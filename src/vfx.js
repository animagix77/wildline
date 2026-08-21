import * as THREE from 'three';
import { G } from './state.js';
import { rand, terrainHeight, clamp } from './utils.js';

/* =========================================================================
   WILDLINE — special-effects layer.

   Everything here is pooled and procedural: fireballs, smoke, shockwaves,
   debris, ground scorch, muzzle flashes, burning wrecks, spirit wisps.
   No textures, no sprite sheets — icosahedra, quads and cones with animated
   materials, billboarded where it matters.

   Deliberately NO real PointLights: adding/removing lights changes three's
   program hash and recompiles every material mid-game. The "light" of an
   explosion is faked with an additive ground-glow quad, which at RTS zoom
   reads the same and costs nothing.

   Draw order: fx keep renderOrder 0, i.e. UNDER the fog veil (renderOrder 5).
   That is intentional — an explosion inside unexplored fog is information the
   player has not earned.
   ========================================================================= */

const puffGeo   = new THREE.IcosahedronGeometry(1, 1);
const chunkGeo  = new THREE.TetrahedronGeometry(1, 0);
const quadGeo   = new THREE.PlaneGeometry(1, 1);
const vfxRingGeo   = new THREE.RingGeometry(0.72, 1, 40);
const jetGeo    = new THREE.ConeGeometry(1, 1, 10, 1, true);
const discGeo   = new THREE.CircleGeometry(1, 26);

/* fire ramps from white-hot through orange to sooty as it ages */
const FIRE_A = new THREE.Color(0xfff0b8);
const FIRE_B = new THREE.Color(0xff7a2a);
const FIRE_C = new THREE.Color(0x3a1c10);
const NATURE_A = new THREE.Color(0xe6ffc4);
const NATURE_B = new THREE.Color(0x6fe06a);
const NATURE_C = new THREE.Color(0x123816);

const vfxLive = [];
const pools = new Map();      // geoKey -> mesh[]
const scheduled = [];
let vt = 0;
const MAX_LIVE = 420;         // spawn budget; beyond this new fx are dropped

const _c = new THREE.Color();

function alloc(key, geo, matOpts) {
  let bucket = pools.get(key);
  if (!bucket) { bucket = []; pools.set(key, bucket); }
  let m = bucket.pop();
  if (!m) {
    m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(Object.assign({
      transparent: true, depthWrite: false,
    }, matOpts)));
    m.userData.poolKey = key;
    m.raycast = () => {};
    G.fxRoot.add(m);
  }
  m.visible = true;
  return m;
}
function release(m) {
  m.visible = false;
  pools.get(m.userData.poolKey).push(m);
}

function push(item) {
  if (vfxLive.length >= MAX_LIVE) { release(item.m); return; }
  item.t = item.life;
  vfxLive.push(item);
}

/* ------------------------------------------------------------- pieces --- */

function flash(pos, r, color = 0xfff2c8) {
  const m = alloc('flash', puffGeo, { blending: THREE.AdditiveBlending, toneMapped: false });
  m.material.color.set(color);
  m.material.opacity = 0.95;
  m.position.copy(pos);
  m.scale.setScalar(r * 0.25);
  push({ kind: 'flash', m, life: 0.16, r });
}

function groundGlow(pos, r, color = 0xffb45a) {
  const m = alloc('glow', quadGeo, { blending: THREE.AdditiveBlending, toneMapped: false });
  m.material.color.set(color);
  m.material.opacity = 0.7;
  m.rotation.set(-Math.PI / 2, 0, rand(0, 6.28));
  m.position.set(pos.x, terrainHeight(pos.x, pos.z) + 0.3, pos.z);
  m.scale.setScalar(r * 0.4);
  push({ kind: 'glow', m, life: 0.3, r });
}

function shockRing(pos, r, color = 0xffc276, delay = 0) {
  if (delay > 0) { scheduled.push({ at: vt + delay, fn: () => shockRing(pos, r, color) }); return; }
  const m = alloc('ring', vfxRingGeo, { blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  m.material.color.set(color);
  m.material.opacity = 0.85;
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, terrainHeight(pos.x, pos.z) + 0.45, pos.z);
  m.scale.setScalar(r * 0.25);
  push({ kind: 'ring', m, life: 0.55, r });
}

function firePuff(pos, speed, size, nature) {
  const m = alloc('fire', puffGeo, { blending: THREE.AdditiveBlending, toneMapped: false });
  m.material.opacity = 0.9;
  m.position.copy(pos);
  m.scale.setScalar(size * rand(0.5, 0.8));
  push({
    kind: 'fire', m, life: rand(0.45, 0.8), size, nature,
    vel: new THREE.Vector3(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.35, 1)),
  });
}

