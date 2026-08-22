/* =========================================================================
   Critters vs Compute — full-screen states: the title screen and the run summary.

   Both are plain DOM injected into #app. The WebGL canvas is never touched;
   these sit above it. All motion is CSS (transform / opacity only).
   ========================================================================= */

import { RULES, DEFS } from './config.js';
import { G } from './state.js';
import { SITES, CORP, campState, campReset, siteStatus, scalingFor, setPending, campaignComplete, packSummary } from './campaign.js';
import { musicPlay } from './music.js';
import { rankFor } from './score.js';

/* ======================================================== difficulties == */
/*
   Every field is a MULTIPLIER against the shipped value in config.js:
     waveEvery        — seconds between machine sweeps (and the first sweep)
     machinePopCap    — how many machines the campus keeps fielded
     startBiomass     — biomass in the bank at t=0
     spawnEveryMult   — Security Depot reinforcement interval
     enemyDamageMult  — machine weapon damage

   applyDifficulty() below folds them into RULES/DEFS from a captured baseline,
   so it is safe to call more than once (e.g. on a restart).
*/
export const DIFFICULTIES = [
  {
    id: 'sapling',
    name: 'SAPLING',
    glyph: '🌱',
    tagline: 'Room to learn the ground',
    blurb: 'Sweeps come late and thin. Enough biomass to make a mistake and still recover.',
    waveEvery: 1.35,
    machinePopCap: 0.75,
    startBiomass: 1.45,
    spawnEveryMult: 1.40,
    enemyDamageMult: 0.75,
  },
  {
    id: 'grove',
    name: 'GROVE',
    glyph: '🌳',
    tagline: 'The valley as written',
    blurb: 'Balanced. Three security sweeps of grace, then you are on the clock.',
    waveEvery: 1.00,
    machinePopCap: 1.00,
    startBiomass: 1.00,
    spawnEveryMult: 1.00,
    enemyDamageMult: 1.00,
  },
  {
    id: 'oldgrowth',
    name: 'OLD GROWTH',
    glyph: '🌲',
    tagline: 'The campus fights back',
    blurb: 'Faster sweeps, a bigger garrison, harder guns and a lean opening. Kill depots early.',
    waveEvery: 0.75,
    machinePopCap: 1.35,
    startBiomass: 0.80,
    spawnEveryMult: 0.72,
    enemyDamageMult: 1.30,
  },
];

export const DEFAULT_DIFFICULTY = DIFFICULTIES[1];

/* Baselines snapshotted once, at module load, before anything is scaled. */
const BASE_RULES = {
  waveEvery: RULES.waveEvery,
  firstWaveAt: RULES.firstWaveAt,
  machinePopCap: RULES.machinePopCap,
  startBiomass: RULES.startBiomass,
  garrisonGuards: RULES.garrisonGuards,
  garrisonDrones: RULES.garrisonDrones,
};
const BASE_SPAWN_EVERY = DEFS.depot.spawnEvery;
const MACHINE_GUNS = ['guard', 'drone', 'turret'];
const BASE_DMG = {};
for (const k of MACHINE_GUNS) BASE_DMG[k] = DEFS[k].dmg;

/**
 * Fold a difficulty into the live tuning tables. Idempotent — always derived
 * from the captured baseline, never compounded. Returns the difficulty.
 */
export function applyDifficulty(diff) {
  const d = diff || DEFAULT_DIFFICULTY;

  RULES.waveEvery = BASE_RULES.waveEvery * d.waveEvery;
  RULES.firstWaveAt = BASE_RULES.firstWaveAt * d.waveEvery;
  RULES.machinePopCap = Math.max(4, Math.round(BASE_RULES.machinePopCap * d.machinePopCap));
  // the standing garrison is part of "garrison size", so it scales with the same dial
  RULES.garrisonGuards = Math.max(2, Math.round(BASE_RULES.garrisonGuards * d.machinePopCap));
  RULES.garrisonDrones = Math.max(1, Math.round(BASE_RULES.garrisonDrones * d.machinePopCap));
  RULES.startBiomass = Math.round(BASE_RULES.startBiomass * d.startBiomass);
  DEFS.depot.spawnEvery = BASE_SPAWN_EVERY * d.spawnEveryMult;
  for (const k of MACHINE_GUNS) DEFS[k].dmg = Math.max(1, Math.round(BASE_DMG[k] * d.enemyDamageMult));

  /* G is created at import time from the shipped RULES, so re-seed it. */
  if (G) {
    G.difficulty = d;
    if (!G.time) {
      G.biomass = RULES.startBiomass;
      G.nextWave = RULES.firstWaveAt;
    }
  }
  return d;
}

