import { RULES, DEFS } from './config.js';
import { G } from './state.js';

/* =========================================================================
   The Reclamation — WILDLINE's campaign layer, Dark Crusade school:
   a territory graph with free strike order, a perk per liberated site, and
   an enemy that scales as it loses ground.

   Scaling composes three terms onto the GROVE-difficulty baseline:
     challenge = tier(site) × progress × adapt
   `tier` is authored, `progress` grows with sites liberated, and `adapt` is
   a clamped band read from your recent mission ranks — Homeworld's idea
   without Homeworld's death spiral.

   Persistence is localStorage; every mission is a fresh page load, so
   applying multipliers once at boot needs no idempotency machinery.
   ========================================================================= */

export const CORP = 'TerraByte Solutions';

export const SITES = {
  heartwood: {
    id: 'heartwood', name: 'Heartwood', tier: 0, map: null, home: true,
    mx: 14, my: 62,
    blurb: 'The old forest. Your Heart Tree. The only place on this map without a parking mandate.',
  },
  'relay-shed': {
    id: 'relay-shed', name: 'Relay Shed 9', tier: 1, map: 'relay-shed',
    mx: 34, my: 44, links: ['heartwood'],
    blurb: 'Technically an edge node. The edge of what, nobody at TerraByte has ever specified.',
    perk: { id: 'fertile', name: 'Fertile Ground', desc: '+25% starting biomass in every mission. The shed was full of fertiliser. Was.' },
  },
  milltown: {
    id: 'milltown', name: 'Milltown', tier: 1, map: 'milltown',
    mx: 30, my: 78, links: ['heartwood'],
    blurb: 'TerraByte bought the mill, the diner, and the naming rights to the word "howdy".',
    perk: { id: 'locals', name: 'The Locals Join', desc: 'Locals (hotkey B) become buildable in every mission. They are done asking.' },
  },
  mirefen: {
    id: 'mirefen', name: 'The Mirefen Exchange', tier: 2, map: 'mirefen',
    mx: 55, my: 66, links: ['relay-shed', 'milltown'],
    blurb: 'Built on a drained marsh. The marsh has filed a counterclaim.',
    perk: { id: 'deeproots', name: 'Deep Roots', desc: 'Overgrowth cooldown −25%. The ground remembers what it was.' },
  },
  'substation-gary': {
    id: 'substation-gary', name: 'Substation Gary', tier: 2, map: 'substation-gary',
    mx: 56, my: 30, links: ['relay-shed'],
    blurb: 'Named after the CFO’s kayak. The kayak is also named Gary.',
    perk: { id: 'highground', name: 'High Ground', desc: 'Wildlife cap +6. Thin air builds character.' },
  },
  groundbreak: {
    id: 'groundbreak', name: 'The Groundbreaking', tier: 2, map: 'groundbreak',
    mx: 44, my: 20, links: ['substation-gary'],
    blurb: 'Half a data centre and a very optimistic sign. Hit it before the sign is right.',
    perk: { id: 'quarry', name: 'The Quarry', desc: 'Bears and beavers cost 15% less. There is a great deal of loose rock now.' },
  },
  pourhouse: {
    id: 'pourhouse', name: 'Pourhouse Flats', tier: 3, map: 'pourhouse',
    mx: 66, my: 96, links: ['coldrake', 'mirefen'],
    blurb: 'They are pouring the slab over the floodplain. The floodplain has other ideas.',
    perk: { id: 'floodplain', name: 'Floodplain', desc: 'Lakes drain 30% slower everywhere. The water table remembers.' },
  },
  coldrake: {
    id: 'coldrake', name: 'Coldrake Logistics Hub', tier: 3, map: 'coldrake',
    mx: 74, my: 82, links: ['milltown', 'mirefen'],
    blurb: 'Ships forty thousand units a day. Of what, the brochure does not say.',
    perk: { id: 'supplycut', name: 'Severed Supply', desc: 'Enemy depots reinforce 30% slower in every remaining mission.' },
  },
  'the-campus': {
    id: 'the-campus', name: 'The Campus', tier: 5, map: 'the-campus', stronghold: true,
    mx: 84, my: 42, links: ['mirefen', 'substation-gary', 'coldrake', 'pourhouse'], needLiberated: 5,
    blurb: 'TerraByte HQ. Seventeen espresso bars, zero windows, one very large Server Core.',
    perk: { id: 'done', name: 'The Valley, Reclaimed', desc: 'Campaign complete.' },
  },
};

const KEY = 'wildline.campaign.v1';
const PENDING = 'wildline.pending.v1';

