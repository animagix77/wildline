/* Judge Dean LLC — short guided raids. No accounts, analytics or new save keys. */
import { G } from './state.js';
import { RULES, DEFS, TEAM } from './config.js';
import { seedSim } from './utils.js';
import { spawn } from './entity.js';
import { fogRevealAll } from './fog.js';
import { makeFormation } from './tactics.js';
import { SFX, animalVoice } from './audio.js';
import { toast } from './ui.js';

const RAID_IDS = ['first-raid', 'beaver-raid'];
const RAID_SEED = 20261026;
let raidGuide = null;
let raidLastStep = '';

export function raidFromURL(search = location.search) {
  const id = new URLSearchParams(search).get('raid');
  return RAID_IDS.includes(id) ? id : null;
}

// Called once per page, after difficulty is applied and before populate().
export function configureRaid(id) {
  if (!RAID_IDS.includes(id)) return null;
  const beavers = id === 'beaver-raid';
  G.raid = {
    id, title: beavers ? 'Beavers Only' : 'First Raid', seed: RAID_SEED, version: 1,
    startingUnits: beavers ? Array(6).fill('beaver')
      : ['wolf', 'wolf', 'wolf', 'wolf', 'beaver', 'beaver', 'capybara'],
    allowedUnits: beavers ? ['beaver'] : ['wolf', 'beaver', 'capybara'],
    noWaves: true, noEvolution: true, hero: null, heroName: 'Bramble',
    step: 'select', selected: false, captured: false, pumpBroken: false,
  };
  seedSim(RAID_SEED); // A shared raid ignores caller-supplied rseed/map/difficulty.
  Object.assign(RULES, {
    startBiomass: beavers ? 128 : 100, baseIncome: 1.5, grovIncome: 4,
    popCap: 40, firstWaveAt: Infinity, waveEvery: Infinity,
    garrisonGuards: 0, garrisonDrones: 0, machinePopCap: 8,
    meltdownSeconds: beavers ? 26 : 20, meltdownCool: 0.3,
    emergencyTechs: beavers ? 1 : 0, emergencyEvery: 24,
    stages: [{ id: 'field-station', name: 'Field station', at: 0,
      garrison: 1, turrets: 1, popCap: 1, works: [], meltdownCool: 0.3 }],
  });
  DEFS.guard.dmg = beavers ? 9 : 7;
  G.biomass = RULES.startBiomass;
  G.popCap = RULES.popCap;
  G.nextWave = G.nextDetail = Infinity;
  return G.raid;
}

export function initRaid() {
  if (!G.raid) return;
  const beavers = G.raid.id === 'beaver-raid';
  document.body.classList.add('raid-mode');
  document.body.dataset.raid = G.raid.id;
  // The short scenario is a visible tactical puzzle; fog remains in the campaign.
  fogRevealAll();
  for (const lake of G.lakes || []) lake.level = 0.72;
  for (const pump of G.pumps) pump.baseHp = pump.hp = pump.maxHp = beavers ? 520 : 280;
  for (const tower of G.coolants) tower.baseHp = tower.hp = tower.maxHp = beavers ? 520 : 380;
  const guards = beavers ? [[18, -4], [22, -18], [31, 5], [47, -21]] : [[22, -18], [31, 5]];
  for (const [x, z] of guards) {
    const guard = spawn('guard', x, z);
    guard.setOrder('hold');
  }
  G.raid.hero = G.entities.find(e => e.alive && e.type === 'beaver');
  const names = ['Bramble', 'Brook', 'Willow', 'Fern', 'Moss', 'Reed'];
  G.entities.filter(e => e.alive && e.type === 'beaver')
    .forEach((e, i) => { e.nickname = names[i % names.length]; });
  if (G.rts) G.rts.focus({ x: -8, y: 0, z: 10 }, true, 94);
  raidGuide?.remove();
  raidGuide = document.createElement('section');
  raidGuide.id = 'raid-guide';
  raidGuide.setAttribute('aria-label', 'Raid field guide');
  raidGuide.innerHTML = `<div class="raid-guide-head"><span>${G.raid.title} · 1–3 minutes</span><button id="raid-toggle" type="button" aria-expanded="true" aria-controls="raid-instructions" title="Minimise the field guide">−</button></div>
    <div id="raid-instructions"><div id="raid-step" aria-live="polite"></div><p id="raid-copy"></p><div id="raid-progress"></div>
    <div class="raid-actions"><button id="raid-action" type="button"></button><button id="raid-focus" type="button">Show target</button></div></div>`;
  document.getElementById('app').appendChild(raidGuide);
  document.getElementById('raid-toggle').addEventListener('click', () => {
    const collapsed = raidGuide.classList.toggle('collapsed');
    const button = document.getElementById('raid-toggle');
    document.getElementById('raid-instructions').hidden = collapsed;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? '+' : '−';
    button.title = collapsed ? 'Expand the field guide' : 'Minimise the field guide';
  });
  document.getElementById('raid-action').addEventListener('click', raidAction);
  document.getElementById('raid-focus').addEventListener('click', () => {
    if (G.over) return;
    const target = raidTargetEntity();
    if (target && G.rts) G.rts.focus(target.pos, false, 70);
  });
  raidLastStep = '';
  updateRaid(0);
}

