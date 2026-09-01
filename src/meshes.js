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
/* The 20-face sphere. Foliage clusters, boulders and lanterns want BIG facets
   -- that is the whole stylised read -- and at 60 vertices instead of 240 it
   is also the only sphere cheap enough to scatter a few hundred times. */
const sphLoGeo = new THREE.IcosahedronGeometry(1, 0);
/* Tapered cylinders for anything that grows: trunks, branches, tusks. Cached
   by profile so a species built a hundred times over allocates once. */
const taperCache = new Map();
function taperGeo(rTop, rBot, seg = 6) {
  const k = `${rTop}|${rBot}|${seg}`;
  let g = taperCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(rTop, rBot, 1, seg); taperCache.set(k, g); }
  return g;
}

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
  return new THREE.Mesh(mergeGeo(parts), material);
}

/* The geometry half of mergeParts, on its own so scatter props can bake a
   two-tone buffer (bark + cut face, stem + cap) and hand it to an
   InstancedMesh: one draw for three hundred mushrooms, still coloured. */
function mergeGeo(parts) {
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
  return out;
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
const pSphLo = (c, r, x, y, z, sy = r) => part(sphLoGeo, c, r, sy, r, x, y, z);
/* tapered post: radius at top, at bottom, height; rotates about its centre */
const pTaper = (c, rt, rb, h, x, y, z, rx, ry, rz, seg = 6) =>
  part(taperGeo(rt, rb, seg), c, 1, h, 1, x, y, z, rx, ry, rz);
/* Greyscale multiplier, not a colour: instanced foliage carries its real hue in
   instanceColor, so its vertex colours only say "this facet is a shade lighter".
   part() takes a THREE.Color as readily as a hex. */
const shade = k => new THREE.Color(k, k, k);

/* ============================ WILDLIFE ================================== */

/* Everything below stays one merged buffer per moving part (torso, head, two
   leg pairs, tail) -- the detail pass adds vertices, never draw calls.

   New optional knobs, all off by default so existing species keep their specs:
     saddle     colour   darker dorsal marking laid over the back
     bushyTail  bool     tapered-cone brush instead of the thin box (wolf)
     hump       bool     shoulder mass ahead of the withers (bear, bison-like)
     roundEars  bool     sphere ears instead of pricked cones (bear)
     earIn      colour   inner-ear panel, defaults to the belly tone */
function quadruped({ fur, belly, bodyL, bodyW, bodyH, legH, headS, snout, tail, ears, extras,
                     saddle, bushyTail, hump, roundEars, earIn }) {
  const g = new THREE.Group();
  const y = legH + bodyH / 2;
  const DARK = 0x15130f;

  /* ---- body: torso, belly, shoulder/haunch masses, and the shaping pass ---- */
  const bodyParts = [
    pBox(fur,   bodyW, bodyH, bodyL, 0, 0, 0),
    pBox(belly, bodyW * 0.86, bodyH * 0.45, bodyL * 0.8, 0, -bodyH * 0.32, 0),
    /* haunches tilt a few degrees so they read as muscle, not crates */
    pBox(fur,   bodyW * 1.12, bodyH * 1.06, bodyL * 0.26, 0, bodyH * 0.05, bodyL * 0.28, -0.08),
    pBox(fur,   bodyW * 1.05, bodyH * 1.12, bodyL * 0.28, 0, bodyH * 0.05, -bodyL * 0.3, 0.1),
    /* rump slope and chest brisket break the brick silhouette front and rear */
    pBox(fur,   bodyW * 0.92, bodyH * 0.5, bodyL * 0.34, 0, bodyH * 0.3, -bodyL * 0.44, 0.5),
    pBox(belly, bodyW * 0.7, bodyH * 0.42, bodyL * 0.2, 0, -bodyH * 0.28, bodyL * 0.46, -0.35),
    /* neck wedge: the head used to float ahead of the torso with a visible gap
       at three-quarter angles; this closes it without joining the nod pivot */
    pBox(fur,   headS * 0.95, bodyH * 0.62, headS * 1.2, 0, bodyH * 0.26, bodyL * 0.46, -0.45),
  ];
  if (saddle) bodyParts.push(pBox(saddle, bodyW * 1.02, bodyH * 0.22, bodyL * 0.62, 0, bodyH * 0.46, -bodyL * 0.06));
  if (hump)   bodyParts.push(pBox(fur, bodyW * 0.9, bodyH * 0.55, bodyL * 0.32, 0, bodyH * 0.52, bodyL * 0.18, 0.25));
  if (extras && extras.body) bodyParts.push(...extras.body);
  const body = mergeParts(bodyParts, VC_MAT);
  body.position.y = y;
  body.castShadow = true;
  g.add(body);

  /* ---- head, baked around its own pivot so it can still nod ---- */
  const headParts = [
    pBox(fur, headS, headS * 0.86, headS * 1.1, 0, 0, 0),
    pBox(DARK, headS * 0.5, headS * 0.16, headS * 0.16, 0, headS * 0.06, headS * 0.5),
    /* eyes -- two dark beads; invisible at strategic zoom, all character up close */
    pSph(DARK, headS * 0.09, -headS * 0.3, headS * 0.16, headS * 0.42),
    pSph(DARK, headS * 0.09,  headS * 0.3, headS * 0.16, headS * 0.42),
  ];
  if (snout) {
    headParts.push(pBox(fur, headS * 0.5, headS * 0.44, snout, 0, -headS * 0.2, headS * 0.55 + snout * 0.4));
    headParts.push(pBox(DARK, headS * 0.28, headS * 0.18, headS * 0.14,
      0, -headS * 0.08, headS * 0.55 + snout * 0.82));                    // nose tip
  }
  if (ears) {
    const inner = earIn !== undefined ? earIn : belly;
    for (const sx of [-1, 1]) {
      if (roundEars) {
        headParts.push(pSph(fur, headS * 0.24, sx * headS * 0.36, headS * 0.5, -headS * 0.1));
      } else {
        headParts.push(pCone(fur,   headS * 0.22, headS * 0.44, sx * headS * 0.3, headS * 0.52, -headS * 0.05));
        headParts.push(pCone(inner, headS * 0.12, headS * 0.28, sx * headS * 0.3, headS * 0.5, -headS * 0.02));
      }
    }
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
      /* thigh mass at the hip: legs used to be bare sticks from body to ground */
      parts.push(pBox(fur, lw * 1.6, legH * 0.5, lw * 2.0,
        sx * bodyW * 0.36, legH * 0.82, sz * bodyL * 0.32));
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
    const tp = bushyTail
      ? [pCone(fur, bodyW * 0.26, tail, 0, 0, -tail * 0.42, -Math.PI / 2 - 0.12),
         pSph(fur, bodyW * 0.2, 0, 0.02, -tail * 0.08)]
      : [pBox(fur, bodyW * 0.22, bodyW * 0.22, tail, 0, 0, -tail * 0.4)];
    tailObj = mergeParts(tp, VC_MAT);
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
  saddle: 0x565d68, bushyTail: true,
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
  hump: true, roundEars: true,
  extras: { paw: 0xd8d2c2 },
});

export const buildRaven = () => {
  const g = new THREE.Group();
  const F = 0x21222c, S = 0x3a3c4a, BEAK = 0xc9a227, EYE = 0xffe9a8, FOOT = 0x5a5040;

  const body = mergeParts([
    pBox(F, 0.72, 0.66, 1.9, 0, 0, 0),
    pBox(S, 0.5, 0.3, 1.2, 0, -0.32, 0.1),                          // breast
    /* tail: three fanned vanes, the outer pair splayed */
    pBox(F, 0.42, 0.07, 1.1, 0, -0.02, -1.35, 0.08, 0, 0),
    pBox(S, 0.36, 0.06, 1.0, -0.28, -0.03, -1.3, 0.08, 0.25, 0),
    pBox(S, 0.36, 0.06, 1.0, 0.28, -0.03, -1.3, 0.08, -0.25, 0),
    pBox(F, 0.55, 0.5, 0.6, 0, 0.22, 1.05),                         // head
    pBox(S, 0.4, 0.18, 0.32, 0, 0.5, 0.98),                         // crown ruff
    pCone(BEAK, 0.13, 0.62, 0, 0.16, 1.55, -Math.PI / 2, 0, 0),
    pSph(EYE, 0.07, -0.2, 0.32, 1.2),
    pSph(EYE, 0.07, 0.2, 0.32, 1.2),
    /* feet tucked back under the belly, as a flying bird carries them */
    pBox(FOOT, 0.1, 0.3, 0.1, -0.18, -0.45, 0.2, 0.5, 0, 0),
    pBox(FOOT, 0.1, 0.3, 0.1, 0.18, -0.45, 0.2, 0.5, 0, 0),
    pBox(FOOT, 0.26, 0.05, 0.3, -0.18, -0.58, 0.28),
    pBox(FOOT, 0.26, 0.05, 0.3, 0.18, -0.58, 0.28),
  ], VC_MAT);
  body.castShadow = true;
  g.add(body);

  const wings = [];
  for (const sx of [-1, 1]) {
    const parts = [
      pBox(S, 1.4, 0.09, 1.0, sx * 0.7, 0, 0),                      // secondaries
      pBox(F, 1.0, 0.08, 0.9, sx * 1.85, 0.01, -0.1),               // primaries block
    ];
    /* feather steps: four fingers off the trailing edge, each shorter and
       swept a little further back -- the ragged raven hand-print silhouette */
    for (let k = 0; k < 4; k++) {
      parts.push(pBox(k % 2 ? S : F, 0.26, 0.07, 0.75 - k * 0.12,
        sx * (1.55 + k * 0.32), 0.02, -0.55 - k * 0.1, 0, sx * (0.1 + k * 0.12), 0));
    }
    const w = mergeParts(parts, VC_MAT);
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
    pBox(ARM, 1.2, 0.12, 0.5, 0, 0.22, 0),                          // top spine
    pCone(SHELL, 0.55, 0.5, 0, -0.32, 0, Math.PI, 0, 0),
    pCyl(ARM, 0.24, 0.16, 0, -0.3, 0.34, Math.PI / 2, 0, 0),         // sensor housing
    pCyl(ARM, 0.05, 0.6, 0.3, 0.5, -0.3),                           // antenna
    pBox(ARM, 0.2, 0.2, 0.6, 0, -0.34, 0.25),                       // gun pod
    pCyl(ARM, 0.06, 0.5, 0, -0.34, 0.6, Math.PI / 2, 0, 0),          // barrel, tip z 0.85
    pBox(ARM, 0.06, 0.16, 0.9, -0.4, -0.5, 0),                      // skids
    pBox(ARM, 0.06, 0.16, 0.9, 0.4, -0.5, 0),
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    shellParts.push(pBox(ARM, 0.16, 0.1, 0.16, sx * 0.75, 0.02, sz * 0.75));
    /* arm struts out to the motors, laid along the diagonal */
    shellParts.push(pBox(ARM, 0.7, 0.07, 0.07, sx * 0.5, 0.02, sz * 0.5, 0, Math.atan2(-sz, sx), 0));
  }
  const body = mergeParts(shellParts, VC_MAT_METAL);
  body.castShadow = true;
  g.add(body);

  /* sensor eye, nav lights (cyan forward, amber aft) and the antenna tip:
     one glow buffer riding the body so it bobs with it */
  body.add(mergeParts([
    pSphLo(EYE, 0.12, 0, -0.3, 0.44),
    pBox(MK_CYAN, 0.12, 0.06, 0.12, -0.75, 0.09, 0.75),
    pBox(MK_CYAN, 0.12, 0.06, 0.12, 0.75, 0.09, 0.75),
    pBox(MK_AMBER, 0.12, 0.06, 0.12, -0.75, 0.09, -0.75),
    pBox(MK_AMBER, 0.12, 0.06, 0.12, 0.75, 0.09, -0.75),
    pSphLo(MK_AMBER, 0.06, 0.3, 0.82, -0.3),
  ], VC_GLOW));

  const rotors = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const r = cyl(M(0x8fa0b0, { opacity: 0.45 }), 0.5, 0.04, sx * 0.75, 0.14, sz * 0.75);
    r.castShadow = false;
    body.add(r); rotors.push(r);
  }

  g.userData.anim = { kind: 'drone', rotors, body, hover: rand(0, 6.28), muzzle: new THREE.Vector3(0, -0.34, 0.85) };
  return g;
};

