/* =========================================================================
   Critters vs Compute — scoring, streaks, floating score popups and the on-screen readout.

   Deliberately decoupled from three.js: the host injects a projector via
   setProjector((worldPos) => ({x, y})) so this module never needs a camera.
   ========================================================================= */

import { G } from './state.js';
import { DEFS, RULES } from './config.js';

/* --------------------------------------------------------------- table -- */
/* Point values track cost / threat. A guard is worth about a wolf, a coolant
   tower is worth a small army, the core is the run.                          */

export const SCORE = {
  /* mobile machine units you destroy */
  kill: {
    guard: 45,
    drone: 60,
    default: 40,
  },
  /* machine structures you destroy */
  structure: {
    wall: 20,
    turret: 260,
    depot: 320,
    coolant: 900,
    core: 2500,
    default: 150,
  },
  /* one-off events */
  groveBloom: 150,
  survivePerMinute: 60,     // slow drip so a long defensive game still scores
  winBonus: 1800,
  /* a clean fast win is worth more than a grind */
  fastWinTarget: 720,       // seconds; beat this and every second banks points
  fastWinPerSecond: 2,

  /* streak / combo */
  streak: {
    window: 4.5,            // seconds since the last kill before the chain drops
    step: 0.25,             // +25% multiplier per link
    max: 3.0,               // hard ceiling
  },

  /* rank thresholds, evaluated against points-per-minute (see rankFor) */
  /* `work` = groves held at peak + half the structures levelled. An S has to have
     actually run the map, not just rushed the core with ravens. */
  ranks: [
    { letter: 'S', ppm: 1500, min: 9000, work: 6 },
    { letter: 'A', ppm: 1050, min: 5200, work: 4 },
    { letter: 'B', ppm: 700,  min: 2600, work: 2 },
    { letter: 'C', ppm: 350,  min: 900,  work: 0 },
    { letter: 'D', ppm: 0,    min: 0,    work: 0 },
  ],
};

const POPUP_LIMIT = 26;
const POPUP_LIFE = 1.15;

/* ---------------------------------------------------------------- state -- */
const ST = {
  ready: false,
  base: 0,              // raw accumulated points, pre end-of-run bonuses
  bonus: 0,             // win / speed bonuses, applied once by endRun()
  shown: 0,             // eased value used by the readout so it ticks up
  combo: 0,
  comboTimer: 0,
  bestCombo: 0,
  kills: Object.create(null),
  structures: Object.create(null),
  lost: Object.create(null),
  killTotal: 0,
  structureTotal: 0,
  lostTotal: 0,
  grovesBloomed: 0,
  peakGroves: 0,
  largestArmy: 0,
  biomassEarned: 0,
  finished: false,
  win: null,
  endTime: 0,
};

let scoreProjector = null;
let scorePopLayer = null;
let scoreReadout = null, scoreReadoutVal = null, scoreReadoutCombo = null;
const scorePops = [];
let scoreUiAccum = 0;

/* ---------------------------------------------------------------- utils -- */
function scoreCommas(n) {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (neg ? '-' : '') + out;
}