/* ------------------------------------------------------------- state io -- */
/* Normalise whatever is in storage. Guarding only against unparseable JSON was
   not enough: any truthy value (an array, a number, an older schema missing
   `ranks`) sailed through and then threw deep inside the map screen, where the
   player had no recovery path at all because "Abandon Run" is hidden until
   `started` is true. Everything is coerced to its expected shape here instead. */
export function campState() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { raw = null; }
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  return {
    started: !!o.started,
    liberated: Array.isArray(o.liberated)
      ? o.liberated.filter(id => Object.prototype.hasOwnProperty.call(SITES, id)) : [],
    ranks: obj(o.ranks),
    attempts: obj(o.attempts),
    pack: Array.isArray(o.pack) ? o.pack.filter(u => u && DEFS[u.type]) : [],
    history: Array.isArray(o.history) ? o.history.slice(-4) : [],
  };
}
function freshState() { return { started: false, liberated: [], ranks: {}, attempts: {}, pack: [] }; }

/* The pack that walks out of a won mission walks into the next one. Capped by
   population so a snowball can't carry the campaign — this is Dark Crusade's
   Honor Guard, not an ever-growing doomstack. */
export const PACK_POP_CAP = 16;
function save(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }

export function campReset() { try { localStorage.removeItem(KEY); localStorage.removeItem(PENDING); } catch {} }

export function pendingMission() {
  try { return JSON.parse(localStorage.getItem(PENDING)); } catch { return null; }
}
export function setPending(p) {
  try { p ? localStorage.setItem(PENDING, JSON.stringify(p)) : localStorage.removeItem(PENDING); } catch {}
}

/* --------------------------------------------------------------- graph --- */
export function siteStatus(st, id) {
  const s = SITES[id];
  if (s.home) return 'home';
  if (st.liberated.includes(id)) return 'liberated';
  if (s.needLiberated && st.liberated.length < s.needLiberated) return 'locked';
  const reachable = (s.links || []).some(l => l === 'heartwood' || st.liberated.includes(l));
  return reachable ? 'open' : 'locked';
}

/* ------------------------------------------------------------- scaling --- */
const RANK_ADAPT = { S: 1.2, A: 1.12, B: 1.0, C: 0.92, D: 0.85 };

export function scalingFor(st, siteId) {
  const site = SITES[siteId];
  const tier = 0.85 + site.tier * 0.14;                       // authored difficulty
  const progress = 1 + 0.07 * st.liberated.length;            // the corp hardens as it loses
  const recent = (Array.isArray(st.history) && st.history.length ? st.history : Object.values(st.ranks || {})).slice(-2);
  let adapt = recent.length
    ? recent.reduce((a, r) => a + (RANK_ADAPT[r] || 1), 0) / recent.length
    : 1;
  adapt = Math.max(0.85, Math.min(1.2, adapt));               // the Homeworld clamp
  /* Ease the band in over the first three liberations. At full strength on the
     very first transition it meant an S on site 1 made site 2 twenty percent
     harder than a B and forty percent harder than a D — punishing the player for
     playing well, at exactly the point they have the least to absorb it with. */
  adapt = 1 + (adapt - 1) * Math.min(1, st.liberated.length / 3);
  const c = Math.max(0.7, Math.min(2.6, tier * progress * adapt));
  return { challenge: c, tier: site.tier, adapt };
}

/* Applied once at mission boot, after applyDifficulty(GROVE). Fresh page per
   mission, so straight mutation is safe. */
/* Snapshot the post-difficulty baseline so a second call cannot compound.
   applyDifficulty next door already does this; matching it removes a silent
   difficulty explosion that was one refactor away. */
