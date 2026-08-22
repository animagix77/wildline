import * as THREE from 'three';
import { G } from './state.js';
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
let reflectTarget = null, reflectCam = null;
const _reflMat = new THREE.Matrix4();
const _norm = new THREE.Vector3(0, 1, 0);
const _plane = new THREE.Plane();

export function initWater(scene, defs) {
  disposeWater();
  if (!defs || !defs.length) { G.lakes = lakes = []; return; }

  reflectTarget = new THREE.WebGLRenderTarget(REFLECT_SIZE, REFLECT_SIZE, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  reflectCam = new THREE.PerspectiveCamera();

  lakes = defs.map(d => {
    const uni = {
      uTime:    { value: 0 },
      uRefl:    { value: reflectTarget.texture },
      uLevel:   { value: 1 },                       // 1 full .. 0 dry
      uDeep:    { value: new THREE.Color(0x16404a) },
      uShallow: { value: new THREE.Color(0x3d8e93) },
      uDry:     { value: new THREE.Color(0x5b5647) },
      uRadius:  { value: d.r },
    };
    const geo = new THREE.CircleGeometry(d.r, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false,
      vertexShader: `
        varying vec4 vScreen; varying vec2 vLocal;
        void main() {
          vLocal = position.xz;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
          vScreen = gl_Position;
        }`,
      fragmentShader: `
        uniform sampler2D uRefl; uniform float uTime, uLevel, uRadius;
        uniform vec3 uDeep, uShallow, uDry;
        varying vec4 vScreen; varying vec2 vLocal;
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

          float depth = smoothstep(edge, 0.0, r);
          vec3 body = mix(uShallow, uDeep, depth);
          /* fresnel-ish: glancing angles are mirror, straight down is water */
          float f = pow(1.0 - clamp(depth, 0.0, 1.0), 2.0) * 0.55 + 0.18;
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
  return lakes;
}

/* Intake pumps still standing decide how fast the water goes — and beavers
   sitting on them decide how well those pumps work. The Beaver's card has
   always promised "every beaver on a pump slows the drain"; until now that was
   a blurb with no code behind it. */
const DAM_RADIUS = 9;
const DAM_PER_BEAVER = 0.18;
const DAM_FLOOR = 0.15;          // a dammed pump still trickles

function activeDraw() {
  if (!G.pumps || !G.pumps.length) return 1;
  let total = 0, live = 0;
  for (const p of G.pumps) {
    total++;
    if (!p.alive) continue;
    let dams = 0;
    for (const e of G.entities) {
      if (!e.alive || e.type !== 'beaver') continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      if (dx * dx + dz * dz < DAM_RADIUS * DAM_RADIUS) dams++;
    }
    live += Math.max(DAM_FLOOR, 1 - dams * DAM_PER_BEAVER);
  }
  G.dammed = total - live;                     // for the HUD
  return total ? live / total : 1;
}

export function updateWater(dt) {
  if (!lakes.length) return;
  const draw = activeDraw() * (G.drainMult !== undefined ? G.drainMult : 1);
  let anyDry = false;

  for (const L of lakes) {
    L.uni.uTime.value += dt;
    /* Net flow, not an either/or. The old rule only refilled when EVERY pump
       was dead, so killing three of four changed nothing the player could see.
       Now each pump you break (or dam) shifts the balance, and at roughly half
       the intakes down the lake holds steady — a visible, earnable stalemate. */
    const flow = L.baseDrain * (draw - REFILL * (1 - draw));
    if (flow !== 0) {
      L.level = clamp(L.level - flow * dt, 0, 1);
      L.uni.uLevel.value = L.level;
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
    const dx = L2.mesh.position.x - camera.position.x, dz = L2.mesh.position.z - camera.position.z;
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
  for (const L2 of lakes) { visible.push([L2.mesh, L2.mesh.visible]); L2.mesh.visible = false; }

  renderer.clippingPlanes = [_plane];
  renderer.setRenderTarget(reflectTarget);
  renderer.clear();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;   // reuse this frame's shadow map
  renderer.render(scene, reflectCam);
  renderer.shadowMap.autoUpdate = prevShadow;
  renderer.setRenderTarget(prevTarget);
  renderer.clippingPlanes = prevPlanes;
  for (const [m, v] of visible) m.visible = v;
}

export function disposeWater() {
  for (const L of lakes) {
    L.mesh.parent && L.mesh.parent.remove(L.mesh);
    L.mesh.geometry.dispose(); L.mesh.material.dispose();
  }
  lakes = [];
  if (reflectTarget) { reflectTarget.dispose(); reflectTarget = null; }
  reflectCam = null;
  G.lakes = lakes;
}
