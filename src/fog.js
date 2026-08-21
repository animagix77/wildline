import * as THREE from 'three';
import { G } from './state.js';
import { WORLD, HALF, TEAM, BASE } from './config.js';
import { terrainHeight } from './utils.js';

/* =========================================================================
   Critters vs Compute — fog of war
   =========================================================================

   DESIGN NOTES
   ------------
   * Fog gates *information*, never the player's own agency. Wild entities are
     never hidden by their own fog — `applyConcealment()` skips TEAM.WILD
     outright, so a wolf can never vanish on you even if a bug left a hole in
     the grid.
   * Neutral Groves are the map's economic vocabulary. Once a Grove has been
     explored it stays on screen forever (never ghosted, never re-hidden) so
     the player can always plan an expansion route. Only *unexplored* Groves
     are hidden — discovering them is the reward for scouting.
   * The match opens with a revealed disc around the Heart Tree (see
     `START_REVEAL`) marked EXPLORED, so the first frame reads as "my valley,
     the rest is unknown" rather than "the game failed to load".
   * Machine *units* disappear when they leave vision — that is the whole point
     of the fog. Machine *structures* that have ever been seen stay drawn as a
     "last known" ghost (`entity.ghost === true`), because a base that erases
     itself the moment you look away is hostile to planning, not mysterious.

   THREE STATES per cell: UNSEEN (0) / EXPLORED (1) / VISIBLE (2).

   GRID SIZING
   -----------
   GRID = 128 cells across a 240-unit world => CELL = 1.875 units.
   * 1.875u is smaller than every unit collision radius in the game (largest is
     the bear at 1.7), so a vision edge never mis-classifies the cell a unit is
     standing in, and the Heart Tree's 6.5u footprint spans ~7 cells.
   * 128x128 = 16,384 cells = a 16 KB single-channel texture: a power-of-two
     upload, one page of memory, trivial to re-upload every frame.
   * Finer (e.g. 1.5u => 160x160) buys nothing visible: the fragment shader
     already runs a 3-texel tent over the mask, so the *rendered* softness is
     ~3.5 units regardless. Coarser (2.5u) starts to show as blockiness on the
     26u wolf discs even through the tent.

   COST
   ----
   Visibility is recomputed at RECOMPUTE_HZ (10 Hz) and only ever touches cells
   inside a viewer's disc, using an analytic per-row span (x-extent solved from
   r^2 - dz^2) rather than a bounding-box scan with an inner reject. There is
   no full-grid iteration anywhere in the steady state: per-frame smoothing
   walks a compacted dirty list of cells that are still mid-fade, which drains
   to zero whenever the front line is quiet.
   ========================================================================= */

/* ------------------------------------------------------------- tuning -- */
const GRID  = 128;
const CELL  = WORLD / GRID;                 // 1.875 world units per cell
const NCELL = GRID * GRID;

const UNSEEN = 0, EXPLORED = 1, VISIBLE = 2;

/* Mask byte levels. The shader maps 0 -> opaque black, MASK_EXPLORED -> veil,
   1 -> fully transparent. Keeping EXPLORED off-centre (0.42 rather than 0.5)
   widens the unseen->explored ramp so the outer fog edge is the soft one. */
const MASK_EXPLORED = 0.42;

const RECOMPUTE_HZ  = 10;
const RECOMPUTE_DT  = 1 / RECOMPUTE_HZ;

/* Asymmetric time constants: reveal snappily, conceal lazily. The slow decay
   is what kills strobing — a viewer jittering across a cell boundary at 10 Hz
   can never darken the cell before the next stamp re-lights it. */
const TAU_REVEAL = 0.09;
const TAU_CONCEAL = 0.30;
const CONVERGE = 1 / 512;                   // below this we snap and retire the cell

/* Vision for wild structures, which have no `def.vision`. The Heart Tree is a
   40 m canopy full of birds — it sees considerably further than a wolf (26). */
const BUILDING_VISION = { hearttree: 34 };
const BUILDING_VISION_DEFAULT = 18;

