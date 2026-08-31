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
    terra: {}, palette: { bg: 0x2b2130, fog: 0x3d2f3c, fogNear: 165, fogFar: 430, treeHue: 0.26 },
    /* LATE SUMMER, GOLDEN HOUR. The poster shot: a long low sun out of the
       west, violet dusk pooling in the fog, warm rim on every canopy. */
    mood: { sunC: 0xffb36b, sunI: 2.15, sunOffset: [-125, 62, 45],
            hemiSky: 0xffcfa0, hemiGround: 0x3c4230, hemiI: 0.8 },
    season: 'late summer',
    river: [{ x: -12, z: 56 }, { x: -8, z: 34 }, { x: 4, z: 18 }, { x: -2, z: -4 },
            { x: -18, z: -26 }, { x: -30, z: -48 }, { x: -26, z: -72 }],
    props: { trees: 820, rocks: 240, ferns: 520 },
    base: { x: -72, z: 68 },
    compound: { x: 56, z: -50, hw: 40, hd: 33 },
    groves: [{ x: -34, z: 26 }, { x: 6, z: 66 }, { x: -66, z: -14 }, { x: 16, z: -4 }, { x: -14, z: -62 }, { x: 70, z: 34 }],
    turrets: [[22, -22], [22, -78], [90, -26], [90, -74], [46, -34], [46, -66]],
    coolants: [[26, -68], [26, -30], [86, -50]],
    depots: [[56, -76], [56, -27]],
    core: { x: 58, z: -50 },
    weather: 'clear',
    /* The hollow's sky is on a clock. `weather` is only the opening frame now;
       `fronts` is [preset, seconds], looping on sim time, identical every run.
       This map is where the rain system finally does something: clear for the
       first 100s so the player watches the lake fall at full rate, then rain
       (which roughly halves the loss), a clear spell to make them miss it, then
       a storm at ~5:00 — and during a storm, killing the intake actually pushes
       the water back up. Any map can carry one of these; only this one does,
       because this is the one everybody starts on. */
    fronts: [['clear', 100], ['rain', 120], ['clear', 70], ['storm', 90]],
    water: [{ x: -12, z: 34, r: 22, drain: 0.0026 }],
    pumps: [[32, -23]],
    /* MOVED from [75,-80] — the far back corner, past the core, past two depots
       and four turrets. Across two full matches and 24 structures destroyed a
       critic never had a reason to go near it, and G.powered read true for all
       892 seconds of a winning run: the entire "cut the power and the guns go
       quiet" mechanic, its blurb and the whole `power` comms category, never
       fired once on the map every new player starts on. Every other map already
       puts a generator on the near face. Now this one does too — 14m inside the
       west gate, on the same shelf as the well, so "kill the power, then walk
       in" is a legible opening play instead of a thing that exists in config. */
    generators: [[30, -58]],
    wells: [[20, -48]],
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
    coolants: [[48, -58], [76, -58], [62, -30]],
    depots: [[45, -46]],
    core: { x: 62, z: -46 },
    weather: 'mist',
    water: [{ x: -20, z: 30, r: 18, drain: 0.0022 }],
    pumps: [[41, -36]],
    generators: [[88, -44]],
    wells: [[35, -68]],
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
    depots: [[52, -72], [52, -36]],
    core: { x: 52, z: -54 },
    weather: 'rain',
    water: [{ x: -26, z: 38, r: 20, drain: 0.0030 }, { x: 24, z: 40, r: 14, drain: 0.0030 }],
    pumps: [[26, -42], [70, -34]],
    generators: [[20, -58], [66, -80]],
    wells: [[84, -63]],
  },

  /* ------------------------------------------------------- tier 2 sites -- */
  'mirefen': {
    id: 'mirefen', name: 'The Mirefen Exchange', archetype: 'wetland', faction: 'wild',
    terra: { ampl: 3.5, freq: 0.02, rippleA: 0.5 },
    palette: { bg: 0x1b2f2e, fog: 0x2a4540, fogNear: 120, fogFar: 340, treeHue: 0.34 },
    /* SPRING, FIRST LIGHT. A pale gold sun barely up in the east, everything
       else cold teal — dawn over standing water. */
    mood: { sunC: 0xffdda6, sunI: 1.45, sunOffset: [105, 58, -55],
            hemiSky: 0x9fd4cf, hemiGround: 0x2e3d34, hemiI: 1.05 },
    season: 'spring',
    river: [{ x: -30, z: 28 }, { x: -12, z: 40 }, { x: 10, z: 52 }, { x: -8, z: 66 },
            { x: -34, z: 4 }, { x: -48, z: -14 }, { x: -58, z: -30 }],
    props: { trees: 480, rocks: 140, ferns: 900 },
    base: { x: -70, z: 70 },
    compound: { x: 55, z: -48, hw: 36, hd: 30 },
    groves: [{ x: -38, z: 30 }, { x: 0, z: 64 }, { x: -64, z: -10 }, { x: 14, z: -8 }, { x: -20, z: -60 }, { x: 68, z: 36 }, { x: -80, z: -60 }],
    turrets: [[24, -24], [24, -72], [86, -26], [86, -70], [55, -22], [55, -74]],
    coolants: [[28, -62], [28, -32], [82, -48]],
    depots: [[49, -68], [51, -30]],
    core: { x: 55, z: -48 },
    weather: 'mist',
    /* the fen IS the map: three shallow meres, drained fast, and four pumps.
       Ignore the water here and the economy is gone before the fourth sweep. */
    water: [{ x: -30, z: 28, r: 24, drain: 0.0050 }, { x: 10, z: 52, r: 18, drain: 0.0050 },
            { x: -58, z: -30, r: 20, drain: 0.0050 }],
    pumps: [[33, -24], [79, -26], [31, -72], [79, -70]],
    generators: [[19, -47], [65, -65]],
    wells: [[35, -46], [67, -18]],
  },
  'substation-gary': {
    id: 'substation-gary', name: 'Substation Gary', archetype: 'alpine', faction: 'wild',
    terra: { ampl: 16, freq: 0.010, rippleA: 2.4 },
    palette: { bg: 0x232b3d, fog: 0x35364a, fogNear: 150, fogFar: 400, treeHue: 0.42 },
    /* DEEP WINTER, ALPENGLOW. Rose-pink sun skimming the ridgeline, blue-slate
       shadow everywhere it does not reach, snow already falling. */
    mood: { sunC: 0xff9fae, sunI: 1.75, sunOffset: [-135, 52, -35],
            hemiSky: 0xc6d8ff, hemiGround: 0x3e4152, hemiI: 0.95 },
    season: 'winter',
    props: { trees: 520, rocks: 520, ferns: 260 },
    base: { x: -72, z: 66 },
    compound: { x: 58, z: -50, hw: 34, hd: 28 },
    groves: [{ x: -32, z: 22 }, { x: 8, z: 64 }, { x: -66, z: -16 }, { x: 18, z: -6 }, { x: 72, z: 32 }],
    turrets: [[28, -26], [28, -74], [88, -28], [88, -72], [46, -34], [70, -66], [58, -24]],
    coolants: [[30, -66], [30, -34], [86, -50]],
    depots: [[58, -70], [62, -32]],
    core: { x: 58, z: -50 },
    weather: 'snow',
    water: [{ x: -34, z: 40, r: 16, drain: 0.0020 }],
    pumps: [[44, -28]],
    generators: [[24, -50], [42, -78]],
    wells: [[76, -78]],
  },

  /* ------------------------------------------------------- tier 3 site --- */
  'coldrake': {
    id: 'coldrake', name: 'Coldrake Logistics Hub', archetype: 'industrial', faction: 'wild',
    terra: { ampl: 6, blightReach: 52 },
    palette: { bg: 0x2a201c, fog: 0x38281f, fogNear: 140, fogFar: 380, treeHue: 0.07 },
    /* AUTUMN, STORMLIGHT. The canopy has turned -- rust and amber -- and the
       sun is a low ember cutting under the weather. */
    mood: { sunC: 0xff9448, sunI: 1.55, sunOffset: [-110, 48, 70],
            hemiSky: 0xb8a48e, hemiGround: 0x3a2c22, hemiI: 0.9 },
    season: 'autumn',
    props: { trees: 420, rocks: 300, ferns: 240 },
    base: { x: -74, z: 68 },
    compound: { x: 52, z: -48, hw: 44, hd: 34 },
    groves: [{ x: -36, z: 26 }, { x: 4, z: 64 }, { x: -64, z: -14 }, { x: -18, z: -64 }, { x: -84, z: 8 }],
    turrets: [[12, -18], [12, -78], [92, -18], [92, -78], [36, -30], [36, -66], [70, -30], [70, -66]],
    coolants: [[20, -64], [20, -32], [86, -48]],
    depots: [[42, -74], [62, -74], [52, -24]],
    core: { x: 52, z: -48 },
    weather: 'storm',
    water: [{ x: -30, z: 34, r: 22, drain: 0.0040 }],
    pumps: [[16, -24], [86, -24], [52, -76]],
    generators: [[30, -15], [30, -49]],
    wells: [[87, -65], [9, -46]],
  },

  /* ---------------------------------------------------- the stronghold --- */
  'the-campus': {
    id: 'the-campus', name: 'The Campus', archetype: 'valley', faction: 'wild',
    terra: { ampl: 8 },
    palette: { bg: 0x1a2433, fog: 0x25303e, fogNear: 150, fogFar: 400, treeHue: 0.25 },
    /* HIGH SUMMER, STORM-BREAK NOON. Hard white light straight down between
       the weather -- the clinical hour for the most fortified site. */
    mood: { sunC: 0xf2f7ff, sunI: 2.0, sunOffset: [-45, 130, 30],
            hemiSky: 0xaec8e8, hemiGround: 0x33404a, hemiI: 1.05 },
    season: 'high summer',
    river: [{ x: -36, z: 36 }, { x: -48, z: 14 }, { x: -60, z: -8 }, { x: -70, z: -40 }],
    props: { trees: 560, rocks: 260, ferns: 380 },
    base: { x: -78, z: 74 },
    compound: { x: 50, z: -44, hw: 52, hd: 40 },
    groves: [{ x: -40, z: 30 }, { x: -2, z: 68 }, { x: -68, z: -8 }, { x: -24, z: -62 }, { x: -88, z: -52 }, { x: -90, z: 30 }],
    turrets: [[0, -8], [0, -80], [100, -8], [100, -80], [26, -24], [26, -64], [74, -24], [74, -64], [50, -8], [50, -80]],
    coolants: [[10, -62], [10, -26], [92, -44]],
    depots: [[34, -76], [66, -76], [50, -18]],
    core: { x: 50, z: -44 },
    weather: 'storm',
    water: [{ x: -36, z: 36, r: 20, drain: 0.0035 }, { x: -70, z: -40, r: 16, drain: 0.0035 }],
    pumps: [[8, -16], [94, -16], [48, -74]],
    generators: [[23, -7], [93, -65], [21, -40]],
    wells: [[73, -6], [73, -50]],
  },
};