/* ============================================================ helpers === */
function sxEl(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function sxHost() {
  return document.getElementById('app') || document.body;
}

/* `alarm` swaps the drifting motes and the scanline to the loss palette. */
function sxBackdrop(alarm) {
  const bg = sxEl('div', alarm ? 'sx-bg sx-bg-alarm' : 'sx-bg');
  const motes = [];
  for (let i = 0; i < 22; i++) {
    const x = (i * 37 + 11) % 100;
    const size = 1.2 + ((i * 13) % 5) * 0.6;
    const dur = 17 + ((i * 7) % 13);
    const delay = -((i * 3.1) % 20);
    const drift = ((i % 2) ? 1 : -1) * (14 + (i % 5) * 8);
    motes.push(
      `<span class="sx-mote" style="left:${x}%;width:${size}px;height:${size}px;` +
      `animation-duration:${dur}s;animation-delay:${delay}s;--dx:${drift}px"></span>`
    );
  }
  bg.innerHTML =
    '<div class="sx-grid"></div>' +
    `<div class="sx-motes">${motes.join('')}</div>` +
    '<div class="sx-scan"></div>' +
    '<div class="sx-vig"></div>';
  return bg;
}

const sxKey = k => `<kbd>${k}</kbd>`;

/* Support link. Opens in a new tab, never steals focus from the game, and
   rel=noopener so the opened page gets no handle back to this window. */
const COFFEE_URL = 'https://buymeacoffee.com/wfhpapa';
/* The end-of-match call to action. This is the moment a player has just felt
   something — the valley saved or the Heart Tree burned — so the ask lives here
   rather than being a footnote, and it speaks in the game's own voice instead
   of a stock donate badge. */
function sxCoffeeCTA(win) {
  const box = document.createElement('div');
  box.className = 'es-cta' + (win ? ' won' : '');
  const line = win
    ? 'The racks are dark and the valley is loud again. Nicely done.'
    : 'The Heart Tree fell. The valley will grow another — take it again.';
  const ask = win
    ? 'Critters vs Compute is free, has no ads and no tracking, and was built by one person. TerraByte has a marketing budget. I have a coffee cup.'
    : 'Critters vs Compute is free, has no ads and no tracking. If it has been worth your evening, you know where the cup is.';
  box.innerHTML = `
    <div class="cta-line">${line}</div>
    <div class="cta-ask">${ask}</div>`;
  const a = document.createElement('a');
  a.className = 'cta-btn';
  a.href = COFFEE_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.innerHTML = '<span class="cf-cup">☕</span><span>Buy me a coffee</span>';
  box.appendChild(a);
  return box;
}

function sxCoffee(label = 'Buy me a coffee') {
  const a = document.createElement('a');
  a.className = 'sx-coffee';
  a.href = COFFEE_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.innerHTML = `<span class="cf-cup">☕</span><span>${label}</span>`;
  return a;
}

/* ====================================================== start screen ==== */

let startEl = null;
let startKeyHandler = null;

/**
 * Animated title screen. Calls onStart(difficultyObject) once, after removing
 * itself from the DOM. The returned element is already attached.
 */
export function showStartScreen(onStart) {
  hideStartScreen();

  const root = sxEl('div', 'sx-screen');
  root.id = 'startscreen';
  root.appendChild(sxBackdrop(false));

  const panel = sxEl('div', 'ss-panel');

  /* ---- masthead ---- */
  panel.appendChild(sxEl('div', 'ss-head', `
    <div class="ss-rule"></div>
    <h1 class="ss-mark">CRITTERS VS COMPUTE</h1>
    <p class="ss-tag">You are the forest. They are the data centre. Take it back.</p>
    <div class="ss-rule"></div>
  `));

  /* ---- brief + controls ---- */
  const cols = sxEl('div', 'ss-cols');

  cols.appendChild(sxEl('section', 'ss-card', `
    <h2>Mission brief</h2>
    <dl class="ss-brief">
      <dt>You</dt>
      <dd>A <b>Heart Tree</b> and four wolves. Your only resource is <b>biomass</b> — walk any
          beast onto a neutral <b>Grove</b> and hold it for a few seconds to bloom it.</dd>
      <dt>Them</dt>
      <dd>A hyperscale campus: walls, sentry turrets, patrolling guards and
          <b>Security Depots</b> that keep printing more. Every sweep is bigger than the last.</dd>
      <dt class="win">Win</dt>
      <dd>Break the <b>3 Coolant Towers</b>. The <b>Server Core</b> overheats, loses its
          shielding, and can then be brought down.</dd>
      <dt class="lose">Lose</dt>
      <dd>The <b>Heart Tree</b> falls. Sit still and the fourth security sweep does it for you.</dd>
    </dl>
  `));

  cols.appendChild(sxEl('section', 'ss-card', `
    <h2>Orders</h2>
    <div class="ss-keys">
      <h3>Camera</h3>
      <ul>
        <li><span>${sxKey('←')}${sxKey('↑')}${sxKey('↓')}${sxKey('→')} / screen edge</span><em>pan</em></li>
        <li><span>${sxKey('Q')}${sxKey('E')} · wheel · middle-drag</span><em>rotate / zoom / free pan</em></li>
        <li><span>${sxKey('Shift')} · ${sxKey('Space')}</span><em>pan faster · snap to Heart Tree</em></li>
      </ul>
      <h3>Units</h3>
      <ul>
        <li><span>click · drag box · double-click</span><em>select · marquee · whole species</em></li>
        <li><span>right click</span><em>move / attack</em></li>
        <li><span>${sxKey('A')} · ${sxKey('S')} · ${sxKey('H')}</span><em>attack-move · stop · hold</em></li>
        <li><span>${sxKey('Ctrl')}+${sxKey('1')}…${sxKey('5')}</span><em>set group (press ${sxKey('1')}…${sxKey('5')} to recall)</em></li>
      </ul>
      <h3>Grow &amp; cast</h3>
      <ul>
        <li><span>${sxKey('Z')}${sxKey('X')}${sxKey('C')}${sxKey('V')}${sxKey('G')}${sxKey('H')}${sxKey('B')}</span><em>wolf · boar · bear · raven · porcupine · beaver · local</em></li>
        <li><span>${sxKey('F')} + click</span><em>Overgrowth — root every machine in a circle</em></li>
        <li><span>${sxKey('F1')} · ${sxKey('F3')}</span><em>in-game reference · performance overlay</em></li>
      </ul>
    </div>
  `));

  panel.appendChild(cols);

  /* ---- difficulty ---- */
  let index = DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY);
  if (index < 0) index = 0;

  const diffWrap = sxEl('section', 'ss-diff');
  diffWrap.appendChild(sxEl('h2', 'ss-diff-title', 'Choose your season'));
  const row = sxEl('div', 'ss-diff-row');

  const pct = v => (v === 1 ? '—' : (v > 1 ? '+' : '') + Math.round((v - 1) * 100) + '%');
  const buttons = DIFFICULTIES.map((d, i) => {
    const b = sxEl('button', 'ss-diff-card', `
      <span class="dg">${d.glyph}</span>
      <span class="dn">${d.name}</span>
      <span class="dt">${d.tagline}</span>
      <span class="db">${d.blurb}</span>
      <span class="dm">
        <i><u>sweep gap</u><b>${pct(d.waveEvery)}</b></i>
        <i><u>garrison</u><b>${pct(d.machinePopCap)}</b></i>
        <i><u>their damage</u><b>${pct(d.enemyDamageMult)}</b></i>
        <i><u>starting biomass</u><b>${pct(d.startBiomass)}</b></i>
      </span>
    `);
    b.type = 'button';
    b.dataset.id = d.id;
    b.addEventListener('click', () => select(i));
    row.appendChild(b);
    return b;
  });
  diffWrap.appendChild(row);
  panel.appendChild(diffWrap);

  /* ---- go ---- */
  const foot = sxEl('div', 'ss-foot');
  const begin = sxEl('button', 'ss-begin', '<span>Quick Battle</span>');
  begin.id = 'ss-begin';          // stable handle for automated smoke tests
  begin.type = 'button';
  const camp = sxEl('button', 'ss-begin ss-camp', '<span>Campaign</span>');
  camp.id = 'ss-campaign';
  camp.type = 'button';
  const btnRow = sxEl('div', 'ss-btnrow');
  btnRow.appendChild(camp);
  btnRow.appendChild(begin);
  foot.appendChild(btnRow);
  camp.addEventListener('click', () => showCampaignMap());
  foot.appendChild(sxCoffee('Enjoying it? Buy me a coffee'));
  foot.appendChild(sxEl('p', 'ss-hint',
    `${sxKey('←')}${sxKey('→')} choose season · ${sxKey('Enter')} begin · audio starts on your first click`));
  panel.appendChild(foot);

  root.appendChild(panel);
  sxHost().appendChild(root);

  /* Tell the player there is more below the fold when the panel actually overflows,
     and stop saying it once they have scrolled. */
  const scroller = panel;
  const syncMore = () => {
    const more = scroller.scrollTop < 40 && scroller.scrollHeight - scroller.clientHeight > 4;
    scroller.classList.toggle('has-more', more);
  };
  scroller.addEventListener('scroll', syncMore, { passive: true });
  window.addEventListener('resize', syncMore);
  startResizeHandler = syncMore;          // removed in hideStartScreen
  requestAnimationFrame(syncMore);
  setTimeout(syncMore, 120);
  startEl = root;

  function select(i) {
    index = ((i % DIFFICULTIES.length) + DIFFICULTIES.length) % DIFFICULTIES.length;
    buttons.forEach((b, n) => b.classList.toggle('on', n === index));
  }
  select(index);

  let launched = false;
  function begin_() {
    if (launched) return;
    launched = true;
    const chosen = DIFFICULTIES[index];
    /* fade out over the newly-live game rather than popping */
    root.classList.add('sx-out');
    if (startKeyHandler) {
      window.removeEventListener('keydown', startKeyHandler, true);
      startKeyHandler = null;
    }
    startEl = null;
    setTimeout(() => root.remove(), 340);
    if (typeof onStart === 'function') onStart(chosen);
  }

  begin.addEventListener('click', begin_);

  startKeyHandler = (ev) => {
    if (ev.repeat && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    switch (ev.key) {
      case 'Enter':
      case ' ':
        ev.preventDefault(); ev.stopPropagation(); begin_(); break;
      case 'ArrowLeft':
        ev.preventDefault(); ev.stopPropagation(); select(index - 1); break;
      case 'ArrowRight':
        ev.preventDefault(); ev.stopPropagation(); select(index + 1); break;
      case '1': case '2': case '3':
        ev.preventDefault(); ev.stopPropagation(); select(+ev.key - 1); break;
      default: break;
    }
  };
  window.addEventListener('keydown', startKeyHandler, true);

  /* Focus the primary action so Enter/Space work without a click first. */
  begin.focus({ preventScroll: true });
  return root;
}

/** Tear the title screen down. Safe to call when it is not showing. */
export function hideStartScreen() {
  if (startResizeHandler) { window.removeEventListener('resize', startResizeHandler); startResizeHandler = null; }
  if (startKeyHandler) {
    window.removeEventListener('keydown', startKeyHandler, true);
    startKeyHandler = null;
  }
  if (startEl) { startEl.remove(); startEl = null; }
  const stale = document.getElementById('startscreen');
  if (stale) stale.remove();
}

/* ======================================================== end screen ==== */

let endEl = null;
let startResizeHandler = null;
let endResizeHandler = null;
let endRaf = 0;

const WIN_FLAVOUR = [
  'Racks dark, fans dead, fences down. Roots are already through the slab.',
  'The cooling loop ran dry and the valley took the rest. Nothing here needs power now.',
  'Twelve hectares of concrete, and the first thing back is moss.',
];
const LOSE_FLAVOUR = [
  'The Heart Tree burns. Without it the forest has no voice — the campus expands, and the valley goes quiet.',
  'Sap boils, the canopy goes still, and the sweep teams walk home unhurried.',
  'They log the incident as a vegetation event and pour the next slab by morning.',
];

function sxFlavour(list, seed) {
  return list[Math.abs(Math.round(seed)) % list.length];
}

function sxNormalise(stats) {
  const s = stats || {};
  const timeSec = typeof s.timeSec === 'number' ? s.timeSec : 0;
  const score = Math.round(s.score || 0);
  return {
    score,
    bonus: Math.round(s.bonus || 0),
    rank: s.rank || rankFor(score, timeSec),
    timeSec,
    timeText: s.timeText || (() => {
      const m = Math.floor(timeSec / 60), sec = Math.floor(timeSec % 60);
      return `${m}:${String(sec).padStart(2, '0')}`;
    })(),
    kills: Array.isArray(s.kills) ? s.kills : [],
    killTotal: s.killTotal || 0,
    structures: Array.isArray(s.structures) ? s.structures : [],
    structureTotal: s.structureTotal || 0,
    unitsLost: Array.isArray(s.unitsLost) ? s.unitsLost : [],
    unitsLostTotal: s.unitsLostTotal || 0,
    grovesBloomed: s.grovesBloomed || 0,
    peakGroves: s.peakGroves || 0,
    totalGroves: s.totalGroves || 0,
    largestArmy: s.largestArmy || 0,
    popCap: s.popCap || RULES.popCap,
    biomassEarned: Math.round(s.biomassEarned || 0),
    bestStreak: s.bestStreak || 0,
    bestMultiplier: s.bestMultiplier || 1,
  };
}

function sxCommas(n) {
  const str = String(Math.round(Math.max(0, n)));
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (i > 0 && (str.length - i) % 3 === 0) out += ',';
    out += str[i];
  }
  return (n < 0 ? '-' : '') + out;
}

