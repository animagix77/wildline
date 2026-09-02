import * as THREE from 'three';
import { G } from './state.js';
import { rainfall } from './weather.js';
import { postEnabled } from './post.js';
import { rand, terrainHeight, clamp, smoothstep } from './utils.js';
import { toast } from './ui.js';
import { commsEvent } from './comms.js';

/* =========================================================================
   Water, and the draining of it.

   A map can carry lakes. The data centre's intakes pull from them, and the
   level falls on a visible clock. This is the strategic spine of a mission:

     · Groves inside a lake's catchment pay full income only while the lake
       holds. As it drops they wither and pay less, so a player who ignores
       the water watches their economy die on a timer they were shown from
       the first frame.
     · Intake pumps sit inside the compound. Killing one stops its share of
       the draw permanently. So there is a real decision every mission: rush
       the Core, or spend units peeling off to kill pumps first.
     · Nothing here is random. The drain rate is arithmetic and the HUD shows
       it, so losing your water is always a decision you made, never a dice roll.

   The surface is a real reflection: a mirrored render into a target, which is
   what actually sells water at this camera angle.
   ========================================================================= */

const REFILL = 0.9;      // recovery rate as a fraction of the drain rate
const REFLECT_SIZE = 512;

let lakes = [];
let rivers = [];
let reflectTarget = null, reflectCam = null;
const _reflMat = new THREE.Matrix4();
const _norm = new THREE.Vector3(0, 1, 0);
const _plane = new THREE.Plane();

/* Water colours, per map: `palette.water = { deep, shallow, dry }` in sRGB
   hex. The defaults are the old constants. `sky` is the mirror's fallback —
   the reflection is a real render, but at a glancing angle over dark forest
   it comes back dark, so a slice of the sky's horizon colour is blended in
   to keep a lake reading as WATER (light, open) against the ground around
   it. Comes from palette.skyHorizon, the same colour the far fog uses, so
   water and distance agree.                                               */
const WATER_DEFAULTS = { deep: 0x16404a, shallow: 0x3d8e93, dry: 0x5b5647 };
function waterPalette() {
  const pal = (G.map && G.map.palette) || {};
  const w = { ...WATER_DEFAULTS, ...(pal.water || {}) };
  return {
    uDeep:    { value: new THREE.Color(w.deep) },
    uShallow: { value: new THREE.Color(w.shallow) },
    uDry:     { value: new THREE.Color(w.dry) },
    uSky:     { value: new THREE.Color(pal.skyHorizon !== undefined ? pal.skyHorizon : 0xaabbaf) },
  };
}