function scoreClock(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function scoreLabelFor(key) {
  const d = DEFS[key];
  return (d && d.name) || String(key).replace(/^./, c => c.toUpperCase());
}

function scoreIconFor(key) {
  const d = DEFS[key];
  return (d && d.icon) || '•';
}

/* ------------------------------------------------------------------ dom -- */
function scoreEnsureDom() {
  const app = document.getElementById('app') || document.body;
  if (!app) return;

  if (!scorePopLayer || !scorePopLayer.isConnected) {
    scorePopLayer = document.createElement('div');
    scorePopLayer.id = 'scorepops';
    app.appendChild(scorePopLayer);
  }
  if (!scoreReadout || !scoreReadout.isConnected) {
    scoreReadout = document.createElement('div');
    scoreReadout.id = 'scorehud';
    scoreReadout.innerHTML =
      '<div class="sc-label">SCORE</div>' +
      '<div class="sc-val">0</div>' +
      '<div class="sc-combo"><b>×1.0</b><span>chain</span></div>';
    app.appendChild(scoreReadout);
    scoreReadoutVal = scoreReadout.querySelector('.sc-val');
    scoreReadoutCombo = scoreReadout.querySelector('.sc-combo');
  }
}

/* ------------------------------------------------------------------ api -- */

/** Inject a world→screen projector: (worldPos) => {x, y} in CSS pixels. */
export function setProjector(fn) {
  scoreProjector = typeof fn === 'function' ? fn : null;
}

/** Reset all counters and (re)build the readout + popup layer. */
export function initScore() {
  ST.base = 0; ST.bonus = 0; ST.shown = 0;
  ST.combo = 0; ST.comboTimer = 0; ST.bestCombo = 0;
  ST.kills = Object.create(null);
  ST.structures = Object.create(null);
  ST.killPts = Object.create(null);
  ST.structPts = Object.create(null);
  ST.lost = Object.create(null);
  ST.killTotal = 0; ST.structureTotal = 0; ST.lostTotal = 0;
  ST.grovesBloomed = 0; ST.peakGroves = 0;
  ST.largestArmy = 0; ST.biomassEarned = 0;
  ST.finished = false; ST.win = null; ST.endTime = 0;
  ST.ready = true;

  for (const p of scorePops) p.el.remove();
  scorePops.length = 0;

  scoreEnsureDom();
  if (scoreReadoutVal) scoreReadoutVal.textContent = '0';
  if (scoreReadout) scoreReadout.classList.remove('chaining');
  return ST;
}

/** Current multiplier from the kill chain (1.0 … SCORE.streak.max). */
export function comboMultiplier() {
  if (ST.combo <= 1) return 1;
  return Math.min(SCORE.streak.max, 1 + (ST.combo - 1) * SCORE.streak.step);
}

/**
 * Record a scoring event.
 *   kind: 'kill'      key = machine unit type    (guard, drone, …)
 *         'structure' key = machine building type (turret, depot, coolant, core, wall)
 *         'grove'     key = 'bloom'
 *         'lost'      key = your unit type       (wolf, boar, bear, raven) — 0 pts, tracked
 * worldPos is optional; when a projector is set a floating popup is spawned there.
 * Returns the points actually awarded.
 */
export function addScore(kind, key, worldPos) {
  if (!ST.ready) initScore();
  if (ST.finished) return 0;

  let pts = 0, cls = 'pop-kill', text = '';

  if (kind === 'kill') {
    const chained = ST.comboTimer > 0;
    ST.combo = chained ? ST.combo + 1 : 1;
    ST.comboTimer = SCORE.streak.window;
    if (ST.combo > ST.bestCombo) ST.bestCombo = ST.combo;

    const raw = SCORE.kill[key] != null ? SCORE.kill[key] : SCORE.kill.default;
    pts = Math.round(raw * comboMultiplier());
    ST.kills[key] = (ST.kills[key] || 0) + 1;
    ST.killPts[key] = (ST.killPts[key] || 0) + pts;
    ST.killTotal++;
    text = '+' + pts;
  } else if (kind === 'structure') {
    ST.comboTimer = SCORE.streak.window;
    ST.combo = Math.max(1, ST.combo + 1);
    if (ST.combo > ST.bestCombo) ST.bestCombo = ST.combo;

    const raw = SCORE.structure[key] != null ? SCORE.structure[key] : SCORE.structure.default;
    pts = Math.round(raw * comboMultiplier());
    ST.structures[key] = (ST.structures[key] || 0) + 1;
    ST.structPts[key] = (ST.structPts[key] || 0) + pts;
    ST.structureTotal++;
    cls = 'pop-struct';
    text = '+' + scoreCommas(pts);
  } else if (kind === 'grove') {
    pts = SCORE.groveBloom;
    ST.grovesBloomed++;
    cls = 'pop-grove';
    text = '+' + pts;
  } else if (kind === 'lost') {
    ST.lost[key] = (ST.lost[key] || 0) + 1;
    ST.lostTotal++;
    ST.combo = 0; ST.comboTimer = 0;
    cls = 'pop-lost';
    text = '✕';
  } else {
    return 0;
  }

  ST.base += pts;
  if (worldPos) spawnScorePop(text, cls, worldPos, kind === 'structure');
  return pts;
}

/** Per-frame tick: chain decay, popup motion, sampled peaks, readout refresh. */
export function updateScore(dt) {
  if (!ST.ready) return;
  const d = Math.min(0.1, Math.max(0, dt || 0));

  if (!ST.finished) {
    if (ST.comboTimer > 0) {
      ST.comboTimer -= d;
      if (ST.comboTimer <= 0) { ST.comboTimer = 0; ST.combo = 0; }
    }
    ST.base += SCORE.survivePerMinute * d / 60;

    /* sampled telemetry — cheap reads off the shared state object */
    const bloomed = ((G && G.bloomed) || 0) | 0;
    if (bloomed > ST.peakGroves) ST.peakGroves = bloomed;
    const pop = ((G && G.pop) || 0) | 0;
    if (pop > ST.largestArmy) ST.largestArmy = pop;
    if (G && typeof G.income === 'number') ST.biomassEarned += G.income * d;
  }

  updateScorePops(d);

  scoreUiAccum += d;
  if (scoreUiAccum >= 0.06) {
    scoreUiAccum = 0;
    refreshScoreReadout();
  }
}

/** Apply end-of-run bonuses exactly once. Safe to call repeatedly. */
export function endRun(win) {
  if (ST.finished) return getStats();
  ST.finished = true;
  ST.win = !!win;
  ST.endTime = (G && G.time) || 0;
  ST.combo = 0; ST.comboTimer = 0;
  if (win) {
    ST.bonus += SCORE.winBonus;
    const spare = Math.max(0, SCORE.fastWinTarget - ST.endTime);
    ST.bonus += Math.round(spare * SCORE.fastWinPerSecond);
  }
  refreshScoreReadout();
  return getStats();
}

/** Full breakdown for the end screen. Pass win to finalise in one call. */
export function getStats(win) {
  if (!ST.ready) initScore();
  if (win !== undefined && !ST.finished) return endRun(win);

  const timeSec = ST.finished ? ST.endTime : ((G && G.time) || 0);
  const score = Math.round(ST.base + ST.bonus);
  const killList = Object.keys(ST.kills).map(k => ({
    key: k, label: scoreLabelFor(k), icon: scoreIconFor(k), count: ST.kills[k],
    points: Math.round(ST.killPts[k] || 0),
  })).sort((a, b) => b.count - a.count);
  const structList = Object.keys(ST.structures).map(k => ({
    key: k, label: scoreLabelFor(k), icon: scoreIconFor(k), count: ST.structures[k],
    points: Math.round(ST.structPts[k] || 0),
  })).sort((a, b) => b.points - a.points);
  const lostList = Object.keys(ST.lost).map(k => ({
    key: k, label: scoreLabelFor(k), icon: scoreIconFor(k), count: ST.lost[k],
  })).sort((a, b) => b.count - a.count);

  return {
    score,
    base: Math.round(ST.base),
    bonus: Math.round(ST.bonus),
    rank: rankFor(score, timeSec),
    win: ST.win,
    finished: ST.finished,
    timeSec,
    timeText: scoreClock(timeSec),
    kills: killList,
    killTotal: ST.killTotal,
    structures: structList,
    structureTotal: ST.structureTotal,
    unitsLost: lostList,
    unitsLostTotal: ST.lostTotal,
    grovesBloomed: ST.grovesBloomed,
    peakGroves: ST.peakGroves,
    totalGroves: (G && G.groves && G.groves.length) || 0,
    largestArmy: ST.largestArmy,
    popCap: (G && G.popCap) || RULES.popCap,
    biomassEarned: Math.round(ST.biomassEarned),
    bestStreak: ST.bestCombo,
    bestMultiplier: ST.bestCombo <= 1 ? 1
      : Math.min(SCORE.streak.max, 1 + (ST.bestCombo - 1) * SCORE.streak.step),
  };
}

/** ST / A / B / C / D from score and elapsed time. */
/* Rank must reflect what you actually did, not how fast the clock ran. `ppm` alone
   let a 1:58 win with 4 kills and zero groves bloomed take an S. The gate is
   `work` = peak groves held + each objective structure by its WORTH below; walls
   and yard clutter score nothing, so a grind cannot out-rank a decisive strike. */
export function rankFor(score, timeSec, stats) {
  const s = stats || ST;
  /* Only objective-bearing work counts. Counting every structure let a long game
     that chewed through 20 perimeter walls out-rank a decisive strike on the core,
     which is exactly backwards. Walls and yard clutter are not an achievement. */
  const WORTH = { coolant: 2, core: 3, depot: 1.5, turret: 0.5 };
  let objective = 0;
  if (s) {
    objective += (s.peakGroves || 0) * 1.0;
    const st = s.structures || {};
    for (const k in st) objective += (WORTH[k] || 0) * st[k];
  }
  const minutes0 = Math.max(0.5, (timeSec || 0) / 60);
  const ppm0 = score / minutes0;
  let letter = 'D';
  for (const r of SCORE.ranks) {
    if (ppm0 >= r.ppm && score >= r.min && objective >= (r.work || 0)) { letter = r.letter; break; }
  }
  /* A finished run that LOST cannot outrank a C. rankFor took no outcome argument
     at all, so a measured defeat — ppm 1815, score 16,813, objective 14.5 — cleared
     every S gate and printed 'S RANK' directly under a dead Heart Tree, the same
     letter a victory got. Losing the one thing the whole game is about is not an S,
     and a triumphant grade undercuts the defeat copy in the line above it. */
  if (s && s.finished && s.win === false) {
    const floor = SCORE.ranks.findIndex(r => r.letter === 'C');
    const cur = SCORE.ranks.findIndex(r => r.letter === letter);
    if (cur >= 0 && floor >= 0 && cur < floor) letter = 'C';
  }
  return letter;
}


/* -------------------------------------------------------------- popups --- */
/* Kills happen all over the map; a popup for something the player cannot see
   would otherwise pile up against the edge of the screen. */
const POPUP_MARGIN = 48;
function scoreOffScreen(scr) {
  const w = window.innerWidth || 0, h = window.innerHeight || 0;
  return scr.x < -POPUP_MARGIN || scr.x > w + POPUP_MARGIN ||
         scr.y < -POPUP_MARGIN || scr.y > h + POPUP_MARGIN;
}

function spawnScorePop(text, cls, worldPos, big) {
  if (!scoreProjector) return;
  scoreEnsureDom();
  if (!scorePopLayer) return;

  let scr = null;
  try { scr = scoreProjector(worldPos); } catch (e) { scr = null; }
  if (!scr || !isFinite(scr.x) || !isFinite(scr.y)) return;
  if (scr.behind || scoreOffScreen(scr)) return;

  while (scorePops.length >= POPUP_LIMIT) {
    const old = scorePops.shift();
    old.el.remove();
  }

  const el = document.createElement('div');
  el.className = 'scorepop ' + cls + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = scr.x.toFixed(1) + 'px';
  el.style.top = scr.y.toFixed(1) + 'px';
  scorePopLayer.appendChild(el);
  scorePops.push({ el, life: POPUP_LIFE, world: worldPos, jitter: (Math.random() - 0.5) * 26 });
}

function updateScorePops(dt) {
  if (!scorePops.length) return;
  for (let i = scorePops.length - 1; i >= 0; i--) {
    const p = scorePops[i];
    p.life -= dt;
    if (p.life <= 0) {
      p.el.remove();
      scorePops.splice(i, 1);
      continue;
    }
    const t = 1 - p.life / POPUP_LIFE;
    if (scoreProjector && p.world) {
      let scr = null;
      try { scr = scoreProjector(p.world); } catch (e) { scr = null; }
      if (scr && isFinite(scr.x) && isFinite(scr.y)) {
        /* the camera can pan away mid-flight — follow it, then cull */
        const hide = scr.behind || scoreOffScreen(scr);
        p.el.style.display = hide ? 'none' : '';
        if (!hide) {
          p.el.style.left = (scr.x + p.jitter * t).toFixed(1) + 'px';
          p.el.style.top = (scr.y - 54 * t).toFixed(1) + 'px';
        }
      }
    }
    p.el.style.opacity = String(t < 0.15 ? t / 0.15 : Math.min(1, (1 - t) / 0.45));
  }
}

/* ------------------------------------------------------------- readout --- */
function refreshScoreReadout() {
  if (!scoreReadout || !scoreReadout.isConnected) return;
  const target = ST.base + ST.bonus;
  const diff = target - ST.shown;
  ST.shown += Math.abs(diff) < 1 ? diff : diff * 0.25;
  scoreReadoutVal.textContent = scoreCommas(ST.shown);

  const m = comboMultiplier();
  if (m > 1) {
    scoreReadout.classList.add('chaining');
    scoreReadoutCombo.firstChild.textContent = '×' + String(+m.toFixed(2));
  } else {
    scoreReadout.classList.remove('chaining');
  }
}

/** Hide or show the on-screen score readout (used by the start/end screens). */
export function setScoreVisible(v) {
  scoreEnsureDom();
  if (scoreReadout) scoreReadout.classList.toggle('hidden', !v);
  if (scorePopLayer) scorePopLayer.classList.toggle('hidden', !v);
}
