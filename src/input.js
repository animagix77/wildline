import * as THREE from 'three';
import { G } from './state.js';
import { TEAM, DEFS, RULES, BUILDABLE } from './config.js';
import { queueUnit, cancelQueue, resetRallySpiral, deepenRoots, rootsPrice, rootsMaxed } from './world.js';
import { makeFormation } from './tactics.js';
import { terrainHeight } from './utils.js';
import { castOvergrowth, overgrowthTargets } from './ai.js';
import { ring, burst } from './combat.js';
import { toast } from './ui.js';
import { unitPortrait, UNIT_ROLES } from './unit-portraits.js';
import { SFX, initAudio, resumeAudio, toggleMute, isMuted, voiceFor, animalVoice, loadAnimalAudio, audioStats } from './audio.js';
import { shorePoint } from './water.js';

const _wv = new THREE.Vector3();   // scratch for the send-to-water order
import { musicUnlock, musicSetMuted } from './music.js';
import { WORLD, HALF } from './config.js';
import { dist2D, vw, vh } from './utils.js';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _p = new THREE.Vector3();

let canvas, rts;
let down = null;          // {x,y,button}
let dragging = false;
let lastClickAt = 0, lastClickType = null;
let lastGroupKey = { key: null, at: 0 };

export function initInput(canvasEl, rtsCam) {
  canvas = canvasEl; rts = rtsCam;

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', e => { e.preventDefault(); rts.zoom(e.deltaY); }, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => G.keys.delete(e.code));
  window.addEventListener('blur', () => { G.keys.clear(); down = null; dragging = false; hideSelBox(); pointerOnField = false; });
  window.addEventListener('keydown', () => { initAudio(); resumeAudio(); musicUnlock(); }, { once: true });
  window.addEventListener('pointerdown', () => { initAudio(); resumeAudio(); musicUnlock(); }, { once: true });

  document.addEventListener('mouseleave', () => { rts.mouse.inside = false; pointerOnField = false; });
  canvas.addEventListener('pointerleave', () => { pointerOnField = false; });
  document.addEventListener('mouseenter', () => { rts.mouse.inside = true; });

  initMinimap();
  initCards();
  initCommandPreview();
  document.querySelectorAll('[data-animal-preview]').forEach(button => {
    button.addEventListener('click', async () => {
      initAudio(); resumeAudio();
      const status = document.getElementById('animal-preview-status');
      if (isMuted()) { status.textContent = 'Sound is muted. Press M to listen.'; return; }
      status.textContent = 'Loading wildlife recordings…';
      await loadAnimalAudio();
      const type = button.dataset.animalPreview;
      const kind = document.getElementById('animal-preview-event').value;
      if (audioStats().samples.failed.some(name => name.startsWith(type + '-'))) {
        status.textContent = 'This recording could not load. Try again.'; return;
      }
      const available = animalVoice({ type, alive: true }, kind);
      status.textContent = available ? button.textContent + ' · ' + kind : 'Audio is unavailable. Try again.';
    });
  });
}

/* ------------------------------------------------------------- picking -- */
function setNDC(x, y) {
  ndc.x = (x / vw()) * 2 - 1;
  ndc.y = -(y / vh()) * 2 + 1;
  ray.setFromCamera(ndc, G.camera);
}

function entityUnder(x, y) {
  setNDC(x, y);
  const hits = ray.intersectObjects(G.entityRoot.children, true);
  for (const h of hits) {
    // three's Raycaster ignores .visible on the object AND its ancestors, so a
    // fog-hidden guard stayed selectable and its hidden health bar and selection
    // ring absorbed clicks on empty ground. Reject anything that isn't drawn.
    let o = h.object, drawn = true;
    for (let n = o; n; n = n.parent) if (n.visible === false) { drawn = false; break; }
    if (!drawn) continue;
    while (o && !o.userData.entity) o = o.parent;
    if (o && o.userData.entity && o.userData.entity.alive) return o.userData.entity;
  }
  return null;
}

function groundUnder(x, y) {
  setNDC(x, y);
  const hits = ray.intersectObject(G.terrain, false);
  if (hits.length) return hits[0].point.clone();
  // fall back to the y=0 plane if the ray misses the mesh
  const dir = ray.ray.direction, org = ray.ray.origin;
  if (Math.abs(dir.y) < 1e-4) return null;
  const t = -org.y / dir.y;
  if (t < 0) return null;
  return org.clone().addScaledVector(dir, t);
}