/* A bloomed Grove is your territory even though its `team` is NEUTRAL, so it
   grants a small watch radius. Set to 0 to make groves purely economic. */
const GROVE_VISION = 14;

const START_REVEAL = 42;                    // opening explored disc at the Heart Tree

/* How long a machine entity stays drawn after slipping out of vision. Purely
   anti-flicker: at 10 Hz a unit skimming a vision edge would otherwise blink. */
const CONCEAL_HOLD = 0.35;

/* Plane overhang past the world edge, so the terrain's hard border sits under
   black fog instead of ending in mid-air. */
const PLANE_PAD = 12;

/* Height above the terrain surface. The fog plane is displaced by the *same*
   `terrainHeight()` field as the ground, so this is a constant normal-ish
   offset rather than a "sit above the tallest hill" fudge; 0.35 is ~5 orders
   of magnitude more than the depth-buffer resolution at RTS distances and
   ~100x the worst-case sag between the fog plane's 2.2u tessellation and the
   terrain's 1.26u tessellation of the same continuous function (both sample
   `terrainHeight`, whose finest feature is ~65u across, so the piecewise-linear
   surfaces differ by well under 0.01u). */
const FOG_Y = 0.35;
const PLANE_SEG = 120;                      // (WORLD + 2*PAD) / 120 = 2.2 u per quad

/* --------------------------------------------------------------- state -- */
let inited = false;
let revealAll = false;

let state, target, level, texData;
let visA, visB, visCount = 0;               // cells set VISIBLE by the last stamp pass
let dirtyFlag, dirty, dirtyCount = 0;

let tex = null, mesh = null, geo = null, mat = null;
let accum = 0, clock = 0;
let maskVersion = 0;

/* Lazily-built 2D mirror of the mask, for the minimap. */
let fogMmCanvas = null, fogMmCtx = null, fogMmImg = null, fogMmVersion = -1;

/* Entities we have touched, so `disposeFog()` can put them back exactly. */
const touched = new Set();

/* ============================================================ helpers === */

const cellX = wx => ((wx + HALF) / CELL) | 0;
const cellZ = wz => ((wz + HALF) / CELL) | 0;

function markDirty(i) {
  if (dirtyFlag[i]) return;
  dirtyFlag[i] = 1;
  dirty[dirtyCount++] = i;
}

function setTarget(i, v) {
  if (target[i] === v) return;
  target[i] = v;
  markDirty(i);
}

/* ============================================================== init ==== */

