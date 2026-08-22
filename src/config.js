import * as THREE from 'three';

/* =========================================================================
   Critters vs Compute — tuning constants. Everything gameplay-tweakable lives here.
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
    hp: 56, dmg: 10, rate: 0.70, range: 2.6, speed: 10.5, radius: 1.0,
    armor: 0, vision: 26, cost: 13, build: 2.1, pop: 1, death: 'topple',
    blurb: 'Loses to a rifle. Beats three. Bring more than three.'
  },
  boar: {
    name: 'Boar', team: TEAM.WILD, icon: '🐗', key: 'X',
    hp: 125, dmg: 22, rate: 1.25, range: 2.8, speed: 8.0, radius: 1.25,
    armor: 2, vision: 25, cost: 24, build: 3.4, pop: 2, siege: 1.4, death: 'topple',
    blurb: 'Armoured battering ram. Shrugs off rifles.'
  },
  bear: {
    name: 'Bear', team: TEAM.WILD, icon: '🐻', key: 'C',
    hp: 380, dmg: 46, rate: 1.7, range: 3.4, speed: 5.6, radius: 1.7,
    armor: 7, vision: 25, cost: 80, build: 10, pop: 4, siege: 2.2, death: 'topple',
    blurb: 'Siege. Double damage to structures. Four pop \u2014 that is four wolves you are not fielding.'
  },
  capybara: {
    name: 'Capybara', team: TEAM.WILD, icon: '🦛', key: 'R',
    hp: 200, dmg: 6, rate: 1.4, range: 2.6, speed: 6.2, radius: 1.35,
    armor: 3, vision: 25, cost: 20, build: 3.0, pop: 2, death: 'topple',
    /* Taunt biases enemy target selection toward this unit (see acquire()).
       Without it the capybara is merely tanky and the swarm still gets shot
       out from behind it; with it, putting capybaras in front is a real and
       discoverable answer to turret splash. */
    taunt: 20,
    blurb: 'A wall that walks. Barely fights, soaks punishment, and the guns would rather shoot it than your wolves.'
  },
  raven: {
    name: 'Raven', team: TEAM.WILD, icon: '🦅', key: 'V',
    hp: 48, dmg: 12, rate: 0.55, range: 10, speed: 14, radius: 0.9,
    armor: 0, vision: 30, cost: 26, build: 3.2, pop: 1, flying: true, ranged: true, death: 'fall',
    projectile: { color: 0xdff0c0, speed: 60, size: 0.22 },
    blurb: 'Flies over walls. Ignores the perimeter entirely.'
  },

  local: {
    name: 'Local', team: TEAM.WILD, icon: '🎯', key: 'B',
    hp: 120, dmg: 16, rate: 0.65, range: 20, speed: 7.2, radius: 0.95,
    armor: 1, vision: 28, cost: 58, build: 7, pop: 2, ranged: true, death: 'topple',
    projectile: { color: 0xffe08a, speed: 95, size: 0.15 },
    blurb: 'The valley\'s people, armed and done asking. Expensive, and very good shots.'
  },

  porcupine: {
    name: 'Porcupine', team: TEAM.WILD, icon: '🦔', key: 'G',
    hp: 120, dmg: 14, rate: 1.15, range: 16, speed: 4.6, radius: 1.1,
    armor: 4, vision: 26, cost: 38, build: 5, pop: 2, ranged: true, death: 'topple',
    projectile: { color: 0xd9c08a, speed: 58, size: 0.13 },
    blurb: 'Quill volley. Slow, armoured, and the only thing on four legs that answers a rifle in kind.'
  },
  beaver: {
    name: 'Beaver', team: TEAM.WILD, icon: '🦫', key: 'N',
    hp: 105, dmg: 12, rate: 1.0, range: 2.8, speed: 5.4, radius: 1.05,
    armor: 2, vision: 25, cost: 32, build: 4.5, pop: 2, siege: 1.8, death: 'topple',
    mend: 14, mendRange: 7,
    blurb: 'Engineer. Gnaws through machine structures, dams intakes to slow the drain, and rebuilds your own — the Heart Tree included — when it is not fighting.'
  },

  /* ---- MACHINE (enemy) ---- */
  guard: {
    name: 'Security Guard', team: TEAM.MACHINE, icon: '🔫',
    hp: 100, dmg: 10, rate: 0.55, range: 15, speed: 6.4, radius: 0.9,
    armor: 1, vision: 26, ranged: true, pop: 1, death: 'topple',
    projectile: { color: 0xffc85c, speed: 90, size: 0.16 },
  },
  drone: {
    name: 'Patrol Drone', team: TEAM.MACHINE, icon: '🛸', mech: true,
    hp: 75, dmg: 8, rate: 0.40, range: 15, speed: 12, radius: 0.85,
    armor: 0, vision: 32, ranged: true, flying: true, pop: 1, death: 'fall',
    projectile: { color: 0x59e5ff, speed: 95, size: 0.14 },
  },
  tech: {
    name: 'Field Technician', team: TEAM.MACHINE, icon: '\ud83d\udd27',
    hp: 90, dmg: 0, rate: 1, range: 6, speed: 7.0, radius: 0.85,
    armor: 1, vision: 24, pop: 1, death: 'topple', repair: 16,
    blurb: 'Unarmed. Welds the compound back together behind you. Kill it first.'
  },
  turret: {
    name: 'Sentry Turret', team: TEAM.MACHINE, icon: '🗼',
    hp: 460, dmg: 15, rate: 0.85, range: 21, speed: 0, radius: 2.2,
    armor: 4, vision: 27, ranged: true, building: true, splash: 2.6,
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
    hp: 1300, radius: 4.6, armor: 2, building: true, critical: true,
  },
  core: {
    name: 'Server Core', team: TEAM.MACHINE, icon: '🧊',
    hp: 3000, radius: 9, armor: 8, building: true,
  },
  wall: {
    name: 'Perimeter Wall', team: TEAM.MACHINE, icon: '🧱',
    hp: 320, radius: 4, armor: 6, building: true, wall: true,
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
  startBiomass:   200,
  baseIncome:     0.7,      // per second from the Heart Tree
  grovIncome:     3.2,      // per second per bloomed grove
  captureTime:    3.0,      // seconds standing on a grove
  popCap:         96,
  machinePopCap:  16,
  garrisonGuards: 7,        // scaled by difficulty alongside machinePopCap
  garrisonDrones: 3,
  waveCapMult:    2.0,      // a sweep may surge to this multiple of the standing cap
  waveEvery:      108,      // seconds between machine sweep attacks
  firstWaveAt:    95,
  spellCost:      65,
  spellCooldown:  26,
  spellRadius:    16,
  spellDuration:  5,

  /* --- The Green (creep) ---------------------------------------------------
     A swarm of individually weak things only works if losing bodies is
     survivable and hurt bodies come back. Both live here. Regeneration is
     gated on being out of combat so it never wins a fight for you -- it only
     saves you the biomass of rebuilding between fights. */
  regenDelay:     5,        // seconds out of combat before healing starts
  regenOnGreen:   0.040,    // fraction of max HP per second, on the Green
  regenOffGreen:  0.008,    // ...and out in the world, where you are alone
  greenHaste:     1.18,     // movement multiplier on the Green

  /* --- Watered (drinking) --------------------------------------------------
     The Green sustains you AT HOME; water sustains you AWAY from it. An animal
     that stops at a shore carries off a short, potent buff, so lakes become
     staging points on the route to the compound rather than scenery.

     Deliberately short: this is a decision about WHEN to commit, not a chore to
     keep topped up. Duration scales with how full the lake is, which is what
     finally makes TerraByte's pumps something the player feels rather than
     something that quietly edits their income. */
  drinkTime:      1.8,      // seconds at the shore to drink
  drinkMin:       12,       // buff seconds from a nearly-dry lake
  drinkMax:       26,       // ...and from a full one
  wateredRate:    1.20,     // attack speed while Watered
  wateredDmg:     1.15,     // damage while Watered
  wateredSpeed:   1.10,     // movement while Watered
};

export const BUILDABLE = ['wolf', 'capybara', 'boar', 'bear', 'raven', 'porcupine', 'beaver', 'local'];