/* Hover readout: C&C and WC3 both tell you what is under the cursor before you
   click it, and this game's picking is dense enough that guessing is unfair. */
function updateHover(x, y) {
  const now = performance.now();
  if (now - hoverAt < 40) return;      // 25Hz is plenty and keeps the raycast cheap
  hoverAt = now;

  let ent = G.phase === 'playing' ? entityUnder(x, y) : null;
  if (ent && !ent.alive) ent = null;   // a reaped entity must not keep its tooltip alive
  const tip = document.getElementById('hovertip');
  if (!tip) return;

  const changed = ent !== G.hoverEntity;
  G.hoverEntity = ent;

  if (!ent) {
    if (changed) {
      tip.style.display = 'none';
      document.body.classList.remove('hover-foe', 'hover-own');
    }
    return;
  }

  if (changed) {
    document.body.classList.toggle('hover-foe', ent.team === TEAM.MACHINE);
    document.body.classList.toggle('hover-own', ent.team === TEAM.WILD);
    tip.className = ent.team === TEAM.MACHINE ? 'foe' : ent.team === TEAM.WILD ? 'own' : 'neutral';
    tip.innerHTML = `<b></b><span></span>`;
    tip.firstChild.textContent = ent.def.name;
    tip.style.display = 'flex';
  }
  /* Recompute on every qualifying pointer move; syncHoverTip() refreshes it from
     the HUD tick so a stationary cursor still tracks a unit's health. Short-circuiting
     on `ent === hoverEntity` froze the number at whatever it was when the pointer
     arrived, so a unit that was actually under fire always read 100%.
     A fog-remembered structure shows no number at all: fog.js deliberately hides
     its health bar so a ghost cannot leak its current hit points, and the tooltip
     must honour the same rule. */
  const ghost = !!ent.ghost;
  tip.lastChild.textContent = ghost ? 'last known'
    : Math.max(0, Math.round(ent.hp / ent.maxHp * 100)) + '%';
  positionTip(x, y);
}

/* combat.js clears G.hoverEntity when the hovered entity dies; the HUD tick calls
   this so the tooltip disappears without waiting for the next pointer move. */
export function syncHoverTip() {
  /* updateHover only runs on mousemove, so a parked cursor watching a unit melt
     would never see the number change. The HUD tick refreshes it in place. */
  const ent = G.hoverEntity;
  if (ent) {
    if (!ent.alive) { G.hoverEntity = null; }
    else {
      const tip = document.getElementById('hovertip');
      if (tip && tip.lastChild) {
        tip.lastChild.textContent = ent.ghost ? 'last known'
          : Math.max(0, Math.round(ent.hp / ent.maxHp * 100)) + '%';
      }
      return;
    }
  }
  const tip = document.getElementById('hovertip');
  if (tip && tip.style.display !== 'none') tip.style.display = 'none';
  if (document.body.classList.contains('hover-foe') || document.body.classList.contains('hover-own'))
    document.body.classList.remove('hover-foe', 'hover-own');
}
function positionTip(x, y) {
  const tip = document.getElementById('hovertip');
  if (!tip || tip.style.display === 'none') return;
  tip.style.left = Math.min(x + 16, vw() - 190) + 'px';
  tip.style.top = Math.max(8, y - 34) + 'px';
}

/* ------------------------------------------------------------- pointer -- */
function onDown(e) {
  if (G.over || G.phase !== 'playing') return;
  /* Middle-drag still pans while paused — surveying the board is the whole
     reason to pause — but nothing that changes the game state gets through. */
  if (e.button === 1) { down = { x: e.clientX, y: e.clientY, button: 1 }; e.preventDefault(); return; }
  if (G.paused) return;
  down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
  dragging = false;
}

let hoverAt = 0;