let CAMP_BASE = null;
export function applyCampaignMods(st, siteId) {
  if (!CAMP_BASE) {
    CAMP_BASE = {
      machinePopCap: RULES.machinePopCap, garrisonGuards: RULES.garrisonGuards,
      garrisonDrones: RULES.garrisonDrones, waveEvery: RULES.waveEvery,
      firstWaveAt: RULES.firstWaveAt, startBiomass: RULES.startBiomass,
      popCap: RULES.popCap, spellCooldown: RULES.spellCooldown,
      spawnEvery: DEFS.depot.spawnEvery,
      dmg: { guard: DEFS.guard.dmg, drone: DEFS.drone.dmg, turret: DEFS.turret.dmg },
    };
  }
  const B = CAMP_BASE;
  RULES.machinePopCap = B.machinePopCap; RULES.garrisonGuards = B.garrisonGuards;
  RULES.garrisonDrones = B.garrisonDrones; RULES.waveEvery = B.waveEvery;
  RULES.firstWaveAt = B.firstWaveAt; RULES.startBiomass = B.startBiomass;
  RULES.popCap = B.popCap; RULES.spellCooldown = B.spellCooldown;
  DEFS.depot.spawnEvery = B.spawnEvery;
  for (const k of ['guard', 'drone', 'turret']) DEFS[k].dmg = B.dmg[k];

  const { challenge } = scalingFor(st, siteId);
  RULES.machinePopCap = Math.max(6, Math.round(RULES.machinePopCap * challenge));
  RULES.garrisonGuards = Math.max(3, Math.round(RULES.garrisonGuards * challenge));
  RULES.garrisonDrones = Math.max(1, Math.round(RULES.garrisonDrones * challenge));
  RULES.waveEvery = RULES.waveEvery / Math.sqrt(challenge);
  RULES.firstWaveAt = RULES.firstWaveAt / Math.sqrt(challenge);
  for (const k of ['guard', 'drone', 'turret'])
    DEFS[k].dmg = Math.max(1, Math.round(DEFS[k].dmg * (0.85 + challenge * 0.18)));

  /* perks from liberated ground */
  const perks = perkIds(st);
  if (perks.includes('fertile')) RULES.startBiomass = Math.round(RULES.startBiomass * 1.25);
  if (perks.includes('deeproots')) RULES.spellCooldown = Math.round(RULES.spellCooldown * 0.75);
  if (perks.includes('highground')) RULES.popCap += 6;
  if (perks.includes('supplycut')) DEFS.depot.spawnEvery *= 1.3;
  if (perks.includes('quarry')) { DEFS.bear.cost = Math.round(70 * 0.85); DEFS.beaver.cost = Math.round(45 * 0.85); }
  else { DEFS.bear.cost = 70; DEFS.beaver.cost = 45; }
  G.drainMult = perks.includes('floodplain') ? 0.7 : 1;
  if (!perks.includes('locals')) G.lockedUnits = ['local'];   // the town has not joined yet
  else G.lockedUnits = null;

  /* applyDifficulty seeded G.nextWave from the UNSCALED firstWaveAt, and nothing
     re-derived it here — so the opening lull was a flat 95s at every site,
     including the hardest, where it should have been 59s. */
  if (!G.time) {
    G.nextWave = RULES.firstWaveAt;
    G.biomass = RULES.startBiomass;
    G.popCap = RULES.popCap;
  }

  return { challenge, perks };
}

export function perkIds(st) {
  return st.liberated.map(id => SITES[id].perk && SITES[id].perk.id).filter(Boolean);
}

/* ----------------------------------------------------------- resolution -- */
/* Called on victory with the surviving wild units. Keeps the most experienced,
   under the population cap. */
export function bankSurvivors(survivors) {
  const st = campState();
  const ranked = survivors
    .filter(e => e && e.alive && !e.isBuilding && e.team === 'wild' && DEFS[e.type])
    .map(e => ({ type: e.type, kills: e.kills || 0, pop: e.def.pop || 1 }))
    .sort((a, b) => b.kills - a.kills);
  const kept = [];
  let pop = 0;
  for (const u of ranked) {
    if (pop + u.pop > PACK_POP_CAP) continue;
    kept.push({ type: u.type, kills: u.kills });
    pop += u.pop;
  }
  st.pack = kept;
  save(st);
  return kept;
}

export function packSummary(st) {
  const by = {};
  for (const u of (st.pack || [])) {
    const r = u.kills >= 13 ? 3 : u.kills >= 7 ? 2 : u.kills >= 3 ? 1 : 0;
    const k = u.type + '|' + r;
    by[k] = (by[k] || 0) + 1;
  }
  return by;
}

export function recordResult(siteId, win, rank) {
  const st = campState();
  st.started = true;
  st.attempts[siteId] = (st.attempts[siteId] || 0) + 1;
  if (win && !st.liberated.includes(siteId)) st.liberated.push(siteId);
  /* Record the rank either way. Only banking wins meant repeated failures could
     never lower the adapt band, so the "reads your recent mission ranks" promise
     only ever worked in the player's favour. */
  st.ranks[siteId] = rank || (win ? 'C' : 'D');
  st.history = (Array.isArray(st.history) ? st.history : []).concat(rank || (win ? 'C' : 'D')).slice(-4);
  save(st);
  return st;
}

export function campaignComplete(st) { return st.liberated.includes('the-campus'); }