/* ---------------------------------------------------- construction sites --
   Caught mid-build. Fewer defences, but a completion timer: let it finish and
   the turrets come online, the garrison doubles and the coolant towers gain
   armour. The whole mission is a question the player must answer early —
   strike fast and dirty, or dig in and lose the window. Nothing random. */
MAPS['groundbreak'] = {
  id: 'groundbreak', name: 'The Groundbreaking', archetype: 'valley', faction: 'wild',
  terra: { ampl: 6, blightReach: 40 }, palette: { ...VALLEY_PALETTE, bg: 0x2a2b22, fog: 0x36382c },
  props: { trees: 620, rocks: 380, ferns: 300 },
  base: { x: -70, z: 66 },
  compound: { x: 54, z: -48, hw: 34, hd: 28 },
  groves: [{ x: -34, z: 24 }, { x: 4, z: 62 }, { x: -62, z: -16 }, { x: 14, z: -4 }, { x: 70, z: 30 }],
  turrets: [[30, -28], [78, -28]],
  coolants: [[32, -62], [76, -62], [54, -26]],
  depots: [[54, -68]],
  core: { x: 54, z: -48 },
  weather: 'rain',
  water: [{ x: -22, z: 34, r: 20, drain: 0.0026 }],
  pumps: [[36, -26]],
    generators: [[87, -48]],
    wells: [[24, -45]],
  construction: { time: 300, addTurrets: [[30, -68], [78, -68], [54, -46]], addGarrison: 6 },
};