function onMove(e) {
  pointerOnField = e.target === canvas;
  pointerX = e.clientX; pointerY = e.clientY;
  rts.mouse.x = e.clientX; rts.mouse.y = e.clientY;
  rts.mouse.inside = true;
  if (!down) {
    updateHover(e.clientX, e.clientY);
    return;
  }
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (down.button === 1) {
    const f = new THREE.Vector3(), r = new THREE.Vector3();
    rts.forward(f).multiplyScalar(dy * rts.dist * 0.0016);
    rts.right(r).multiplyScalar(-dx * rts.dist * 0.0016);
    rts.target.add(f).add(r);
    rts.goal = null;
    down.x = e.clientX; down.y = e.clientY;
    return;
  }
  if (down.button === 0 && G.mode === 'normal') {
    if (!dragging && Math.hypot(dx, dy) > 6) dragging = true;
    if (dragging) drawSelBox(down.x, down.y, e.clientX, e.clientY);
  }
}

function onUp(e) {
  if (!down) return;
  const d = down; down = null;
  hideSelBox();
  if (G.over || G.paused || G.phase !== 'playing') return;
  if (d.button === 1) return;

  if (d.button === 0) {
    if (G.mode === 'attack') { issueAt(e.clientX, e.clientY, true); setMode('normal'); return; }
    if (G.mode === 'spell') { castAt(e.clientX, e.clientY); setMode('normal'); return; }
    if (dragging) { boxSelect(d.x, d.y, e.clientX, e.clientY, e.shiftKey); dragging = false; return; }
    clickSelect(e.clientX, e.clientY, e.shiftKey, e.ctrlKey || e.metaKey);
    return;
  }
  if (d.button === 2) {
    if (G.mode !== 'normal') { setMode('normal'); return; }
    issueAt(e.clientX, e.clientY, false);
  }
}

/* ----------------------------------------------------------- selection -- */
function setSelection(list) {
  for (const e of G.selection) e.selected = false;
  G.selection = list;
  for (const e of G.selection) e.selected = true;
}

function clickSelect(x, y, additive, screenOnly) {
  const ent = entityUnder(x, y);
  const now = performance.now();
  if (!ent) { if (!additive) setSelection([]); return; }

  /* Double-click grabs the whole species, not just what is on screen —
     on-screen-only silently left half the pack behind at 96 pop. Ctrl+double
     restores the narrow behaviour when you do want just what you can see.

     MATCHED ON TYPE, NOT ON IDENTITY, and that is the whole fix. The test used
     to be `ent === lastClickEnt`: the exact same animal had to be under the
     cursor both times. Animals move. A wolf travelling at 10.5 units/second
     clears its own 0.6-unit radius in about 60ms, so across a 340ms window the
     second click almost always landed on a different wolf — or on the grass
     where that wolf used to be — and the feature quietly did nothing in the one
     situation anybody wants it in, which is a pack on the move. Reported as
     missing rather than broken, which is exactly how it would feel.

     Window widened to 450ms too; 340 was well under the ~500ms most systems
     use, so even a stationary target needed an unusually brisk double-click. */
  if (lastClickType && ent.type === lastClickType && now - lastClickAt < 450 && !ent.isBuilding) {
    const same = G.entities.filter(o => o.alive && o.team === TEAM.WILD
      && o.type === ent.type && (screenOnly ? onScreen(o) : true));
    setSelection(same);
    if (!voiceFor(G.selection, 'select')) SFX.select();
    lastClickType = null;
    return;
  }
  lastClickType = ent.isBuilding ? null : ent.type; lastClickAt = now;

  if (additive && ent.team === TEAM.WILD) {
    const i = G.selection.indexOf(ent);
    if (i >= 0) { ent.selected = false; G.selection.splice(i, 1); }
    else { ent.selected = true; G.selection.push(ent); }
  } else {
    setSelection([ent]);
  }
  if (!voiceFor(G.selection, 'select')) SFX.select();
}

function onScreen(e) {
  _p.copy(e.pos).project(G.camera);
  return _p.x > -1 && _p.x < 1 && _p.y > -1 && _p.y < 1 && _p.z < 1;
}

function boxSelect(x0, y0, x1, y1, additive) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const found = [];
  for (const e of G.entities) {
    if (!e.alive || e.team !== TEAM.WILD || e.isBuilding) continue;
    _p.copy(e.pos); _p.y += 1;
    _p.project(G.camera);
    if (_p.z > 1) continue;
    const sx = (_p.x * 0.5 + 0.5) * vw();
    const sy = (-_p.y * 0.5 + 0.5) * vh();
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) found.push(e);
  }
  if (!found.length) { if (!additive) setSelection([]); return; }
  if (additive) {
    const set = new Set(G.selection);
    for (const f of found) set.add(f);
    setSelection([...set]);
  } else setSelection(found);
  if (!voiceFor(G.selection, 'select')) SFX.select();
}