/* Pissed-off locals. Two body plans — a woman and a man — built on the same
   biped rig as the guard so the walk/recoil animation drives them unchanged.
   Which one you get is decided per spawn; both templates are cached, so the
   variety costs nothing after the first of each. */
function buildLocalVariant(v) {
  const g = new THREE.Group();
  const W = v === 'w';
  const SHIRT = W ? 0x8a4a3c : 0x5c6e46;     // rust flannel / olive jacket
  const PANTS = W ? 0x3f4956 : 0x46505c;
  const SKIN  = W ? 0xe0b08a : 0xc98e63;
  const HAIR  = W ? 0x2e2018 : 0x3a3428;
  const STOCK = 0x5a3e26, BARREL = 0x24282e, LEATHER = 0x4a3524;

  const bodyParts = [
    pBox(SHIRT, W ? 0.78 : 0.88, 1.05, 0.5, 0, 0, 0),
    pBox(SKIN, 0.44, 0.42, 0.44, 0, 0.75, 0),                     // head
    // armband in the forest's green — whose side they're on reads at a glance
    pBox(0x7fd44a, 0.27, 0.14, 0.27, -0.5, 0.18, 0.04),
    pBox(SHIRT, 0.24, 0.85, 0.24, -0.52, -0.05, 0.05),            // off arm
    pBox(SKIN, 0.24, 0.18, 0.24, -0.52, -0.38, 0.05),             // hand
    pBox(LEATHER, W ? 0.82 : 0.92, 0.12, 0.54, 0, -0.46, 0),      // belt
    pBox(LEATHER, 0.3, 0.26, 0.14, 0.3, -0.5, 0.3),               // cartridge pouch
  ];
  if (W) {
    bodyParts.push(pBox(HAIR, 0.48, 0.5, 0.2, 0, 0.78, -0.26));   // hair, tied back
    bodyParts.push(pBox(HAIR, 0.2, 0.42, 0.16, 0, 0.5, -0.3));    // tail
    bodyParts.push(pBox(HAIR, 0.5, 0.14, 0.48, 0, 0.97, 0));      // crown
    bodyParts.push(pBox(0xc8b08a, 0.5, 0.16, 0.5, 0, 0.5, 0.02)); // scarf
    bodyParts.push(pBox(LEATHER, 0.34, 0.4, 0.14, 0.42, -0.2, -0.3)); // satchel
    bodyParts.push(pBox(LEATHER, 0.06, 0.9, 0.06, -0.2, 0.2, -0.3, 0, 0, 0.45)); // strap
  } else {
    bodyParts.push(pBox(HAIR, 0.48, 0.14, 0.5, 0, 0.95, 0.02));   // cap
    bodyParts.push(pBox(HAIR, 0.48, 0.06, 0.2, 0, 0.9, 0.3));     // brim
    bodyParts.push(pBox(HAIR, 0.36, 0.14, 0.12, 0, 0.6, 0.2));    // beard
    bodyParts.push(pBox(0x3b3f33, 0.9, 0.8, 0.54, 0, 0.1, 0));    // hunting vest
  }
  const body = mergeParts(bodyParts, VC_MAT);
  body.position.y = 1.55;
  body.castShadow = true;
  g.add(body);

  /* firing arm + hunting rifle move together on recoil */
  const gun = mergeParts([
    pBox(SHIRT, 0.24, 0.75, 0.24, 0, 0, -0.22, -1.1, 0, 0),
    pBox(SKIN, 0.24, 0.18, 0.24, 0, 0.02, 0.1),                  // hand on the grip
    pBox(STOCK, 0.13, 0.2, 0.85, 0, -0.02, -0.1),                 // wooden stock
    pBox(STOCK, 0.12, 0.14, 0.7, 0, -0.06, 0.5),                  // fore-end
    pBox(BARREL, 0.09, 0.09, 1.6, 0, 0.04, 0.65),                 // long barrel
    pBox(BARREL, 0.05, 0.16, 0.05, 0, 0.14, 1.3),                 // front sight
    pBox(BARREL, 0.08, 0.12, 0.3, 0, 0.16, 0.05),                 // bolt housing
  ], VC_MAT);
  gun.position.set(0.5, 1.5, 0.5);
  g.add(gun);

  const legs = [];
  for (const sx of [-1, 1]) {
    const l = mergeParts([
      pBox(PANTS, 0.26, 1.05, 0.26, sx * 0.2, 0, 0),
      pBox(LEATHER, 0.28, 0.24, 0.34, sx * 0.2, -0.42, 0.03),    // boot
    ], VC_MAT);
    l.position.y = 0.52;
    g.add(l); legs.push(l);
  }

  /* muzzle at the barrel tip: gun z 0.5 + barrel end z 1.45 */
  g.userData.anim = { kind: 'biped', legs, torso: body, head: null, gun, muzzle: new THREE.Vector3(0.5, 1.54, 1.95) };
  return g;
}

export const buildPorcupine = () => {
  const g = quadruped({
    fur: 0x4a3b2e, belly: 0x6a5946, bodyL: 2.2, bodyW: 1.25, bodyH: 1.15,
    legH: 0.62, headS: 0.72, snout: 0.5, tail: 0.5, ears: true,
    extras: {
      // the quill mantle, angled back over the body
      body: (() => {
        const q = [];
        for (let r = 0; r < 4; r++) {
          for (let i = 0; i < 5; i++) {
            const sx = (i - 2) * 0.24;
            q.push(pCone(r % 2 ? 0xe8dfc8 : 0x2b2118, 0.055, 0.95,
              sx, 0.62 + r * 0.05, -0.55 + r * 0.36, -0.55 - r * 0.07, 0, sx * 0.25));
          }
        }
        return q;
      })(),
    },
  });
  return g;
};

export const buildBeaver = () => quadruped({
  fur: 0x533b28, belly: 0x6d5137, bodyL: 2.0, bodyW: 1.1, bodyH: 1.05,
  legH: 0.5, headS: 0.68, snout: 0.42, tail: 0, ears: true,
  extras: {
    head: [pBox(0xe8e0c4, 0.24, 0.2, 0.12, 0, -0.16, 0.62)],       // incisors
    body: [
      pBox(0x3a2a1c, 1.15, 0.14, 1.5, 0, -0.34, -1.5),             // the paddle tail
      pBox(0x2e2116, 1.0, 0.1, 0.28, 0, -0.3, -2.1),
    ],
  },
});

/* The capybara reads as a wall on legs: long, wide, low to the ground, with a
   blunt squared-off snout and almost no neck. Deliberately the broadest
   silhouette on the wild side, because at RTS zoom the player identifies its
   job before they read its name. */
export const buildCapybara = () => quadruped({
  fur: 0x7a5433, belly: 0x8d6a45, bodyL: 2.45, bodyW: 1.5, bodyH: 1.2,
  legH: 0.42, headS: 0.82, snout: 0.5, tail: 0, ears: true,
  extras: {
    head: [
      pBox(0x3a2a1c, 0.5, 0.2, 0.2, 0, -0.2, 0.68),        // blunt dark muzzle
      pBox(0x2a1d13, 0.14, 0.1, 0.08, -0.14, -0.12, 0.76), // nostrils
      pBox(0x2a1d13, 0.14, 0.1, 0.08, 0.14, -0.12, 0.76),
    ],
    body: [
      pBox(0x6b4829, 1.55, 0.22, 1.1, 0, 0.58, 0.1),       // heavy shoulder ridge
    ],
  },
});

/* ============================= MACHINE ================================== */

/* Machine palette, held to five tones so every structure reads as one kit:
   dark steel, mid steel, near-black trim, safety yellow, and the cyan that
   means "live". Amber is reserved for warnings and gun glow. */
const MK_STEEL = 0x4a525c, MK_MID = 0x5d6773, MK_DARK = 0x22272e, MK_BLACK = 0x14181e;
const MK_YELLOW = 0xd9ab2b, MK_CYAN = 0x39d7ea, MK_AMBER = 0xff8a3d;

/* A box whose local z points outward from the origin at angle `a` on the XZ
   plane. `w` runs along the tangent, `d` along the radius, so a hazard tile or
   a hold-down foot can be laid around a drum without trig at the call site. */
const pRadial = (c, w, h, d, r, a, y, rx = 0) =>
  pBox(c, w, h, d, Math.cos(a) * r, y, Math.sin(a) * r, rx, Math.PI / 2 - a, 0);

export const buildGuard = () => {
  const g = new THREE.Group();
  const SUIT = 0x2b303a, VEST = 0x1d2128, SKIN = 0x4b515c, DARK = 0x141922, GUN = 0x14171d;

  /* torso, vest, head, helmet and the off-hand arm never move relative to one
     another, so they are one buffer */
  const body = mergeParts([
    pBox(SUIT, 0.85, 1.05, 0.55, 0, 0, 0),
    pBox(VEST, 0.95, 0.62, 0.66, 0, 0.10, 0),
    pBox(DARK, 0.6, 0.34, 0.12, 0, 0.14, 0.36),            // chest plate
    pBox(MK_CYAN, 0.16, 0.06, 0.02, 0.3, 0.23, 0.43),      // status light
    pBox(VEST, 0.34, 0.2, 0.36, -0.55, 0.42, 0),           // shoulder pads
    pBox(VEST, 0.34, 0.2, 0.36, 0.55, 0.42, 0),
    pBox(VEST, 0.7, 0.5, 0.3, 0, 0.05, -0.4),              // pack
    pBox(DARK, 0.9, 0.12, 0.6, 0, -0.44, 0),               // belt
    pBox(DARK, 0.22, 0.2, 0.16, -0.32, -0.54, 0.3),        // pouch
    pBox(SKIN, 0.45, 0.42, 0.45, 0, 0.75, 0),              // head
    /* helmet: shell, brim, and a lit visor band -- the cyan says machine at
       the same glance the green armband says forest on a Local */
    pBox(DARK, 0.52, 0.3, 0.52, 0, 0.92, -0.02),
    pBox(DARK, 0.58, 0.08, 0.58, 0, 0.8, 0),
    pBox(MK_CYAN, 0.4, 0.09, 0.05, 0, 0.72, 0.24),
    pBox(SUIT, 0.24, 0.85, 0.24, -0.55, -0.05, 0.05),      // off arm
    pBox(DARK, 0.26, 0.2, 0.26, -0.55, -0.38, 0.05),       // glove
  ], VC_MAT_METAL);
  body.position.y = 1.55;
  body.castShadow = true;
  g.add(body);

  /* firing arm + weapon travel together on recoil */
  const gun = mergeParts([
    pBox(SUIT, 0.24, 0.75, 0.24, 0, 0, -0.22, -1.1, 0, 0),
    pBox(DARK, 0.26, 0.2, 0.26, 0, 0.02, 0.12),            // glove on the grip
    pBox(GUN, 0.14, 0.16, 1.5, 0, 0, 0.5),
    pBox(0x232830, 0.12, 0.3, 0.3, 0, -0.18, 0.05),        // grip
    pBox(GUN, 0.1, 0.32, 0.14, 0, -0.22, 0.45),            // magazine
    pBox(0x232830, 0.16, 0.12, 0.4, 0, 0.14, 0.4),         // optic
    pBox(GUN, 0.18, 0.2, 0.5, 0, 0.02, -0.4),              // stock
    pCyl(GUN, 0.05, 0.3, 0, 0.02, 1.35, Math.PI / 2, 0, 0),  // barrel, tip at z 1.5
  ], VC_MAT_METAL);
  gun.position.set(0.5, 1.5, 0.5);
  g.add(gun);

  const legs = [];
  for (const sx of [-1, 1]) {
    const l = mergeParts([
      pBox(0x232833, 0.28, 1.05, 0.28, sx * 0.22, 0, 0),
      pBox(DARK, 0.3, 0.2, 0.3, sx * 0.22, 0.05, 0.02),      // knee pad
      pBox(DARK, 0.3, 0.22, 0.38, sx * 0.22, -0.44, 0.04),   // boot
    ], VC_MAT_METAL);
    l.position.y = 0.52;
    g.add(l); legs.push(l);
  }

  /* muzzle = barrel tip in unit space: gun origin z 0.5 + barrel end z 1.5 */
  g.userData.anim = { kind: 'biped', legs, torso: body, head: null, gun, muzzle: new THREE.Vector3(0.5, 1.5, 2.0) };
  return g;
};