MAPS['pourhouse'] = {
  id: 'pourhouse', name: 'Pourhouse Flats', archetype: 'wetland', faction: 'wild',
  terra: { ampl: 3.5, freq: 0.02, rippleA: 0.5, blightReach: 44 },
  palette: { bg: 0x1a2b28, fog: 0x233a35, fogNear: 140, fogFar: 380, treeHue: 0.32 },
  props: { trees: 440, rocks: 260, ferns: 780 },
  base: { x: -72, z: 70 },
  compound: { x: 56, z: -46, hw: 38, hd: 30 },
  groves: [{ x: -36, z: 28 }, { x: 2, z: 64 }, { x: -66, z: -12 }, { x: 16, z: -6 }, { x: -18, z: -58 }, { x: 72, z: 34 }],
  turrets: [[26, -26], [86, -26], [56, -70]],
  coolants: [[30, -60], [82, -60], [56, -24]],
  depots: [[50, -64], [32, -32]],
  core: { x: 56, z: -46 },
  weather: 'storm',
  water: [{ x: -28, z: 36, r: 26, drain: 0.0045 }, { x: 20, z: -70, r: 16, drain: 0.0045 }],
  pumps: [[32, -22], [80, -22]],
    generators: [[79, -42], [94, -75]],
    wells: [[21, -75]],
  construction: { time: 360, addTurrets: [[26, -66], [86, -66], [56, -44]], addGarrison: 8 },
};