function drawSelBox(x0, y0, x1, y1) {
  const el = document.getElementById('selbox');
  el.style.display = 'block';
  el.style.left = Math.min(x0, x1) + 'px';
  el.style.top = Math.min(y0, y1) + 'px';
  el.style.width = Math.abs(x1 - x0) + 'px';
  el.style.height = Math.abs(y1 - y0) + 'px';
}
function hideSelBox() { document.getElementById('selbox').style.display = 'none'; }

/* -------------------------------------------------------------- orders -- */
function commandable() {
  return G.selection.filter(e => e.alive && e.team === TEAM.WILD && !e.isBuilding);
}

function issueAt(x, y, attackMove) {
  const sel = commandable();
  const heartSelected = G.selection.some(e => e.type === 'hearttree');
  const ent = entityUnder(x, y);
  const pt = groundUnder(x, y);

  if (heartSelected && !sel.length && pt) {
    G.rally.copy(pt);
    resetRallySpiral();
    ring(pt, 0x9bff6a, 3.2, 0.7);
    toast('Rally point set');
    SFX.order(); voiceFor(commandable(), 'order');
    return;
  }
  if (!sel.length) return;

  if (ent && ent.team === TEAM.MACHINE) {
    if (ent.type === 'core' && !G.coreExposed) {
      toast('The Server Core is shielded — break the Coolant Towers first', 'warn');
      SFX.deny();
      return;
    }
    for (const e of sel) e.setOrder('attack', null, ent);
    ring(ent.pos, 0xff6a3d, ent.radius * 2 + 1.5, 0.7);
    SFX.attackOrder(); voiceFor(commandable(), 'order');
    return;
  }
  if (!pt) return;

  const formation = makeFormation(sel, pt);
  sel.forEach((e, i) => e.setOrder(attackMove ? 'attackmove' : 'move', formation[i]));
  ring(pt, attackMove ? 0xffc85c : 0x9bff6a, 2.6, 0.6);
  burst(pt, attackMove ? 0xffc85c : 0x9bff6a, 5, 5, 0.4, 0.35);
  (attackMove ? SFX.attackOrder : SFX.order)(); voiceFor(commandable(), 'order');
}


function castAt(x, y) {
  const pt = groundUnder(x, y);
  if (!pt) return;
  if (G.time < G.spellReady) { SFX.deny(); return; }
  if (G.biomass < RULES.spellCost) { toast('Not enough biomass for Overgrowth', 'warn'); SFX.deny(); return; }
  G.biomass -= RULES.spellCost;
  G.spellReady = G.time + RULES.spellCooldown;
  const n = castOvergrowth(pt);
  ring(pt, 0x9bff6a, RULES.spellRadius, 1.2);
  burst(pt, 0x6ad06a, 40, 14, 1.3, 1.1);
  SFX.spell();
  /* Say what it caught. "3 machines rooted" hid the important half — a cast
     that silences two turrets is a completely different play from one that
     pins three guards, and the player has to be able to tell them apart. */
  const bits = [];
  if (n.rooted) bits.push(`${n.rooted} machine${n.rooted === 1 ? '' : 's'} rooted`);
  if (n.guns) bits.push(`${n.guns} gun${n.guns === 1 ? '' : 's'} smothered`);
  toast(bits.length ? `Overgrowth — ${bits.join(', ')}` : 'Overgrowth — nothing caught in it');
}

/* Tell the player *before* they pick a target that the cast will not happen. */
function enterSpellMode() {
  if (G.phase !== 'playing' || G.paused || G.over) return;
  if (G.time < G.spellReady) {
    toast(`Overgrowth recovering — ${Math.ceil(G.spellReady - G.time)}s`, 'warn');
    SFX.deny(); return;
  }
  if (G.biomass < RULES.spellCost) {
    toast(`Overgrowth needs ${RULES.spellCost} biomass`, 'warn');
    SFX.deny(); return;
  }
  setMode('spell');
}

export function setMode(m) {
  G.mode = m;
  document.body.classList.toggle('mode-attack', m === 'attack');
  document.body.classList.toggle('mode-spell', m === 'spell');
}

