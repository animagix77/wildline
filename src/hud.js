import * as THREE from 'three';
import { G } from './state.js';
import { DEFS, RULES, TEAM, WORLD, HALF, COMPOUND, BUILDABLE } from './config.js';
import { fmt, queuedPop } from './world.js';
import { waterLevel, lakeCount } from './water.js';
import { isPouring } from './weather.js';
import { setSelection, syncHoverTip } from './input.js';
import { isExplored, isVisible, isRemembered, drawFogOverlay } from './fog.js';

const el = id => document.getElementById(id);
let mmCtx, cards = null, spellCard = null;
let lastSelSig = '';

export function initHUD() {
  mmCtx = el('minimap').getContext('2d');
  cards = [...document.querySelectorAll('#cards .card[data-type]')];
  spellCard = el('spellcard');
  const pips = el('objpips');
  pips.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = document.createElement('div');
    p.className = 'pip alive';
    pips.appendChild(p);
  }
}

export function updateHUD() {
  el('biomass').textContent = Math.floor(G.biomass);
  /* Income alone never explained itself. If the pumps are costing you yield,
     say so on the number they are costing. */
  const tax = G.waterTax || 0;
  el('biorate').innerHTML = tax > 0.02
    ? `+${G.income.toFixed(1)}/s <b class="drag">-${Math.round(tax * 100)}%</b>`
    : `+${G.income.toFixed(1)}/s`;
  el('pop').innerHTML = `${G.pop}<span class="slash">/</span>${G.popCap}`;
  el('groves').innerHTML = `${G.bloomed || 0}<span class="slash">/</span>${G.groves.length}`;
  el('clock').textContent = fmt(G.time);

  /* The single most plannable number in the game, and until now the AI was the
     only thing that could see it. A game that asks the player to think ahead
     has to tell them how long they have. */
  const sw = el('sweepres');
  if (sw) {
    const left = Math.max(0, (G.nextWave || 0) - G.time);
    el('sweeptime').textContent = fmt(left);
    el('sweepsub').textContent = `sweep ${(G.waveNum || 0) + 1} · ${G.machinePop || 0} out`;   // machines standing, so the countdown has a size next to it
    sw.classList.toggle('low', left < 30);
    sw.classList.toggle('dry', left < 10);
  }

  /* Water. The pumps have always drained the lakes and quietly cut grove yield;
     until this readout existed the player had no way to see it happening, let
     alone plan around it. Now it also gates how long a drink lasts. */
  const wres = el('waterres');
  if (wres) {
    if (!lakeCount()) wres.style.display = 'none';
    else {
      wres.style.display = '';
      const lv = waterLevel();
      el('waterlvl').innerHTML = `${Math.round(lv * 100)}<span class="slash">%</span>`;
      wres.classList.toggle('low', lv < 0.45);
      wres.classList.toggle('dry', lv < 0.15);
      let n = 0;
      for (const e of G.entities) if (e.alive && e.watered > 0) n++;
      /* These used to share one slot and hide each other. Show whichever the
         player can act on, and say when the sky is helping. */
      const dammed = Math.round((G.dammed || 0) * 10) / 10;
      const bits = [];
      if (isPouring()) bits.push('raining');
      if (n) bits.push(`${n} watered`);
      if (dammed >= 0.5) bits.push(`${dammed} dammed`);
      el('watersub').textContent = bits.length ? bits.join(' · ') : 'water';
      wres.classList.toggle('rain', isPouring());
    }
  }

  /* objective */
  const left = G.coolants.filter(c => c.alive).length;
  const pips = el('objpips').children;
  for (let i = 0; i < 3; i++) pips[i].className = 'pip ' + (G.coolants[i].alive ? 'alive' : 'dead');
  pips[3].className = 'pip ' + (G.core.alive ? (G.coreExposed ? 'alive' : '') : 'dead');
  el('objtext').textContent = left > 0
    ? `Destroy the Coolant Towers (${left} left)`
    : (G.core.alive ? 'Server Core exposed — bring it down' : 'The valley is quiet again');

  /* cards */
  for (const c of cards) {
    const d = DEFS[c.dataset.type];
    const gated = G.lockedUnits && G.lockedUnits.includes(c.dataset.type);
    const afford = !gated && G.biomass >= d.cost && G.pop + queuedPop() + (d.pop || 1) <= G.popCap && G.heart.alive;
    c.classList.toggle('locked', !afford);
    c.classList.toggle('gated', !!gated);
  }
  const cd = spellCard.querySelector('.cd');
  const rem = G.spellReady - G.time;
  if (rem > 0) { cd.style.display = 'flex'; cd.textContent = Math.ceil(rem); }
  else { cd.style.display = 'none'; spellCard.classList.toggle('locked', G.biomass < RULES.spellCost); }

  /* queue — the lane count is the economy's most important number, so it is
     shown right here where the player is already looking, and the slots that
     are actively growing are visually distinct from the ones merely waiting */
  const q = el('queue');
  const lanes = G.lanes || 1;
  const sig = G.queue.map(i => i.type).join(',') + '|' + G.queue.length + '|' + lanes;
  if (q.dataset.sig !== sig) {
    q.dataset.sig = sig;
    q.innerHTML = (G.queue.length
      ? G.queue.map((i, n) => `<div class="qitem${n < lanes ? ' q-live' : ''}" data-i="${n}" title="Click to cancel">${DEFS[i.type].icon}<i></i></div>`).join('')
      : '<span class="qhint">nothing growing — pick a card above</span>')
      + `<span class="qlanes" title="Growing lanes — one per two bloomed groves, up to three">×${lanes}</span>`;
  }
  if (G.queue.length) {
    const items = q.children;
    for (let n = 0; n < G.queue.length; n++) {
      const bar = items[n] && items[n].querySelector('i');
      if (bar) bar.style.height = `${(1 - G.queue[n].remaining / G.queue[n].total) * 100}%`;
    }
  }

  updateSelectionPanel();
  syncHoverTip();
  drawMinimap();
}