/* Field technician: hi-vis, unarmed, carries a welding rig. Deliberately reads
   as *not a soldier* at a glance, because shooting it is the correct answer and
   the player needs to spot it inside a firefight. */
export const buildTech = () => {
  const g = new THREE.Group();
  const HIVIS = 0xe8862a, VEST = 0xf5c243, SKIN = 0x4b515c, DARK = 0x1b2028, REFLEX = 0xdfe3e6;

  const body = mergeParts([
    pBox(HIVIS, 0.82, 1.02, 0.54, 0, 0, 0),
    pBox(VEST, 0.92, 0.34, 0.64, 0, 0.20, 0),
    pBox(VEST, 0.92, 0.14, 0.64, 0, -0.14, 0),
    pBox(REFLEX, 0.94, 0.05, 0.66, 0, 0.3, 0),           // reflective tape
    pBox(REFLEX, 0.94, 0.05, 0.66, 0, -0.06, 0),
    pBox(DARK, 0.86, 0.12, 0.58, 0, -0.42, 0),           // tool belt
    pBox(DARK, 0.2, 0.22, 0.18, 0.34, -0.52, 0.28),      // pouches
    pBox(DARK, 0.2, 0.22, 0.18, -0.34, -0.52, 0.28),
    pCyl(DARK, 0.2, 0.9, 0.16, 0.05, -0.42),             // gas bottle on the back
    pCyl(DARK, 0.2, 0.9, -0.16, 0.05, -0.42),
    pBox(VEST, 0.6, 0.12, 0.3, 0, 0.42, -0.42),          // bottle bracket
    pBox(SKIN, 0.44, 0.40, 0.44, 0, 0.73, 0),
    pBox(VEST, 0.5, 0.22, 0.5, 0, 0.96, 0),              // hard hat
    pBox(VEST, 0.58, 0.06, 0.6, 0, 0.86, 0.04),          // brim
    pBox(DARK, 0.42, 0.12, 0.05, 0, 0.74, 0.23),         // visor
    pBox(HIVIS, 0.23, 0.82, 0.23, -0.53, -0.05, 0.05),
    pBox(DARK, 0.25, 0.18, 0.25, -0.53, -0.36, 0.05),    // glove
  ], VC_MAT_METAL);
  body.position.y = 1.52;
  body.castShadow = true;
  g.add(body);

  /* the welder sits where the rifle would, so the silhouette rhymes with a
     guard at distance and separates up close */
  const gun = mergeParts([
    pBox(HIVIS, 0.23, 0.72, 0.23, 0, 0, -0.22, -1.0, 0, 0),
    pBox(DARK, 0.25, 0.18, 0.25, 0, 0.02, 0.1),          // glove
    pBox(DARK, 0.16, 0.16, 0.7, 0, 0, 0.28),
    pBox(DARK, 0.1, 0.22, 0.12, 0, -0.16, 0.12),         // trigger grip
    pCyl(DARK, 0.04, 0.5, 0, -0.1, -0.2, 0.9, 0, 0),     // hose back toward the bottles
    pBox(MK_CYAN, 0.10, 0.10, 0.16, 0, 0, 0.66),         // arc tip
  ], VC_MAT_METAL);
  gun.position.set(0.48, 1.46, 0.42);
  g.add(gun);

  const legs = [];
  for (const sx of [-1, 1]) {
    const l = mergeParts([
      pBox(DARK, 0.27, 1.02, 0.27, sx * 0.21, 0, 0),
      pBox(VEST, 0.29, 0.1, 0.29, sx * 0.21, -0.1, 0),     // hi-vis cuff
      pBox(DARK, 0.29, 0.2, 0.36, sx * 0.21, -0.43, 0.04), // boot
    ], VC_MAT_METAL);
    l.position.y = 0.51;
    g.add(l); legs.push(l);
  }

  g.userData.anim = { kind: 'biped', legs, torso: body, head: null, gun, muzzle: new THREE.Vector3(0.48, 1.46, 1.16) };
  return g;
};

/* Generator bank: transformer drums in a hard cage, and a live-current glow
   that goes out with the power. Wide and low so it reads as infrastructure
   rather than a weapon, because it is a target, not a threat. */
export const buildGenerator = () => {
  const g = new THREE.Group();
  const STEEL = 0x555f6b, DARK = 0x24292f, COPPER = 0x9a6b33, CERAMIC = 0xd8d2c2;

  const baseParts = [
    pBox(DARK, 7.0, 0.7, 4.6, 0, 0.35, 0),
    pBox(STEEL, 6.2, 1.9, 3.9, 0, 1.5, 0),
    pBox(DARK, 6.4, 0.2, 4.1, 0, 2.5, 0),                 // deck lip
    /* control cabinet at the end of the bank, with a lit panel */
    pBox(STEEL, 1.0, 2.4, 1.6, 3.7, 1.9, 0),
    pBox(DARK, 1.04, 0.2, 1.64, 3.7, 3.15, 0),
    /* cable tray feeding the drums, low on the near side */
    pBox(STEEL, 5.8, 0.14, 0.5, 0, 2.7, 2.15),
    pBox(DARK, 0.5, 2.0, 0.5, -3.2, 1.0, 2.3),
  ];
  /* hazard stripes down the plinth face */
  for (let i = 0; i < 7; i++)
    baseParts.push(pBox(i % 2 ? MK_YELLOW : DARK, 0.9, 0.5, 0.1, -2.7 + i * 0.9, 0.5, 2.32));
  /* the cage: four posts and top rails around the drums */
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    baseParts.push(pBox(DARK, 0.18, 3.4, 0.18, sx * 2.95, 3.9, sz * 1.65));
  for (const sz of [-1, 1]) baseParts.push(pBox(DARK, 6.0, 0.12, 0.12, 0, 5.55, sz * 1.65));
  for (const sx of [-1, 1]) baseParts.push(pBox(DARK, 0.12, 0.12, 3.4, sx * 2.95, 5.55, 0));
  const base = mergeParts(baseParts, VC_MAT_METAL);
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  /* three transformer drums with cooling fins and ceramic insulators */
  const drumParts = [];
  for (let i = -1; i <= 1; i++) {
    const x = i * 2.0;
    drumParts.push(pCyl(STEEL, 0.95, 2.5, x, 0, 0));
    drumParts.push(pCyl(DARK, 1.08, 0.22, x, 1.0, 0));
    drumParts.push(pCyl(DARK, 1.08, 0.22, x, 0.4, 0));
    drumParts.push(pCyl(DARK, 1.08, 0.22, x, -0.3, 0));
    drumParts.push(pCyl(CERAMIC, 0.38, 0.18, x, 1.32, 0));
    drumParts.push(pCyl(CERAMIC, 0.3, 0.18, x, 1.5, 0));
    drumParts.push(pBox(COPPER, 0.26, 0.5, 0.26, x, 1.8, 0));
  }
  const drums = mergeParts(drumParts, VC_MAT_METAL);
  drums.position.set(0, 3.4, 0);
  drums.castShadow = true;
  g.add(drums);

  /* the tell: current arcing between the drums, hidden when the bank is dead.
     The panel screen rides along, so a dead bank has no lit face at all. */
  const glow = mergeParts([
    pBox(MK_CYAN, 3.9, 0.10, 0.10, 0, 0, 0),
    pBox(MK_CYAN, 0.10, 0.10, 2.6, 0, 0, 0),
    pBox(MK_CYAN, 0.06, 0.5, 0.8, 4.22, -2.3, 0),
  ], VC_GLOW);
  glow.position.set(0, 4.9, 0);
  g.add(glow);

  g.userData.anim = { kind: 'generator', glow };
  return g;
};

/* Deep well: a capped bore with a pump head. Small, unglamorous, and easy to
   walk past — which is the joke, because it outlasts every intake you smash. */
export const buildWell = () => {
  const g = new THREE.Group();
  const STONE = 0x6b6f74, DARK = 0x2a2f35, PIPE = 0x4b5560, GAUGE = 0xe6e8ea;

  const parts = [
    pCyl(STONE, 2.2, 1.5, 0, 0.75, 0),
    pCyl(DARK, 1.8, 0.25, 0, 1.6, 0),
    pBox(PIPE, 0.6, 3.2, 0.6, 0, 3.0, 0),
    pBox(PIPE, 2.4, 0.5, 0.5, 0.6, 4.4, 0),
    pSphLo(PIPE, 0.42, 1.75, 4.4, 0),                     // elbow
    pCyl(DARK, 0.42, 1.4, 1.75, 3.7, 0),
    /* valve wheel on the riser, gauge above it */
    pCyl(DARK, 0.55, 0.1, 0, 2.6, 0.55, Math.PI / 2, 0, 0),
    pBox(DARK, 1.0, 0.1, 0.1, 0, 2.6, 0.62),
    pBox(DARK, 0.1, 1.0, 0.1, 0, 2.6, 0.62),
    pCyl(GAUGE, 0.2, 0.08, 0, 3.6, 0.36, Math.PI / 2, 0, 0),
    pCyl(DARK, 0.24, 0.06, 0, 3.6, 0.32, Math.PI / 2, 0, 0),
    /* pipe run leaving the head toward the compound mains */
    pCyl(PIPE, 0.28, 3.0, 1.75, 0.5, -1.5, Math.PI / 2, 0, 0),
    pCyl(DARK, 0.36, 0.2, 1.75, 0.5, -2.6, Math.PI / 2, 0, 0),
  ];
  /* hazard chevrons around the cap rim, and three bollards guarding it */
  for (let i = 0; i < 10; i++)
    parts.push(pRadial(i % 2 ? MK_YELLOW : DARK, 0.9, 0.06, 0.5, 1.9, i * Math.PI / 5, 1.54));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.09 + 0.5;
    parts.push(pCyl(MK_YELLOW, 0.16, 1.0, Math.cos(a) * 3.0, 0.5, Math.sin(a) * 3.0));
    parts.push(pCyl(DARK, 0.17, 0.2, Math.cos(a) * 3.0, 0.7, Math.sin(a) * 3.0));
  }
  const body = mergeParts(parts, VC_MAT_METAL);
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const glow = mergeParts([pCyl(MK_CYAN, 1.5, 0.10, 0, 0, 0)], VC_GLOW);
  glow.position.set(0, 1.75, 0);
  g.add(glow);

  g.userData.anim = { kind: 'well', glow };
  return g;
};

