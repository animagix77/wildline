import { COMPOUND, BASE } from './config.js';
import { TERRA } from './utils.js';
import { G } from './state.js';

/* =========================================================================
   Scenario definitions. A map is pure data: terrain parameters, palette,
   prop densities and the layout arrays world.js populates from. loadMap()
   mutates the shared COMPOUND/BASE/TERRA objects BEFORE the scene is built,
   so every module keeps reading the same references it always did.

   `faction: 'wild'` is reserved on every map — a future machine-side campaign
   ("play as middle management") flips it, and nothing here needs to change.
   ========================================================================= */

const VALLEY_PALETTE = { bg: 0x1b2f24, fog: 0x24402f, fogNear: 170, fogFar: 420, treeHue: 0.26 };

export const MAPS = {
  /* ------------------------------------------------ the original valley -- */
  'verdant-hollow': {
    id: 'verdant-hollow', name: 'Verdant Hollow', archetype: 'valley', faction: 'wild',
    terra: {}, palette: VALLEY_PALETTE,
    props: { trees: 820, rocks: 240, ferns: 520 },
    base: { x: -72, z: 68 },
    compound: { x: 56, z: -50, hw: 40, hd: 33 },
    groves: [{ x: -34, z: 26 }, { x: 6, z: 66 }, { x: -66, z: -14 }, { x: 16, z: -4 }, { x: -14, z: -62 }, { x: 70, z: 34 }],
    turrets: [[22, -22], [22, -78], [90, -26], [90, -74], [46, -34], [46, -66]],
    coolants: [[26, -68], [26, -30], [86, -50]],
    depots: [[56, -76], [56, -27]],
  },

  /* ------------------------------------------------------- tier 1 sites -- */
  'relay-shed': {
    id: 'relay-shed', name: 'Relay Shed 9', archetype: 'valley', faction: 'wild',
    terra: {}, palette: VALLEY_PALETTE,
    props: { trees: 880, rocks: 220, ferns: 560 },
    base: { x: -74, z: 66 },
    compound: { x: 62, z: -46, hw: 27, hd: 22 },
    groves: [{ x: -30, z: 20 }, { x: 10, z: 62 }, { x: -60, z: -20 }, { x: 4, z: -16 }, { x: 66, z: 30 }],
    turrets: [[44, -30], [80, -30], [62, -60]],
    coolants: [[48, -56], [76, -56], [62, -32]],
    depots: [[62, -50]],
  },
  'milltown': {
    id: 'milltown', name: 'Milltown', archetype: 'valley', faction: 'wild',
    terra: { ampl: 7 }, palette: { ...VALLEY_PALETTE, bg: 0x22301f, fog: 0x2c3c28 },
    props: { trees: 700, rocks: 200, ferns: 640 },
    base: { x: -70, z: 64 },
    compound: { x: 52, z: -54, hw: 32, hd: 26 },
    groves: [{ x: -36, z: 24 }, { x: 2, z: 60 }, { x: -62, z: -18 }, { x: 20, z: 0 }, { x: -18, z: -58 }, { x: 74, z: 28 }],
    turrets: [[26, -34], [78, -34], [26, -74], [78, -74]],
    coolants: [[36, -68], [36, -40], [72, -54]],
    depots: [[52, -74], [52, -34]],
  },

  /* ------------------------------------------------------- tier 2 sites -- */
  'mirefen': {
    id: 'mirefen', name: 'The Mirefen Exchange', archetype: 'wetland', faction: 'wild',
    terra: { ampl: 3.5, freq: 0.02, rippleA: 0.5 },
    palette: { bg: 0x182b2a, fog: 0x1f3a37, fogNear: 130, fogFar: 360, treeHue: 0.34 },
    props: { trees: 480, rocks: 140, ferns: 900 },
    base: { x: -70, z: 70 },
    compound: { x: 55, z: -48, hw: 36, hd: 30 },
    groves: [{ x: -38, z: 30 }, { x: 0, z: 64 }, { x: -64, z: -10 }, { x: 14, z: -8 }, { x: -20, z: -60 }, { x: 68, z: 36 }, { x: -80, z: -60 }],
    turrets: [[24, -24], [24, -72], [86, -26], [86, -70], [55, -22], [55, -74]],
    coolants: [[28, -62], [28, -32], [82, -48]],
    depots: [[55, -72], [55, -26]],
  },
  'substation-gary': {
    id: 'substation-gary', name: 'Substation Gary', archetype: 'alpine', faction: 'wild',
    terra: { ampl: 16, freq: 0.010, rippleA: 2.4 },
    palette: { bg: 0x1c2733, fog: 0x27333d, fogNear: 150, fogFar: 400, treeHue: 0.30 },
    props: { trees: 520, rocks: 520, ferns: 260 },
    base: { x: -72, z: 66 },
    compound: { x: 58, z: -50, hw: 34, hd: 28 },
    groves: [{ x: -32, z: 22 }, { x: 8, z: 64 }, { x: -66, z: -16 }, { x: 18, z: -6 }, { x: 72, z: 32 }],
    turrets: [[28, -26], [28, -74], [88, -28], [88, -72], [46, -34], [70, -66], [58, -24]],
    coolants: [[30, -66], [30, -34], [86, -50]],
    depots: [[58, -74], [58, -28]],
  },

  /* ------------------------------------------------------- tier 3 site --- */
  'coldrake': {
    id: 'coldrake', name: 'Coldrake Logistics Hub', archetype: 'industrial', faction: 'wild',
    terra: { ampl: 6, blightReach: 52 },
    palette: { bg: 0x242422, fog: 0x30302c, fogNear: 140, fogFar: 380, treeHue: 0.20 },
    props: { trees: 420, rocks: 300, ferns: 240 },
    base: { x: -74, z: 68 },
    compound: { x: 52, z: -48, hw: 44, hd: 34 },
    groves: [{ x: -36, z: 26 }, { x: 4, z: 64 }, { x: -64, z: -14 }, { x: -18, z: -64 }, { x: -84, z: 8 }],
    turrets: [[12, -18], [12, -78], [92, -18], [92, -78], [36, -30], [36, -66], [70, -30], [70, -66]],
    coolants: [[20, -64], [20, -32], [86, -48]],
    depots: [[42, -74], [62, -74], [52, -24]],
  },

  /* ---------------------------------------------------- the stronghold --- */
  'the-campus': {
    id: 'the-campus', name: 'The Campus', archetype: 'valley', faction: 'wild',
    terra: { ampl: 8 },
    palette: { bg: 0x171f2b, fog: 0x202b38, fogNear: 150, fogFar: 400, treeHue: 0.25 },
    props: { trees: 560, rocks: 260, ferns: 380 },
    base: { x: -78, z: 74 },
    compound: { x: 50, z: -44, hw: 52, hd: 40 },
    groves: [{ x: -40, z: 30 }, { x: -2, z: 68 }, { x: -68, z: -8 }, { x: -24, z: -62 }, { x: -88, z: -52 }, { x: -90, z: 30 }],
    turrets: [[0, -8], [0, -80], [100, -8], [100, -80], [26, -24], [26, -64], [74, -24], [74, -64], [50, -8], [50, -80]],
    coolants: [[10, -62], [10, -26], [92, -44]],
    depots: [[34, -76], [66, -76], [50, -14]],
  },
};

export const DEFAULT_MAP = 'verdant-hollow';

export function loadMap(id) {
  const m = MAPS[id] || MAPS[DEFAULT_MAP];
  G.map = m;

  // Every module imports these objects by reference — mutate, never reassign.
  BASE.set(m.base.x, 0, m.base.z);
  COMPOUND.x = m.compound.x; COMPOUND.z = m.compound.z;
  COMPOUND.hw = m.compound.hw; COMPOUND.hd = m.compound.hd;

  TERRA.freq = 0.012; TERRA.ampl = 9; TERRA.lift = -4;
  TERRA.rippleFx = 0.05; TERRA.rippleFz = 0.043; TERRA.rippleA = 1.4;
  TERRA.blightReach = 34;
  Object.assign(TERRA, m.terra);

  return m;
}