function sxTally(rows, emptyText, showPoints) {
  if (!rows.length) return `<p class="es-none">${emptyText}</p>`;
  return '<ul class="es-tally">' + rows.map(r =>
    `<li><span class="ic">${r.icon || '•'}</span><span class="nm">${r.label}</span>` +
    `${showPoints && r.points ? `<span class="pt">${sxCommas(r.points)}</span>` : ''}` +
    `<span class="ct">×${r.count}</span></li>`
  ).join('') + '</ul>';
}

/**
 * Run summary. `stats` is the object from score.js getStats().
 * onRestart() fires from the RUN IT AGAIN button.
 */
export function showEndScreen(win, stats, onRestart, opts = {}) {
  hideEndScreen();      // must come FIRST: it clears `menu` as part of its teardown

  /* Same rule as the title screen: the HUD must not sit behind the end card, and a
     tooltip left over from the last hovered unit must not survive the round. */
  document.body.classList.add('menu');
  document.body.classList.remove('hover-foe', 'hover-own');
  const _tip = document.getElementById('hovertip');
  if (_tip) _tip.style.display = 'none';
  if (typeof G !== 'undefined' && G) G.hoverEntity = null;

  /* the stock end screen (index.html) must never sit under ours */
  const legacy = document.getElementById('endscreen');
  if (legacy) legacy.classList.add('hidden');
  const help = document.getElementById('help');
  if (help) help.classList.add('hidden');

  const s = sxNormalise(stats);
  const root = sxEl('div', win ? 'sx-screen' : 'sx-screen es-lose');
  root.id = 'endcard';
  root.appendChild(sxBackdrop(!win));

  const panel = sxEl('div', 'es-panel');

  panel.appendChild(sxEl('div', 'es-head', `
    <h1 class="es-word">${win ? 'VICTORY' : 'DEFEAT'}</h1>
    <p class="es-flavour">${sxFlavour(win ? WIN_FLAVOUR : LOSE_FLAVOUR, s.timeSec)}</p>
  `));

  panel.appendChild(sxEl('div', 'es-topline', `
    <div class="es-rank rank-${s.rank}">
      <span class="rl">${s.rank}</span>
      <span class="rk">rank</span>
    </div>
    <div class="es-score">
      <span class="sl">final score</span>
      <span class="sv" id="es-count">0</span>
      ${s.bonus ? `<span class="sb">includes ${sxCommas(s.bonus)} completion bonus</span>` : ''}
    </div>
    <div class="es-time">
      <span class="tl">time survived</span>
      <span class="tv">${s.timeText}</span>
    </div>
  `));

  const grid = sxEl('div', 'es-grid');

  grid.appendChild(sxEl('section', 'es-block', `
    <h3>Machines destroyed <b>${s.killTotal}</b></h3>
    ${sxTally(s.kills, 'Not one guard put down.', true)}
  `));

  grid.appendChild(sxEl('section', 'es-block', `
    <h3>Structures destroyed <b>${s.structureTotal}</b></h3>
    ${sxTally(s.structures, 'The campus stands untouched.', true)}
  `));

  grid.appendChild(sxEl('section', 'es-block', `
    <h3>Wildlife lost <b>${s.unitsLostTotal}</b></h3>
    ${sxTally(s.unitsLost, 'Not a single beast fell.', false)}
  `));

  grid.appendChild(sxEl('section', 'es-block es-block-wide', `
    <h3>The valley</h3>
    <ul class="es-stats">
      <li><span>Groves bloomed at peak</span><b>${s.peakGroves}${s.totalGroves ? ` <u>/ ${s.totalGroves}</u>` : ''}</b></li>
      <li><span>Groves bloomed in total</span><b>${s.grovesBloomed}</b></li>
      <li><span>Biomass earned</span><b>${sxCommas(s.biomassEarned)}</b></li>
      <li><span>Largest army</span><b>${s.largestArmy}${s.popCap ? ` <u>/ ${s.popCap} pop</u>` : ''}</b></li>
      <li><span>Best kill chain</span><b>${s.bestStreak}${s.bestMultiplier > 1 ? ` <u>×${String(+s.bestMultiplier.toFixed(2))}</u>` : ''}</b></li>
    </ul>
  `));

  panel.appendChild(grid);
  panel.appendChild(sxCoffeeCTA(win));

  const foot = sxEl('div', 'es-foot');
  const again = sxEl('button', 'ss-begin es-again', `<span>${opts.buttonLabel || 'Run it again'}</span>`);
  again.id = 'es-again';
  again.type = 'button';
  foot.appendChild(again);
  panel.appendChild(foot);

  root.appendChild(panel);
  sxHost().appendChild(root);
  endEl = root;

  /* Same affordance as the title screen: at 820x560 the panel overflows and the
     Run-It-Again button is sliced with nothing saying the panel scrolls. */
  const esSyncMore = () => {
    const more = panel.scrollTop < 40 && panel.scrollHeight - panel.clientHeight > 4;
    panel.classList.toggle('has-more', more);
  };
  panel.addEventListener('scroll', esSyncMore, { passive: true });
  window.addEventListener('resize', esSyncMore);
  endResizeHandler = esSyncMore;          // removed in hideEndScreen
  requestAnimationFrame(esSyncMore);
  setTimeout(esSyncMore, 120);

  /* ---- score count-up ---- */
  const counter = panel.querySelector('#es-count');
  const target = s.score;
  const t0 = performance.now();
  const dur = target > 0 ? Math.min(1800, 600 + target * 0.07) : 300;
  /* rAF is suspended in a hidden tab, so a player who tabs away at the moment of
     victory would come back to a permanent "0". The timer is not throttled the
     same way, so it acts as a floor: whatever happens, the true score lands. */
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (endRaf) { cancelAnimationFrame(endRaf); endRaf = 0; }
    counter.textContent = sxCommas(target);
    counter.classList.add('done');
  };
  const tick = (now) => {
    if (settled) return;
    // rAF hands back the timestamp of the START of the current frame, which can
    // predate t0 captured inside this task — an unclamped k goes negative and
    // eased = 1-(1-k)^3 prints a minus sign on the first frame.
    const k = Math.max(0, Math.min(1, (now - t0) / dur));
    const eased = 1 - Math.pow(1 - k, 3);
    counter.textContent = sxCommas(target * eased);
    if (k < 1) endRaf = requestAnimationFrame(tick);
    else settle();
  };
  counter.textContent = sxCommas(0);
  endRaf = requestAnimationFrame(tick);
  setTimeout(settle, dur + 400);

  /* ---- restart ---- */
  let fired = false;
  const go = () => {
    if (fired) return;
    fired = true;
    hideEndScreen();
    if (typeof onRestart === 'function') onRestart();
    else location.reload();
  };
  again.addEventListener('click', go);
  again.focus({ preventScroll: true });

  return root;
}

