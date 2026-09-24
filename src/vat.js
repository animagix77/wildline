import * as THREE from 'three';
import { G } from './state.js';

/* =========================================================================
   VERTEX ANIMATION TEXTURES — Blender-rigged units at instanced cost.

   Why this exists: the procedural animals are merged static meshes (~0.03ms
   each), which is what lets the pop cap sit at 280. A real rigged character
   cannot be merged — every one is its own draw call running bone math every
   frame — so 140 skinned wolves would land a performance cliff exactly on the
   swarm identity the game is built around.

   So the animation is authored properly in Blender (assets/src/<species>.blend:
   armature, heat-diffusion skinning, one Action per clip), then BAKED: every
   clip is sampled and every vertex position written into a texture, one row per
   sample. At runtime ONE InstancedMesh per species draws every living animal of
   that species in a single call; the vertex shader reads its position out of
   the texture for whichever frame that instance is on. Real Blender animation,
   one draw call, no bone math.

   Integration is deliberately thin. An entity still owns an ordinary Group —
   position, facing, health bar, selection ring, picking — but its body is an
   invisible pick proxy. Each frame this module copies every such entity's
   matrixWorld into the instance buffer, so facing, hit-lean, lunge, corpse
   topple and corpse sink, which all move that Group, carry over with no extra
   code. All this module decides is WHICH FRAME each animal shows.

   Replaced by build.mjs with the baked assets inlined as base64; the dev build
   fetches assets/vat/<species>.{json,bin} instead.
   ========================================================================= */
export const EMBEDDED_VAT = null;

/* Species with a baked asset. The build embeds whatever is in assets/vat/, but
   only these are switched on — a baked species is not a shipped species until
   it has been looked at. */
const VAT_SPECIES = ['wolf'];

/* ?vat=0 forces the procedural models: an A/B for performance and a kill switch
   if a GPU chokes on half-float textures. */
const VAT_ENABLED = !/[?&]vat=0\b/.test(typeof location !== 'undefined' ? location.search : '');

const vatSets = {};              // species -> { manifest, geo, mat, depth, tex, mesh, attr, cap }
const vatPending = {};           // species -> manifest+buffer waiting for a scene

const _vatM = new THREE.Matrix4();

function vatB64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

function vatSrgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/* The one hook both materials share: replace the rest position with a texture
   read, interpolated between the two frames this instance sits between. The
   normal is left alone on purpose — the material is flat-shaded, so lighting
   comes from screen-space derivatives of the DEFORMED position and needs no
   baked normals at all, which halves the texture. */
function vatHook(tex) {
  return shader => {
    shader.uniforms.uVat = { value: tex };
    shader.vertexShader = 'uniform highp sampler2D uVat;\nattribute float aVid;\nattribute vec3 aVat;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', `
        ivec2 vatA = ivec2(int(aVid), int(aVat.x));
        ivec2 vatB = ivec2(int(aVid), int(aVat.y));
        vec3 transformed = mix(texelFetch(uVat, vatA, 0).xyz, texelFetch(uVat, vatB, 0).xyz, aVat.z);
      `);
  };
}

