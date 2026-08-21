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
  coldrake: {
    id: 'coldrake', name: 'Coldrake Logistics Hub', tier: 3, map: 'coldrake',
    mx: 74, my: 82, links: ['milltown', 'mirefen'],
    blurb: 'Ships forty thousand units a day. Of what, the brochure does not say.',
    perk: { id: 'supplycut', name: 'Severed Supply', desc: 'Enemy depots reinforce 30% slower in every remaining mission.' },
  },
  'the-campus': {
    id: 'the-campus', name: 'The Campus', tier: 5, map: 'the-campus', stronghold: true,
    mx: 84, my: 42, links: ['mirefen', 'substation-gary', 'coldrake'], needLiberated: 4,
    blurb: 'TerraByte HQ. Seventeen espresso bars, zero windows, one very large Server Core.',
    perk: { id: 'done', name: 'The Valley, Reclaimed', desc: 'Campaign complete.' },
  },
};

const KEY = 'wildline.campaign.v1';
const PENDING = 'wildline.pending.v1';

/* ------------------------------------------------------------- state io -- */
export function campState() {
  try { return JSON.parse(localStorage.getItem(KEY)) || freshState(); }
  catch { return freshState(); }
}
function freshState() { return { started: false, liberated: [], ranks: {}, attempts: {}, pack: [] }; }

/* The pack that walks out of a won mission walks into the next one. Capped by
   population so a snowball can't carry the campaign — this is Dark Crusade's
   Honor Guard, not an ever-growing doomstack. */
export const PACK_POP_CAP = 10;
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
  const progress = 1 + 0.12 * st.liberated.length;            // the corp hardens as it loses
  const recent = Object.values(st.ranks).slice(-2);
  let adapt = recent.length
    ? recent.reduce((a, r) => a + (RANK_ADAPT[r] || 1), 0) / recent.length
    : 1;
  adapt = Math.max(0.85, Math.min(1.2, adapt));               // the Homeworld clamp
  const c = Math.max(0.7, Math.min(2.6, tier * progress * adapt));
  return { challenge: c, tier: site.tier, adapt };
}

/* Applied once at mission boot, after applyDifficulty(GROVE). Fresh page per
   mission, so straight mutation is safe. */
export function applyCampaignMods(st, siteId) {
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
  if (perks.includes('fertile')) { RULES.startBiomass = Math.round(RULES.startBiomass * 1.25); G.biomass = RULES.startBiomass; }
  if (perks.includes('deeproots')) RULES.spellCooldown = Math.round(RULES.spellCooldown * 0.75);
  if (perks.includes('highground')) { RULES.popCap += 6; G.popCap = RULES.popCap; }
  if (perks.includes('supplycut')) DEFS.depot.spawnEvery *= 1.3;
  if (!perks.includes('locals')) G.lockedUnits = ['local'];   // the town has not joined yet

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
  if (win && !st.liberated.includes(siteId)) {
    st.liberated.push(siteId);
    st.ranks[siteId] = rank || 'C';
  }
  save(st);
  return st;
}

export function campaignComplete(st) { return st.liberated.includes('the-campus'); }