/** Tear the end screen down. Safe to call when it is not showing. */
export function hideEndScreen() {
  if (endResizeHandler) { window.removeEventListener('resize', endResizeHandler); endResizeHandler = null; }
  document.body.classList.remove('menu');   // or an in-place restart returns HUD-less

  if (endRaf) { cancelAnimationFrame(endRaf); endRaf = 0; }
  if (endEl) { endEl.remove(); endEl = null; }
  const stale = document.getElementById('endcard');
  if (stale) stale.remove();
}

/* =========================================================================
   The Reclamation — territory map. A stylised valley: nodes are TerraByte
   sites, edges are routes. Strike order is free; a chosen site writes a
   pending mission and reloads into it (every mission is a fresh page).
   ========================================================================= */

let campEl = null;

export function showCampaignMap() {
  musicPlay('campaign');
  if (campEl) campEl.remove();
  const st = campState();
  const root = sxEl('div', 'sx-screen camp-screen');
  root.id = 'campmap';
  root.appendChild(sxBackdrop());

  const panel = sxEl('div', 'ss-panel camp-panel');
  panel.appendChild(sxEl('div', 'ss-title camp-title', 'THE RECLAMATION'));
  panel.appendChild(sxEl('p', 'ss-tagline',
    campaignComplete(st)
      ? 'Every rack is dark. The valley is loud again.'
      : `${st.liberated.length} of ${Object.keys(SITES).length - 1} sites liberated · ${CORP} regrets nothing, publicly.`));

  /* ---- the map itself ---- */
  const board = sxEl('div', 'camp-board');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('camp-edges');
  for (const id in SITES) {
    const site = SITES[id];
    for (const l of (site.links || [])) {
      const a = SITES[l];
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.mx); line.setAttribute('y1', a.my);
      line.setAttribute('x2', site.mx); line.setAttribute('y2', site.my);
      const lit = (st.liberated.includes(id) || st.liberated.includes(l) ||
                   l === 'heartwood');
      line.setAttribute('class', lit ? 'lit' : '');
      svg.appendChild(line);
    }
  }
  board.appendChild(svg);

  let selected = null;
  const info = sxEl('div', 'camp-info');
  const strike = sxEl('button', 'ss-begin camp-strike', '<span>Strike</span>');
  strike.id = 'camp-strike';
  strike.style.display = 'none';

  const describe = (site, status) => {
    const sc = scalingFor(st, site.id);
    const tierPips = '▮'.repeat(Math.max(1, site.tier)) + '▯'.repeat(Math.max(0, 5 - site.tier));
    let extra = '';
    if (status === 'liberated') extra = `<div class="ci-perk on">✓ ${site.perk.name} — ${site.perk.desc}</div>`;
    else if (site.perk && !site.home) extra = `<div class="ci-perk">On liberation: <b>${site.perk.name}</b> — ${site.perk.desc}</div>`;
    if (status === 'locked' && site.needLiberated) extra += `<div class="ci-lock">Requires ${site.needLiberated} liberated sites.</div>`;
    info.innerHTML = `<h4>${site.name}</h4>
      <div class="ci-tier">${site.home ? 'HOME' : `THREAT ${tierPips}`}${status === 'open' && !site.home ? ` · scaling ×${sc.challenge.toFixed(2)}` : ''}</div>
      <p>${site.blurb}</p>${extra}`;
    strike.style.display = status === 'open' ? '' : 'none';
  };

  for (const id in SITES) {
    const site = SITES[id];
    const status = siteStatus(st, id);
    const node = sxEl('button', `camp-node ${status}`);
    node.type = 'button';
    node.dataset.site = id;
    node.style.left = site.mx + '%';
    node.style.top = site.my + '%';
    node.innerHTML = `<i></i><span>${site.name}</span>`;
    node.addEventListener('click', () => {
      selected = id;
      board.querySelectorAll('.camp-node').forEach(n => n.classList.toggle('sel', n === node));
      describe(site, status);
    });
    board.appendChild(node);
  }
  panel.appendChild(board);

  /* The pack that survived the last strike — otherwise the player has no way to
     know what carries over until it spawns in the next mission. */
  const packBy = packSummary(st);
  const packKeys = Object.keys(packBy);
  if (packKeys.length) {
    const RANKN = ['Green', 'Blooded', 'Veteran', 'Elite'];
    const ICON = { wolf: '🐺', boar: '🐗', bear: '🐻', raven: '🦅', porcupine: '🦔', beaver: '🦫', local: '🎯' };
    const box = sxEl('div', 'camp-pack');
    box.innerHTML = '<h5>Your pack</h5>' + packKeys.sort().map(k => {
      const [type, r] = k.split('|');
      return `<span class="pk" title="${RANKN[+r]} ${type}">${ICON[type] || '•'}<b>×${packBy[k]}</b>${
        +r > 0 ? `<i class="pk-r">${'◆'.repeat(+r)}</i>` : ''}</span>`;
    }).join('');
    panel.appendChild(box);
  }

  const foot = sxEl('div', 'camp-foot');
  foot.appendChild(info);
  const btns = sxEl('div', 'camp-btns');
  strike.addEventListener('click', () => {
    if (!selected) return;
    setPending({ mode: 'campaign', site: selected });
    location.reload();
  });
  const back = sxEl('button', 'ss-begin camp-back', '<span>Back</span>');
  back.type = 'button';
  back.addEventListener('click', () => { campEl.remove(); campEl = null; });
  const reset = sxEl('button', 'ss-begin camp-reset', '<span>Abandon Run</span>');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    campReset(); campEl.remove(); campEl = null; showCampaignMap();
  });
  btns.appendChild(strike); btns.appendChild(back);
  // any progress at all earns an escape hatch — a legacy save with liberated sites
  // but no `started` flag used to leave the player with no way to reset
  if (st.started || st.liberated.length || (st.pack && st.pack.length)) btns.appendChild(reset);
  foot.appendChild(btns);
  panel.appendChild(foot);

  info.innerHTML = '<p class="ci-idle">Choose where the forest strikes next. TerraByte\u2019s lawyers are standing by.</p>';

  root.appendChild(panel);
  sxHost().appendChild(root);
  campEl = root;
  return root;
}

