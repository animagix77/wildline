import * as THREE from 'three';
import { G } from './state.js';
import { WORLD, HALF } from './config.js';
import { terrainHeight, blight, clamp } from './utils.js';

/* =========================================================================
   The Green — creep.

   The zerg idea, in a forest: the wild side spreads living ground outward from
   the Heart Tree and every bloomed Grove. On the Green your critters move
   faster and regenerate; off it they are slow and stay hurt. It grows over
   time rather than appearing, so holding a grove visibly reclaims the map, and
   the data centre's tarmac actively suppresses it.

   Mechanically this is what makes "weak but numerous" work: a swarm that can
   heal between pushes can afford to lose bodies. Off the Green you are a long
   way from home and it feels like it.

   Same shape as fog.js — a coarse grid, an R8 DataTexture, and one displaced
   plane sampling it with a soft tent so it never reads as squares.
   ========================================================================= */

const VGRID = 96;
const VCELL = WORLD / VGRID;
const GROW = 2.2;              // cells per second the edge advances
const Y_OFF = 0.22;            // sits under the fog veil (0.35) and over the ground

let vfield = null;              // 0..255 current
let vgoal = null;               // 0..255 target
let vtex = null, vmesh = null, vmat = null;
let vAcc = 0, vDirty = true;

const vCellX = x => clamp(((x + HALF) / VCELL) | 0, 0, VGRID - 1);
const vCellZ = z => clamp(((z + HALF) / VCELL) | 0, 0, VGRID - 1);

export function initVerdant(scene) {
  disposeVerdant();
  vfield = new Uint8Array(VGRID * VGRID);
  vgoal = new Uint8Array(VGRID * VGRID);

  vtex = new THREE.DataTexture(vfield, VGRID, VGRID, THREE.RedFormat, THREE.UnsignedByteType);
  vtex.minFilter = vtex.magFilter = THREE.LinearFilter;
  vtex.wrapS = vtex.wrapT = THREE.ClampToEdgeWrapping;
  vtex.needsUpdate = true;

  /* displaced to follow the terrain, like the fog veil, or it clips through hills */
  const seg = 96;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)) + Y_OFF);
  }
  geo.computeVertexNormals();

  vmat = new THREE.ShaderMaterial({
    uniforms: {
      uVField: { value: vtex },
      uTexel: { value: new THREE.Vector2(1 / VGRID, 1 / VGRID) },
      uTime:  { value: 0 },
      uHalf:  { value: HALF },
      uWorld: { value: WORLD },
      uNear:  { value: new THREE.Color(0x74d64a) },
      uDeep:  { value: new THREE.Color(0x2f7a34) },
    },
    transparent: true, depthWrite: false,
    vertexShader: `
      uniform float uHalf, uWorld;
      varying vec2 vUv; varying vec2 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xz;
        vUv = (wp.xz + uHalf) / uWorld;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D uVField; uniform vec2 uTexel; uniform float uTime;
      uniform vec3 uNear, uDeep;
      varying vec2 vUv; varying vec2 vWorld;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y); }
      void main(){
        vec2 o = uTexel*0.5;
        float v = texture2D(uVField, vUv+vec2( o.x, o.y)).r
                + texture2D(uVField, vUv+vec2(-o.x, o.y)).r
                + texture2D(uVField, vUv+vec2( o.x,-o.y)).r
                + texture2D(uVField, vUv+vec2(-o.x,-o.y)).r;
        v *= 0.25;
        /* organic edge: break the boundary with noise so it creeps rather than
           expanding as a clean disc */
        float edge = n(vWorld*0.09) * 0.30 + n(vWorld*0.26)*0.12;
        float a = smoothstep(0.18 + edge*0.5, 0.62 + edge*0.3, v);
        if (a < 0.01) discard;
        float mottle = n(vWorld*0.5)*0.5 + n(vWorld*1.6)*0.3;
        vec3 col = mix(uDeep, uNear, mottle);
        /* a slow pulse outward from wherever it is thickest */
        col += 0.05 * sin(uTime*0.7 + vWorld.x*0.05 + vWorld.y*0.04) * v;
        gl_FragColor = vec4(col, a * 0.5);
      }`,
  });

  vmesh = new THREE.Mesh(geo, vmat);
  vmesh.renderOrder = 1;          // above ground decals, below the fog veil
  vmesh.frustumCulled = false;
  vmesh.raycast = () => {};
  scene.add(vmesh);
  G.verdant = { at: verdantAt };
  return vmesh;
}

/* Sources: the Heart Tree, and every grove you actually hold. */
function stampGoal() {
  vgoal.fill(0);
  const add = (x, z, r, strength) => {
    const r2 = r * r;
    const ci = vCellX(x), cj = vCellZ(z), rad = Math.ceil(r / VCELL);
    for (let j = Math.max(0, cj - rad); j <= Math.min(VGRID - 1, cj + rad); j++) {
      const dz = (j + 0.5) * VCELL - HALF - z;
      for (let i = Math.max(0, ci - rad); i <= Math.min(VGRID - 1, ci + rad); i++) {
        const dx = (i + 0.5) * VCELL - HALF - x;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const t = 1 - Math.sqrt(d2) / r;
        const v = Math.min(255, strength * (0.45 + 0.55 * t));
        const k = j * VGRID + i;
        if (v > vgoal[k]) vgoal[k] = v;
      }
    }
  };
  if (G.heart && G.heart.alive) add(G.heart.pos.x, G.heart.pos.z, 34, 255);
  for (const g of (G.groves || [])) if (g.owned) add(g.pos.x, g.pos.z, 26, 255);

  /* the campus poisons the ground it sits on */
  for (let j = 0; j < VGRID; j++) {
    for (let i = 0; i < VGRID; i++) {
      const k = j * VGRID + i;
      if (!vgoal[k]) continue;
      const wx = (i + 0.5) * VCELL - HALF, wz = (j + 0.5) * VCELL - HALF;
      const b = blight(wx, wz);
      if (b > 0.05) vgoal[k] = Math.max(0, vgoal[k] * (1 - b));
    }
  }
}

export function updateVerdant(dt) {
  if (!vfield) return;
  vmat.uniforms.uTime.value += dt;

  vAcc += dt;
  if (vAcc >= 0.25) { stampGoal(); vAcc = 0; vDirty = true; }

  /* advance toward the vgoal at a fixed rate — the edge crawls, it doesn't snap */
  const step = Math.max(1, (GROW * 255 * dt) | 0);
  let moved = false;
  for (let k = 0; k < vfield.length; k++) {
    const g = vgoal[k], f = vfield[k];
    if (f === g) continue;
    moved = true;
    vfield[k] = f < g ? Math.min(g, f + step) : Math.max(g, f - Math.max(1, step >> 1));
  }
  if (moved || vDirty) { vtex.needsUpdate = true; vDirty = false; }
}

/** 0..1 — how alive the ground is under a point. */
export function verdantAt(x, z) {
  if (!vfield) return 0;
  return vfield[vCellZ(z) * VGRID + vCellX(x)] / 255;
}

export function disposeVerdant() {
  if (vmesh) { vmesh.parent && vmesh.parent.remove(vmesh); vmesh.geometry.dispose(); }
  if (vmat) vmat.dispose();
  if (vtex) vtex.dispose();
  vfield = vgoal = null; vtex = vmesh = vmat = null;
}