export const buildTurret = () => {
  const g = new THREE.Group();
  const STEEL = 0x5d6773, DARK = 0x2b3038;

  const baseParts = [
    pCyl(DARK, 2.4, 0.6, 0, 0.3, 0),
    pCyl(STEEL, 1.5, 2.6, 0, 1.7, 0),
    pCyl(DARK, 1.7, 0.3, 0, 3.05, 0),                     // slew bearing
    /* ammo hopper bolted to the column, feed chute up to the head */
    pBox(DARK, 1.1, 1.3, 0.9, -1.75, 1.6, 0.2),
    pBox(MK_YELLOW, 1.14, 0.18, 0.94, -1.75, 1.95, 0.2),
    pCyl(DARK, 0.16, 1.6, -1.2, 2.7, 0.2, 0, 0, -0.5),
    /* power cable out to the ground */
    pCyl(DARK, 0.12, 2.6, 2.4, 0.16, 0.6, 0, 0, Math.PI / 2),
  ];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    baseParts.push(pBox(DARK, 0.3, 2.2, 0.3, Math.cos(a) * 1.5, 1.6, Math.sin(a) * 1.5));
    baseParts.push(pRadial(STEEL, 0.5, 0.25, 1.6, 2.0, a, 0.72));     // hold-down feet
  }
  /* hazard chevrons around the plinth rim */
  for (let i = 0; i < 8; i++)
    baseParts.push(pRadial(MK_YELLOW, 0.55, 0.08, 1.0, 1.95, i * Math.PI / 4 + Math.PI / 8, 0.62));
  const base = mergeParts(baseParts, VC_MAT_METAL);
  base.castShadow = true;
  g.add(base);

  const head = new THREE.Group();
  head.position.y = 3.4;
  const shell = mergeParts([
    pBox(STEEL, 2.2, 1.3, 2.0, 0, 0, 0),
    pBox(DARK, 2.4, 0.35, 0.6, 0, 0.5, 0.5),
    pBox(STEEL, 1.6, 0.12, 1.6, 0, 0.72, -0.2),           // roof plate
    pBox(DARK, 1.0, 0.8, 1.2, 1.5, 0.1, -0.3),            // ammo drum housing
    pBox(MK_YELLOW, 1.04, 0.12, 1.24, 1.5, 0.35, -0.3),
    pCyl(DARK, 0.18, 2.4, -0.45, -0.2, 1.3, Math.PI / 2, 0, 0),
    pCyl(DARK, 0.18, 2.4,  0.45, -0.2, 1.3, Math.PI / 2, 0, 0),
    pCyl(STEEL, 0.26, 0.5, -0.45, -0.2, 2.3, Math.PI / 2, 0, 0),   // muzzle brakes
    pCyl(STEEL, 0.26, 0.5,  0.45, -0.2, 2.3, Math.PI / 2, 0, 0),
    pBox(DARK, 1.4, 0.5, 0.6, 0, -0.3, 1.1),              // barrel shroud
    pCyl(DARK, 0.08, 1.2, -0.8, 1.2, -0.6),               // sensor mast
    pBox(DARK, 0.5, 0.3, 0.5, -0.8, 1.85, -0.6),          // sensor head
  ], VC_MAT_METAL);
  shell.castShadow = true;
  head.add(shell);
  /* sensor eye and the ammo counter: lit, but not state -- static glow */
  head.add(mergeParts([
    pBox(MK_CYAN, 0.3, 0.12, 0.06, -0.8, 1.85, -0.34),
    pBox(MK_CYAN, 0.06, 0.4, 0.06, 1.5, 0.1, 0.32),
  ], VC_GLOW));
  /* THE HOUSING GLOW, and it needed a name.
     entity.js has always hidden `anim.glow` when a turret loses power or is
     smothered by Overgrowth, and swelled it with the wind-up (RULES.turretSpinUp)
     — and two config comments sell that swell as the readable tell the whole
     spin-up mechanic depends on. The lamp existed; it was just never handed to
     the anim record, so every one of those reads was `undefined` and NONE of
     the tells have ever rendered. Measured: `!!e.anim.glow` was false on all
     six turrets of verdant-hollow. */
  const glow = sph(GLOW(MK_AMBER), 0.34, 0, 0.2, 1.05);
  head.add(glow);
  head.add(box(GLOW(MK_AMBER), 1.9, 0.09, 0.09, 0, 0.66, 0.75));
  g.add(head);

  /* muzzle at the brake tips: barrel z 2.3 + half a brake */
  g.userData.anim = { kind: 'turret', head, glow, muzzle: new THREE.Vector3(0, 3.2, 2.55) };
  return g;
};

export const buildDepot = () => {
  const g = new THREE.Group();
  const WALL = 0x39414b, TRIM = 0x1d2229, DOOR = 0x0f1216;

  const parts = [
    pBox(WALL, 11, 6, 9, 0, 3, 0),
    pBox(TRIM, 11.6, 0.7, 9.6, 0, 6.2, 0),
    pBox(TRIM, 11.4, 0.5, 9.4, 0, 0.25, 0),               // plinth
    /* bay door: panel seams and a safety-yellow frame */
    pBox(DOOR, 3.2, 3.6, 0.3, 0, 1.8, 4.6),
    pBox(MK_YELLOW, 3.7, 0.25, 0.4, 0, 3.75, 4.6),
    pBox(MK_YELLOW, 0.25, 3.8, 0.4, -1.72, 1.9, 4.6),
    pBox(MK_YELLOW, 0.25, 3.8, 0.4, 1.72, 1.9, 4.6),
    pBox(MK_STEEL, 3.0, 0.06, 0.34, 0, 1.0, 4.6),
    pBox(MK_STEEL, 3.0, 0.06, 0.34, 0, 1.8, 4.6),
    pBox(MK_STEEL, 3.0, 0.06, 0.34, 0, 2.6, 4.6),
    pBox(MK_STEEL, 5.0, 0.25, 1.6, 0, 4.25, 5.2),          // door canopy
    /* antenna mast with a dish looking out over the valley */
    pCyl(TRIM, 0.16, 5, 4.2, 9, -3.4),
    pBox(TRIM, 0.6, 0.3, 0.6, 4.2, 6.7, -3.4),
    pCone(MK_STEEL, 0.9, 0.5, 4.2, 10.4, -3.0, -Math.PI / 2, 0, 0),
    pCyl(TRIM, 0.05, 0.7, 4.2, 10.4, -3.0, Math.PI / 2, 0, 0),
    /* two bollards flanking the bay */
    pCyl(MK_YELLOW, 0.18, 1.0, -2.8, 0.5, 6.0),
    pCyl(MK_YELLOW, 0.18, 1.0, 2.8, 0.5, 6.0),
  ];
  /* roof plant: three air handlers with grilles, and the cable run between */
  for (let i = -1; i <= 1; i++) {
    parts.push(pBox(MK_STEEL, 1.8, 1.0, 1.8, i * 3.2, 7.05, -2));
    parts.push(pCyl(TRIM, 0.7, 0.14, i * 3.2, 7.6, -2));
    parts.push(pBox(MK_YELLOW, 1.84, 0.1, 1.84, i * 3.2, 6.62, -2));
  }
  parts.push(pBox(TRIM, 7.4, 0.14, 0.4, 0, 6.62, -0.6));
  /* crate stack beside the bay: the depot is where the machines keep their
     stuff, and it should look like it */
  parts.push(pBox(MK_STEEL, 1.4, 1.4, 1.4, 4.2, 0.7, 5.5));
  parts.push(pBox(MK_STEEL, 1.4, 1.4, 1.4, 5.7, 0.7, 5.6, 0, 0.2, 0));
  parts.push(pBox(MK_STEEL, 1.4, 1.4, 1.4, 4.9, 2.1, 5.5, 0, -0.3, 0));
  parts.push(pBox(MK_YELLOW, 1.44, 0.16, 1.44, 4.2, 0.7, 5.5));
  parts.push(pBox(MK_YELLOW, 1.44, 0.16, 1.44, 4.9, 2.1, 5.5, 0, -0.3, 0));
  /* wall louvres on the long faces */
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const z = -2.4 + i * 2.4;
    parts.push(pBox(TRIM, 0.2, 1.6, 1.4, s * 5.55, 3.4, z));
    parts.push(pBox(MK_STEEL, 0.26, 0.1, 1.2, s * 5.55, 3.0, z));
    parts.push(pBox(MK_STEEL, 0.26, 0.1, 1.2, s * 5.55, 3.5, z));
  }
  const body = mergeParts(parts, VC_MAT_METAL);
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const glow = mergeParts([
    pBox(MK_CYAN, 10.2, 0.16, 0.1, 0, 4.6, 4.55),
    pBox(MK_AMBER, 3.0, 0.12, 0.12, 0, 3.7, 4.78),
    pBox(MK_CYAN, 0.1, 0.3, 1.6, -5.56, 5.0, 0),          // side window slits
    pBox(MK_CYAN, 0.1, 0.3, 1.6, 5.56, 5.0, 0),
  ], VC_GLOW);
  g.add(glow);
  const beacon = sph(GLOW(0xff6a3d), 0.28, 4.2, 11.5, -3.4); g.add(beacon);
  g.userData.anim = { kind: 'depot', beacon };
  return g;
};

export const buildPump = () => {
  const g = new THREE.Group();
  const shell = 0x46505c, dark = 0x232a33, PIPE = 0x5b6470;
  const body = mergeParts([
    pCyl(dark, 3.4, 1.0, 0, 0.5, 0),
    pBox(shell, 4.6, 2.6, 3.4, 0, 2.2, 0),
    pCyl(PIPE, 0.62, 7, -3.2, 1.6, 0, 0, 0, Math.PI / 2),          // intake running out
    pCyl(dark, 0.8, 0.3, -5.0, 1.6, 0, 0, 0, Math.PI / 2),          // flange
    pCyl(PIPE, 0.45, 3.6, 0, 4.4, 0),
    pBox(dark, 5.0, 0.5, 3.8, 0, 3.6, 0),
    pBox(dark, 0.9, 1.2, 0.5, 1.6, 1.8, 1.8),                       // control box
    pBox(MK_YELLOW, 4.64, 0.14, 3.44, 0, 0.98, 0),                  // skirt stripe
  ], VC_MAT_METAL);
  body.castShadow = true;
  g.add(body);
  g.add(box(GLOW(MK_CYAN), 3.6, 0.12, 0.1, 0, 2.9, 1.75));
  const wheel = new THREE.Group();
  wheel.position.set(0, 4.4, 0);
  for (let i = 0; i < 4; i++) {
    const b = box(M(0x8a949e, { metal: 0.6 }), 2.1, 0.14, 0.42, 0, 0, 0);
    b.rotation.y = i * Math.PI / 4;
    wheel.add(b);
  }
  g.add(wheel);
  g.userData.anim = { kind: 'pump', wheel };
  return g;
};