function smokePuff(pos, size, delay = 0, life = rand(1.4, 2.4)) {
  if (delay > 0) { scheduled.push({ at: vt + delay, fn: () => smokePuff(pos, size, 0, life) }); return; }
  const m = alloc('smoke', puffGeo, {});
  m.material.color.setHex(0x17181b).offsetHSL(0, 0, rand(0, 0.05));
  m.material.opacity = 0.34;
  m.position.copy(pos).add(new THREE.Vector3(rand(-1, 1), rand(0, 1.4), rand(-1, 1)));
  m.scale.setScalar(size * rand(0.4, 0.7));
  push({
    kind: 'smoke', m, life, size,
    vel: new THREE.Vector3(rand(-0.7, 0.7), rand(1.6, 3.2), rand(-0.7, 0.7)),
  });
}

function debris(pos, n, power, color = 0x2c2f34) {
  for (let i = 0; i < n; i++) {
    const m = alloc('chunk', chunkGeo, { transparent: false });
    m.material.color.set(color).offsetHSL(0, 0, rand(-0.05, 0.06));
    m.position.copy(pos);
    m.scale.setScalar(rand(0.16, 0.5) * (0.7 + power * 0.3));
    push({
      kind: 'chunk', m, life: rand(0.9, 1.7),
      vel: new THREE.Vector3(rand(-1, 1), rand(0.6, 1.8), rand(-1, 1)).normalize()
        .multiplyScalar((7 + power * 5) * rand(0.4, 1.1)),
      spin: rand(-11, 11),
    });
  }
}

function fireJet(pos, h, r, nature) {
  const m = alloc('jet', jetGeo, { blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  m.material.color.copy(nature ? NATURE_B : FIRE_B);
  m.material.opacity = 0.75;
  m.position.set(pos.x, terrainHeight(pos.x, pos.z), pos.z);
  m.rotation.x = Math.PI;                       // cone opens downward → flame points up
  m.scale.set(r, 0.1, r);
  push({ kind: 'jet', m, life: rand(0.7, 1.0), h, r });
}

function scorch(pos, r) {
  const m = alloc('scorch', discGeo, {});
  m.material.color.setHex(0x0b0b0a);
  m.material.opacity = 0.5;
  m.rotation.x = -Math.PI / 2;
  // tiny per-instance lift so overlapping scorches don't z-fight each other
  m.position.set(pos.x, terrainHeight(pos.x, pos.z) + 0.2 + rand(0, 0.04), pos.z);
  m.scale.setScalar(r);
  push({ kind: 'scorch', m, life: 16 });
}

/* A wild creature's death releases a spirit mote instead of shrapnel. */
export function spiritWisp(pos) {
  const m = alloc('wisp', puffGeo, { blending: THREE.AdditiveBlending, toneMapped: false });
  m.material.color.setHex(0xb8ffb0);
  m.material.opacity = 0.8;
  m.position.copy(pos);
  m.scale.setScalar(0.32);
  push({ kind: 'wisp', m, life: 1.6, phase: rand(0, 6.28) });
}

/* ------------------------------------------------------------ headline --- */

/**
 * The one call combat makes. power: ~0.3 unit pop, 1 wall/turret,
 * 2 depot/coolant, 3 core. nature=true tints the whole event green.
 */
export function explode(pos, power = 1, { nature = false, fire = true } = {}) {
  const p = clamp(power, 0.2, 3.2);
  if (G.rts) G.rts.shake = Math.min(1.5, (G.rts.shake || 0) + 0.22 + p * 0.28);

  flash(pos, 2.5 + p * 3.2, nature ? 0xd6ffc0 : 0xfff2c8);
  groundGlow(pos, 4 + p * 4.5, nature ? 0x7fe07a : 0xffb45a);
  shockRing(pos, 3.5 + p * 3.6, nature ? 0x9dff8a : 0xffc276);
  if (p >= 1.6) shockRing(pos, 5.5 + p * 4.2, nature ? 0x6fd06a : 0xff9a4a, 0.12);

  if (fire) {
    const nF = Math.round(4 + p * 4);
    for (let i = 0; i < nF; i++) firePuff(pos, 5 + p * 4.5, 1 + p * 0.9, nature);
    if (p >= 1.6) fireJet(pos, 8 + p * 5, 1.2 + p * 0.8, nature);
  }
  const nS = Math.round(3 + p * 3);
  for (let i = 0; i < nS; i++) smokePuff(pos, 1.2 + p * 1.1, rand(0.05, 0.45));
  debris(pos, Math.round(4 + p * 5), p, nature ? 0x3a4a2c : 0x2c2f34);
  if (p >= 0.9) scorch(pos, 2.5 + p * 2.2);
}

/* The Server Core doesn't just pop — it cooks off. */
export function chainExplosion(pos, radius, count, power, opts) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, 6.28), d = rand(0.2, 1) * radius;
    const p = pos.clone();
    p.x += Math.cos(a) * d; p.z += Math.sin(a) * d; p.y += rand(0, 4);
    scheduled.push({ at: vt + 0.18 + i * rand(0.16, 0.34), fn: () => explode(p, power * rand(0.6, 1), opts) });
  }
}