/* -------------------------------------------------------- selection ---- */
function updateSelectionPanel() {
  const body = el('selbody');
  const sel = G.selection.filter(e => e.alive);
  const sig = sel.length + ':' + sel.map(e => e.id).join(',');
  const solo = sel.length === 1;

  if (sig !== lastSelSig) {
    lastSelSig = sig;
    body.classList.toggle('empty', sel.length === 0);
    if (!sel.length) { body.innerHTML = 'Nothing selected'; return; }
    if (solo) {
      const e = sel[0];
      const d = e.def;
      const stats = d.building
        ? `${d.dmg ? `<b>${d.dmg}</b> dmg · <b>${d.range}</b>m range · ` : ''}<b>${d.armor || 0}</b> armour`
        : `<b>${d.dmg}</b> dmg · <b>${(d.dmg / d.rate).toFixed(0)}</b> dps · <b>${d.armor}</b> armour · <b>${d.pop || 1}</b> pop`
          + (e.watered > 0 ? ` · <b class="wet">Watered ${Math.ceil(e.watered)}s</b>` : '')
          + (e.vet ? ` · <b class="vet">Rank ${e.vet}</b>` : '');
      body.innerHTML = `<div class="solo">
        <div class="big">${d.icon}</div>
        <div class="meta">
          <h4>${d.name}</h4>
          <div class="hpbar ${e.team === TEAM.MACHINE ? 'foe' : ''}"><i id="soloHp"></i></div>
          <div class="st" id="soloHpText"></div>
          <div class="st">${stats}</div>
          ${d.blurb ? `<div class="st" style="opacity:.75">${d.blurb}</div>` : ''}
        </div></div>`;
    } else {
      // cap the grid at what actually fits; the overflow becomes a count
      const CAP = 27;
      const shown = sel.slice(0, CAP);
      const rest = sel.length - shown.length;
      body.innerHTML = `<div class="selgrid">${shown.map(e =>
        `<div class="selchip" data-id="${e.id}" title="${e.def.name}">${e.def.icon}<div class="bar"><i></i></div></div>`
      ).join('')}${rest > 0 ? `<div class="selmore" title="${rest} more selected">+${rest}</div>` : ''}</div>`;
      body.querySelectorAll('.selchip').forEach(chip => {
        chip.addEventListener('click', () => {
          const ent = G.byId.get(+chip.dataset.id);
          if (ent && ent.alive) setSelection([ent]);
        });
      });
    }
  }

  if (!sel.length) return;
  if (solo) {
    const e = sel[0];
    const f = Math.max(0, e.hp / e.maxHp);
    const bar = el('soloHp'); if (bar) bar.style.width = (f * 100) + '%';
    const t = el('soloHpText');
    if (t) {
      let extra = '';
      if (e.type === 'grove') extra = e.owned ? ' · <b style="color:#7fd44a">bloomed</b>' : ` · capture ${(e.prog / RULES.captureTime * 100) | 0}%`;
      if (e.type === 'core' && !G.coreExposed) extra = ' · <b style="color:#39d7ea">shielded by coolant</b>';
      if (e.isRooted && e.isRooted()) extra += ' · <b style="color:#9bff6a">rooted</b>';
      t.innerHTML = `<b>${Math.ceil(e.hp)}</b> / ${e.maxHp} hp${extra}`;
    }
  } else {
    const chips = el('selbody').querySelectorAll('.selchip');
    for (let i = 0; i < chips.length && i < sel.length; i++) {
      const f = Math.max(0, sel[i].hp / sel[i].maxHp);
      const b = chips[i].querySelector('i');
      if (b) { b.style.width = (f * 100) + '%'; b.style.background = f > 0.4 ? '#7fd44a' : '#ff6a3d'; }
    }
  }
}

