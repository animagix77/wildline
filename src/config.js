import * as THREE from 'three';

/* =========================================================================
   WILDLINE — tuning constants. Everything gameplay-tweakable lives here.
   ========================================================================= */

export const WORLD = 240;          // world is WORLD x WORLD, centred on origin
export const HALF  = WORLD / 2;

export const TEAM = { WILD: 'wild', MACHINE: 'machine', NEUTRAL: 'neutral' };

export const BASE     = new THREE.Vector3(-72, 0, 68);           // Heart Tree
export const COMPOUND = { x: 56, z: -50, hw: 40, hd: 33 };        // datacenter half-extents

export const COLORS = {
  grass:    0x35592c,
  grassDry: 0x6b6a35,
  scorched: 0x2e2b26,
  bark:     0x4a3a28,
};

/* ---------------------------------------------------------------- units -- */
/* dmg is per shot; dps = dmg / rate. armour subtracts flat damage.           */

export const DEFS = {
  /* ---- WILDLIFE (player) ---- */
  wolf: {
    name: 'Wolf', team: TEAM.WILD, icon: '🐺', key: 'Z',
    hp: 80, dmg: 12, rate: 0.70, range: 2.6, speed: 10.5, radius: 1.0,
    armor: 0, vision: 26, cost: 20, build: 3.5, pop: 1, death: 'topple',
    blurb: 'Cheap, fast, dies fast. Bring friends.'
  },
  boar: {
    name: 'Boar', team: TEAM.WILD, icon: '🐗', key: 'X',
    hp: 170, dmg: 26, rate: 1.25, range: 2.8, speed: 8.0, radius: 1.25,
    armor: 3, vision: 24, cost: 35, build: 6, pop: 2, siege: 1.4, death: 'topple',
    blurb: 'Armoured battering ram. Shrugs off rifles.'
  },
  bear: {
    name: 'Bear', team: TEAM.WILD, icon: '🐻', key: 'C',
    hp: 380, dmg: 46, rate: 1.7, range: 3.4, speed: 5.6, radius: 1.7,
    armor: 7, vision: 24, cost: 70, build: 11, pop: 3, siege: 2.2, death: 'topple',
    blurb: 'Siege. Deals double damage to structures.'
  },
  raven: {
    name: 'Raven', team: TEAM.WILD, icon: '🦅', key: 'V',
    hp: 60, dmg: 10, rate: 0.55, range: 10, speed: 14, radius: 0.9,
    armor: 0, vision: 30, cost: 35, build: 5, pop: 1, flying: true, ranged: true, death: 'fall',
    projectile: { color: 0xdff0c0, speed: 60, size: 0.22 },
    blurb: 'Flies over walls. Ignores the perimeter entirely.'
  },

  local: {
    name: 'Local', team: TEAM.WILD, icon: '🎯', key: 'B',
    hp: 130, dmg: 14, rate: 0.65, range: 16, speed: 7.2, radius: 0.95,
    armor: 1, vision: 28, cost: 110, build: 10, pop: 2, ranged: true, death: 'topple',
    projectile: { color: 0xffe08a, speed: 95, size: 0.15 },
    blurb: 'The valley\'s people, armed and done asking. Expensive, and very good shots.'
  },

  porcupine: {
    name: 'Porcupine', team: TEAM.WILD, icon: '🦔', key: 'G',
    hp: 165, dmg: 17, rate: 1.15, range: 14, speed: 4.6, radius: 1.1,
    armor: 5, vision: 26, cost: 55, build: 8, pop: 2, ranged: true, death: 'topple',
    projectile: { color: 0xd9c08a, speed: 58, size: 0.13 },
    blurb: 'Quill volley. Slow, armoured, and the only thing on four legs that answers a rifle in kind.'
  },
  beaver: {
    name: 'Beaver', team: TEAM.WILD, icon: '🦫', key: 'H',
    hp: 140, dmg: 14, rate: 1.0, range: 2.8, speed: 5.4, radius: 1.05,
    armor: 2, vision: 22, cost: 45, build: 7, pop: 2, siege: 1.8, death: 'topple',
    blurb: 'Gnaws through structures, and dams the intakes: every beaver on a pump slows the drain.'
  },

  /* ---- MACHINE (enemy) ---- */
  guard: {
    name: 'Security Guard', team: TEAM.MACHINE, icon: '🔫',
    hp: 100, dmg: 10, rate: 0.55, range: 17, speed: 6.4, radius: 0.9,
    armor: 1, vision: 26, ranged: true, pop: 1, death: 'topple',
    projectile: { color: 0xffc85c, speed: 90, size: 0.16 },
  },
  drone: {
    name: 'Patrol Drone', team: TEAM.MACHINE, icon: '🛸',
    hp: 75, dmg: 8, rate: 0.40, range: 15, speed: 12, radius: 0.85,
    armor: 0, vision: 32, ranged: true, flying: true, pop: 1, death: 'fall',
    projectile: { color: 0x59e5ff, speed: 95, size: 0.14 },
  },
  turret: {
    name: 'Sentry Turret', team: TEAM.MACHINE, icon: '🗼',
    hp: 460, dmg: 16, rate: 0.85, range: 25, speed: 0, radius: 2.2,
    armor: 4, vision: 27, ranged: true, building: true,
    projectile: { color: 0xff8a3d, speed: 110, size: 0.25 },
  },
  depot: {
    name: 'Security Depot', team: TEAM.MACHINE, icon: '🏭',
    hp: 800, radius: 5.5, armor: 4, building: true, spawnEvery: 18,
  },
  pump: {
    name: 'Intake Pump', team: TEAM.MACHINE, icon: '🚱',
    hp: 520, radius: 3.4, armor: 3, building: true, pump: true,
  },
  coolant: {
    name: 'Coolant Tower', team: TEAM.MACHINE, icon: '🌀',
    hp: 950, radius: 4.6, armor: 2, building: true, critical: true,
  },
  core: {
    name: 'Server Core', team: TEAM.MACHINE, icon: '🧊',
    hp: 2400, radius: 9, armor: 8, building: true,
  },
  wall: {
    name: 'Perimeter Wall', team: TEAM.MACHINE, icon: '🧱',
    hp: 320, radius: 0, armor: 6, building: true, wall: true,
  },

  /* ---- NEUTRAL / PLAYER STRUCTURES ---- */
  hearttree: {
    name: 'Heart Tree', team: TEAM.WILD, icon: '🌳',
    hp: 4200, radius: 6.5, armor: 3, building: true,
    /* Range MUST exceed the guard standoff or the tree never fires a shot.
       A guard (range 17) halts at 17 + tree radius 6.5 = 23.5m from centre, and
       the tree's reach is `range + target radius`. Anything under ~24 here makes
       the Heart Tree a decorative punching bag. */
    dmg: 25, rate: 1.25, range: 24, ranged: true,
    projectile: { color: 0x9bff6a, speed: 55, size: 0.22 },
    blurb: 'Your base. Flings thorns at anything machine that comes close.',
  },
  grove: {
    name: 'Grove', team: TEAM.NEUTRAL, icon: '🌱',
    hp: 500, radius: 3.2, armor: 2, building: true, capturable: true,
  },
};

/* ---------------------------------------------------------- economy/game -- */
export const RULES = {
  startBiomass:   180,
  baseIncome:     0.6,      // per second from the Heart Tree
  grovIncome:     2.0,      // per second per bloomed grove
  captureTime:    4.0,      // seconds standing on a grove
  popCap:         40,
  machinePopCap:  16,
  garrisonGuards: 7,        // scaled by difficulty alongside machinePopCap
  garrisonDrones: 3,
  waveCapMult:    2.0,      // a sweep may surge to this multiple of the standing cap
  waveEvery:      108,      // seconds between machine sweep attacks
  firstWaveAt:    95,
  spellCost:      90,
  spellCooldown:  35,
  spellRadius:    14,
  spellDuration:  5,
};

export const BUILDABLE = ['wolf', 'boar', 'bear', 'raven', 'porcupine', 'beaver', 'local'];