/* ----------------------------------------------------------- keyboard -- */
function onKey(e) {
  if (e.target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable)) return;
  if (e.code === 'Space' && e.target.closest?.('button, summary, a')) return;
  G.keys.add(e.code);
  // a held key repeats ~30x/second; without this one keypress queued 8 units
  if (e.repeat) return;

  if (e.code === 'F1') { e.preventDefault(); if (!G.over) toggleHelp(); return; }
  if (e.code === 'Escape') {
    if (pausedByPlayer) return setPaused(false);
    if (!document.getElementById('help').classList.contains('hidden')) return toggleHelp();
    if (G.mode !== 'normal') return setMode('normal');
    /* Escape cancels whatever is outstanding; with nothing left to cancel it
       means "get me out", which in a game is pause. */
    if (G.selection.length) return setSelection([]);
    togglePause();
    return;
  }
  if (e.code === 'KeyP') { e.preventDefault(); togglePause(); return; }
  if (e.code === 'KeyM') { syncMuteButton(toggleMute()); return; }
  if (G.phase !== 'playing' || G.over || G.paused) return;
  if (e.code === 'Backquote') {          // ` — the whole swarm, wherever it is
    e.preventDefault();
    setSelection(G.entities.filter(o => o.alive && o.team === TEAM.WILD && !o.isBuilding));
    if (!voiceFor(G.selection, 'select')) SFX.select();
    return;
  }


  switch (e.code) {
    case 'KeyA': if (commandable().length) setMode('attack'); return;
    case 'KeyF': enterSpellMode(); return;
    case 'KeyS': stanceOrder('stop'); return;
    case 'KeyW': sendToWater(); return;
    case 'KeyH': stanceOrder('hold'); return;
    case 'Space': e.preventDefault(); if (G.heart) rts.focus(G.heart.pos); return;
    case 'KeyZ': queueUnit('wolf'); return;
    case 'KeyX': queueUnit('boar'); return;
    case 'KeyC': queueUnit('bear'); return;
    case 'KeyV': queueUnit('raven'); return;
    case 'KeyG': queueUnit('porcupine'); return;
    case 'KeyR': queueUnit('capybara'); return;
    case 'KeyN': queueUnit('beaver'); return;
    case 'KeyB': queueUnit('local'); return;
    case 'KeyT': deepenRoots(); return;
  }

  const m = /^Digit([1-5])$/.exec(e.code);
  if (m) {
    // Ctrl/Cmd+1..5 switches browser tabs unless we claim it
    e.preventDefault();
    const k = m[1];
    if (e.ctrlKey || e.metaKey) {
      G.groups[k] = commandable().slice();
      toast(`Group ${k} set — ${G.groups[k].length} beasts`);
    } else if (e.shiftKey) {
      /* Grow a group instead of rebuilding it. Without append you cannot
         reinforce a control group, which at 96 pop is most of army handling. */
      const cur = (G.groups[k] || []).filter(u => u.alive);
      G.groups[k] = [...new Set([...cur, ...commandable()])];
      toast(`Group ${k} — ${G.groups[k].length} beasts`);
    } else {
      const g = (G.groups[k] || []).filter(u => u.alive);
      if (!g.length) return;
      setSelection(g);
      const now = performance.now();
      if (lastGroupKey.key === k && now - lastGroupKey.at < 400) rts.focus(g[0].pos);
      lastGroupKey = { key: k, at: now };
      if (!voiceFor(G.selection, 'select')) SFX.select();
    }
  }
}

function stanceOrder(type) {
  const units = commandable();
  if (!units.length) return;
  for (const u of units) u.setOrder(type);
  setMode('normal');
  SFX.holdOrder();
  toast(type === 'hold' ? 'Holding position — defend without chasing' : 'Orders cleared');
}

function sendToWater() {
  const sel = commandable();
  if (!sel.length) { SFX.deny(); return; }
  let sent = 0;
  for (const u of sel) {
    const p = shorePoint(u.pos.x, u.pos.z, _wv);
    if (p) { u._wantsDrink = true; u.setOrder('move', p.clone()); sent++; }
  }
  setMode('normal');
  if (sent) { SFX.order(); voiceFor(sel, 'order'); toast(`${sent} sent to drink`); }
  else { SFX.deny(); toast('No water left to drink', 'warn'); }
}