export const buildCoolant = () => {
  const g = new THREE.Group();
  const SHELL = 0x4a525c, DARK = 0x22272e, PIPE = 0x5b6470;

  const parts = [pCyl(DARK, 5.2, 1.0, 0, 0.5, 0)];
  for (let i = 0; i < 6; i++) parts.push(pCyl(SHELL, 4.0 - i * 0.16, 1.9, 0, 1.6 + i * 1.9, 0));
  for (let i = 0; i < 3; i++) parts.push(pCyl(DARK, 4.15 - i * 0.32, 0.3, 0, 3.4 + i * 3.8, 0));
  /* hazard tiles around the plinth */
  for (let i = 0; i < 16; i++)
    parts.push(pRadial(i % 2 ? MK_YELLOW : DARK, 1.0, 0.5, 0.2, 5.15, i * Math.PI / 8, 0.75));
  /* ladder up the +x face, leaning with the taper: the shell loses 0.8 of
     radius over eleven metres, and a plumb ladder would float off the top */
  const lean = Math.atan((4.0 - 3.2) / 11);
  for (const dz of [-0.35, 0.35]) parts.push(pCyl(DARK, 0.06, 10.8, 3.95, 6.6, dz, 0, 0, lean));
  for (let i = 0; i < 17; i++) {
    const y = 1.6 + i * 0.62;
    parts.push(pBox(DARK, 0.1, 0.08, 0.7, 3.95 + (6.6 - y) * Math.tan(lean), y, 0));
  }
  /* coolant mains: two big pipes leaving the plinth, elbowing up into the shell */
  parts.push(pCyl(PIPE, 0.55, 7, -6.0, 1.3, 1.6, 0, 0, Math.PI / 2));
  parts.push(pSphLo(PIPE, 0.62, -2.6, 1.3, 1.6));
  parts.push(pCyl(PIPE, 0.55, 2.4, -2.6, 2.4, 1.6));
  parts.push(pCyl(DARK, 0.72, 0.3, -4.5, 1.3, 1.6, 0, 0, Math.PI / 2));
  parts.push(pCyl(DARK, 0.72, 0.3, -8.5, 1.3, 1.6, 0, 0, Math.PI / 2));
  parts.push(pBox(DARK, 0.5, 0.8, 0.5, -8.0, 0.4, 1.6));
  parts.push(pCyl(PIPE, 0.55, 7, 1.2, 1.3, 6.0, Math.PI / 2, 0, 0));
  parts.push(pSphLo(PIPE, 0.62, 1.2, 1.3, 2.6));
  parts.push(pCyl(PIPE, 0.55, 2.4, 1.2, 2.4, 2.6));
  parts.push(pCyl(DARK, 0.72, 0.3, 1.2, 1.3, 4.5, Math.PI / 2, 0, 0));
  parts.push(pCyl(DARK, 0.72, 0.3, 1.2, 1.3, 8.5, Math.PI / 2, 0, 0));
  parts.push(pBox(DARK, 0.5, 0.8, 0.5, 1.2, 0.4, 8.0));
  /* catwalk under the crown, with a railing */
  parts.push(pCyl(DARK, 3.9, 0.16, 0, 11.3, 0));
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5, am = a + Math.PI / 10;
    parts.push(pCyl(DARK, 0.05, 1.0, Math.cos(a) * 3.75, 11.85, Math.sin(a) * 3.75));
    parts.push(pRadial(DARK, 2.35, 0.06, 0.06, 3.75, am, 12.3));
  }
  /* the fan well: a floor the fan sits in and an open rim, so the blades are
     visible from the RTS camera instead of hidden under a lid */
  parts.push(pCyl(DARK, 3.3, 0.3, 0, 12.85, 0));
  for (let i = 0; i < 12; i++)
    parts.push(pRadial(SHELL, 1.9, 0.6, 0.3, 3.45, i * Math.PI / 6, 13.45));
  const body = mergeParts(parts, VC_MAT_METAL);
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  /* The band is the tower's ON light: it is how a player reads offline-vs-online
     from across the valley, which is the single most important piece of state in
     the endgame. Kept as its own reference so entity.js can douse it. */
  const band = cyl(GLOW(MK_CYAN), 3.1, 0.35, 0, 12.5, 0);
  /* Its OWN material. GLOW() hands back a cached instance shared by every cyan
     glow in the scene, so dousing this one in place would darken the Core's
     shield trim and the other two towers along with it. */
  band.material = band.material.clone();
  g.add(band);

  /* five blades and a hub as one buffer inside the group that entity.js spins */
  const fan = new THREE.Group(); fan.position.y = 13.4;
  const blades = [pCyl(0x8a949e, 0.4, 0.5, 0, 0, 0)];
  for (let i = 0; i < 5; i++) {
    const a = i * (Math.PI * 2 / 5);
    blades.push(pBox(0x8a949e, 3.0, 0.12, 0.9, Math.cos(a) * 1.5, 0, -Math.sin(a) * 1.5, 0, a, 0.3));
  }
  fan.add(mergeParts(blades, VC_MAT_METAL));
  g.add(fan);
  g.userData.anim = { kind: 'coolant', fan, band };
  return g;
};

export const buildCore = () => {
  const g = new THREE.Group();
  const SHELL = 0x2e343d, DARK = 0x14181e;

  const parts = [
    pBox(DARK, 22, 1.2, 18, 0, 0.6, 0),
    pBox(SHELL, 20, 9, 16, 0, 5.5, 0),
    pBox(DARK, 21, 0.9, 17, 0, 10.4, 0),
    /* the ridge spine and edge cable trays split one slab into two halls */
    pBox(MK_STEEL, 20.4, 0.6, 1.2, 0, 11.1, 0),
    pBox(MK_STEEL, 19, 0.25, 0.7, 0, 11.0, 7.6),
    pBox(MK_STEEL, 19, 0.25, 0.7, 0, 11.0, -7.6),
    /* entrance: the dark door, a yellow frame and a canopy over it */
    pBox(0x0c0f13, 6, 5, 0.4, 0, 3, 8.2),
    pBox(MK_YELLOW, 6.6, 0.3, 0.5, 0, 5.6, 8.25),
    pBox(MK_YELLOW, 0.3, 5.2, 0.5, -3.3, 3.1, 8.25),
    pBox(MK_YELLOW, 0.3, 5.2, 0.5, 3.3, 3.1, 8.25),
    pBox(MK_STEEL, 8, 0.3, 2.2, 0, 6.4, 9.0),
    /* corner masts */
    pCyl(DARK, 0.12, 4, 9.5, 12.8, -7.5),
    pCyl(DARK, 0.12, 4, -9.5, 12.8, 7.5),
  ];
  /* roof plant: eight vent boxes with louvred lids and yellow skirts */
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const x = -6 + i * 4, z = s * 3.6;
    parts.push(pBox(MK_STEEL, 2.0, 1.1, 1.6, x, 11.4, z));
    parts.push(pBox(DARK, 1.6, 0.14, 1.2, x, 12.02, z));
    parts.push(pBox(MK_YELLOW, 2.04, 0.12, 1.64, x, 10.95, z));
  }
  /* exhaust stacks with a hazard band and a rain cap */
  for (let i = 0; i < 4; i++) {
    const x = -7.5 + i * 5;
    parts.push(pCyl(DARK, 0.6, 3.2, x, 12.2, 0));
    parts.push(pCyl(MK_YELLOW, 0.64, 0.4, x, 12.6, 0));
    parts.push(pCyl(DARK, 0.85, 0.3, x, 13.85, 0));
  }
  /* cooling louvres on the long faces, between the rack strips */
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const z = -4.5 + i * 3;
    parts.push(pBox(DARK, 0.3, 3.0, 2.0, s * 10.1, 5.5, z));
    for (let k = 0; k < 3; k++) parts.push(pBox(MK_STEEL, 0.36, 0.14, 1.8, s * 10.1, 4.7 + k * 0.8, z));
  }
  /* bollards along the apron */
  for (let i = 0; i < 6; i++) parts.push(pCyl(MK_YELLOW, 0.22, 1.0, -5 + i * 2, 0.5, 10.6));
  const body = mergeParts(parts, VC_MAT_METAL);
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  /* static glow: roof-edge strips, threshold, clerestory windows, mast tips */
  const glowParts = [
    pBox(MK_CYAN, 20, 0.1, 0.1, 0, 10.9, 8.45),
    pBox(MK_CYAN, 20, 0.1, 0.1, 0, 10.9, -8.45),
    pBox(MK_CYAN, 6, 0.1, 0.3, 0, 1.25, 8.3),
    pSphLo(MK_AMBER, 0.3, 9.5, 14.9, -7.5),
    pSphLo(MK_AMBER, 0.3, -9.5, 14.9, 7.5),
  ];
  for (let i = 0; i < 7; i++) glowParts.push(pBox(MK_CYAN, 1.2, 0.3, 0.1, -7.8 + i * 2.6, 8.4, 8.06));
  g.add(mergeParts(glowParts, VC_GLOW));

  // server racks with running lights -- individually toggled by the meltdown strobe
  const strips = [];
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) {
      const st = box(GLOW(MK_CYAN), 0.25, 6.2, 0.12, s * 10.05, 5.4, -6 + i * 3);
      g.add(st); strips.push(st);
    }
    const t = box(GLOW(MK_CYAN), 16, 0.14, 0.14, 0, 2.2 + i * 1.7, 8.05);
    g.add(t); strips.push(t);
  }
  g.userData.anim = { kind: 'core', strips };
  return g;
};

export const buildWall = (len = 10) => {
  const g = new THREE.Group();
  const C = 0x525966, D = 0x2e343d, P = 0x5f6876;
  const parts = [
    pBox(C, len, 4.4, 1.1, 0, 2.2, 0),
    pBox(D, len, 0.5, 1.5, 0, 0.25, 0),                  // plinth
    pBox(D, len, 0.4, 1.5, 0, 4.5, 0),                   // cap rail
    pBox(D, 0.8, 5.2, 1.6, -0.5 * len, 2.6, 0),          // posts
    pBox(D, 0.8, 5.2, 1.6,  0.5 * len, 2.6, 0),
    pBox(MK_YELLOW, 0.9, 0.16, 1.7, -0.5 * len, 5.28, 0), // post caps
    pBox(MK_YELLOW, 0.9, 0.16, 1.7,  0.5 * len, 5.28, 0),
  ];
  /* raised armour plates on both faces: a flat slab read as a fence rail from
     the air; plates give the wall a rhythm the eye can count */
  const nP = Math.max(1, Math.round(len / 2.5));
  for (let i = 0; i < nP; i++) {
    const x = -len / 2 + (i + 0.5) * (len / nP);
    for (const s of [-1, 1]) parts.push(pBox(P, len / nP - 0.5, 2.6, 0.14, x, 2.1, s * 0.62));
  }
  const body = mergeParts(parts, VC_MAT_METAL);
  body.castShadow = true;
  g.add(body);
  g.add(mergeParts([
    pBox(0x1f5f68, len * 0.9, 0.08, 0.06, 0, 3.6, 0.62),
    pBox(0x1f5f68, len * 0.9, 0.08, 0.06, 0, 3.6, -0.62),
    pBox(MK_CYAN, 0.3, 0.1, 0.3, -0.5 * len, 5.4, 0),      // post lamps
    pBox(MK_CYAN, 0.3, 0.1, 0.3,  0.5 * len, 5.4, 0),
  ], VC_GLOW));
  return g;
};

/* Gate gantry: two hazard-banded pylons and a lit beam across the gap in the
   perimeter. Purely dressing -- the gap stays open and pathable, and the beam
   sits above raven height. `span` is the clear width between pylon centres. */