export function initWater(scene, defs) {
  disposeWater();
  if (!defs || !defs.length) { G.lakes = lakes = []; return; }

  /* Half-float: the mirror is rendered LINEAR and un-tonemapped now (see
     renderWaterReflection), so it has to hold values above 1.0 — a reflected
     sun or coolant glow clipped to white at 8 bits would then be tone-mapped
     a second time and come out grey. */
  reflectTarget = new THREE.WebGLRenderTarget(REFLECT_SIZE, REFLECT_SIZE, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  });
  reflectCam = new THREE.PerspectiveCamera();

  lakes = defs.map(d => {
    const uni = {
      uTime:    { value: 0 },
      uRefl:    { value: reflectTarget.texture },
      uLevel:   { value: 1 },                       // 1 full .. 0 dry
      ...waterPalette(),
      uRadius:  { value: d.r },
    };
    const geo = new THREE.CircleGeometry(d.r, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false,
      vertexShader: `
        varying vec4 vScreen; varying vec2 vLocal; varying vec3 vWorld;
        void main() {
          vLocal = position.xz;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;                    // for a real view-angle fresnel
          gl_Position = projectionMatrix * viewMatrix * wp;
          vScreen = gl_Position;
        }`,
      fragmentShader: `
        uniform sampler2D uRefl; uniform float uTime, uLevel, uRadius;
        uniform vec3 uDeep, uShallow, uDry, uSky;
        varying vec4 vScreen; varying vec2 vLocal; varying vec3 vWorld;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y); }
        void main() {
          float r = length(vLocal) / uRadius;
          /* the shoreline retreats as the level falls; beyond it is cracked bed */
          float edge = uLevel * 0.98;
          float wet = smoothstep(edge, edge - 0.10, r);

          vec2 uv = (vScreen.xy / vScreen.w) * 0.5 + 0.5;
          vec2 ripple = vec2(
            n(vLocal * 0.18 + uTime * 0.35),
            n(vLocal * 0.21 - uTime * 0.28)) - 0.5;
          vec3 refl = texture2D(uRefl, clamp(uv + ripple * 0.02, 0.001, 0.999)).rgb;
          /* The mirror is LINEAR HDR now (see renderWaterReflection), so a
             sun-lit sky comes back at or above 1.0 -- and the fresnel mix
             below was tuned against a tone-mapped mirror bounded at 1.0. Fed
             raw HDR it turned every lake and river into a white sheet.
             Compress here (Reinhard) so the mix sees display-scale values
             again; the surface still goes through post with everything else. */
          refl = refl / (1.0 + refl);
          /* the mirror carries the sky's horizon in with it (see uSky) */
          refl = mix(refl, uSky, 0.12);

          float depth = smoothstep(edge, 0.0, r);
          vec3 body = mix(uShallow, uDeep, depth);
          /* REAL FRESNEL, from the view vector rather than from distance-to-shore.
             The old term keyed off depth-to-shore, which made the SHORE the most
             mirror-like part of a lake and the middle the least -- backwards,
             and at this camera it washed an entire lake to pale grey because
             most of the visible surface sits at middling depth. Schlick against
             the surface normal (+Y) instead: looking down you see INTO the
             water (body colour), and only the grazing far edge turns to mirror,
             which is how water actually behaves. */
          vec3 V = normalize(cameraPosition - vWorld);
          float f = 0.02 + 0.60 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
          vec3 col = mix(body, refl, f);
          col += n(vLocal * 2.2 + uTime * 0.6) * 0.05;

          /* exposed bed: dry, cracked, and lighter the longer it has been out */
          float dry = 1.0 - wet;
          vec3 bed = mix(uDry, uDry * 0.72, n(vLocal * 0.9));
          col = mix(col, bed, dry);
          float a = mix(0.94, 0.85, dry);
          if (uLevel <= 0.02) a = 0.9;
          gl_FragColor = vec4(col, a);
        }`,
    });
    /* RIVER SEGMENTS GET NO CIRCLE MESH. The first river shipped as a chain of
       visible discs and looked exactly like a chain of visible discs — reported
       as "you simply used a bunch of round shaped lakes to build a stream".
       The circles remain as GAMEPLAY data (drinking, damming, draining,
       catchment all key off them); the water the player sees is one continuous
       ribbon built below from the authored polyline. */
    if (d.river) {
      geo.dispose(); mat.dispose();
      return {
        x: d.x, z: d.z, r: d.r, y: terrainHeight(d.x, d.z) + 0.35,
        level: 1, mesh: null, uni: null, river: true,
        baseDrain: d.drain !== undefined ? d.drain : 0.0016,
        warned: {},
      };
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(d.x, d.y !== undefined ? d.y : terrainHeight(d.x, d.z) + 0.5, d.z);
    mesh.renderOrder = 1;
    mesh.raycast = () => {};
    scene.add(mesh);

    return {
      x: d.x, z: d.z, r: d.r, y: mesh.position.y,
      level: 1, mesh, uni,
      baseDrain: d.drain !== undefined ? d.drain : 0.0016,  // level units per second
      warned: {},
    };
  });
  G.lakes = lakes;

  if (G.map && G.map.river) {
    rivers.push(buildRiver(scene, G.map.river, lakes.filter(l => l.river)));
  }
  return lakes;
}

/* ------------------------------------------------------------ the ribbon --
   One mesh per river: a Catmull-Rom spline through the authored polyline,
   swept into a strip. Same water language as the lakes — the reflection
   target, the ripple noise, the shoreline that retreats as the level falls —
   but the shoreline runs ALONG the banks (across-width coordinate) instead of
   radially, and the ripples drift downstream, because a river that does not
   visibly flow is a canal. */