function syncMuteButton(off) {
  musicSetMuted(off);           // one M key silences the synth and the score alike
  const mb = document.getElementById('mutebtn');
  if (mb) { mb.classList.toggle('off', off); mb.title = off ? 'Unmute audio (M)' : 'Mute audio (M)'; mb.setAttribute('aria-label', mb.title); mb.setAttribute('aria-pressed', String(off)); }
}

/* Pause has two independent sources — the player asking for it, and the help
   panel, which has always frozen the game while it is open. Keeping them apart
   and OR-ing them means closing help cannot un-pause a game the player
   deliberately paused, which is exactly the bug a single shared flag causes. */
let pausedByPlayer = false;

function syncPaused() {
  const helpOpen = !document.getElementById('help').classList.contains('hidden');
  G.paused = pausedByPlayer || helpOpen;
  const pz = document.getElementById('pause');
  if (pz) pz.classList.toggle('hidden', !pausedByPlayer);
  const pb = document.getElementById('pausebtn');
  if (pb) { pb.classList.toggle('on', pausedByPlayer); pb.textContent = pausedByPlayer ? '▶' : '❚❚'; }
  document.body.classList.toggle('paused', !!G.paused);
  if (pausedByPlayer) fillPauseCard();
}

export function setPaused(on) {
  /* Nothing to pause before the match starts or after it ends, and pausing the
     end card would trap the player behind an overlay with no game under it. */
  if (G.phase !== 'playing' || G.over) { if (!on) { pausedByPlayer = false; syncPaused(); } return; }
  pausedByPlayer = !!on;
  syncPaused();
}
export function togglePause() { setPaused(!pausedByPlayer); }
export function isPaused() { return pausedByPlayer; }

/* A pause is the one moment the player is actually reading the screen, so tell
   them where the run stands rather than showing a bare word. */
function fillPauseCard() {
  const el = document.getElementById('pzstats');
  if (!el) return;
  const mins = Math.floor(G.time / 60), secs = Math.floor(G.time % 60);
  const towers = G.coolants ? G.coolants.filter(c => c.alive && !c.downed).length : 0;
  el.innerHTML = `
    <div><b>${mins}:${String(secs).padStart(2, '0')}</b><span>elapsed</span></div>
    <div><b>${G.pop}<i>/${G.popCap}</i></b><span>wildlife</span></div>
    <div><b>${G.bloomed || 0}<i>/${G.groves.length}</i></b><span>groves</span></div>
    <div><b>${towers}</b><span>towers cooling</span></div>`;
}

function toggleHelp() {
  const h = document.getElementById('help');
  h.classList.toggle('hidden');
  syncPaused();
}

/* ----------------------------------------------------------- minimap --- */
function initMinimap() {
  const mm = document.getElementById('minimap');
  let mdown = false;
  const jump = ev => {
    const r = mm.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * WORLD - HALF;
    const z = ((ev.clientY - r.top) / r.height) * WORLD - HALF;
    rts.focus({ x, z }, true);
  };
  mm.addEventListener('pointerdown', e => { mdown = true; jump(e); });
  window.addEventListener('pointerup', () => { mdown = false; });
  mm.addEventListener('pointermove', e => { if (mdown) jump(e); });
}