export const buildGateGantry = (span = 18) => {
  const g = new THREE.Group();
  const D = 0x2e343d, S = 0x525966;
  const hx = span / 2;
  const parts = [
    pBox(S, span + 2.4, 0.9, 1.2, 0, 11.2, 0),             // cross beam
    pBox(D, span + 1.8, 0.3, 1.5, 0, 10.6, 0),
  ];
  for (const s of [-1, 1]) {
    parts.push(pBox(D, 1.4, 11, 1.4, s * hx, 5.5, 0));
    parts.push(pBox(S, 1.8, 0.6, 1.8, s * hx, 0.3, 0));
    for (let i = 0; i < 4; i++) parts.push(pBox(i % 2 ? MK_YELLOW : D, 1.5, 0.5, 1.5, s * hx, 1.2 + i * 0.5, 0));
    parts.push(pBox(S, 0.5, 0.5, 2.2, s * hx, 10.2, 0));  // lamp hoods
  }
  const body = mergeParts(parts, VC_MAT_METAL);
  body.castShadow = true;
  g.add(body);
  g.add(mergeParts([
    pBox(MK_CYAN, span, 0.12, 0.12, 0, 10.42, 0.7),
    pBox(MK_CYAN, span, 0.12, 0.12, 0, 10.42, -0.7),
    pBox(MK_AMBER, 0.5, 0.25, 0.5, -hx, 11.85, 0),
    pBox(MK_AMBER, 0.5, 0.25, 0.5, hx, 11.85, 0),
  ], VC_GLOW));
  return g;
};

/* ======================== NATURE STRUCTURES ============================= */

