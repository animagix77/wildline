import { RULES, DEFS } from './config.js';
import { G } from './state.js';

/* =========================================================================
   The Reclamation — the campaign layer, Dark Crusade school:
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


/* ------------------------------------------------------------ save code -- */
/* localStorage is per-browser and per-origin: clear your site data, switch
   machines, or open the game in a different browser and the run is gone. There
   is no backend and there isn't going to be one, so the save travels as text
   the player owns — copy it out, paste it back, done.

   Format: "CVC1-" + base64 of the state JSON. The prefix is a version tag so a
   future schema change can reject or migrate old codes instead of throwing
   somewhere deep in the map screen. */
const CODE_PREFIX = 'CVC1-';

/* base64 that survives non-ASCII (site names, blurbs) intact. */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** The current run as a portable string. */
export function exportCode() {
  const st = campState();
  /* Only what campState() actually reads — exporting stray keys would let a
     stale schema ride along and reappear after an import. */
  const slim = {
    started: st.started, liberated: st.liberated, ranks: st.ranks,
    attempts: st.attempts, pack: st.pack, history: st.history,
  };
  try { return CODE_PREFIX + b64encode(JSON.stringify(slim)); } catch { return null; }
}

/** Restore from a code. Returns {ok, error, summary}. Never throws. */
export function importCode(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, '');
  if (!text) return { ok: false, error: 'Paste a save code first.' };
  if (!text.startsWith(CODE_PREFIX)) {
    return { ok: false, error: 'That does not look like a Critters vs Compute save code.' };
  }
  let parsed;
  try { parsed = JSON.parse(b64decode(text.slice(CODE_PREFIX.length))); }
  catch { return { ok: false, error: 'That code is damaged or incomplete.' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'That code does not contain a run.' };
  }
  /* Write it, then read it back through campState() — the normaliser is the
     only thing that decides what a valid run looks like, and letting it be the
     gate means a hand-edited code cannot poison the map screen. */
  const before = localStorage.getItem(KEY);
  try {
    localStorage.setItem(KEY, JSON.stringify(parsed));
    const st = campState();
    const known = st.liberated.length;
    /* `started` alone is not enough to count as a run. A code whose site ids are
       all unknown normalises down to nothing, and accepting it would replace a
       real save with an empty one — destructive, and for no gain. Demand at
       least one liberated site or one banked veteran. */
    if (!known && !st.pack.length) {
      if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
      return { ok: false, error: 'That code contains no progress to load.' };
    }
    setPending(null);              // never resume someone else's half-played strike
    return { ok: true, summary: `${known} site${known === 1 ? '' : 's'} liberated, ${st.pack.length} veterans` };
  } catch {
    if (before !== null) { try { localStorage.setItem(KEY, before); } catch {} }
    return { ok: false, error: 'Could not save that code to this browser.' };
  }
}

/** One-line description of the current run, for the map screen. */
export function saveSummary() {
  const st = campState();
  if (!st.started && !st.liberated.length) return null;
  return `${st.liberated.length} of ${Object.keys(SITES).length - 1} liberated · ${st.pack.length} veterans banked`;
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
      cost: { bear: DEFS.bear.cost, beaver: DEFS.beaver.cost },
    };
  }
  const B = CAMP_BASE;
  RULES.machinePopCap = B.machinePopCap; RULES.garrisonGuards = B.garrisonGuards;
  RULES.garrisonDrones = B.garrisonDrones; RULES.waveEvery = B.waveEvery;
  RULES.firstWaveAt = B.firstWaveAt; RULES.startBiomass = B.startBiomass;
  RULES.popCap = B.popCap; RULES.spellCooldown = B.spellCooldown;
  DEFS.depot.spawnEvery = B.spawnEvery;
  for (const k of ['guard', 'drone', 'turret']) DEFS[k].dmg = B.dmg[k];
  for (const k of ['bear', 'beaver']) DEFS[k].cost = B.cost[k];

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
  /* Scale the LIVE cost, never a literal. These used to be hardcoded 70/45 — the
     config's values from an earlier balance pass — so entering the campaign silently
     repriced the Bear from 80 down to 70 and the Beaver from 32 UP to 45, and the
     "Bears and beavers cost 15% less" perk still left the Beaver at 38, a fifth
     dearer than the same animal in skirmish. A perk advertised as a discount must
     not be a tax, and the only way to keep that true as config moves is to read it. */
  if (perks.includes('quarry')) {
    DEFS.bear.cost = Math.round(B.cost.bear * 0.85);
    DEFS.beaver.cost = Math.round(B.cost.beaver * 0.85);
  }
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