/* ------------------------------------------------------- command cards -- */
function initCards() {
  const host = document.getElementById('cards');
  host.innerHTML = '';
  for (const type of BUILDABLE) {
    const d = DEFS[type];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'card';
    el.dataset.type = type;
    /* Population is the constraint that decides the late game — a Bear is four
       Wolves you are not fielding — and it appeared nowhere in the UI.

       Neither did the siege multiplier, which is the single biggest hidden
       decision in the game: the win condition is a pile of armoured buildings,
       and only three of the eight buildables hit them harder than they hit
       flesh. A player could field a perfectly good army that was quietly bad at
       the only thing that ends the match. Both numbers now sit on the card. */
    const siege = d.siege || 1;
    el.innerHTML = `<span class="key">${d.key}</span><span class="ico">${unitPortrait(type, d.icon)}</span>
      <span class="nm">${d.name}</span>
      <span class="unit-role">${UNIT_ROLES[type]}</span>
      <span class="cost"><svg class="cost-glyph" aria-hidden="true"><use href="#i-leaf"/></svg>${d.cost}<i class="pop">${d.pop || 1} pop</i>`
      + (siege > 1 ? `<i class="siege" title="damage vs structures">×${siege}</i>` : '')
      + `</span>`;
    /* Structure DPS against the Server Core (armour 8) — the number that
       actually decides whether a composition can finish the game. Flat armour is
       why the multiplier alone understates the gap: it is the difference
       between "slow" and "you will be here all night". */
    const vsCore = (Math.max(1, d.dmg * siege - DEFS.core.armor) / d.rate).toFixed(1);
    el.title = `${d.name} — ${d.blurb}\n${d.hp} hp · ${d.dmg} dmg · ${d.pop || 1} pop · ${d.build}s`
      + `\nvs structures ×${siege} · ${vsCore} dps into the Server Core`;
    /* Shift-click queues five. Filling a 96-pop army one press at a time is
       not a decision, it is typing. */
    el.addEventListener('click', ev => {
      if (G.phase !== 'playing' || G.paused || G.over) return;
      const n = ev.shiftKey ? 5 : 1;
      for (let i = 0; i < n; i++) if (!queueUnit(type)) break;
    });
    el.setAttribute('aria-label', `${d.name}, ${d.cost} biomass, ${d.pop || 1} population. ${d.blurb}`);
    host.appendChild(el);
  }
  /* Deepen the Roots — the late game's second thing to buy. Sits at the end of
     the roster because that is where the eye lands once every unit is greyed out
     by the pop cap, which is exactly the moment it is for. */
  const rt = document.createElement('button');
  rt.type = 'button';
  rt.className = 'card roots';
  rt.id = 'rootscard';
  rt.innerHTML = `<span class="key">T</span><span class="ico">🌳</span>
    <span class="nm">Deepen Roots</span><span class="unit-role">Expand capacity</span><span class="cost"><svg class="cost-glyph" aria-hidden="true"><use href="#i-leaf"/></svg><b class="rcost">${rootsPrice()}</b></span>`;
  rt.title = `Raise the wildlife limit by ${RULES.rootsStep}. Each one costs more than the last.`;
  rt.addEventListener('click', () => { if (G.phase === 'playing' && !G.paused && !G.over) { deepenRoots(); refreshRootsCard(); } });
  host.appendChild(rt);

  const sp = document.createElement('button');
  sp.type = 'button';
  sp.className = 'card spell';
  sp.id = 'spellcard';
  sp.innerHTML = `<span class="key">F</span><span class="ico">🌿</span>
    <span class="nm">Overgrowth</span><span class="unit-role">Root &amp; suppress</span><span class="cost"><svg class="cost-glyph" aria-hidden="true"><use href="#i-leaf"/></svg>${RULES.spellCost}</span>
    <div class="cd" style="display:none"></div>`;
  sp.title = `Roots erupt in a ${RULES.spellRadius}m circle for ${RULES.spellDuration}s: machines are held in place, and any Sentry Turret caught in it goes dark.`;
  sp.addEventListener('click', enterSpellMode);
  host.appendChild(sp);

  const mb = document.getElementById('mutebtn');
  mb.addEventListener('click', () => syncMuteButton(toggleMute()));
  syncMuteButton(isMuted());
  document.getElementById('helpbtn').addEventListener('click', toggleHelp);
  const pb = document.getElementById('pausebtn');
  if (pb) pb.addEventListener('click', () => togglePause());
  const pr = document.getElementById('pz-resume');
  if (pr) pr.addEventListener('click', () => setPaused(false));
  const ph = document.getElementById('pz-help');
  if (ph) ph.addEventListener('click', () => { setPaused(false); toggleHelp(); });
  document.getElementById('helpclose').addEventListener('click', toggleHelp);
  document.getElementById('queue').addEventListener('click', ev => {
    if (G.phase !== 'playing' || G.paused || G.over) return;
    const i = ev.target.closest('.qitem');
    if (i) cancelQueue(+i.dataset.i);
  });
}

/* The price climbs, so the card has to say so. Called from the HUD tick as well
   as the click handler, because the hotkey buys without going through the card. */
export function refreshRootsCard() {
  const rt = document.getElementById('rootscard');
  if (!rt) return;
  const b = rt.querySelector('.rcost');
  if (!b) return;
  const maxed = rootsMaxed();
  const txt = maxed ? '—' : String(rootsPrice());
  if (b.textContent !== txt) b.textContent = txt;
  rt.classList.toggle('maxed', maxed);
}

