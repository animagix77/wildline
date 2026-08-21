import * as THREE from 'three';
import { rand } from './utils.js';
import { makeWaterMaterial } from './shaders.js';

/* =========================================================================
   Procedural low-poly meshes. No external assets — everything is boxes,
   cylinders and cones with flat shading.
   ========================================================================= */

const matCache = new Map();
export function M(color, { emissive = 0, rough = 0.9, metal = 0, flat = true, opacity = 1 } = {}) {
  const k = `${color}|${emissive}|${rough}|${metal}|${flat}|${opacity}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, emissive, roughness: rough, metalness: metal, flatShading: flat,
      transparent: opacity < 1, opacity,
    });
    matCache.set(k, m);
  }
  return m;
}
export const GLOW = c => {
  const k = 'glow' + c;
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: c }); matCache.set(k, m); }
  return m;
};

/* --- primitive helpers -------------------------------------------------- */
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const sphGeo = new THREE.IcosahedronGeometry(1, 1);
const conGeo = new THREE.ConeGeometry(1, 1, 8);

function mk(geo, m, sx, sy, sz, x, y, z) {
  const o = new THREE.Mesh(geo, m);
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}
export const box  = (m, sx, sy, sz, x = 0, y = 0, z = 0) => mk(boxGeo, m, sx, sy, sz, x, y, z);
export const cyl  = (m, r, h, x = 0, y = 0, z = 0) => mk(cylGeo, m, r, h, r, x, y, z);
export const sph  = (m, r, x = 0, y = 0, z = 0) => mk(sphGeo, m, r, r, r, x, y, z);
export const cone = (m, r, h, x = 0, y = 0, z = 0) => mk(conGeo, m, r, h, r, x, y, z);


/* =========================================================================
   Part merging.

   Every animal used to be a Group of 9–13 separate meshes, each re-drawn for the
   shadow pass — ~14 draw calls per unit, which is the single biggest cost in the
   frame at 150+ entities. Parts that never move relative to one another are baked
   into one buffer, carrying their colour per-vertex so a single shared material
   covers the lot. Diagonal leg pairs move together in a real quadruped gait, so
   four legs collapse to two meshes rather than four.
   ========================================================================= */

export const VC_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0,
});
export const VC_MAT_METAL = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.35,
});
export const VC_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

/* meshes: [{ geo, color, matrix }] already positioned in the target space. */
function mergeParts(parts, material) {
  const geos = [];
  let total = 0;
  for (const p of parts) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone());
    g.applyMatrix4(p.matrix);      // three applies the normal matrix to normals here
    geos.push({ g, color: p.color });
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  const c = new THREE.Color();
  for (const { g, color } of geos) {
    const gp = g.attributes.position, gn = g.attributes.normal;
    c.copy(color);
    for (let i = 0; i < gp.count; i++) {
      pos[(o + i) * 3] = gp.getX(i); pos[(o + i) * 3 + 1] = gp.getY(i); pos[(o + i) * 3 + 2] = gp.getZ(i);
      nrm[(o + i) * 3] = gn.getX(i); nrm[(o + i) * 3 + 1] = gn.getY(i); nrm[(o + i) * 3 + 2] = gn.getZ(i);
      col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b;
    }
    o += gp.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return new THREE.Mesh(out, material);
}

/* Part builders that record a transform instead of creating a Mesh. */
const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _e4 = new THREE.Euler();
const _s3 = new THREE.Vector3();
const _p3 = new THREE.Vector3();

function part(geo, color, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e4.set(rx, ry, rz);
  return {
    geo, color: new THREE.Color(color),
    matrix: new THREE.Matrix4().compose(_p3.set(x, y, z), _q4.setFromEuler(_e4), _s3.set(sx, sy, sz)),
  };
}
const pBox  = (c, sx, sy, sz, x, y, z, rx, ry, rz) => part(boxGeo, c, sx, sy, sz, x, y, z, rx, ry, rz);
const pCyl  = (c, r, h, x, y, z, rx, ry, rz) => part(cylGeo, c, r, h, r, x, y, z, rx, ry, rz);
const pCone = (c, r, h, x, y, z, rx, ry, rz) => part(conGeo, c, r, h, r, x, y, z, rx, ry, rz);
const pSph  = (c, r, x, y, z) => part(sphGeo, c, r, r, r, x, y, z);

/* ============================ WILDLIFE ================================== */

function quadruped({ fur, belly, bodyL, bodyW, bodyH, legH, headS, snout, tail, ears, extras }) {
  const g = new THREE.Group();
  const y = legH + bodyH / 2;

  /* ---- body: torso, belly panel and the shoulder/haunch masses ---- */
  const bodyParts = [
    pBox(fur,   bodyW, bodyH, bodyL, 0, 0, 0),
    pBox(belly, bodyW * 0.86, bodyH * 0.45, bodyL * 0.8, 0, -bodyH * 0.32, 0),
    pBox(fur,   bodyW * 1.12, bodyH * 1.06, bodyL * 0.26, 0, bodyH * 0.05, bodyL * 0.28),
    pBox(fur,   bodyW * 1.05, bodyH * 1.12, bodyL * 0.28, 0, bodyH * 0.05, -bodyL * 0.3),
  ];
  if (extras && extras.body) bodyParts.push(...extras.body);
  const body = mergeParts(bodyParts, VC_MAT);
  body.position.y = y;
  body.castShadow = true;
  g.add(body);

  /* ---- head, baked around its own pivot so it can still nod ---- */
  const headParts = [
    pBox(fur, headS, headS * 0.86, headS * 1.1, 0, 0, 0),
    pBox(0x15130f, headS * 0.5, headS * 0.16, headS * 0.16, 0, headS * 0.06, headS * 0.5),
  ];
  if (snout) headParts.push(pBox(fur, headS * 0.5, headS * 0.44, snout, 0, -headS * 0.2, headS * 0.55 + snout * 0.4));
  if (ears) {
    headParts.push(pCone(fur, headS * 0.22, headS * 0.44, -headS * 0.3, headS * 0.52, -headS * 0.05));
    headParts.push(pCone(fur, headS * 0.22, headS * 0.44,  headS * 0.3, headS * 0.52, -headS * 0.05));
  }
  if (extras && extras.head) headParts.push(...extras.head);
  const head = mergeParts(headParts, VC_MAT);
  head.position.set(0, y + bodyH * 0.34, bodyL * 0.52);
  head.castShadow = true;
  g.add(head);

  /* ---- legs: diagonal pairs, which is how a quadruped actually walks ---- */
  const lw = bodyW * 0.24;
  const legs = [];
  const pairs = [[[-1, -1], [1, 1]], [[-1, 1], [1, -1]]];
  for (const pair of pairs) {
    const parts = [];
    for (const [sx, sz] of pair) {
      parts.push(pBox(fur, lw, legH, lw, sx * bodyW * 0.36, legH / 2, sz * bodyL * 0.32));
      if (extras && extras.paw) {
        parts.push(pBox(extras.paw, lw * 1.15, lw * 0.42, lw * 1.3,
          sx * bodyW * 0.36, lw * 0.22, sz * bodyL * 0.32 + lw * 0.35));
      }
    }
    const m = mergeParts(parts, VC_MAT);   // legs skip the shadow pass: at RTS
    legs.push(m);                          // zoom the body shadow is the whole read
    g.add(m);
  }

  let tailObj = null;
  if (tail) {
    tailObj = mergeParts([pBox(fur, bodyW * 0.22, bodyW * 0.22, tail, 0, 0, -tail * 0.4)], VC_MAT);
    tailObj.position.set(0, y + bodyH * 0.3, -bodyL * 0.55);
    tailObj.rotation.x = 0.35;
    g.add(tailObj);
  }

  g.userData.anim = { legs, head, tail: tailObj, torso: body, kind: 'quad' };
  return g;
}

export const buildWolf = () => quadruped({
  fur: 0x767d88, belly: 0x9aa2ab, bodyL: 2.5, bodyW: 0.95, bodyH: 0.9,
  legH: 0.95, headS: 0.72, snout: 0.55, tail: 1.1, ears: true,
});

export const buildBoar = () => quadruped({
  fur: 0x4e3d2c, belly: 0x6b563d, bodyL: 2.6, bodyW: 1.35, bodyH: 1.25,
  legH: 0.75, headS: 0.9, snout: 0.6, tail: 0.4, ears: true,
  extras: {
    head: [
      pCone(0xe8e2cf, 0.11, 0.6, -0.3, -0.1, 0.85, -0.7, 0, -0.25),
      pCone(0xe8e2cf, 0.11, 0.6,  0.3, -0.1, 0.85, -0.7, 0,  0.25),
    ],
    // bristled spine, baked straight into the torso buffer
    body: [0, 1, 2, 3, 4].map(i => pCone(0x2f2519, 0.09, 0.42, 0, 0.83, -0.9 + i * 0.45)),
  },
});

export const buildBear = () => quadruped({
  fur: 0x5e4128, belly: 0x74522f, bodyL: 3.5, bodyW: 1.9, bodyH: 1.8,
  legH: 1.25, headS: 1.15, snout: 0.7, tail: 0.35, ears: true,
  extras: { paw: 0xd8d2c2 },
});

export const buildRaven = () => {
  const g = new THREE.Group();
  const F = 0x21222c, S = 0x3a3c4a, BEAK = 0xc9a227, EYE = 0xffe9a8;

  const body = mergeParts([
    pBox(F, 0.72, 0.66, 1.9, 0, 0, 0),
    pCone(F, 0.45, 1.0, 0, -0.05, -1.15, Math.PI / 2, 0, 0),
    pBox(F, 0.55, 0.5, 0.6, 0, 0.22, 1.05),
    pCone(BEAK, 0.13, 0.62, 0, 0.16, 1.55, -Math.PI / 2, 0, 0),
    pSph(EYE, 0.07, -0.2, 0.32, 1.2),
    pSph(EYE, 0.07, 0.2, 0.32, 1.2),
  ], VC_MAT);
  body.castShadow = true;
  g.add(body);

  const wings = [];
  for (const sx of [-1, 1]) {
    const w = mergeParts([
      pBox(S, 2.0, 0.09, 1.0, sx * 1.0, 0, 0),
      pBox(F, 1.1, 0.08, 0.7, sx * 2.0, 0, -0.25),
    ], VC_MAT);
    w.position.set(sx * 0.34, 0.14, 0.05);
    body.add(w);
    wings.push({ w, s: sx });
  }

  g.userData.anim = { kind: 'bird', wings, body, hover: rand(0, 6.28) };
  return g;
};

export const buildDrone = () => {
  const g = new THREE.Group();
  const SHELL = 0x333a44, ARM = 0x22272f, EYE = 0x59e5ff;

  const shellParts = [
    pBox(SHELL, 1.1, 0.38, 1.1, 0, 0, 0),
    pCone(SHELL, 0.55, 0.5, 0, -0.32, 0, Math.PI, 0, 0),
    pSph(EYE, 0.16, 0, -0.34, 0.28),
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    shellParts.push(pBox(ARM, 0.16, 0.1, 0.16, sx * 0.75, 0.02, sz * 0.75));
  const body = mergeParts(shellParts, VC_MAT_METAL);
  body.castShadow = true;
  g.add(body);

  const rotors = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const r = cyl(M(0x8fa0b0, { opacity: 0.45 }), 0.5, 0.04, sx * 0.75, 0.14, sz * 0.75);
    r.castShadow = false;
    body.add(r); rotors.push(r);
  }

  g.userData.anim = { kind: 'drone', rotors, body, hover: rand(0, 6.28), muzzle: new THREE.Vector3(0, -0.3, 0.4) };
  return g;
};

/* ============================= MACHINE ================================== */

export const buildGuard = () => {
  const g = new THREE.Group();
  const SUIT = 0x2b303a, VEST = 0x1d2128, SKIN = 0x4b515c, DARK = 0x141922, GUN = 0x14171d;

  /* torso, vest, head, visor and the off-hand arm never move relative to one
     another, so they are one buffer */
  const body = mergeParts([
    pBox(SUIT, 0.85, 1.05, 0.55, 0, 0, 0),
    pBox(VEST, 0.95, 0.62, 0.66, 0, 0.10, 0),
    pBox(0x39d7ea, 0.16, 0.06, 0.02, 0.3, 0.23, 0.34),
    pBox(SKIN, 0.45, 0.42, 0.45, 0, 0.75, 0),
    pBox(DARK, 0.47, 0.16, 0.06, 0, 0.75, 0.23),
    pBox(SUIT, 0.24, 0.85, 0.24, -0.55, -0.05, 0.05),
  ], VC_MAT_METAL);
  body.position.y = 1.55;
  body.castShadow = true;
  g.add(body);

  /* firing arm + weapon travel together on recoil */
  const gun = mergeParts([
    pBox(SUIT, 0.24, 0.75, 0.24, 0, 0, -0.22, -1.1, 0, 0),
    pBox(GUN, 0.14, 0.16, 1.5, 0, 0, 0.5),
    pBox(0x232830, 0.12, 0.3, 0.3, 0, -0.18, 0.05),
  ], VC_MAT_METAL);
  gun.position.set(0.5, 1.5, 0.5);
  g.add(gun);

  const legs = [];
  for (const sx of [-1, 1]) {
    const l = mergeParts([pBox(0x232833, 0.28, 1.05, 0.28, sx * 0.22, 0, 0)], VC_MAT_METAL);
    l.position.y = 0.52;
    g.add(l); legs.push(l);
  }

  g.userData.anim = { kind: 'biped', legs, torso: body, head: null, gun, muzzle: new THREE.Vector3(0.5, 1.5, 1.3) };
  return g;
};

export const buildTurret = () => {
  const g = new THREE.Group();
  const STEEL = 0x5d6773, DARK = 0x2b3038;

  const baseParts = [
    pCyl(DARK, 2.3, 0.6, 0, 0.3, 0),
    pCyl(STEEL, 1.5, 2.6, 0, 1.7, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    baseParts.push(pBox(DARK, 0.3, 2.2, 0.3, Math.cos(a) * 1.5, 1.6, Math.sin(a) * 1.5));
  }
  const base = mergeParts(baseParts, VC_MAT_METAL);
  base.castShadow = true;
  g.add(base);

  const head = new THREE.Group();
  head.position.y = 3.4;
  const shell = mergeParts([
    pBox(STEEL, 2.2, 1.3, 2.0, 0, 0, 0),
    pBox(DARK, 2.4, 0.35, 0.6, 0, 0.5, 0.5),
    pCyl(DARK, 0.18, 2.4, -0.45, -0.2, 1.3, Math.PI / 2, 0, 0),
    pCyl(DARK, 0.18, 2.4,  0.45, -0.2, 1.3, Math.PI / 2, 0, 0),
  ], VC_MAT_METAL);
  shell.castShadow = true;
  head.add(shell);
  head.add(sph(GLOW(0xff8a3d), 0.34, 0, 0.2, 1.05));
  head.add(box(GLOW(0xff8a3d), 1.9, 0.09, 0.09, 0, 0.66, 0.75));
  g.add(head);

  g.userData.anim = { kind: 'turret', head, muzzle: new THREE.Vector3(0, 3.2, 2.4) };
  return g;
};

export const buildDepot = () => {
  const g = new THREE.Group();
  const wallM = M(0x39414b, { metal: 0.35, rough: 0.6 });
  const trim = M(0x1d2229, { metal: 0.5, rough: 0.45 });
  g.add(box(wallM, 11, 6, 9, 0, 3, 0));
  g.add(box(trim, 11.6, 0.7, 9.6, 0, 6.2, 0));
  g.add(box(GLOW(0x39d7ea), 10.2, 0.16, 0.1, 0, 4.6, 4.55));
  g.add(box(M(0x0f1216), 3.2, 3.6, 0.3, 0, 1.8, 4.6));           // bay door
  g.add(box(GLOW(0xff8a3d), 3.0, 0.12, 0.12, 0, 3.7, 4.72));
  for (let i = -1; i <= 1; i++) g.add(cyl(trim, 0.7, 1.8, i * 3.2, 7.2, -2));
  g.add(cyl(trim, 0.16, 5, 4.2, 9, -3.4));
  const beacon = sph(GLOW(0xff6a3d), 0.28, 4.2, 11.5, -3.4); g.add(beacon);
  g.userData.anim = { kind: 'depot', beacon };
  return g;
};

export const buildCoolant = () => {
  const g = new THREE.Group();
  const shell = M(0x4a525c, { metal: 0.45, rough: 0.5 });
  const dark = M(0x22272e, { metal: 0.5, rough: 0.4 });
  g.add(cyl(dark, 5.2, 1.0, 0, 0.5, 0));
  for (let i = 0; i < 6; i++)
    g.add(cyl(shell, 4.0 - i * 0.16, 1.9, 0, 1.6 + i * 1.9, 0));
  for (let i = 0; i < 3; i++)
    g.add(cyl(dark, 4.15 - i * 0.32, 0.3, 0, 3.4 + i * 3.8, 0));
  g.add(cyl(GLOW(0x39d7ea), 3.1, 0.35, 0, 12.5, 0));
  const fan = new THREE.Group(); fan.position.y = 13.2;
  for (let i = 0; i < 5; i++) {
    const b = box(M(0x8a949e, { metal: 0.6 }), 3.0, 0.12, 0.9, 0, 0, 0);
    b.rotation.y = i * (Math.PI * 2 / 5);
    b.position.set(Math.cos(b.rotation.y) * 1.5, 0, -Math.sin(b.rotation.y) * 1.5);
    b.rotation.z = 0.3;
    fan.add(b);
  }
  g.add(fan);
  g.add(cyl(dark, 3.4, 0.5, 0, 13.7, 0));
  g.userData.anim = { kind: 'coolant', fan };
  return g;
};

export const buildCore = () => {
  const g = new THREE.Group();
  const shell = M(0x2e343d, { metal: 0.45, rough: 0.5 });
  const dark = M(0x14181e, { metal: 0.5, rough: 0.4 });
  g.add(box(dark, 22, 1.2, 18, 0, 0.6, 0));
  g.add(box(shell, 20, 9, 16, 0, 5.5, 0));
  g.add(box(dark, 21, 0.9, 17, 0, 10.4, 0));
  // server racks with running lights
  const strips = [];
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) {
      const st = box(GLOW(0x39d7ea), 0.25, 6.2, 0.12, s * 10.05, 5.4, -6 + i * 3);
      g.add(st); strips.push(st);
    }
    const t = box(GLOW(0x39d7ea), 16, 0.14, 0.14, 0, 2.2 + i * 1.7, 8.05);
    g.add(t); strips.push(t);
  }
  g.add(box(M(0x0c0f13), 6, 5, 0.4, 0, 3, 8.2));
  for (let i = 0; i < 4; i++)
    g.add(cyl(dark, 0.5, 3, -7.5 + i * 5, 12, 0));
  g.userData.anim = { kind: 'core', strips };
  return g;
};

export const buildWall = (len = 10) => {
  const g = new THREE.Group();
  const C = 0x525966, D = 0x2e343d;
  const body = mergeParts([
    pBox(C, len, 4.4, 1.1, 0, 2.2, 0),
    pBox(D, len, 0.4, 1.5, 0, 4.5, 0),
    pBox(D, 0.7, 5.0, 1.5, -0.5 * len, 2.5, 0),
    pBox(D, 0.7, 5.0, 1.5,  0.5 * len, 2.5, 0),
  ], VC_MAT_METAL);
  body.castShadow = true;
  g.add(body);
  g.add(box(GLOW(0x1f5f68), len * 0.9, 0.08, 0.06, 0, 3.6, 0.6));
  return g;
};

/* ======================== NATURE STRUCTURES ============================= */

export const buildHeartTree = () => {
  const g = new THREE.Group();
  const BARK = 0x513f2b, BARK_D = 0x3a2c1d;
  const LEAF_A = 0x67ad4a, LEAF_B = 0x4f9440, LEAF_C = 0x8bc95c;
  const SPIRIT = 0x9bff6a, MOTE = 0xd9ff9b;

  /* mossy ring of standing stones, plus their wisps — two buffers, not twenty */
  const stones = [], wisps = [];
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI * 2 / 10 + rand(-0.15, 0.15);
    const h = rand(1.6, 3.2);
    stones.push(part(boxGeo, 0x6f7468, rand(0.8, 1.4), h, rand(0.7, 1.2),
      Math.cos(a) * 10.5, h / 2, Math.sin(a) * 10.5, 0, a + rand(-0.3, 0.3), rand(-0.12, 0.12)));
    wisps.push(pSph(SPIRIT, 0.16, Math.cos(a) * 10.5, h + 0.3, Math.sin(a) * 10.5));
  }
  const stoneRing = mergeParts(stones, VC_MAT);
  stoneRing.castShadow = true;
  g.add(stoneRing);
  g.add(mergeParts(wisps, VC_GLOW));

  /* buttress roots, trunk, hollow and limbs are one rigid mass */
  const trunkParts = [];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI * 2 / 8;
    trunkParts.push(pCyl(BARK_D, 1.0, 6.5, Math.cos(a) * 3.6, 1.4, Math.sin(a) * 3.6,
      -Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5));
  }
  trunkParts.push(pCyl(BARK, 3.2, 12, 0, 6, 0));
  trunkParts.push(pCyl(BARK, 2.5, 14, 0, 17, 0));
  trunkParts.push(pBox(0x2a2a1c, 1.5, 3.6, 0.5, 0, 7.0, 2.6));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.32;
    trunkParts.push(pCyl(BARK, 0.62, 9, Math.cos(a) * 3.4, 19, Math.sin(a) * 3.4,
      Math.sin(a) * 0.85, 0, -Math.cos(a) * 0.85));
  }
  const trunk = mergeParts(trunkParts, VC_MAT);
  trunk.castShadow = true;
  g.add(trunk);

  const heart = sph(GLOW(SPIRIT), 1.3, 0, 7.0, 2.9);
  g.add(heart);

  /* three tiers so it reads as a crown, baked into one buffer that still sways */
  const canopy = mergeParts([
    pSph(LEAF_B, 9.0, 0, 0, 0),
    pSph(LEAF_A, 6.6, -5.6, 4.0, 2.2),
    pSph(LEAF_A, 6.0, 5.4, 3.4, -2.8),
    pSph(LEAF_C, 5.0, 0.8, 8.6, 1.0),
    pSph(LEAF_B, 4.4, 2.0, 5.2, 6.2),
    pSph(LEAF_C, 3.8, -3.6, 6.8, -5.4),
  ], VC_MAT);
  canopy.position.y = 23;
  canopy.castShadow = true;
  g.add(canopy);

  const moteParts = [];
  for (let i = 0; i < 12; i++) {
    const a = rand(0, 6.28), d = rand(7, 13);
    moteParts.push(pSph(MOTE, rand(0.14, 0.3), Math.cos(a) * d, rand(-4, 9), Math.sin(a) * d));
  }
  const motes = mergeParts(moteParts, VC_GLOW);
  motes.position.y = 18;
  g.add(motes);

  g.userData.anim = {
    kind: 'tree', canopy, heart, motes, phase: rand(0, 6.28),
    muzzle: new THREE.Vector3(0, 9, 0),
  };
  return g;
};

export const buildGrove = () => {
  const g = new THREE.Group();

  const stones = [];
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9 + rand(-0.2, 0.2);
    const sz = rand(0.5, 0.95);
    stones.push(part(sphGeo, 0x6b6f6a, sz, sz, sz,
      Math.cos(a) * 3.4, sz * 0.4, Math.sin(a) * 3.4, rand(0, 3), rand(0, 3), rand(0, 3)));
  }
  const ring = mergeParts(stones, VC_MAT);
  ring.castShadow = true;
  g.add(ring);

  // one water material per grove — the bloom uniform is per-grove state
  const water = new THREE.Mesh(new THREE.CircleGeometry(3.1, 40), makeWaterMaterial());
  water.rotation.x = -Math.PI / 2; water.position.y = 0.16;
  g.add(water);

  /* flowering ring: stems and blossoms as two buffers rather than twenty-eight */
  const bloom = new THREE.Group();
  bloom.visible = false;
  const stems = [], buds = [];
  for (let i = 0; i < 14; i++) {
    const a = rand(0, 6.28), d = rand(1.0, 4.6), h = rand(1.2, 2.6), y = rand(0.6, 1.3);
    stems.push(pCyl(0x4f8f3a, 0.09, h, Math.cos(a) * d, y, Math.sin(a) * d));
    buds.push(pSph(rand(0, 1) > 0.5 ? 0xffe27a : 0xd06ad0, 0.24,
      Math.cos(a) * d, y + h * 0.5, Math.sin(a) * d));
  }
  bloom.add(mergeParts(stems, VC_MAT));
  bloom.add(mergeParts(buds, VC_GLOW));
  g.add(bloom);

  /* Shaft of light — a billboarded quad, not a cylinder.
     An open-ended additive cylinder reads as disconnected pale slivers: you see its
     two silhouette edges accumulate and its front/back faces cancel visually. A
     single camera-facing quad with the falloff baked into vertex colours (soft at
     both vertical ends and at both sides, black at the tip, since black contributes
     nothing under additive blending) reads as one clean beam from every angle.
     It keeps depth testing, so it is properly occluded by the canopy and the
     forest instead of being painted over the top of them — it is 46m tall, which
     clears both, so the visible portion still carries the whole distance. */
  const SHAFT_W = 7, SHAFT_H = 46, SEG_X = 6, SEG_Y = 16;
  const shaftGeo = new THREE.PlaneGeometry(SHAFT_W, SHAFT_H, SEG_X, SEG_Y);
  const sp = shaftGeo.attributes.position;
  const scol = new Float32Array(sp.count * 3);
  const tint = new THREE.Color(0x8bffa0);
  for (let i = 0; i < sp.count; i++) {
    const v = (sp.getY(i) + SHAFT_H / 2) / SHAFT_H;         // 0 base .. 1 tip
    const u = Math.abs(sp.getX(i)) / (SHAFT_W / 2);         // 0 centre .. 1 edge
    const vertical = Math.pow(1 - v, 2.0);                  // fades out toward the sky
    const across = Math.pow(1 - u, 1.6);                    // soft sides, no hard edge
    const k = vertical * across * 0.85 + 0.015;
    scol[i * 3] = tint.r * k; scol[i * 3 + 1] = tint.g * k; scol[i * 3 + 2] = tint.b * k;
  }
  shaftGeo.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  const pillar = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    depthWrite: false, fog: true,
  }));
  pillar.position.y = SHAFT_H / 2;
  pillar.renderOrder = 6;          // same reason as the ring below
  g.add(pillar);

  /* Ground ping for an unvisited grove. A vertical shaft is heavily foreshortened
     at an RTS camera pitch and gets chopped up by the treeline in front of it, so
     it cannot carry the marker on its own. A flat ring on the ground is read
     instantly from above — it is how every RTS in the genre pings a location. */
  const beaconRing = new THREE.Mesh(
    new THREE.RingGeometry(5.0, 7.4, 48),
    new THREE.MeshBasicMaterial({
      // toneMapped:false — ACES pulls an additive marker toward white and the ring
      // measured 23% saturation against an authored 45%, reading as a grey UI decal
      // instead of the same nature-green cue as the column above it.
      color: 0x6cffa0, transparent: true, opacity: 0.46, toneMapped: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, fog: true,
    })
  );
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.position.y = 0.4;
  beaconRing.visible = false;
  /* MUST out-order the fog veil (renderOrder 5). The veil is transparent, writes no
     depth and resolves to fully opaque near-black over unexplored ground, so anything
     drawn before it there is erased no matter what the depth buffer says. depthTest
     stays on, so real geometry still occludes the marker correctly. */
  beaconRing.renderOrder = 6;
  g.add(beaconRing);

  g.userData.anim = { kind: 'grove', water, bloom, pillar, beaconRing, phase: rand(0, 6.28) };
  return g;
};

/* ======================= SCENERY (instanced) ============================ */

export function makeForest(count, placeFn) {
  const trunkG = new THREE.CylinderGeometry(0.34, 0.5, 4.4, 6);
  trunkG.translate(0, 2.2, 0);
  const leafG = new THREE.ConeGeometry(2.1, 6.2, 7);
  leafG.translate(0, 6.7, 0);
  const trunks = new THREE.InstancedMesh(trunkG, M(0x40331f), count);
  const leaves = new THREE.InstancedMesh(leafG, M(0x2f5f2c), count);
  trunks.castShadow = leaves.castShadow = true;
  trunks.receiveShadow = leaves.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  let n = 0;
  for (let i = 0; i < count * 5 && n < count; i++) {
    const p = placeFn();
    if (!p) continue;
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.y = rand(0, 6.28);
    const s = rand(0.62, 1.15);
    dummy.scale.set(s, s * rand(0.85, 1.3), s);
    dummy.updateMatrix();
    trunks.setMatrixAt(n, dummy.matrix);
    leaves.setMatrixAt(n, dummy.matrix);
    col.setHSL(0.26 + rand(-0.05, 0.05), rand(0.3, 0.5), rand(0.16, 0.30));
    leaves.setColorAt(n, col);
    n++;
  }
  trunks.count = leaves.count = n;
  trunks.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  return [trunks, leaves];
}

export function makeScatter(geo, material, count, placeFn, scaleRange = [0.6, 1.6]) {
  const im = new THREE.InstancedMesh(geo, material, count);
  im.castShadow = true; im.receiveShadow = true;
  const d = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i < count * 5 && n < count; i++) {
    const p = placeFn();
    if (!p) continue;
    d.position.set(p.x, p.y, p.z);
    d.rotation.set(rand(0, 3), rand(0, 6.28), rand(0, 3));
    const s = rand(scaleRange[0], scaleRange[1]);
    d.scale.set(s, s * rand(0.7, 1.2), s);
    d.updateMatrix();
    im.setMatrixAt(n++, d.matrix);
  }
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  return im;
}

/* =========================================================================
   Rig templates.

   `mergeParts` builds fresh BufferGeometry on every call, so spawning a wolf used
   to upload five new buffers that `destroyMesh()` never released — measured at
   +300 geometries per 60 units with zero reclaimed. Units of a given species are
   geometrically identical, so each species is built exactly once and cloned;
   `Object3D.clone()` shares geometry and material by reference, which removes the
   leak and the upload churn at the same time.

   `Object3D.copy()` deep-clones userData through JSON, which explodes on the
   Object3D references in `userData.anim` (parent<->child is circular), so the
   template's userData is stripped and the anim map is rebuilt per clone.
   ========================================================================= */
const _templates = new Map();

function remapAnim(tpl, clone, anim) {
  if (!anim) return null;
  const src = []; tpl.traverse(o => src.push(o));
  const dst = []; clone.traverse(o => dst.push(o));
  const map = new Map();
  for (let i = 0; i < src.length; i++) map.set(src[i], dst[i]);
  const pick = x => (x && x.isObject3D) ? (map.get(x) || x) : x;

  const out = {};
  for (const k in anim) {
    const v = anim[k];
    if (v && v.isObject3D) out[k] = pick(v);
    else if (Array.isArray(v)) {
      out[k] = v.map(x => (x && x.w && x.w.isObject3D) ? { w: pick(x.w), s: x.s } : pick(x));
    } else out[k] = v;
  }
  // per-instance phase, or every clone flaps and bobs in lockstep
  if ('hover' in anim) out.hover = rand(0, 6.28);
  if ('phase' in anim) out.phase = rand(0, 6.28);
  return out;
}

function cached(key, factory) {
  let rec = _templates.get(key);
  if (!rec) {
    const tpl = factory();
    const anim = tpl.userData.anim || null;
    tpl.userData = {};
    rec = { tpl, anim };
    _templates.set(key, rec);
  }
  const g = rec.tpl.clone(true);
  g.userData.anim = remapAnim(rec.tpl, g, rec.anim);
  return g;
}

/* ------------------------------------------------------------------------ */
export const BUILDERS = {
  // repeatedly spawned: built once, cloned thereafter
  wolf:   () => cached('wolf', buildWolf),
  boar:   () => cached('boar', buildBoar),
  bear:   () => cached('bear', buildBear),
  raven:  () => cached('raven', buildRaven),
  guard:  () => cached('guard', buildGuard),
  drone:  () => cached('drone', buildDrone),
  turret: () => cached('turret', buildTurret),
  // one-offs, or (grove) needing genuinely per-instance materials
  depot: buildDepot, coolant: buildCoolant, core: buildCore,
  wall: buildWall, hearttree: buildHeartTree, grove: buildGrove,
};