/* ---------------------------------------------------------- minimap ---- */
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ray = new THREE.Raycaster();
const _mmVec = new THREE.Vector2();
const _hit = new THREE.Vector3();

function corner(nx, ny, out) {
  _mmVec.set(nx, ny);
  _ray.setFromCamera(_mmVec, G.camera);
  const p = _ray.ray.intersectPlane(groundPlane, _hit);
  if (!p) return null;
  out.x = (p.x + HALF) / WORLD * 200;
  out.y = (p.z + HALF) / WORLD * 200;
  return out;
}

const MM = (x, z) => [(x + HALF) / WORLD * 200, (z + HALF) / WORLD * 200];

/* Sutherland-Hodgman against the 0..200 minimap square. */
function clipToMap(poly) {
  const edges = [
    { inside: p => p.x >= 0,   cut: (a, b) => lerpPt(a, b, (0 - a.x) / (b.x - a.x)) },
    { inside: p => p.x <= 200, cut: (a, b) => lerpPt(a, b, (200 - a.x) / (b.x - a.x)) },
    { inside: p => p.y >= 0,   cut: (a, b) => lerpPt(a, b, (0 - a.y) / (b.y - a.y)) },
    { inside: p => p.y <= 200, cut: (a, b) => lerpPt(a, b, (200 - a.y) / (b.y - a.y)) },
  ];
  let out = poly;
  for (const e of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      const curIn = e.inside(cur), prevIn = e.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(e.cut(prev, cur));
      }
    }
    if (!out.length) return out;
  }
  return out;
}
function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function drawMinimap() {
  const c = mmCtx;
  c.fillStyle = '#0b1a10';
  c.fillRect(0, 0, 200, 200);

  // blighted zone
  const [bx, bz] = MM(COMPOUND.x - COMPOUND.hw - 16, COMPOUND.z - COMPOUND.hd - 16);
  c.fillStyle = 'rgba(60,50,40,.55)';
  c.fillRect(bx, bz, (COMPOUND.hw + 16) * 2 / WORLD * 200, (COMPOUND.hd + 16) * 2 / WORLD * 200);
  const [cx, cz] = MM(COMPOUND.x - COMPOUND.hw, COMPOUND.z - COMPOUND.hd);
  c.strokeStyle = 'rgba(57,215,234,.28)';
  c.lineWidth = 1;
  c.strokeRect(cx, cz, COMPOUND.hw * 2 / WORLD * 200, COMPOUND.hd * 2 / WORLD * 200);

  /* Actual wall segments, once scouted. The gaps between them ARE the gates, and
     where to go in is the single most useful thing the minimap can tell you. */
  c.strokeStyle = '#7f8b95';
  c.lineWidth = 2.5;
  c.beginPath();
  for (const e of G.entities) {
    if (!e.alive || !e.def.wall || !isRemembered(e)) continue;
    const [wx, wy] = MM(e.pos.x, e.pos.z);
    const hw = e.box.hw / WORLD * 200, hd = e.box.hd / WORLD * 200;
    if (hw >= hd) { c.moveTo(wx - hw, wy); c.lineTo(wx + hw, wy); }
    else { c.moveTo(wx, wy - hd); c.lineTo(wx, wy + hd); }
  }
  c.stroke();

  drawFogOverlay(c, 200);   // veil the terrain backdrop; blips draw on top

  /* Anything of yours being hurt right now pulses. Losing the Heart Tree or a
     grove used to be a single toast you were never looking at — and the comment
     in world.js has promised this pulse since the day it was written. */
  const alarm = 0.35 + 0.65 * Math.abs(Math.sin(G.time * 4));
  const pulseAt = (pos, r) => {
    const [px, py] = MM(pos.x, pos.z);
    c.save(); c.globalAlpha = alarm; c.strokeStyle = '#ff6a3d'; c.lineWidth = 2;
    c.beginPath(); c.arc(px, py, r, 0, 6.2832); c.stroke(); c.restore();
  };
  if (G.heart && G.heart.alive && G.time - (G.heart.lastHitAt || -99) < 4) pulseAt(G.heart.pos, 9);
  for (const g of (G.groves || [])) if (g.losing) pulseAt(g.pos, 6);

  // groves
  for (const g of G.groves) {
    // landmarks: always plotted, dimmed until you have actually been there
    c.globalAlpha = isExplored(g.pos.x, g.pos.z) ? 1 : 0.4;
    const [x, y] = MM(g.pos.x, g.pos.z);
    c.beginPath(); c.arc(x, y, g.owned ? 4 : 3, 0, 6.28);
    c.fillStyle = g.owned ? '#7fd44a' : 'rgba(230,220,140,.55)';
    c.fill();
    if (g.owned) { c.strokeStyle = 'rgba(127,212,74,.4)'; c.lineWidth = 3; c.stroke(); }
  }
  c.globalAlpha = 1;

  // entities
  for (const e of G.entities) {
    if (!e.alive) continue;
    if (e.type === 'grove' || e.def.wall) continue;
    // machines are only plotted where you can see them; structures persist as last-known
    if (e.team === TEAM.MACHINE &&
        (e.isBuilding ? !isRemembered(e) : !isVisible(e.pos.x, e.pos.z))) continue;
    c.globalAlpha = e.ghost ? 0.45 : 1;
    const [x, y] = MM(e.pos.x, e.pos.z);
    if (e.isBuilding) {
      const s = e.type === 'core' ? 7 : e.type === 'hearttree' ? 7 : 4;
      c.fillStyle = e.team === TEAM.WILD ? '#9bff6a'
        : e.def.critical ? '#39d7ea' : e.type === 'core' ? (G.coreExposed ? '#ff6a3d' : '#5d7f88') : '#7f8b95';
      c.fillRect(x - s / 2, y - s / 2, s, s);
    } else if (e.team === TEAM.WILD) {
      c.fillStyle = '#7fd44a';
      c.fillRect(x - 1.4, y - 1.4, 2.8, 2.8);      // yours: squares
    } else {
      /* theirs: diamonds. Distinguishable without colour vision at all. */
      c.fillStyle = '#ff6a3d';
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4);
      c.fillRect(-1.7, -1.7, 3.4, 3.4);
      c.restore();
    }
    c.globalAlpha = 1;
  }

  // camera footprint. At any zoom the ground quad is larger than the map, so it
  // must be clipped — unclipped it degenerates into a single diagonal streak.
  const pts = [];
  for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
    const o = { x: 0, y: 0 };
    if (corner(nx, ny, o)) pts.push(o); else pts.length = 0;
    if (!pts.length) break;
  }
  /* Draw the INTERSECTION of the footprint with the map, not the raw quad.
     Canvas clipping alone just hides the off-map edges, which at the default zoom
     leaves two stray diagonals in opposite corners that read as roads — so the
     previous build suppressed the outline entirely and the starting camera showed
     no footprint at all. Clipping the polygon properly means the outline always
     traces the visible region, degenerating to the map border when you can see
     everything, which is what the genre does. */
  const poly = clipToMap(pts);
  if (poly.length >= 3) {
    c.strokeStyle = 'rgba(255,255,255,.7)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) c.lineTo(poly[i].x, poly[i].y);
    c.closePath();
    c.stroke();
  }

  /* At anything but the closest zoom the ground quad is larger than the map, so the
     outline alone says "everywhere". The camera's look-at point is the part the
     player actually needs. */
  const [tx, ty] = MM(G.rts.target.x, G.rts.target.z);
  c.strokeStyle = 'rgba(255,255,255,.9)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(tx - 5, ty); c.lineTo(tx - 2, ty);
  c.moveTo(tx + 2, ty); c.lineTo(tx + 5, ty);
  c.moveTo(tx, ty - 5); c.lineTo(tx, ty - 2);
  c.moveTo(tx, ty + 2); c.lineTo(tx, ty + 5);
  c.stroke();
}