function vatBuildSet(name, manifest, buf) {
  const V = manifest.vertexCount, R = manifest.rows;
  const idx = new Uint16Array(buf, manifest.offsets.indices, manifest.indexCount);
  const col = new Uint8Array(buf, manifest.offsets.colors, V * 4);
  const vat = new Uint16Array(buf, manifest.offsets.vat, R * V * 4);

  const geo = new THREE.BufferGeometry();
  // rest positions = the first idle row; only used for normals and bounds
  const pos = new Float32Array(V * 3);
  for (let i = 0; i < V; i++) {
    pos[i * 3]     = THREE.DataUtils.fromHalfFloat(vat[i * 4]);
    pos[i * 3 + 1] = THREE.DataUtils.fromHalfFloat(vat[i * 4 + 1]);
    pos[i * 3 + 2] = THREE.DataUtils.fromHalfFloat(vat[i * 4 + 2]);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  /* Colours are baked as sRGB bytes and converted here, because every other
     vertex-coloured mesh in the game stores LINEAR colour (THREE.Color does the
     conversion when the procedural builders run). Skip it and the wolf comes
     out visibly paler than the animals standing next to it. */
  const lin = new Float32Array(V * 3);
  for (let i = 0; i < V; i++) {
    lin[i * 3]     = vatSrgbToLinear(col[i * 4]);
    lin[i * 3 + 1] = vatSrgbToLinear(col[i * 4 + 1]);
    lin[i * 3 + 2] = vatSrgbToLinear(col[i * 4 + 2]);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(lin, 3));
  const vid = new Float32Array(V);
  for (let i = 0; i < V; i++) vid[i] = i;
  geo.setAttribute('aVid', new THREE.BufferAttribute(vid, 1));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const tex = new THREE.DataTexture(new Uint16Array(vat), V, R, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  // matches VC_MAT, so a baked wolf lights exactly like the procedural boar beside it
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = vatHook(tex);
  mat.customProgramCacheKey = () => 'vat_std_v1';
  /* The shadow pass draws with its own depth material. Without the same hook
     the shadow would be the rest pose — a frozen wolf's shadow under a running
     one. */
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = vatHook(tex);
  depth.customProgramCacheKey = () => 'vat_depth_v1';

  const clips = {};
  for (const c of manifest.clips) clips[c.name] = c;
  vatSets[name] = { name, manifest, clips, geo, mat, depth, tex, mesh: null, attr: null, cap: 0 };
}

/* Load at import: synchronous from the bundle, a fetch in the dev build. The
   dev fetch virtually always lands before the player has cleared the title
   screen; if it has not, early animals simply build procedurally (see
   vatProxy) — never invisible. */
if (VAT_ENABLED) {
  for (const name of VAT_SPECIES) {
    if (EMBEDDED_VAT && EMBEDDED_VAT[name]) {
      try { vatBuildSet(name, EMBEDDED_VAT[name].manifest, vatB64(EMBEDDED_VAT[name].bin)); }
      catch (err) { console.warn('[vat] embedded asset failed for', name, err); }
    } else if (typeof fetch === 'function') {
      const base = new URL('../assets/vat/', import.meta.url);
      Promise.all([
        fetch(new URL(name + '.json', base)).then(r => r.json()),
        fetch(new URL(name + '.bin', base)).then(r => r.arrayBuffer()),
      ]).then(([m, b]) => vatBuildSet(name, m, b))
        .catch(err => console.warn('[vat] no baked asset for', name, '- using procedural', err));
    }
  }
}

export function vatReady(name) { return !!vatSets[name]; }

/* The stand-in an entity carries when its body is drawn by the instance buffer.
   Picking rejects anything with visible === false anywhere up the chain (fog
   has to be able to hide a guard), so the proxy stays VISIBLE and its MATERIAL
   is switched off instead: the raycaster still hits it, the renderer never
   draws it. */
const vatProxyMat = new THREE.MeshBasicMaterial({ visible: false });
const vatProxyGeo = {};
export function vatProxy(name) {
  const S = vatSets[name];
  if (!S) return null;
  if (!vatProxyGeo[name]) {
    const b = S.manifest.bounds;
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], l = b.max[2] - b.min[2];
    const g = new THREE.BoxGeometry(w * 0.9, h * 0.8, l * 0.75);
    g.translate((b.max[0] + b.min[0]) / 2, h * 0.45, (b.max[2] + b.min[2]) / 2);
    vatProxyGeo[name] = g;
  }
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(vatProxyGeo[name], vatProxyMat));
  /* kind 'vat' falls through every case in Entity.animate(); the fields below
     are this module's per-animal playback state. */
  grp.userData.anim = { kind: 'vat', species: name, clip: 'idle', t: 0, spd: 0, px: null, pz: null };
  return grp;
}

function vatEnsureMesh(S, need) {
  if (S.mesh && S.cap >= need) return;
  const cap = Math.max(64, Math.ceil(need * 1.5));
  if (S.mesh) {
    S.mesh.parent && S.mesh.parent.remove(S.mesh);
    S.mesh.geometry.dispose(); S.mesh.dispose();
  }
  // per-mesh geometry: the instanced attribute belongs to this buffer, not the shared template
  const geo = S.geo.clone();
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aVat', attr);
  const mesh = new THREE.InstancedMesh(geo, S.mat, cap);
  mesh.customDepthMaterial = S.depth;
  mesh.castShadow = true; mesh.receiveShadow = true;
  /* Instances roam the whole map every frame; one bounding volume over all of
     them would need recomputing every frame too. One draw call for the whole
     species is cheap enough to always issue. */
  mesh.frustumCulled = false;
  mesh.raycast = () => {};                     // picking goes through the proxies
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  G.scene.add(mesh);
  S.mesh = mesh; S.attr = attr; S.cap = cap;
}

/* Walk/run thresholds in world units per second, with hysteresis so an animal
   hovering near the boundary does not flicker between gaits. */
const VAT_WALK_AT = 0.6, VAT_RUN_UP = 5.5, VAT_RUN_DOWN = 4.5;