export const buildHeartTree = () => {
  const g = new THREE.Group();
  const BARK = 0x513f2b, BARK_D = 0x3a2c1d, MOSS = 0x4f7a38, VINE = 0x3f6a2e;
  const LEAF_A = 0x67ad4a, LEAF_B = 0x4f9440, LEAF_C = 0x8bc95c;
  const SPIRIT = 0x9bff6a, MOTE = 0xd9ff9b, LANTERN = 0xffd27a;

  /* mossy ring of standing stones, plus their wisps — two buffers, not twenty */
  const stones = [], wisps = [];
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI * 2 / 10 + rand(-0.15, 0.15);
    const h = rand(1.6, 3.2);
    const x = Math.cos(a) * 10.5, z = Math.sin(a) * 10.5;
    stones.push(part(boxGeo, 0x6f7468, rand(0.8, 1.4), h, rand(0.7, 1.2),
      x, h / 2, z, 0, a + rand(-0.3, 0.3), rand(-0.12, 0.12)));
    stones.push(pSphLo(MOSS, rand(0.5, 0.8), x, h, z, 0.25));       // moss cap
    wisps.push(pSph(SPIRIT, 0.16, x, h + 0.3, z));
  }
  const stoneRing = mergeParts(stones, VC_MAT);
  stoneRing.castShadow = true;
  g.add(stoneRing);
  g.add(mergeParts(wisps, VC_GLOW));

  /* buttress roots, trunk, hollow and limbs are one rigid mass */
  const trunkParts = [];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI * 2 / 8;
    /* the inner flare, then a longer, lower root reaching out to a knuckle:
       the old single ring stopped at the trunk's shadow, and a tree this
       size needs to visibly grip the ground */
    trunkParts.push(pTaper(BARK_D, 0.7, 1.3, 7, Math.cos(a) * 3.6, 1.4, Math.sin(a) * 3.6,
      -Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5, 7));
    const b = a + Math.PI / 8;
    trunkParts.push(pTaper(BARK_D, 0.3, 0.7, 5.5, Math.cos(b) * 5.6, 0.7, Math.sin(b) * 5.6,
      -Math.sin(b) * 1.05, 0, Math.cos(b) * 1.05, 6));
    trunkParts.push(pSphLo(BARK_D, 0.75, Math.cos(b) * 7.6, 0.35, Math.sin(b) * 7.6, 0.5));
  }
  trunkParts.push(pTaper(BARK, 2.7, 3.5, 12, 0, 6, 0, 0, 0, 0, 10));
  trunkParts.push(pTaper(BARK, 1.9, 2.7, 14, 0, 17, 0, 0, 0, 0, 10));
  trunkParts.push(pBox(0x2a2a1c, 1.5, 3.6, 0.5, 0, 7.0, 2.6));       // the hollow
  trunkParts.push(pBox(BARK_D, 2.3, 0.5, 0.7, 0, 9.05, 2.75));       // and its bark lips
  trunkParts.push(pBox(BARK_D, 2.3, 0.5, 0.7, 0, 4.95, 2.75));
  trunkParts.push(pSphLo(MOSS, 1.5, -0.4, 12.5, -2.9, 0.5));         // moss shelves, north side
  trunkParts.push(pSphLo(MOSS, 1.1, 1.6, 15.5, -2.4, 0.4));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.32;
    trunkParts.push(pTaper(BARK, 0.36, 0.75, 9, Math.cos(a) * 3.4, 19, Math.sin(a) * 3.4,
      Math.sin(a) * 0.85, 0, -Math.cos(a) * 0.85, 7));
    /* a second, lighter limb between each pair so the crown has a skeleton */
    const b = a + 0.66;
    trunkParts.push(pTaper(BARK, 0.2, 0.42, 6, Math.cos(b) * 4.6, 21.5, Math.sin(b) * 4.6,
      Math.sin(b) * 1.1, 0, -Math.cos(b) * 1.1, 6));
  }
  const trunk = mergeParts(trunkParts, VC_MAT);
  trunk.castShadow = true;
  g.add(trunk);

  /* hanging vines from the canopy underside, each ending in a lantern: the
     tree is the player's base and should look lived-in and lit from below */
  const vineParts = [], lanternParts = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7 + rand(-0.2, 0.2), d = rand(5.5, 8.5);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const top = 16 + rand(-1, 1.5), len = rand(4, 7.5);
    vineParts.push(pTaper(VINE, 0.06, 0.11, len, x, top - len / 2, z, 0, 0, 0, 5));
    vineParts.push(pSphLo(LEAF_B, rand(0.4, 0.6), x + 0.2, top - len * 0.55, z, 0.35));
    vineParts.push(pBox(BARK_D, 0.34, 0.16, 0.34, x, top - len + 0.1, z));
    lanternParts.push(pSphLo(LANTERN, 0.32, x, top - len - 0.25, z));
  }
  const vines = mergeParts(vineParts, VC_MAT);
  vines.castShadow = true;
  g.add(vines);
  g.add(mergeParts(lanternParts, VC_GLOW));

  const heart = sph(GLOW(SPIRIT), 1.3, 0, 7.0, 2.9);
  g.add(heart);

  /* three tiers so it reads as a crown, baked into one buffer that still sways;
     the 20-facers between the round masses break the outline into clusters */
  const canopy = mergeParts([
    pSph(LEAF_B, 9.0, 0, 0, 0),
    pSph(LEAF_A, 6.6, -5.6, 4.0, 2.2),
    pSph(LEAF_A, 6.0, 5.4, 3.4, -2.8),
    pSph(LEAF_C, 5.0, 0.8, 8.6, 1.0),
    pSph(LEAF_B, 4.4, 2.0, 5.2, 6.2),
    pSph(LEAF_C, 3.8, -3.6, 6.8, -5.4),
    pSphLo(LEAF_A, 4.2, 7.8, -1.0, 3.6),
    pSphLo(LEAF_B, 3.9, -8.2, 0.4, -2.0),
    pSphLo(LEAF_C, 3.4, 4.8, 9.2, -4.0),
    pSphLo(LEAF_A, 3.6, -2.4, 10.8, 3.8),
    pSphLo(LEAF_B, 3.5, 0.4, -2.6, 8.8),
    pSphLo(LEAF_A, 3.2, 1.5, -1.8, -9.0),
  ], VC_MAT);
  canopy.position.y = 23;
  canopy.castShadow = true;
  g.add(canopy);
  /* spirit-light points on the canopy skin, a child so they sway with it */
  const sparkParts = [];
  for (let i = 0; i < 14; i++) {
    const a = rand(0, 6.28), e = rand(-0.3, 0.9), r = 9.6;
    sparkParts.push(pSphLo(SPIRIT, rand(0.2, 0.34),
      Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r + 1.5, Math.sin(a) * Math.cos(e) * r));
  }
  canopy.add(mergeParts(sparkParts, VC_GLOW));

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
  const STONE = 0x6b6f6a, STONE_D = 0x565a55, MOSS = 0x4f8a3a, STEM = 0x4f8f3a;

  /* boulders with moss caps, four carved menhirs at the quarters, moss on the
     ground and a few matte blossoms. All one buffer: the grove's silhouette
     from across the valley is the menhirs, everything else is texture. */
  const stones = [];
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9 + rand(-0.2, 0.2);
    const sz = rand(0.5, 0.95);
    const x = Math.cos(a) * 3.4, z = Math.sin(a) * 3.4;
    stones.push(part(sphGeo, STONE, sz, sz, sz, x, sz * 0.4, z, rand(0, 3), rand(0, 3), rand(0, 3)));
    stones.push(pSphLo(MOSS, sz * 0.7, x, sz * 0.8, z, sz * 0.3));
  }
  const runes = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4, h = 2.4 + (i % 2) * 0.6;
    const x = Math.cos(a) * 4.6, z = Math.sin(a) * 4.6;
    stones.push(pRadial(STONE_D, 0.9, h, 0.55, 4.6, a, h / 2, rand(-0.08, 0.08)));
    stones.push(pRadial(STONE, 1.0, 0.3, 0.65, 4.6, a, h + 0.1));
    stones.push(pSphLo(MOSS, 0.7, x, 0.1, z, 0.2));
    /* three carved marks on the inward face, lit the grove's green */
    for (let k = 0; k < 3; k++)
      runes.push(pRadial(0x8bffa0, 0.22, 0.2, 0.06, 4.29, a, h * 0.3 + k * 0.5));
  }
  for (let i = 0; i < 6; i++) {
    const a = rand(0, 6.28), d = rand(3.6, 4.8);
    stones.push(pSphLo(MOSS, rand(0.6, 1.1), Math.cos(a) * d, 0.08, Math.sin(a) * d, 0.16));
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3, d = rand(3.2, 4.2), h = rand(0.8, 1.3);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    stones.push(pTaper(STEM, 0.04, 0.06, h, x, h / 2, z, 0, 0, 0, 5));
    stones.push(pSphLo(i % 2 ? 0xe58ad0 : 0xf2d27a, 0.2, x, h + 0.1, z));
  }
  const ring = mergeParts(stones, VC_MAT);
  ring.castShadow = true;
  g.add(ring);
  g.add(mergeParts(runes, VC_GLOW));

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
  /* Falloff only — GREYSCALE, deliberately. The green used to be baked in here,
     which meant material.color could never do anything useful: multiplying a red
     tint through green vertices gives near-black, not red. With luminance in the
     vertex colours and the hue in material.color, the beam can be recoloured at
     runtime in one assignment, which is what lets a contested grove go amber and
     a lost one go red. See groveTint() in world.js. */
  for (let i = 0; i < sp.count; i++) {
    const v = (sp.getY(i) + SHAFT_H / 2) / SHAFT_H;         // 0 base .. 1 tip
    const u = Math.abs(sp.getX(i)) / (SHAFT_W / 2);         // 0 centre .. 1 edge
    const vertical = Math.pow(1 - v, 2.0);                  // fades out toward the sky
    const across = Math.pow(1 - u, 1.6);                    // soft sides, no hard edge
    const k = vertical * across * 0.85 + 0.015;
    scol[i * 3] = k; scol[i * 3 + 1] = k; scol[i * 3 + 2] = k;
  }
  shaftGeo.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  const pillar = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({
    color: 0x8bffa0,          // the hue lives here now; vertex colours are luminance
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

/* =========================================================================
   Tree species.

   Every species is a (trunk, canopy) geometry pair with the same contract the
   pine has always had: instance i of the trunk mesh and instance i of the
   canopy mesh are the same tree, one shared `aFade` drives both, and the pair
   is what updateCanopyFade walks. The species differ only in silhouette and in
   the colour recipe -- vertex tones inside a geometry say "this tier is a
   shade lighter", instanceColor carries the real hue per tree, and the
   material colour is the species' base. A map's `treeHue` still steers all of
   them, so an autumn map turns its broadleaves orange without knowing they
   exist.

     pine       the stepped cone everyone recognises; the default
     fir        tall, narrow, four tiers -- alpine and winter maps
     broadleaf  a lobed cluster of big facets on a forked trunk
     snag       a dead, splintered pole with bare limbs; lives near the blight

   The geometries are built once and CLONED per forest, because aFade is set
   on the geometry: two forests sharing one buffer would fight over it. */
const _treeGeo = new Map();
function treeGeometry(kind) {
  let rec = _treeGeo.get(kind);
  if (rec) return { trunk: rec.trunk.clone(), leaf: rec.leaf.clone() };
  let trunk, leaf;
  switch (kind) {
    case 'fir':
      trunk = mergeGeo([
        pTaper(shade(1.0), 0.2, 0.42, 6.0, 0, 3.0, 0),
        pTaper(shade(0.9), 0.42, 0.62, 0.5, 0, 0.25, 0),
      ]);
      leaf = mergeGeo([
        pCone(shade(0.86), 1.6, 3.6, 0, 5.2, 0),
        pCone(shade(0.95), 1.3, 3.4, 0, 7.4, 0),
        pCone(shade(1.04), 1.0, 3.2, 0, 9.5, 0),
        pCone(shade(1.14), 0.6, 2.8, 0, 11.4, 0),
      ]);
      break;
    case 'broadleaf':
      trunk = mergeGeo([
        pTaper(shade(1.0), 0.4, 0.62, 3.9, 0, 1.95, 0),
        pTaper(shade(0.9), 0.62, 0.9, 0.5, 0, 0.25, 0),
        /* the fork: two limbs leaving the crown, which is what separates a
           tree from a lollipop when the canopy is a ball */
        pTaper(shade(0.95), 0.14, 0.24, 2.2, 0.62, 4.3, 0.15, 0.1, 0, -0.62),
        pTaper(shade(0.95), 0.12, 0.22, 2.0, -0.55, 4.2, -0.3, -0.35, 0, 0.7),
      ]);
      leaf = mergeGeo([
        pSphLo(shade(0.94), 2.5, 0, 5.7, 0),
        pSphLo(shade(0.86), 1.9, 1.9, 5.0, 0.6),
        pSphLo(shade(0.88), 1.9, -1.7, 5.2, -0.8),
        pSphLo(shade(0.9), 1.7, 0.4, 5.4, 1.9),
        pSphLo(shade(0.84), 1.6, -0.3, 4.9, -1.9),
        pSphLo(shade(1.14), 1.9, 0.2, 7.4, 0.1),      // sunlit crown
      ]);
      break;
    case 'snag':
      trunk = mergeGeo([
        pTaper(shade(1.0), 0.2, 0.5, 6.2, 0, 3.1, 0, 0, 0, 0.04),
        pTaper(shade(0.88), 0.5, 0.78, 0.6, 0, 0.3, 0),
        pCone(shade(1.08), 0.24, 1.4, 0.05, 6.7, 0, 0.05, 0, 0.12),   // the splinter
      ]);
      /* bare limbs stand in for the canopy so the pair contract holds and the
         fade still lifts them out of the way */
      leaf = mergeGeo([
        pTaper(shade(1.0), 0.07, 0.14, 2.6, 0.7, 4.7, 0.1, 0, 0, -1.05),
        pTaper(shade(1.0), 0.06, 0.13, 2.2, -0.55, 5.3, 0.3, -0.35, 0, 1.15),
        pTaper(shade(1.0), 0.06, 0.12, 1.8, 0.1, 3.7, -0.6, 1.1, 0, 0.2),
        pTaper(shade(1.0), 0.05, 0.1, 1.2, 1.55, 5.5, 0.2, 0, 0, -0.5),
      ]);
      break;
    default:   // pine
      trunk = mergeGeo([
        pTaper(shade(1.0), 0.34, 0.5, 4.4, 0, 2.2, 0),
        pTaper(shade(0.9), 0.5, 0.72, 0.5, 0, 0.25, 0),
      ]);
      /* three tiers overlapping by a third: the stepped edge is the read */
      leaf = mergeGeo([
        pCone(shade(0.88), 2.3, 4.4, 0, 5.2, 0),
        pCone(shade(1.0), 1.7, 3.8, 0, 7.6, 0),
        pCone(shade(1.12), 1.0, 2.6, 0, 9.6, 0),
      ]);
  }
  rec = { trunk, leaf };
  _treeGeo.set(kind, rec);
  return { trunk: trunk.clone(), leaf: leaf.clone() };
}

/* Colour recipe and proportions per species. `leaf` and `bark` are the
   material bases; `hsl(hue)` fills instanceColor from the map's tree hue.
   canopyY / trunkY are where updateCanopyFade samples for occlusion. */
const TREE_SPECIES = {
  pine: {
    leaf: 0x2f5f2c, bark: 0x40331f, scale: [0.62, 1.15], canopyY: 6.7, trunkY: 2.2,
    hsl: h => [h + rand(-0.05, 0.05), rand(0.3, 0.5), rand(0.16, 0.30)],
    barkK: () => rand(0.82, 1.12),
  },
  fir: {
    leaf: 0x27522f, bark: 0x3a2c22, scale: [0.7, 1.2], canopyY: 7.8, trunkY: 3.0,
    hsl: h => [h + rand(-0.02, 0.06), rand(0.3, 0.45), rand(0.14, 0.24)],
    barkK: () => rand(0.78, 1.05),
  },
  broadleaf: {
    leaf: 0x3f6f34, bark: 0x5a4632, scale: [0.72, 1.12], canopyY: 5.8, trunkY: 2.0,
    hsl: h => [h + rand(-0.06, 0.04), rand(0.38, 0.58), rand(0.2, 0.34)],
    barkK: () => rand(0.9, 1.2),
  },
  snag: {
    leaf: 0x6a6258, bark: 0x6a6258, scale: [0.8, 1.3], canopyY: 4.8, trunkY: 3.1,
    hsl: () => [0.09, 0.08, rand(0.28, 0.4)],
    barkK: () => rand(0.9, 1.25),
  },
};

function mapTreeHue() {
  return (typeof window !== 'undefined' && window.G && window.G.map && window.G.map.palette
          && window.G.map.palette.treeHue) || 0.26;
}

/* One species, one (trunk, canopy) instanced pair. */
function makeForestPair(kind, count, placeFn) {
  const sp = TREE_SPECIES[kind] || TREE_SPECIES.pine;
  const { trunk: trunkG, leaf: leafG } = treeGeometry(kind);
  /* Fresh materials, not M(): vertexColors is the tone channel, and the
     caller clones and fog-masks these anyway. */
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({
    color: sp.bark, vertexColors: true, flatShading: true, roughness: 0.95 }), count);
  const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({
    color: sp.leaf, vertexColors: true, flatShading: true, roughness: 0.9 }), count);
  trunks.castShadow = leaves.castShadow = true;
  trunks.receiveShadow = leaves.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const hue = mapTreeHue();
  let n = 0;
  for (let i = 0; i < count * 5 && n < count; i++) {
    const p = placeFn();
    if (!p) continue;
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.y = rand(0, 6.28);
    const s = rand(sp.scale[0], sp.scale[1]);
    dummy.scale.set(s, s * rand(0.85, 1.3), s);
    dummy.updateMatrix();
    trunks.setMatrixAt(n, dummy.matrix);
    leaves.setMatrixAt(n, dummy.matrix);
    const [h, sat, l] = sp.hsl(hue);
    leaves.setColorAt(n, col.setHSL(h, sat, l));
    /* bark instanceColor multiplies a material that already IS bark-coloured,
       so it sits near white: a shade lighter or darker per tree, not a hue */
    const bk = sp.barkK();
    trunks.setColorAt(n, col.setRGB(bk * 1.03, bk, bk * 0.94));
    n++;
  }
  trunks.count = leaves.count = n;
  trunks.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
  leaves.instanceColor.needsUpdate = trunks.instanceColor.needsUpdate = true;

  /* Canopies have to be able to get out of the way. Measured on a real map,
     26% of forest positions put a 6.2-unit cone between the fixed isometric
     camera and a unit standing there — one position in four hides whatever is
     on it, which is how you end up being shot by something you cannot see or
     click. Each instance carries its own fade, driven from the CPU. */
  /* THE TRUNK WAS NEVER FADED, and it is the half that stands at eye level.
     MEASURED on a real match: 22.7% of machines shooting at the player's
     animals were occluded from the camera, and 99 of those occlusions were
     TRUNKS — geometry with no fade path at all, sitting in exactly the 0-4.4
     band where units and shooters are. The canopy above it had been fading
     politely out of the way for a year while the pole in front of the guard
     stayed solid.

     Trunk i and leaf i are the same tree, so ONE fade attribute drives both.
     The buffer is shared by reference, which also means the two can never
     drift apart and show a floating canopy over a solid trunk. */
  const fade = new Float32Array(n).fill(1);
  const fadeAttr = new THREE.InstancedBufferAttribute(fade, 1);
  leaves.geometry.setAttribute('aFade', fadeAttr);
  trunks.geometry.setAttribute('aFade', fadeAttr);
  leaves.userData.fade = fade;
  trunks.userData.fade = fade;
  leaves.userData.twin = trunks;      // so updateCanopyFade can flag both dirty
  leaves.userData.canopyY = sp.canopyY;
  leaves.userData.trunkY = sp.trunkY;
  leaves.userData.pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    leaves.getMatrixAt(i, dummy.matrix);
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
    leaves.userData.pos[i * 3] = dummy.position.x;
    leaves.userData.pos[i * 3 + 1] = dummy.position.y;
    leaves.userData.pos[i * 3 + 2] = dummy.position.z;
  }
  trunks.userData.pos = leaves.userData.pos;
  return [trunks, leaves];
}

/* A forest is a list of species pairs, flattened: [trunks, leaves, trunks,
   leaves, ...]. With no `mix` it is exactly what it always was -- one pine
   pair -- so a caller that destructures two meshes keeps working. A mix entry
   is { kind, share } for a slice of `count`, or { kind, count, place } for an
   absolute number placed by its own rule (snags hugging the blight). */
export function makeForest(count, placeFn, mix) {
  const list = (mix && mix.length) ? mix : [{ kind: 'pine', share: 1 }];
  const total = list.reduce((s, m) => s + (m.share || 0), 0) || 1;
  const out = [];
  for (const m of list) {
    const n = m.count !== undefined ? m.count : Math.max(1, Math.round(count * (m.share || 0) / total));
    if (n <= 0) continue;
    out.push(...makeForestPair(m.kind, n, m.place || placeFn));
  }
  return out;
}

/* Installed by the caller AFTER it has finished swapping materials around --
   world.js clones every scenic material through applyFogMask(), which would
   silently drop an onBeforeCompile set at construction time. Composes with
   whatever hook is already on the material rather than replacing it. */