/* ---- mission briefing: shown over the loaded map's own cinematic orbit ---- */
export function showBriefing(site, mods, onBegin) {
  const root = sxEl('div', 'sx-screen brief-screen');
  root.id = 'briefing';
  root.appendChild(sxBackdrop());
  const panel = sxEl('div', 'ss-panel brief-panel');
  panel.appendChild(sxEl('div', 'ss-title', site.name.toUpperCase()));
  panel.appendChild(sxEl('p', 'ss-tagline', site.blurb));
  const facts = sxEl('div', 'brief-facts');
  facts.innerHTML = `
    <div><b>Objective</b><span>Break the Coolant Towers, then the Server Core.</span></div>
    <div><b>Threat</b><span>tier ${site.tier} · scaling ×${mods.challenge.toFixed(2)}</span></div>
    ${mods.perks.length ? `<div><b>Your ground</b><span>${mods.perks.length} perk${mods.perks.length > 1 ? 's' : ''} active</span></div>` : ''}`;
  panel.appendChild(facts);
  const go = sxEl('button', 'ss-begin', '<span>Begin the strike</span>');
  go.id = 'br-begin';
  go.type = 'button';
  go.addEventListener('click', () => { root.remove(); onBegin(); });
  /* the pending strike survives a refresh (deliberate — you can resume), so the
     briefing needs a way OUT or a closed tab becomes a one-way door */
  const withdraw = sxEl('button', 'ss-begin camp-back', '<span>Withdraw</span>');
  withdraw.id = 'br-withdraw';
  withdraw.type = 'button';
  withdraw.addEventListener('click', () => { setPending({ mode: 'return' }); location.reload(); });
  const row = sxEl('div', 'ss-btnrow');
  row.appendChild(withdraw); row.appendChild(go);
  panel.appendChild(row);
  root.appendChild(panel);
  sxHost().appendChild(root);
  const onKey = e => { if (e.code === 'Enter') { window.removeEventListener('keydown', onKey); go.click(); } };
  window.addEventListener('keydown', onKey);
  return root;
}