function buildRiver(scene, pts, members) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'catmullrom', 0.5);
  const len = curve.getLength();
  const N = Math.max(24, Math.ceil(len / 2));
  const centers = curve.getSpacedPoints(N);

  /* Smoothed bank height: the strip is flat across its width, and the
     centreline height is a 7-sample moving average so the water surface does
     not kink over every terrain ripple it crosses. */
  const hRaw = centers.map(c => terrainHeight(c.x, c.z));
  const hs = hRaw.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j <= N) { s += hRaw[j]; n++; } }
    return s / n + 0.35;
  });

  const pos = new Float32Array((N + 1) * 2 * 3);
  const uvArr = new Float32Array((N + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const c = centers[i];
    const t = curve.getTangentAt(i / N);
    let nx = -t.z, nz = t.x;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    /* width breathes gently and tapers at the ends so the river dies into the
       ground instead of stopping in a blunt bar */
    const u = i / N;
    const taper = Math.min(1, u / 0.07, (1 - u) / 0.07);
    const w = (5.8 + 1.0 * Math.sin(i * 0.47)) * (0.35 + 0.65 * taper);
    const y = hs[i];
    pos.set([c.x - nx * w, y, c.z - nz * w, c.x + nx * w, y, c.z + nz * w], i * 6);
    uvArr.set([u, -1, u, 1], i * 4);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geo.setIndex(idx);

  const uni = {
    uTime:    { value: 0 },
    uRefl:    { value: reflectTarget.texture },
    uLevel:   { value: 1 },
    ...waterPalette(),
    uLen:     { value: len },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false,
    vertexShader: `
      varying vec4 vScreen; varying vec2 vLocal; varying vec2 vRib; varying vec3 vWorld;
      void main() {
        vRib = uv;                               // x: 0..1 along, y: -1..1 across
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vLocal = wp.xz;
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        vScreen = gl_Position;
      }`,
    fragmentShader: `
      uniform sampler2D uRefl; uniform float uTime, uLevel, uLen;
      uniform vec3 uDeep, uShallow, uDry, uSky;
      varying vec4 vScreen; varying vec2 vLocal; varying vec2 vRib; varying vec3 vWorld;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y); }
      void main() {
        float across = abs(vRib.y);
        /* the banks dry out as the level falls, same retreat as a lake's shore */
        float edge = uLevel * 0.98;
        float wet = smoothstep(edge, edge - 0.14, across);

        vec2 uv = (vScreen.xy / vScreen.w) * 0.5 + 0.5;
        vec2 ripple = vec2(
          n(vLocal * 0.18 + uTime * 0.35),
          n(vLocal * 0.21 - uTime * 0.28)) - 0.5;
        vec3 refl = texture2D(uRefl, clamp(uv + ripple * 0.02, 0.001, 0.999)).rgb;
        refl = refl / (1.0 + refl);            // same HDR compression as the lake shader
        refl = mix(refl, uSky, 0.12);

        float depth = smoothstep(edge, 0.0, across);
        vec3 body = mix(uShallow, uDeep, depth);
        vec3 V = normalize(cameraPosition - vWorld);   // same real fresnel as the lake
        float f = 0.02 + 0.60 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
        vec3 col = mix(body, refl, f);
        /* downstream flow: streaks slide along the ribbon's own axis */
        col += n(vec2(vRib.x * uLen * 0.35 - uTime * 1.7, vRib.y * 2.5)) * 0.06;
        col += n(vLocal * 2.2 + uTime * 0.6) * 0.04;

        float dry = 1.0 - wet;
        vec3 bed = mix(uDry, uDry * 0.72, n(vLocal * 0.9));
        col = mix(col, bed, dry);
        float a = mix(0.94, 0.85, dry);
        if (uLevel <= 0.02) a = 0.9;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  scene.add(mesh);
  return { mesh, uni, members };
}

/* Intake pumps still standing decide how fast the water goes. */
/* The beaver used to be able to sit on a pump and "dam" it, shaving the draw
   while it stayed put. It is gone, and deliberately so: one beaver camped on a
   pump forever cut the drain by 11%, while simply killing that pump cut it by
   33% — permanently, for free, and with the beaver then walking away to do
   something else. A choice nobody can ever correctly make is not a choice, it
   is a trap for players who read the card. The beaver keeps the ability that
   was actually good: mend(). */

function activeDraw() {
  /* Wells draw groundwater and count alongside the surface intakes, which is
     the point of them: smashing every pump on the map no longer guarantees the
     water comes back. */
  /* A well counts double. Measured at parity it sustained only 5% of the drain
     once the pumps were gone — the refill all but cancelled it, so the "backup
     supply" was a backup in name only. At weight 2 a surviving well holds
     roughly a third of the draw: the water still leaves, slower, and capping it
     is a real second objective rather than a formality. */
  const WELL_WEIGHT = 2;
  const wells = (G.wells || []).filter(w => w.alive).length * WELL_WEIGHT;
  const wellCap = (G.wells || []).length * WELL_WEIGHT;
  const pumps = G.pumps || [];
  if (!pumps.length && !wellCap) return 1;
  let total = wellCap, live = wells;
  for (const p of pumps) { total++; if (p.alive) live++; }
  return total ? live / total : 1;
}

export function updateWater(dt) {
  if (!lakes.length) return;
  const draw = activeDraw() * (G.drainMult !== undefined ? G.drainMult : 1);
  let anyDry = false;

  for (const R of rivers) {
    R.uni.uTime.value += dt;
    /* the ribbon shows the mean of its member segments -- one waterway, one level */
    let sum = 0;
    for (const m of R.members) sum += m.level;
    R.uni.uLevel.value = R.members.length ? sum / R.members.length : 1;
  }

  for (const L of lakes) {
    if (L.uni) L.uni.uTime.value += dt;
    /* Net flow, not an either/or. The old rule only refilled when EVERY pump
       was dead, so killing three of four changed nothing the player could see.
       Now each pump you break shifts the balance, and at roughly half the
       intakes down the lake holds steady — a visible, earnable stalemate. */
    /* Three forces on one number: the intakes pulling it down, the water table
       pushing it back when they are broken, and the sky. */
    const rain = rainfall();
    const flow = L.baseDrain * (draw - REFILL * (1 - draw) - rain);
    if (flow !== 0) {
      L.level = clamp(L.level - flow * dt, 0, 1);
      if (L.uni) L.uni.uLevel.value = L.level;
      /* let the warnings re-arm on the way back up, so a lake you fought for
         and then lost again still tells you about it */
      if (flow < 0) for (const k in L.warned) if (L.level > +k + 0.08) L.warned[k] = false;
    }
    for (const [mark, msg] of [[0.6, 'is dropping'], [0.3, 'is nearly gone'], [0.02, 'has run dry']]) {
      if (L.level <= mark && !L.warned[mark]) {
        L.warned[mark] = true;
        toast(`The water ${msg}`, mark <= 0.3 ? 'warn' : '');
        if (mark === 0.02) commsEvent('water', 1);
      }
    }
    if (L.level <= 0.02) anyDry = true;
  }
  G.waterLevel = lakes.reduce((s, L) => s + L.level, 0) / lakes.length;
  G.waterDrying = anyDry;
}

/* A grove's yield depends on the water under it. Nothing random — a straight
   readable curve from the nearest lake's level. */
export function groveWaterFactor(x, z) {
  if (!lakes.length) return 1;
  let best = 0, lvl = 1;
  for (const L of lakes) {
    const d = Math.hypot(x - L.x, z - L.z);
    const reach = L.r * 4.0;                     // catchment
    if (d > reach) continue;
    const share = 1 - smoothstep(L.r * 0.9, reach, d);
    // the level that matters is THIS lake's, not the map average
    if (share > best) { best = share; lvl = L.level; }
  }
  if (best <= 0) return 1;                       // outside any catchment: unaffected
  return 1 - best * (1 - (0.25 + 0.75 * lvl));   // full lake = 1.0, dry = 0.25 at the centre
}


/* ------------------------------------------------------------- drinking -- */
/* A lake's wetted radius shrinks as it drains, so the shoreline animals have to
   reach recedes with the water — a nearly-dry lake is a longer walk for a worse
   drink, which is how the pumps are meant to hurt. */
export function lakeAt(x, z, reach = 4) {
  for (const L of lakes) {
    if (L.level <= 0.05) continue;
    const d = Math.hypot(x - L.x, z - L.z);
    const wet = L.r * (0.35 + 0.65 * L.level);      // matches the shader's edge
    if (d <= wet + reach) return L;
  }
  return null;
}

/** Nearest drinkable point on the shore, for pathing a unit to the water. */
export function shorePoint(x, z, out) {
  let best = null, bd = 1e9;
  for (const L of lakes) {
    if (L.level <= 0.05) continue;
    const d = Math.hypot(x - L.x, z - L.z);
    if (d < bd) { bd = d; best = L; }
  }
  if (!best) return null;
  const wet = best.r * (0.35 + 0.65 * best.level);
  const dx = x - best.x, dz = z - best.z;
  const len = Math.hypot(dx, dz) || 1;
  out.set(best.x + (dx / len) * wet * 0.92, 0, best.z + (dz / len) * wet * 0.92);
  return out;
}

/** 0..1 fullness of the fullest lake — what the HUD reports. */
export function waterLevel() {
  let best = 0;
  for (const L of lakes) if (L.level > best) best = L.level;
  return lakes.length ? best : 1;
}

export function lakeCount() { return lakes.length; }

/* ------------------------------------------------------------ reflection -- */
/* Mirror the scene through the water plane once a frame at low resolution. */
let reflFlip = false;
const _look = new THREE.Vector3();
export function renderWaterReflection(renderer, scene, camera) {
  if (!lakes.length || !reflectTarget) return;
  /* A full second scene render is the single most expensive thing this game
     does. Mirrors at half rate are imperceptible on slow water, and a map
     whose lakes are all far outside the view doesn't pay for one at all. */
  reflFlip = !reflFlip;
  if (reflFlip) return;
  let near = false;
  for (const L2 of lakes) {
    const dx = L2.x - camera.position.x, dz = L2.z - camera.position.z;
    if (dx * dx + dz * dz < 220 * 220) { near = true; break; }
  }
  if (!near) return;
  const L = lakes[0];
  const y = L.y;

  reflectCam.copy(camera);
  reflectCam.position.set(camera.position.x, 2 * y - camera.position.y, camera.position.z);
  const look = _look.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
  reflectCam.up.set(0, 1, 0);
  reflectCam.lookAt(look.x, 2 * y - look.y, look.z);
  reflectCam.updateMatrixWorld();
  reflectCam.updateProjectionMatrix();

  // clip everything under the surface so submerged geometry can't leak in
  _plane.setFromNormalAndCoplanarPoint(_norm, new THREE.Vector3(0, y, 0));
  const prevPlanes = renderer.clippingPlanes;
  const prevTarget = renderer.getRenderTarget();
  const visible = [];
  for (const L2 of lakes) { if (!L2.mesh) continue; visible.push([L2.mesh, L2.mesh.visible]); L2.mesh.visible = false; }
  for (const R of rivers) { visible.push([R.mesh, R.mesh.visible]); R.mesh.visible = false; }

  renderer.clippingPlanes = [_plane];
  renderer.setRenderTarget(reflectTarget);
  renderer.clear();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;   // reuse this frame's shadow map
  /* LINEAR, UN-TONEMAPPED — the same state post.js renders the main view in.
     The mirror used to be drawn with the renderer's ACES + sRGB defaults and
     then sampled as if it were linear scene light: tone-mapped twice, so the
     reflected sky came back dull and grey and a lake never quite matched the
     world it was mirroring. */
  const prevTone = renderer.toneMapping, prevOut = renderer.outputColorSpace;
  if (postEnabled()) {               // with post off the main view is ACES too; match it
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  }
  renderer.render(scene, reflectCam);
  renderer.toneMapping = prevTone;
  renderer.outputColorSpace = prevOut;
  renderer.shadowMap.autoUpdate = prevShadow;
  renderer.setRenderTarget(prevTarget);
  renderer.clippingPlanes = prevPlanes;
  for (const [m, v] of visible) m.visible = v;
}

export function disposeWater() {
  for (const L of lakes) {
    if (!L.mesh) continue;
    L.mesh.parent && L.mesh.parent.remove(L.mesh);
    L.mesh.geometry.dispose(); L.mesh.material.dispose();
  }
  for (const R of rivers) {
    R.mesh.parent && R.mesh.parent.remove(R.mesh);
    R.mesh.geometry.dispose(); R.mesh.material.dispose();
  }
  rivers = [];
  lakes = [];
  if (reflectTarget) { reflectTarget.dispose(); reflectTarget = null; }
  reflectCam = null;
  G.lakes = lakes;
}