export const DEFAULT_MAP = 'verdant-hollow';

/* Structure radii, mirrored from config so this stays a pure data check. */
const R = { core: 9, depot: 5.5, coolant: 4.6, turret: 2.2, pump: 3.4, generator: 5.4, well: 4.2 };

/* Every authored structure must clear every other one and sit inside its own
   perimeter. The Core used to be a hard-coded literal and quietly overlapped a
   Depot on relay-shed, which flung units away at 256 m/s. Data bugs like that
   should be loud, so `validateAllMaps()` is run at boot in dev builds. */
export function validateMap(m) {
  const items = [];
  const push = (kind, x, z) => items.push({ kind, x, z, r: R[kind] });
  const c = m.core || m.compound;
  push('core', c.x, c.z);
  (m.depots || []).forEach(([x, z]) => push('depot', x, z));
  (m.coolants || []).forEach(([x, z]) => push('coolant', x, z));
  (m.turrets || []).forEach(([x, z]) => push('turret', x, z));
  (m.pumps || []).forEach(([x, z]) => push('pump', x, z));
  (m.generators || []).forEach(([x, z]) => push('generator', x, z));
  (m.wells || []).forEach(([x, z]) => push('well', x, z));
  const bad = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z), need = a.r + b.r;
      if (d < need) bad.push(`${a.kind}(${a.x},${a.z}) overlaps ${b.kind}(${b.x},${b.z}) — ${d.toFixed(1)}m of ${need}m`);
    }
    /* Centre must be inside the perimeter. A wall-mounted turret's rim is allowed
       to overhang — that is how they are meant to sit. */
    if (Math.abs(a.x - m.compound.x) > m.compound.hw ||
        Math.abs(a.z - m.compound.z) > m.compound.hd) {
      bad.push(`${a.kind}(${a.x},${a.z}) is outside the perimeter`);
    }
  }
  return bad;
}

export function validateAllMaps() {
  const report = {};
  for (const id in MAPS) { const bad = validateMap(MAPS[id]); if (bad.length) report[id] = bad; }
  return report;
}

/* Quick battles cycle through these five — five seasons, five hours of light,
   five compounds. Chosen for spread: the golden-hour valley, the misty fen at
   dawn, winter alpenglow in the hills, an autumn storm over the log hub, and
   the campus at hard noon. */
export const QUICK_ROTATION = ['verdant-hollow', 'mirefen', 'substation-gary', 'coldrake', 'the-campus'];

/* A river is authored as a polyline; the engine only knows circular water
   bodies, so it becomes a chain of overlapping circles at load. Every derived
   circle is a real lake — drinkable, dammable, drainable — because it goes
   through the same G.map.water list as everything else. Done ONCE and cached
   back onto the def (loadMap runs on every restart). */
function expandRiver(m) {
  if (!m.river || m._riverDone) return;
  m._riverDone = true;
  m.water = m.water ? m.water.slice() : [];
  const pts = m.river;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    /* Dense overlap (a circle every 5 units at r~6) is what makes the chain
       read as one waterway instead of stepping stones; the wobble is kept
       small for the same reason. */
    const steps = Math.max(1, Math.round(d / 5));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      m.water.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
                     r: 6.2 + 0.9 * Math.sin(i * 2.7 + k * 1.3),
                     drain: 0.0008, river: true });
    }
  }
}

export function loadMap(id) {
  const m = MAPS[id] || MAPS[DEFAULT_MAP];
  expandRiver(m);
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
