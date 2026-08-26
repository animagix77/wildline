import { RULES } from './config.js';

/* One shared mutable game state object. Modules import { G } and read/write. */
export const G = {
  scene: null, camera: null, renderer: null,
  terrain: null, entityRoot: null, fxRoot: null,

  entities: [],
  byId: new Map(),
  nextId: 1,

  selection: [],
  groups: {},                 // control groups 1..5

  time: 0,
  wallTime: 0,
  dt: 0,
  biomass: RULES.startBiomass,
  income: RULES.baseIncome,
  pop: 0, popCap: RULES.popCap,
  machinePop: 0,

  queue: [],                  // [{type, remaining, total}]
  rally: null,                // THREE.Vector3

  rootsN: 0,                  // Deepen the Roots purchases made (price and cap key off it)
  spellReady: 0,              // timestamp when Overgrowth is usable again
  nextWave: RULES.firstWaveAt,
  waveNum: 0,

  coreExposed: false,
  runawayAt: 0,               // G.time the last coolant died — starts the meltdown clock
  runawaySaid: null,          // which meltdown countdown milestones have been announced
  depotsGoneToldOnce: false,
  over: false,
  paused: false,

  phase: 'boot',              // 'boot' | 'menu' | 'playing' | 'over'
  difficulty: null,
  keys: new Set(),
  mode: 'normal',             // 'normal' | 'attack' | 'spell'
  hoverEntity: null,
};

export function addEntity(e) {
  e.id = G.nextId++;
  G.entities.push(e);
  G.byId.set(e.id, e);
  return e;
}

export function livingOf(team, type) {
  return G.entities.filter(e => e.alive && e.team === team && (!type || e.type === type));
}