function raidPack() {
  return G.entities.filter(e => e.alive && e.team === TEAM.WILD && !e.isBuilding);
}

function raidSelectPack() {
  for (const e of G.selection) e.selected = false;
  G.selection = raidPack();
  for (const e of G.selection) e.selected = true;
  return G.selection;
}

function raidTargetEntity() {
  switch (G.raid?.step) {
    case 'select': return G.raid.hero?.alive ? G.raid.hero : raidPack()[0];
    case 'grove': return G.groves[0];
    case 'pump': return G.pumps.find(e => e.alive);
    default: return G.coolants[0];
  }
}

function raidAction() {
  if (!G.raid || G.over || G.paused || G.phase !== 'playing') return;
  const units = raidSelectPack();
  if (!units.length) { toast('Grow another animal at the Heart Tree to keep going.'); return; }
  const step = G.raid.step;
  if (step === 'select') {
    G.raid.selected = true;
    animalVoice(units[0], 'select');
    SFX.select();
  } else {
    const target = raidTargetEntity();
    if (!target) return;
    if (step === 'grove' || step === 'hold') {
      const destination = target.pos.clone();
      if (step === 'hold') destination.z += target.radius + 4;
      const slots = makeFormation(units, destination);
      units.forEach((e, i) => e.setOrder(step === 'grove' ? 'move' : 'attackmove', slots[i]));
    } else {
      for (const e of units) e.setOrder('attack', target.pos.clone(), target);
    }
    if (G.rts) G.rts.focus(target.pos, false, 78);
    SFX.order();
  }
  updateRaid(0);
}

export function updateRaid(dt) {
  if (!G.raid || !raidGuide) return;
  if (G.over) { raidGuide.hidden = true; G.raid.step = 'done'; raidGuide.dataset.step = 'done'; return; }
  // Pausing freezes both guidance state and gameplay actions.
  if (G.paused || G.phase !== 'playing') return;
  const R = G.raid;
  R.selected ||= G.selection.some(e => e.alive && e.team === TEAM.WILD && !e.isBuilding);
  R.captured ||= !!G.groves[0]?.owned;
  R.pumpBroken ||= G.pumps.every(e => !e.alive);
  const tower = G.coolants[0];
  R.step = !R.selected ? 'select' : !R.captured ? 'grove' : !R.pumpBroken ? 'pump'
    : tower?.alive && !tower.downed ? 'coolant' : 'hold';
  raidGuide.dataset.step = R.step;
  const challenge = R.id === 'beaver-raid';
  if (R.step !== raidLastStep) {
    raidLastStep = R.step;
    const copy = {
      select: ['01 / Meet your pack', challenge
        ? 'Six beavers. One field station. Same layout every run. Select your crew to begin.'
        : 'Meet Bramble and a fellow beaver, four wolves and a capybara. Select your pack to begin.', 'Select pack'],
      grove: ['02 / Bring the grove to life', 'Send the pack to the pale grove. Stay nearby until it blooms: living ground earns biomass for more animals.', 'Send pack to grove'],
      pump: ['03 / Give the water back', 'The intake is draining this pond. Beavers chew through structures; keep the pack together and break the pump.', 'Attack pump'],
      coolant: ['04 / Switch off the cooling', challenge
        ? 'Break the coolant tower. A technician will try to restart it. You can grow more beavers at the Heart Tree.'
        : 'Water is returning. Now disable the coolant tower so the Server Core overheats. Your capybara protects and heals nearby allies.', 'Disable cooling'],
      hold: ['05 / Hold for the meltdown', challenge
        ? 'Keep the tower down. Your beavers must stop the repair technician while the Core heats up.'
        : 'Keep the pack by the tower and watch the Core temperature. Once it reaches 100%, the station shuts down.', 'Defend tower'],
    }[R.step];
    document.getElementById('raid-step').textContent = copy[0];
    document.getElementById('raid-copy').textContent = copy[1];
    document.getElementById('raid-action').textContent = copy[2];
  }
  const living = raidPack().length;
  let progress = `${living} animals ready · ${challenge ? 'Beavers Only · fixed challenge' : 'Click the field or use the guide buttons'}`;
  if (R.step === 'grove') progress = `Grove blooming · ${Math.min(100, Math.round((G.groves[0]?.prog || 0) / RULES.captureTime * 100))}%`;
  if (R.step === 'pump') {
    const pump = G.pumps.find(e => e.alive);
    progress = `Pump health · ${pump ? Math.max(0, Math.ceil(pump.hp)) : 0}`;
  }
  if (R.step === 'coolant') progress = `Cooling capacity · ${Math.round((G.coolFrac ?? 1) * 100)}%`;
  if (R.step === 'hold') progress = `Core temperature · ${Math.min(100, Math.round(G.heat * 100))}%`;
  if (!living) progress = 'Your pack fell. Recruit at the Heart Tree, then select the new animals.';
  const node = document.getElementById('raid-progress');
  if (node.textContent !== progress) node.textContent = progress;
}