function vatPick(S, e, a, dt) {
  const clips = S.clips;
  if (!e.alive) {
    const t = Math.max(0, G.wallTime - (e.deadAt || G.wallTime));
    return ['death', Math.min(t, clips.death.seconds)];
  }
  /* The bite is driven by the attack itself, not by a clock of its own: the
     playhead is the attack's own progress, so the jaws close on exactly the
     frame the damage lands (windup / (windup + recovery) — baked in at 34%). */
  const m = e.attackMotion;
  if (m && clips.bite) {
    const p = Math.min(1, m.elapsed / Math.max(1e-3, m.windup + m.recovery));
    return ['bite', p * clips.bite.seconds];
  }
  // speed from actual displacement, smoothed: independent of how the steering stores velocity
  if (a.px === null) { a.px = e.pos.x; a.pz = e.pos.z; }
  const inst = dt > 0 ? Math.hypot(e.pos.x - a.px, e.pos.z - a.pz) / dt : a.spd;
  a.px = e.pos.x; a.pz = e.pos.z;
  a.spd += (inst - a.spd) * Math.min(1, dt * 10);
  const s = a.spd;
  let want;
  if (s < VAT_WALK_AT) want = 'idle';
  else if (a.clip === 'run') want = s < VAT_RUN_DOWN ? 'walk' : 'run';
  else want = s > VAT_RUN_UP ? 'run' : 'walk';
  const c = clips[want];
  /* Locomotion plays at the rate that keeps the feet planted: the bake measured
     each gait's natural ground speed, so the playback rate is simply speed over
     that. Clamped so a nudge from separation never plays a walk in slow motion. */
  let rate = 1;
  if (want === 'walk') rate = THREE.MathUtils.clamp(s / (c.groundSpeed || 1.9), 0.6, 2.6);
  else if (want === 'run') rate = THREE.MathUtils.clamp(s / (c.groundSpeed || 8.9), 0.7, 1.7);
  if (want !== a.clip) {
    // walk <-> run keep their stride phase so the legs do not jump; anything else restarts
    const from = clips[a.clip];
    const locomotion = (a.clip === 'walk' || a.clip === 'run') && (want === 'walk' || want === 'run');
    a.t = locomotion && from ? (a.t / from.seconds) * c.seconds : 0;
    a.clip = want;
  }
  a.t = (a.t + dt * rate) % c.seconds;
  return [want, a.t];
}

function vatRows(c, t) {
  if (c.loop) {
    const f = (t / c.seconds) * c.count;
    const i = Math.floor(f);
    return [c.row + (i % c.count), c.row + ((i + 1) % c.count), f - i];
  }
  const f = THREE.MathUtils.clamp(t / c.seconds, 0, 1) * (c.count - 1);
  const i = Math.min(Math.floor(f), c.count - 2);
  return [c.row + i, c.row + i + 1, f - i];
}

/* Per frame, after every entity has moved and before anything renders. */
export function updateVat(dt) {
  if (!G.scene) return;
  for (const name in vatSets) {
    const S = vatSets[name];
    let n = 0;
    for (const e of G.entities) {
      const a = e.anim;
      if (!a || a.kind !== 'vat' || a.species !== name) continue;
      if (!e.mesh.parent || !e.mesh.visible) continue;
      n++;
    }
    if (!n && !S.mesh) continue;
    vatEnsureMesh(S, n);
    const arr = S.attr.array;
    let k = 0;
    for (const e of G.entities) {
      const a = e.anim;
      if (!a || a.kind !== 'vat' || a.species !== name) continue;
      const g = e.mesh;
      if (!g.parent || !g.visible) continue;
      g.updateWorldMatrix(false, false);
      S.mesh.setMatrixAt(k, g.matrixWorld);
      const [clip, t] = vatPick(S, e, a, dt);
      /* `a.clip` is the GAIT memory (walk/run/idle) and deliberately survives a
         bite, so the animal resumes mid-stride afterwards. What is actually on
         screen this frame is `a.playing`. */
      a.playing = clip;
      const [ra, rb, fr] = vatRows(S.clips[clip], t);
      arr[k * 3] = ra; arr[k * 3 + 1] = rb; arr[k * 3 + 2] = fr;
      k++;
    }
    S.mesh.count = k;
    S.mesh.instanceMatrix.needsUpdate = true;
    S.attr.needsUpdate = true;
  }
}

/* Harness surface: what is drawn, and how. */
export function vatStats() {
  const out = {};
  for (const name in vatSets) {
    const S = vatSets[name];
    out[name] = { drawn: S.mesh ? S.mesh.count : 0, capacity: S.cap,
      vertices: S.manifest.vertexCount, rows: S.manifest.rows };
  }
  return out;
}