export { setSelection };


/* Terrain-following targeting disc. Its footprint uses the exact same radius
   and target predicate as the spell. Hidden enemies never enter the readout. */
let commandDisc = null, commandDiscRest = null, commandHint = null;
let commandStrip = null, commandButtons = [];
let pointerOnField = false, pointerX = 0, pointerY = 0, previewAt = -Infinity;
function initCommandPreview() {
  const geo = new THREE.RingGeometry(0, 1, 64, 4);
  geo.rotateX(-Math.PI / 2);
  commandDiscRest = geo.attributes.position.array.slice();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCommandColor: { value: new THREE.Color(0x9bff6a) } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vCommandUV; void main(){vCommandUV=uv;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 uCommandColor; varying vec2 vCommandUV;
      void main(){vec2 p=(vCommandUV-.5)*2.;float r=length(p);
      float edge=smoothstep(.955,.978,r)*(1.-smoothstep(.99,1.,r));
      float inner=smoothstep(.02,.12,r)*(1.-smoothstep(.78,.95,r))*.045;
      float ticks=step(.88,r)*step(.92,cos(atan(p.y,p.x)*24.))*.28;
      gl_FragColor=vec4(uCommandColor,edge*.8+inner+ticks);}`,
  });
  commandDisc = new THREE.Mesh(geo, mat);
  commandDisc.frustumCulled = false;
  commandDisc.renderOrder = 6;
  commandDisc.raycast = () => {};
  commandDisc.visible = false;
  G.scene.add(commandDisc);
  commandHint = document.getElementById('commandhint');
  commandStrip = document.getElementById('commands');
  commandButtons = [...commandStrip.querySelectorAll('button')];
  commandStrip.addEventListener('click', ev => {
    const btn = ev.target.closest('button[data-command]');
    if (!btn || G.phase !== 'playing' || G.paused || G.over) return;
    const cmd = btn.dataset.command;
    if (cmd === 'all') { setSelection(G.entities.filter(u => u.alive && u.team === TEAM.WILD && !u.isBuilding)); if (!voiceFor(G.selection, 'select')) SFX.select(); }
    else if (cmd === 'attack') { if (commandable().length) setMode('attack'); }
    else if (cmd === 'water') sendToWater();
    else if (cmd === 'spell') enterSpellMode();
    else stanceOrder(cmd);
  });
}

export function updateCommandPreview() {
  if (!commandDisc) return;
  const active = G.phase === 'playing' && !G.over && !G.paused;
  commandStrip.classList.toggle('hidden', !active);
  const spell = G.mode === 'spell', attack = G.mode === 'attack';
  commandDisc.visible = active && pointerOnField && (spell || attack);
  commandHint.hidden = !active || (!spell && !attack);
  if (!active) return;
  const now = performance.now();
  if (now - previewAt < 50) return;
  previewAt = now;
  const hasUnits = commandable().length > 0;
  for (const btn of commandButtons) {
    const cmd = btn.dataset.command;
    btn.disabled = !hasUnits && !['all', 'spell'].includes(cmd);
    btn.classList.toggle('active', (cmd === 'spell' && spell) || (cmd === 'attack' && attack));
  }
  if (!spell && !attack) return;
  commandHint.textContent = spell ? 'OVERGROWTH · point to aim · right-click to cancel' : 'ATTACK MOVE · click ground · right-click to cancel';
  if (!commandDisc.visible) return;
  const point = groundUnder(pointerX, pointerY);
  if (!point) { commandDisc.visible = false; return; }
  const radius = spell ? RULES.spellRadius : 3;
  const pos = commandDisc.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = point.x + commandDiscRest[i * 3] * radius;
    const z = point.z + commandDiscRest[i * 3 + 2] * radius;
    pos.setXYZ(i, x, terrainHeight(x, z) + 0.18, z);
  }
  pos.needsUpdate = true;
  commandDisc.material.uniforms.uCommandColor.value.setHex(spell ? 0x9bff6a : 0xffc85c);
  if (spell) {
    const targets = overgrowthTargets(point, true);
    const guns = targets.filter(e => e.isBuilding).length;
    commandHint.textContent = `OVERGROWTH · ${targets.length - guns} machines / ${guns} guns in sight · ${RULES.spellCost} biomass · click to cast`;
  }
}