/* Quick two-blade cross at a gun muzzle. Cheap enough for every shot. */
export function muzzleFlash(pos, color = 0xffc85c) {
  for (let i = 0; i < 2; i++) {
    const m = alloc('muzzle', quadGeo, { blending: THREE.AdditiveBlending, toneMapped: false });
    m.material.color.set(color);
    m.material.opacity = 0.9;
    m.position.copy(pos);
    m.rotation.set(rand(0, 3.14), rand(0, 3.14), rand(0, 3.14));
    m.scale.set(rand(0.8, 1.4), rand(0.2, 0.35), 1);
    push({ kind: 'muzzle', m, life: 0.07 });
  }
}

/* ------------------------------------------------- burning structures --- */
/* Called each frame by damaged buildings. Smoke below 55% hp, embers and
   guttering flame below 30%. State lives on the entity so nothing leaks.   */
export function burnTick(e, dt) {
  const f = e.hp / e.maxHp;
  if (f >= 0.55) return;
  e._burnT = (e._burnT || 0) - dt;
  if (e._burnT > 0) return;
  const severity = 1 - f / 0.55;
  e._burnT = rand(0.5, 1.0) / (0.5 + severity);
  const p = e.pos.clone();
  const r = e.def.radius * 0.7;
  p.x += rand(-r, r); p.z += rand(-r, r); p.y += rand(1, e.def.radius);
  smokePuff(p, 0.9 + severity * 1.4, 0, rand(1.8, 3));
  if (f < 0.3) {
    firePuff(p, 1.2, 0.8 + severity, e.team === 'wild');
    if (Math.random() < 0.4) groundGlow(e.pos, e.def.radius * 1.2, 0xff8a3d);
  }
}

/* -------------------------------------------------------------- update --- */

export function updateVFX(dt) {
  vt += dt;

  for (let i = scheduled.length - 1; i >= 0; i--) {
    if (scheduled[i].at <= vt) { const s = scheduled[i]; scheduled.splice(i, 1); s.fn(); }
  }

  const cam = G.camera;
  for (let i = vfxLive.length - 1; i >= 0; i--) {
    const it = vfxLive[i];
    it.t -= dt;
    if (it.t <= 0) { release(it.m); vfxLive.splice(i, 1); continue; }
    const k = it.t / it.life;              // 1 → 0
    const age = 1 - k;
    const m = it.m;
    switch (it.kind) {
      case 'flash':
        m.scale.setScalar(it.r * (0.25 + age * 0.75));
        m.material.opacity = 0.95 * k * k;
        break;
      case 'glow':
        m.scale.setScalar(it.r * (0.4 + age * 0.6));
        m.material.opacity = 0.7 * k;
        break;
      case 'ring': {
        const s = it.r * (0.25 + age * 1.1);
        m.scale.set(s, s, s);
        m.material.opacity = 0.85 * k;
        break;
      }
      case 'fire': {
        m.position.addScaledVector(it.vel, dt);
        it.vel.multiplyScalar(1 - dt * 2.2);
        it.vel.y += dt * 1.5;              // hot gas rises even as it slows
        m.scale.setScalar(it.size * (0.5 + age * 0.9));
        const [a, b, c] = it.nature ? [NATURE_A, NATURE_B, NATURE_C] : [FIRE_A, FIRE_B, FIRE_C];
        if (age < 0.35) _c.lerpColors(a, b, age / 0.35);
        else _c.lerpColors(b, c, (age - 0.35) / 0.65);
        m.material.color.copy(_c);
        m.material.opacity = 0.9 * k;
        if (cam) m.quaternion.copy(cam.quaternion);
        break;
      }
      case 'smoke':
        m.position.addScaledVector(it.vel, dt);
        it.vel.multiplyScalar(1 - dt * 0.6);
        m.scale.setScalar(it.size * (0.5 + age * 1.6));
        m.material.opacity = 0.34 * Math.min(1, k * 1.6);
        if (cam) m.quaternion.copy(cam.quaternion);
        break;
      case 'chunk': {
        it.vel.y -= dt * 26;
        m.position.addScaledVector(it.vel, dt);
        m.rotation.x += it.spin * dt; m.rotation.y += it.spin * 0.7 * dt;
        const gy = terrainHeight(m.position.x, m.position.z) + m.scale.x * 0.5;
        if (m.position.y < gy) { m.position.y = gy; it.vel.y *= -0.38; it.vel.x *= 0.6; it.vel.z *= 0.6; }
        break;
      }
      case 'jet': {
        const grow = age < 0.25 ? age / 0.25 : 1;
        m.scale.y = it.h * grow * (0.85 + Math.sin(vt * 37 + i) * 0.15);
        m.position.y = terrainHeight(m.position.x, m.position.z) + m.scale.y * 0.5;
        m.material.opacity = 0.75 * k;
        break;
      }
      case 'scorch':
        m.material.opacity = 0.5 * Math.min(1, k * 4);
        break;
      case 'wisp':
        m.position.y += dt * 2.4;
        m.position.x += Math.sin(vt * 3 + it.phase) * dt * 0.7;
        m.scale.setScalar(0.32 * (1 + age * 0.6));
        m.material.opacity = 0.8 * k;
        break;
      case 'muzzle':
        m.material.opacity = 0.9 * k;
        break;
    }
  }
}