export function initFog() {
  if (inited) disposeFog();

  state    = new Uint8Array(NCELL);          // all UNSEEN
  target   = new Float32Array(NCELL);        // all 0
  level    = new Float32Array(NCELL);        // all 0
  texData  = new Uint8Array(NCELL);          // all 0
  visA     = new Int32Array(NCELL);
  visB     = new Int32Array(NCELL);
  dirtyFlag = new Uint8Array(NCELL);
  dirty    = new Int32Array(NCELL);
  dirtyCount = 0;
  visCount = 0;
  accum = 0;
  clock = 0;
  maskVersion = 1;
  fogMmVersion = -1;
  revealAll = false;
  touched.clear();

  /* ---- mask texture ------------------------------------------------- */
  tex = new THREE.DataTexture(texData, GRID, GRID, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;                          // row 0 == cell z 0 == world z -HALF
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  bindMaskToProps();

  /* ---- displaced veil plane ----------------------------------------- */
  const span = WORLD + PLANE_PAD * 2;
  geo = new THREE.PlaneGeometry(span, span, PLANE_SEG, PLANE_SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)) + FOG_Y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  uniforms.uMask         = { value: tex };
  uniforms.uTexel        = { value: new THREE.Vector2(1 / GRID, 1 / GRID) };
  uniforms.uUnseenColor  = { value: new THREE.Color(0x05070a) };
  uniforms.uVeilColor    = { value: new THREE.Color(0x0d1a18) };
  uniforms.uVeilAlpha    = { value: 0.58 };
  uniforms.uExplored     = { value: MASK_EXPLORED };
  uniforms.uWarp         = { value: 2.6 / WORLD };   // organic edge wobble, in uv
  uniforms.uWorld        = { value: WORLD };
  uniforms.uHalf         = { value: HALF };

  mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: true,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uWorld;
      uniform float uHalf;
      varying vec2 vGridUv;
      varying vec2 vWorldXZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldXZ = wp.xz;
        vGridUv  = (wp.xz + uHalf) / uWorld;
        vec4 mvPosition = viewMatrix * wp;
        #include <fog_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uMask;
      uniform vec2  uTexel;
      uniform vec3  uUnseenColor;
      uniform vec3  uVeilColor;
      uniform float uVeilAlpha;
      uniform float uExplored;
      uniform float uWarp;
      varying vec2 vGridUv;
      varying vec2 vWorldXZ;

      float h21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i),               h21(i + vec2(1.0, 0.0)), u.x),
                   mix(h21(i + vec2(0.0,1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        /* Static world-space domain warp. Because it is a function of world
           position on a fixed plane it does not crawl when the camera moves;
           it just stops the fog boundary from reading as a union of circles. */
        vec2 w = vec2(vnoise(vWorldXZ * 0.11), vnoise(vWorldXZ * 0.11 + 37.0)) - 0.5;
        vec2 guv = vGridUv + w * uWarp;

        /* 4 bilinear taps at half-texel diagonals == a 3-texel tent over the
           mask. This, not the texture filter alone, is what removes the grid. */
        vec2 o = uTexel * 0.5;
        float v = texture2D(uMask, clamp(guv + vec2( o.x,  o.y), 0.0, 1.0)).r
                + texture2D(uMask, clamp(guv + vec2(-o.x,  o.y), 0.0, 1.0)).r
                + texture2D(uMask, clamp(guv + vec2( o.x, -o.y), 0.0, 1.0)).r
                + texture2D(uMask, clamp(guv + vec2(-o.x, -o.y), 0.0, 1.0)).r;
        v *= 0.25;

        /* Anything past the world border is unseen, ramped so the terrain's
           square edge dissolves instead of ending. */
        vec2 e0 = smoothstep(vec2(0.0), vec2(0.012), vGridUv);
        vec2 e1 = 1.0 - smoothstep(vec2(0.988), vec2(1.0), vGridUv);
        v *= e0.x * e0.y * e1.x * e1.y;

        float a = mix(1.0, uVeilAlpha, smoothstep(0.0, uExplored, v));
        a = mix(a, 0.0, smoothstep(uExplored, 1.0, v));
        if (a <= 0.002) discard;

        vec3 col = mix(uUnseenColor, uVeilColor, smoothstep(0.0, uExplored, v));
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }
    `,
  });

  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;      // after ground decals / selection rings; the
                             // depthTest:false health bars still draw on top
  mesh.name = 'fogOfWar';
  G.scene.add(mesh);

  inited = true;

  /* Opening reveal around the Heart Tree, snapped (no fade-in on frame 1). */
  const hp = (G.heart && G.heart.pos) || BASE;
  revealCircle(hp.x, hp.z, START_REVEAL);
  for (let i = 0; i < NCELL; i++) {
    if (state[i] === UNSEEN) continue;
    level[i] = target[i];
    texData[i] = (target[i] * 255 + 0.5) | 0;
    dirtyFlag[i] = 0;
  }
  dirtyCount = 0;
  tex.needsUpdate = true;
}

/* Permanently mark a disc EXPLORED (used for the opening reveal). */
function revealCircle(wx, wz, r) {
  const r2 = r * r;
  const j0 = Math.max(0, Math.ceil((wz - r + HALF) / CELL - 0.5));
  const j1 = Math.min(GRID - 1, Math.floor((wz + r + HALF) / CELL - 0.5));
  for (let j = j0; j <= j1; j++) {
    const dz = ((j + 0.5) * CELL - HALF) - wz;
    const rem = r2 - dz * dz;
    if (rem <= 0) continue;
    const dx = Math.sqrt(rem);
    const a = Math.max(0, Math.ceil((wx - dx + HALF) / CELL - 0.5));
    const b = Math.min(GRID - 1, Math.floor((wx + dx + HALF) / CELL - 0.5));
    const row = j * GRID;
    for (let i = a; i <= b; i++) {
      const k = row + i;
      if (state[k] !== UNSEEN) continue;
      state[k] = EXPLORED;
      setTarget(k, MASK_EXPLORED);
    }
  }
}

/* ========================================================== visibility == */

/* Stamp one viewer's disc. Rows are span-solved, so every cell we touch is
   already inside the circle — no bounding-box rejects, no full-grid scan. */
function stamp(wx, wz, r) {
  if (!(r > 0)) return;
  const r2 = r * r;
  let j0 = Math.ceil((wz - r + HALF) / CELL - 0.5);
  let j1 = Math.floor((wz + r + HALF) / CELL - 0.5);
  if (j0 < 0) j0 = 0;
  if (j1 > GRID - 1) j1 = GRID - 1;

  for (let j = j0; j <= j1; j++) {
    const dz = ((j + 0.5) * CELL - HALF) - wz;
    const rem = r2 - dz * dz;
    if (rem <= 0) continue;
    const dx = Math.sqrt(rem);
    let a = Math.ceil((wx - dx + HALF) / CELL - 0.5);
    let b = Math.floor((wx + dx + HALF) / CELL - 0.5);
    if (a < 0) a = 0;
    if (b > GRID - 1) b = GRID - 1;
    const row = j * GRID;
    for (let i = a; i <= b; i++) {
      const k = row + i;
      if (state[k] === VISIBLE) continue;    // already lit this pass
      state[k] = VISIBLE;
      setTarget(k, 1);
      visA[visCount++] = k;
    }
  }
}

function viewRadius(e) {
  if (e.isBuilding) {
    if (e.type === 'grove') return e.owned ? GROVE_VISION : 0;
    return BUILDING_VISION[e.type] || BUILDING_VISION_DEFAULT;
  }
  return e.def.vision || 0;
}

function recompute() {
  /* 1. Demote last pass's visible set. Targets are left alone for now so that
        cells which stay visible never churn through the dirty list. */
  const prev = visA, prevCount = visCount;
  for (let n = 0; n < prevCount; n++) state[prev[n]] = EXPLORED;

  /* 2. Stamp every wild viewer into the (now free) buffer. */
  visA = visB; visB = prev;
  visCount = 0;

  const ents = G.entities;
  for (let n = 0; n < ents.length; n++) {
    const e = ents[n];
    if (!e.alive) continue;
    if (e.team !== TEAM.WILD && !(e.type === 'grove' && e.owned)) continue;
    stamp(e.pos.x, e.pos.z, viewRadius(e));
  }

  /* 3. Cells that were visible and no longer are start fading to the veil. */
  for (let n = 0; n < prevCount; n++) {
    const k = prev[n];
    if (state[k] === EXPLORED) setTarget(k, MASK_EXPLORED);
  }
}

/* ============================================================= update === */

export function updateFog(dt) {
  fadeBeacons();
  if (!inited) return;
  if (dt > 0.1) dt = 0.1;
  clock += dt;

  if (!revealAll) {
    accum += dt;
    if (accum >= RECOMPUTE_DT) {
      /* Never run more than one catch-up pass: after a tab-switch stall we
         want one correct snapshot, not a burst of identical ones. */
      accum = accum > RECOMPUTE_DT * 4 ? 0 : accum - RECOMPUTE_DT;
      recompute();
    }
  }

  smooth(dt);
  applyConcealment();
}

/* Walk only the cells still in flight. Converged cells retire from the list,
   so a quiet front line costs literally zero. */
function smooth(dt) {
  if (!dirtyCount) return;
  const kUp = 1 - Math.exp(-dt / TAU_REVEAL);
  const kDn = 1 - Math.exp(-dt / TAU_CONCEAL);
  let w = 0;
  for (let n = 0; n < dirtyCount; n++) {
    const i = dirty[n];
    const t = target[i];
    const l = level[i];
    const nl = l + (t - l) * (t > l ? kUp : kDn);
    if (Math.abs(t - nl) < CONVERGE) {
      level[i] = t;
      texData[i] = (t * 255 + 0.5) | 0;
      dirtyFlag[i] = 0;                       // retire
    } else {
      level[i] = nl;
      texData[i] = (nl * 255 + 0.5) | 0;
      dirty[w++] = i;                         // compact in place (w <= n always)
    }
  }
  dirtyCount = w;
  tex.needsUpdate = true;
  maskVersion++;
}

/* ========================================================= concealment == */

/* Ghosting must not touch materials: `M()`/`GLOW()` in meshes.js hand out
   cached, SHARED MeshStandardMaterial / MeshBasicMaterial instances, so
   setting `.opacity` on a turret's material would fade every turret, every
   depot that happens to reuse the same colour key, and any scenery built from
   the same swatch. Cloning per entity would be safe but would double the
   material count for ~40 structures and silently break the shared-material
   assumption other systems may rely on.
   Instead the treatment is entirely per-Object3D (every entity gets a fresh
   Object3D tree from BUILDERS[type]()):
     - the emissive GLOW sub-meshes are switched off, so the structure reads as
       dark and powered-down rather than live;
     - the health bar is switched off, which is also the *correct* behaviour —
       a remembered building must not leak its current hit points.
   Both are plain `.visible` writes on objects this entity exclusively owns. */
function ghostParts(e) {
  let parts = e._fogGlow;
  if (parts) return parts;
  parts = [];
  const hbG = e.hb ? e.hb.g : null;
  const ring = e.ring || null;
  e.mesh.traverse(o => {
    if (o === hbG || o === ring || o.parent === hbG) return;
    const m = o.material;
    if (m && m.isMeshBasicMaterial) parts.push(o);
  });
  e._fogGlow = parts;
  return parts;
}

function setGhost(e, on) {
  if (e._fogGhosted === on) return;
  e._fogGhosted = on;
  const parts = ghostParts(e);
  for (let i = 0; i < parts.length; i++) parts[i].visible = !on;
}

function show(e, visible) {
  if (e.mesh.visible !== visible) e.mesh.visible = visible;
}

function applyConcealment() {
  const ents = G.entities;
  for (let n = 0; n < ents.length; n++) {
    const e = ents[n];
    if (!e.alive) continue;                   // corpses keep whatever they had

    /* The player's own wildlife is never hidden and never ghosted. */
    if (e.team === TEAM.WILD) {
      e.ghost = false;
      if (e._fogGhosted) setGhost(e, false);
      show(e, true);
      continue;
    }

    if (revealAll) {
      e.ghost = false;
      if (e._fogGhosted) setGhost(e, false);
      show(e, true);
      continue;
    }

    touched.add(e);   // so disposeFog() can put this entity back exactly

    const ci = cellX(e.pos.x), cj = cellZ(e.pos.z);
    const inside = ci >= 0 && ci < GRID && cj >= 0 && cj < GRID;
    const st = inside ? state[cj * GRID + ci] : UNSEEN;
    const seenNow = st === VISIBLE;
    if (seenNow) e._fogSeenAt = clock;
    if (st !== UNSEEN) e._fogEverSeen = true;

    /* Neutral Groves are permanent landmarks — they are the entire economy, and
       hiding all six at t=0 leaves the player with nowhere to go. But rendering a
       fully-lit ring of standing stones inside pitch blackness reads as a bug, not
       as a beacon. So an unvisited Grove shows ONLY its column of light, which rises
       far above the ground-hugging veil: you can see that something is out there and
       roughly where, but not what state it is in until you walk to it. */
    if (e.team === TEAM.NEUTRAL) {
      e.ghost = false;
      if (e._fogGhosted) setGhost(e, false);
      show(e, true);
      setGroveBeacon(e, !e._fogEverSeen);
      continue;
    }

    /* Machines. */
    const held = seenNow || (clock - (e._fogSeenAt || -99) < CONCEAL_HOLD);
    if (held) {
      e.ghost = false;
      if (e._fogGhosted) setGhost(e, false);
      show(e, true);
    } else if (e.isBuilding && e._fogEverSeen) {
      e.ghost = true;                          // last-known silhouette
      if (!e._fogGhosted) setGhost(e, true);
      show(e, true);
      if (e.hb) e.hb.g.visible = false;         // runs after Entity.postUpdate
    } else {
      e.ghost = false;
      if (e._fogGhosted) setGhost(e, false);
      show(e, false);
    }
  }
}

/* ============================================================== queries = */

/* Fail-open: if the fog has not been initialised nothing should ever be
   hidden, so both queries report "you can see it". */
export function isVisible(x, z) {
  if (!inited || revealAll) return true;
  const i = cellX(x), j = cellZ(z);
  if (i < 0 || i >= GRID || j < 0 || j >= GRID) return false;
  return state[j * GRID + i] === VISIBLE;
}

export function isExplored(x, z) {
  if (!inited || revealAll) return true;
  const i = cellX(x), j = cellZ(z);
  if (i < 0 || i >= GRID || j < 0 || j >= GRID) return false;
  return state[j * GRID + i] !== UNSEEN;
}

/* True once this structure has ever entered vision — what a minimap wants in
   order to keep drawing a remembered building. */
export function isRemembered(e) {
  if (!inited || revealAll) return true;
  return !!e._fogEverSeen;
}

/* Paint the fog onto a 2D minimap context, upscaled with smoothing so the
   minimap gets the same soft edge the 3D veil has. The 128x128 mirror is only
   rebuilt when the mask actually changed, so a static front line is free.
   `size` is the minimap's pixel size (200 in this HUD). */
export function drawFogOverlay(ctx, size) {
  if (!inited || revealAll) return;
  if (!fogMmCanvas) {
    if (typeof document === 'undefined') return;
    fogMmCanvas = document.createElement('canvas');
    fogMmCanvas.width = fogMmCanvas.height = GRID;
    fogMmCtx = fogMmCanvas.getContext('2d');
    fogMmImg = fogMmCtx.createImageData(GRID, GRID);
    const d = fogMmImg.data;
    for (let i = 0; i < NCELL; i++) { d[i * 4] = 4; d[i * 4 + 1] = 8; d[i * 4 + 2] = 7; }
  }
  if (fogMmVersion !== maskVersion) {
    fogMmVersion = maskVersion;
    const d = fogMmImg.data;
    const veil = 0.55;
    for (let i = 0; i < NCELL; i++) {
      const v = level[i];
      /* Row 0 of the ImageData is the top of the minimap, and cell row 0 is
         world z = -HALF, which the HUD also maps to y = 0. No flip needed. */
      const a = v < MASK_EXPLORED
        ? 1 - (1 - veil) * (v / MASK_EXPLORED)
        : veil * (1 - (v - MASK_EXPLORED) / (1 - MASK_EXPLORED));
      d[i * 4 + 3] = (a * 255 + 0.5) | 0;
    }
    fogMmCtx.putImageData(fogMmImg, 0, 0);
  }
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogMmCanvas, 0, 0, size, size);
  ctx.imageSmoothingEnabled = prev;
}

/* ============================================================== reveal == */

export function fogRevealAll(on = true) {
  if (!inited) return;
  if (revealAll === on) return;   // idempotent, so it is safe to call every frame
  revealAll = on;
  if (on) {
    for (let i = 0; i < NCELL; i++) {
      state[i] = VISIBLE;
      setTarget(i, 1);
    }
    applyConcealment();
  } else {
    /* Re-derive from scratch: everything we lit stays EXPLORED, and the next
       recompute re-lights what is genuinely in vision. */
    for (let i = 0; i < NCELL; i++) {
      state[i] = EXPLORED;
      setTarget(i, MASK_EXPLORED);
    }
    visCount = 0;
    accum = RECOMPUTE_DT;
  }
}

/* ============================================================= teardown = */

export function disposeFog() {
  if (!inited) return;

  for (const e of touched) {
    if (e._fogGhosted) setGhost(e, false);
    e.ghost = false;
    if (e.mesh) e.mesh.visible = true;
    delete e._fogGlow;
    delete e._fogGhosted;
    delete e._fogSeenAt;
    delete e._fogEverSeen;
  }
  touched.clear();

  if (mesh && mesh.parent) mesh.parent.remove(mesh);
  if (geo) geo.dispose();
  if (mat) mat.dispose();
  if (tex) tex.dispose();

  fogMmCanvas = null; fogMmCtx = null; fogMmImg = null; fogMmVersion = -1;
  mesh = null; geo = null; mat = null; tex = null;
  state = target = level = texData = null;
  visA = visB = dirty = dirtyFlag = null;
  dirtyCount = 0; visCount = 0;
  revealAll = false;
  inited = false;
}

/* =========================================================================
   Prop concealment.

   The veil is a ground-hugging plane, so anything tall — trees, rocks, brush —
   pokes straight through it and stays fully lit inside unexplored terrain,
   which reads as a bug. Hiding individual instances of an InstancedMesh would
   mean rewriting instance matrices every frame; instead we patch the prop
   materials to sample the very same mask, with the very same warp, tent and
   ramp the veil uses, so a tree fades out exactly where the ground under it
   does. Cost is four texture taps in a shader that already runs.

   Call `applyFogMask(material)` at scene-build time — before or after
   initFog(), order does not matter: the sampler uniform is filled in later.
   ========================================================================= */

/* Distant-beacon treatment for an unvisited Grove: everything but the light
   column is switched off. These are per-entity Object3Ds built fresh by
   BUILDERS.grove(), and the pillar's material is created inline by buildGrove
   rather than coming from the shared `M()` cache, so nudging its opacity here
   cannot leak into any other object. */
const BEACON_MAX = 0.30;

/* A beacon is a far-away navigational cue. Close up it is a wall of additive
   light across the viewport, so it fades out as the camera approaches — by the
   time you are near enough to see the grove itself you no longer need the marker. */
function fadeBeacons() {
  const cam = G.camera;
  if (!cam || !G.groves) return;
  for (const g of G.groves) {
    const a = g.anim;
    if (!a || !g._fogBeacon) continue;
    const d = Math.hypot(cam.position.x - g.pos.x, cam.position.z - g.pos.z);
    const t = Math.max(0, Math.min(1, (d - 35) / 60));
    const ramp = t * t * (3 - 2 * t);
    if (a.pillar) a.pillar.material.opacity = BEACON_MAX * ramp;
    /* The ring rides the SAME ramp. Fading only the shaft left a flat grey donut
       hanging in pitch blackness with no light source above it — which reads as a
       rendering artefact, not a beacon. */
    if (a.beaconRing) { a.beaconRing.userData.fade = ramp; a.beaconRing.visible = ramp > 0.02; }
  }
}

function setGroveBeacon(e, beaconOnly) {
  if (e._fogBeacon === beaconOnly) return;
  e._fogBeacon = beaconOnly;
  const pillar = e.anim && e.anim.pillar;
  const bloom = e.anim && e.anim.bloom;
  const beaconRing = e.anim && e.anim.beaconRing;
  for (const child of e.mesh.children) {
    if (child === pillar || child === beaconRing) continue;
    if (child === e.hb.g || child === e.ring) continue;   // HUD furniture, owned elsewhere
    // the flowering ring is world.js's to control — restore it to the capture state,
    // never blanket-on, or an uncaptured grove would bloom the moment you walked past
    child.visible = child === bloom ? (!beaconOnly && !!e.owned) : !beaconOnly;
  }
  if (beaconRing) { beaconRing.visible = beaconOnly; beaconRing.userData.fade = beaconOnly ? 1 : 0; }
  if (pillar) {
    // additive, so this is brightness rather than coverage. Kept low: at 0.8 on a
    // 45 m column six of these saturate to white and paint over the whole scene.
    pillar.material.opacity = beaconOnly ? BEACON_MAX : (e.owned ? 0.55 : 0.35);
    pillar.scale.set(beaconOnly ? 0.85 : 1, 1, 1);
    /* The shaft is 46m tall and billboarded, so its upper half clears the canopy and
       the forest without needing to draw through them. Depth testing stays on: a
       marker that paints over the Heart Tree the camera is looking at is worse than
       one that is partly occluded. */
    pillar.material.depthTest = true;
  }
}

const maskedUniformSets = [];

export function applyFogMask(material) {
  if (!material || material.userData.wlFogMasked) return material;
  material.userData.wlFogMasked = true;

  const u = {
    uMask:        { value: tex },                       // null until initFog()
    uTexel:       { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
    uUnseenColor: { value: new THREE.Color(0x05070a) },
    uVeilColor:   { value: new THREE.Color(0x0d1a18) },
    uVeilAlpha:   { value: 0.58 },
    uExplored:    { value: MASK_EXPLORED },
    uWarp:        { value: 2.6 / WORLD },
    uWorld:       { value: WORLD },
    uHalf:        { value: HALF },
  };
  maskedUniformSets.push(u);

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uWorld;
        uniform float uHalf;
        varying vec2 vWlFogGridUv;
        varying vec2 vWlFogWorldXZ;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          // mirror three's own instancing path so InstancedMesh props land correctly
          vec4 wlWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wlWp = instanceMatrix * wlWp;
          #endif
          wlWp = modelMatrix * wlWp;
          vWlFogWorldXZ = wlWp.xz;
          vWlFogGridUv  = (wlWp.xz + uHalf) / uWorld;
        }`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uMask;
        uniform vec2  uTexel;
        uniform vec3  uUnseenColor;
        uniform vec3  uVeilColor;
        uniform float uVeilAlpha;
        uniform float uExplored;
        uniform float uWarp;
        uniform float uWorld;
        uniform float uHalf;
        varying vec2 vWlFogGridUv;
        varying vec2 vWlFogWorldXZ;

        float wlFogH21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float wlFogNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 uu = f * f * (3.0 - 2.0 * f);
          return mix(mix(wlFogH21(i),                 wlFogH21(i + vec2(1.0, 0.0)), uu.x),
                     mix(wlFogH21(i + vec2(0.0,1.0)), wlFogH21(i + vec2(1.0, 1.0)), uu.x), uu.y);
        }`)
      // after colour-space conversion, so the blend matches the veil plane's
      // raw output rather than fighting it in linear space
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          vec2 wlW = vec2(wlFogNoise(vWlFogWorldXZ * 0.11),
                          wlFogNoise(vWlFogWorldXZ * 0.11 + 37.0)) - 0.5;
          vec2 wlGuv = vWlFogGridUv + wlW * uWarp;
          vec2 wlO = uTexel * 0.5;
          float wlV = texture2D(uMask, clamp(wlGuv + vec2( wlO.x,  wlO.y), 0.0, 1.0)).r
                    + texture2D(uMask, clamp(wlGuv + vec2(-wlO.x,  wlO.y), 0.0, 1.0)).r
                    + texture2D(uMask, clamp(wlGuv + vec2( wlO.x, -wlO.y), 0.0, 1.0)).r
                    + texture2D(uMask, clamp(wlGuv + vec2(-wlO.x, -wlO.y), 0.0, 1.0)).r;
          wlV *= 0.25;
          vec2 wlE0 = smoothstep(vec2(0.0), vec2(0.012), vWlFogGridUv);
          vec2 wlE1 = 1.0 - smoothstep(vec2(0.988), vec2(1.0), vWlFogGridUv);
          wlV *= wlE0.x * wlE0.y * wlE1.x * wlE1.y;

          float wlA = mix(1.0, uVeilAlpha, smoothstep(0.0, uExplored, wlV));
          wlA = mix(wlA, 0.0, smoothstep(uExplored, 1.0, wlV));
          vec3 wlCol = mix(uUnseenColor, uVeilColor, smoothstep(0.0, uExplored, wlV));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, wlCol, wlA);
        }`);
  };
  // distinct program cache key so a masked material never reuses an unmasked program
  material.customProgramCacheKey = () => 'wlFogMasked';
  material.needsUpdate = true;
  return material;
}

/* initFog() calls this once the DataTexture exists. */
function bindMaskToProps() {
  for (const u of maskedUniformSets) u.uMask.value = tex;
}