export function enableCanopyFade(leaves, trunks) {
  if (trunks) enableCanopyFade(trunks);      // same hook, same shared attribute
  const mat = leaves.material;
  if (!mat || mat.userData.canopyFade) return;
  mat.userData.canopyFade = true;
  mat.transparent = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (sh, renderer) {
    if (prev) prev.call(this, sh, renderer);
    sh.vertexShader = 'attribute float aFade;\nvarying float vFade;\n' +
      sh.vertexShader.replace('void main() {', 'void main() {\n  vFade = aFade;');
    sh.fragmentShader = 'varying float vFade;\n' +
      sh.fragmentShader.replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n  gl_FragColor.a *= vFade;');
  };
  mat.needsUpdate = true;
}

/* Fade any canopy standing between the camera and something the player needs
   to see. Runs off precomputed instance positions (trees never move), so the
   per-frame cost is units x a handful of nearby trees, not 820 x everything. */
const _cf = new THREE.Vector3(), _cu = new THREE.Vector3();
export function updateCanopyFade(leaves, camera, watchers, dt) {
  if (!leaves || !leaves.userData.fade) return;
  const fade = leaves.userData.fade, pos = leaves.userData.pos;
  const n = leaves.count;
  const camX = camera.position.x, camY = camera.position.y, camZ = camera.position.z;

  /* Everything drifts back to opaque; anything occluding is pulled down.
     userData.active, when present, is a precomputed index list of the only
     instances that can ever occlude play (the border band uses it: ~150
     edge-adjacent trees out of 700, the rest pure backdrop never iterated). */
  const act = leaves.userData.active || null;
  const nn = act ? act.length : n;
  const cY = leaves.userData.canopyY || 6.7, tY = leaves.userData.trunkY || 2.2;
  const want = new Float32Array(n).fill(1);
  for (const w of watchers) {
    const wx = w.pos.x, wy = w.pos.y + 1.0, wz = w.pos.z;
    _cu.set(wx - camX, wy - camY, wz - camZ);
    const wDist = _cu.length();
    if (wDist < 0.01) continue;
    _cu.divideScalar(wDist);
    for (let k = 0; k < nn; k++) {
      const i = act ? act[k] : k;
      if (want[i] <= 0.16) continue;                    // already fully faded
      const tx = pos[i * 3], tz = pos[i * 3 + 2];
      const by = pos[i * 3 + 1];
      /* TWO SAMPLES PER TREE: the canopy mass at +6.7 and the trunk at +2.2.
         Testing only the canopy meant a trunk squarely between the camera and
         a shooter never triggered a fade at all — which is most of the 22.7%
         of shooters measured as occluded, because the trunk occupies exactly
         the 0-4.4 band that units and shooters stand in. */
      let best = 1e9;
      for (let h = 0; h < 2; h++) {
        _cf.set(tx - camX, by + (h ? tY : cY) - camY, tz - camZ);
        const along = _cf.dot(_cu);
        if (along <= 0 || along >= wDist) continue;     // behind camera, or behind the unit
        /* perpendicular distance from the camera->unit ray */
        const perp = Math.sqrt(Math.max(0, _cf.lengthSq() - along * along));
        if (perp < best) best = perp;
      }
      /* Inner band goes to 0.15, not 0.3. Three faded canopies at 0.3 still
         composite to two-thirds opaque, which is a wall you can see a shape
         moving behind but cannot identify or click. */
      if (best < 3.2) want[i] = Math.min(want[i], 0.15);
      else if (best < 4.6) want[i] = Math.min(want[i], 0.5);
    }
  }
  /* Ease, so canopies dissolve rather than blink as units walk under them. */
  const k = Math.min(1, dt * 7);
  let dirty = false;
  for (let i = 0; i < n; i++) {
    const d = want[i] - fade[i];
    if (Math.abs(d) > 0.002) { fade[i] += d * k; dirty = true; }
  }
  if (dirty) {
    leaves.geometry.getAttribute('aFade').needsUpdate = true;
    /* Same buffer object, but three.js tracks upload state per geometry. */
    const twin = leaves.userData.twin;
    if (twin) twin.geometry.getAttribute('aFade').needsUpdate = true;
  }
}

/* Instanced scatter. The default is the rock treatment -- tumbled on every
   axis -- because that is what it was written for. `opts`:
     upright   keep it standing: yaw only, plus a small random lean (`tilt`)
     tilt      the lean, radians (0.15)
     colorFn   (i) -> THREE.Color, per-instance tint via instanceColor
     shadow    false to skip the shadow pass (mushrooms cast none you can see)
     sink      metres to bury the pivot, so a log sits IN the grass */
export function makeScatter(geo, material, count, placeFn, scaleRange = [0.6, 1.6], opts = {}) {
  const im = new THREE.InstancedMesh(geo, material, count);
  im.castShadow = opts.shadow !== false; im.receiveShadow = true;
  const d = new THREE.Object3D();
  const tilt = opts.tilt !== undefined ? opts.tilt : 0.15;
  if (opts.colorFn) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  let n = 0;
  for (let i = 0; i < count * 5 && n < count; i++) {
    const p = placeFn();
    if (!p) continue;
    d.position.set(p.x, p.y - (opts.sink || 0), p.z);
    if (opts.upright) d.rotation.set(rand(-tilt, tilt), rand(0, 6.28), rand(-tilt, tilt));
    else d.rotation.set(rand(0, 3), rand(0, 6.28), rand(0, 3));
    const s = rand(scaleRange[0], scaleRange[1]);
    d.scale.set(s, s * (opts.upright ? rand(0.85, 1.2) : rand(0.7, 1.2)), s);
    d.updateMatrix();
    im.setMatrixAt(n, d.matrix);
    if (opts.colorFn) im.setColorAt(n, opts.colorFn(n));
    n++;
  }
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  return im;
}

/* =========================================================================
   Ground dressing geometries.

   Each is one vertex-coloured buffer meant for makeScatter with a
   vertexColors material (clone VC_MAT). Real colours are baked where the
   prop's identity IS its colour (a red cap, a pale cut face); anything that
   should vary with the map's season carries greyscale tones instead and takes
   its hue from instanceColor. Palette per prop stays at three tones.
   ========================================================================= */

/* Three overlapping 20-facers, lighter on top. Tones only: the green is the
   map's, via colorFn. */
export function propBushGeo() {
  return mergeGeo([
    pSphLo(shade(0.86), 0.9, 0, 0.55, 0, 0.7),
    pSphLo(shade(0.94), 0.72, 0.62, 0.62, 0.3, 0.6),
    pSphLo(shade(0.9), 0.66, -0.5, 0.58, -0.35, 0.55),
    pSphLo(shade(1.12), 0.55, 0.05, 1.0, -0.05, 0.42),
  ]);
}

/* A fallen trunk with two pale cut faces, a stub, and moss along its top. */
export function propLogGeo() {
  const BARK = 0x4a3a2a, CUT = 0xb59a6a, MOSS = 0x4f7a38;
  return mergeGeo([
    pTaper(BARK, 0.42, 0.5, 3.4, 0, 0.42, 0, 0, 0, Math.PI / 2, 7),
    pCyl(CUT, 0.36, 0.08, -1.72, 0.42, 0, 0, 0, Math.PI / 2),
    pCyl(CUT, 0.43, 0.08, 1.72, 0.42, 0, 0, 0, Math.PI / 2),
    pTaper(BARK, 0.08, 0.16, 0.9, 0.5, 0.9, 0.2, 0.3, 0, -0.5, 5),
    pSphLo(MOSS, 0.5, -0.4, 0.78, 0.05, 0.16),
    pSphLo(MOSS, 0.38, 0.9, 0.8, -0.1, 0.12),
  ]);
}

/* Cut stump: bark drum, pale rings on top, three root flares. */
export function propStumpGeo() {
  const BARK = 0x4a3a2a, CUT = 0xb59a6a, RING = 0x8f7448;
  const parts = [
    pTaper(BARK, 0.55, 0.7, 0.9, 0, 0.45, 0, 0, 0, 0, 7),
    pCyl(CUT, 0.52, 0.06, 0, 0.92, 0),
    pCyl(RING, 0.3, 0.02, 0, 0.96, 0),
  ];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.09 + 0.4;
    parts.push(pBox(BARK, 0.32, 0.36, 0.9, Math.cos(a) * 0.7, 0.16, Math.sin(a) * 0.7, 0.35, -a, 0));
  }
  return mergeGeo(parts);
}

/* A clutch of three toadstools: cream stems, red caps, one runt. */
export function propMushroomGeo() {
  const STEM = 0xe6dcc3, CAP = 0xc8402c, GILL = 0x8e2b1e;
  const parts = [];
  const spots = [[0, 0, 0, 1], [0.42, 0, 0.18, 0.72], [-0.3, 0, 0.32, 0.55]];
  for (const [x, , z, s] of spots) {
    parts.push(pTaper(STEM, 0.09 * s, 0.13 * s, 0.5 * s, x, 0.25 * s, z, 0, 0, 0, 5));
    parts.push(pCyl(GILL, 0.3 * s, 0.06 * s, x, 0.5 * s, z));
    parts.push(pCone(CAP, 0.32 * s, 0.26 * s, x, 0.63 * s, z));
  }
  return mergeGeo(parts);
}

/* One bloom on a stem. Petals are white so instanceColor picks the flower;
   the stem's green survives the tint because stems are three pixels wide. */
export function propFlowerGeo() {
  const STEM = new THREE.Color(0.28, 0.6, 0.2), PETAL = shade(1.0), EYE = new THREE.Color(1.0, 0.85, 0.3);
  const parts = [
    pTaper(STEM, 0.03, 0.045, 0.8, 0, 0.4, 0, 0, 0, 0, 5),
    pBox(STEM, 0.22, 0.02, 0.1, 0.1, 0.3, 0, 0, 0, -0.3),         // a leaf
    pSphLo(EYE, 0.07, 0, 0.84, 0),
  ];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.2566;
    parts.push(pBox(PETAL, 0.16, 0.03, 0.12, Math.cos(a) * 0.12, 0.83, Math.sin(a) * 0.12, 0, -a, 0));
  }
  return mergeGeo(parts);
}

/* A patch of fallen leaves: two thin dodecahedra, warm tones. */
export function propLitterGeo() {
  const d = new THREE.DodecahedronGeometry(1, 0);
  return mergeGeo([
    part(d, shade(0.92), 1.0, 0.1, 1.0, 0, 0.05, 0),
    part(d, shade(1.08), 0.7, 0.09, 0.7, 0.7, 0.06, 0.3),
    part(d, shade(0.98), 0.55, 0.08, 0.55, -0.6, 0.05, -0.4),
  ]);
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
  tech:   () => cached('tech', buildTech),
  local:  () => Math.random() < 0.5
    ? cached('local_w', () => buildLocalVariant('w'))
    : cached('local_m', () => buildLocalVariant('m')),
  drone:  () => cached('drone', buildDrone),
  turret: () => cached('turret', buildTurret),
  // one-offs, or (grove) needing genuinely per-instance materials
  depot: buildDepot, coolant: buildCoolant, core: buildCore, pump: buildPump,
  generator: buildGenerator, well: buildWell,
  porcupine: () => cached('porcupine', buildPorcupine),
  beaver: () => cached('beaver', buildBeaver),
  capybara: () => cached('capybara', buildCapybara),
  wall: buildWall, hearttree: buildHeartTree, grove: buildGrove,
};
