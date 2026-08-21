import * as THREE from 'three';
import { G } from './state.js';
import { RULES, TEAM, COMPOUND, BASE } from './config.js';
import { rand, dist2D } from './utils.js';
import { spawn } from './entity.js';
import { assignPatrol } from './world.js';
import { toast } from './ui.js';
import { SFX } from './audio.js';
import { makeEnergyFieldMaterial } from './shaders.js';
import { terrainHeight } from './utils.js';

/* =========================================================================
   Machine faction brain. Deliberately simple and readable:
     · depots trickle reinforcements
     · idle units walk a patrol route inside the fence
     · every wave timer, a raid party leaves through a gate
   ========================================================================= */

const _v = new THREE.Vector3();

export function updateAI(dt) {
  pruneOvergrowths();   // FX outlive the round; clean them up either way
  if (G.over) return;

  /* --- depot reinforcements --- */
  for (const d of G.depots) {
    if (!d.alive) continue;
    d.spawnTimer -= dt;
    if (d.spawnTimer <= 0) {
      d.spawnTimer = d.def.spawnEvery;
      if (G.machinePop >= RULES.machinePopCap) continue;
      const g = spawn(Math.random() < 0.25 ? 'drone' : 'guard',
        d.pos.x + rand(-7, 7), d.pos.z + (d.mesh.rotation.y ? -7 : 7));
      assignPatrol(g);
    }
  }

  /* --- waves --- */
  if (G.time >= G.nextWave) {
    G.nextWave = G.time + RULES.waveEvery;
    launchWave();
  }

  /* --- per unit behaviour --- */
  for (const e of G.entities) {
    if (!e.alive || e.isBuilding || e.team !== TEAM.MACHINE) continue;
    if (e.target) continue;
    if (e.order.type !== 'idle') continue;

    if (e.mission === 'raid') {
      const t = raidTarget();
      if (t) { e.setOrder('attackmove', t); continue; }
      e.mission = null;
      assignPatrol(e);
    }
    if (!e.patrol) assignPatrol(e);
    e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
    e.setOrder('attackmove', e.patrol[e.patrolIdx]);
  }
}

/* Raiders go for whatever hurts the player most: a bloomed grove, else the tree */
function raidTarget() {
  const owned = G.groves.filter(g => g.owned);
  if (owned.length) {
    let best = owned[0], bd = 1e9;
    for (const g of owned) {
      const d = dist2D(g.pos, { x: COMPOUND.x, z: COMPOUND.z });
      if (d < bd) { bd = d; best = g; }
    }
    return best.pos;
  }
  if (G.heart.alive) return G.heart.pos;
  return null;
}

function launchWave() {
  const alive0 = G.depots.filter(d => d.alive).length;
  if (alive0 === 0 && G.waveNum > 2) {
    // no depots left: do NOT burn a wave slot or advance the counter. nextWave has
    // already been pushed forward by the caller, so latch the toast or it repeats
    // every interval for the rest of the match.
    if (!G.depotsGoneToldOnce) {
      G.depotsGoneToldOnce = true;
      toast('No depots left — the campus cannot mount another sweep', 'machine');
    }
    return;
  }
  G.waveNum++;
  const n = G.waveNum;
  /* A sweep is an offensive surge so it may exceed the standing garrison cap, but
     not without limit — otherwise late waves stack unbounded on top of the trickle. */
  const surgeRoom = Math.max(2, Math.round(RULES.machinePopCap * RULES.waveCapMult) - G.machinePop);
  let guards = Math.min(10, 3 + n);
  let drones = Math.min(5, Math.floor(n / 2) + 1);
  if (guards + drones > surgeRoom) {
    const k = surgeRoom / (guards + drones);
    // floor the sweep at a real threat: the title screen promises escalation, and a
    // "SECURITY SWEEP 4 — 1 guards" toast makes a liar of it
    guards = Math.max(3, Math.floor(guards * k));
    drones = Math.max(1, Math.floor(drones * k));
  }
  const gate = G.gates[G.waveNum % G.gates.length];
  const made = [];
  for (let i = 0; i < guards; i++)
    made.push(spawn('guard', gate.x + rand(-10, 10), gate.z + rand(-10, 10)));
  for (let i = 0; i < drones; i++)
    made.push(spawn('drone', gate.x + rand(-12, 12), gate.z + rand(-12, 12)));

  const t = raidTarget();
  for (const e of made) {
    e.mission = 'raid';
    if (t) e.setOrder('attackmove', t);
  }
  SFX.alarm();
  toast(`SECURITY SWEEP ${n} — ${guards} guards, ${drones} drones inbound`, 'warn');
}

/* Live Overgrowth patches, pruned once their filaments have died back. */
const overgrowths = [];

function spawnOvergrowthField(point) {
  const geo = new THREE.CircleGeometry(RULES.spellRadius, 72);
  const mesh = new THREE.Mesh(geo, makeEnergyFieldMaterial(RULES.spellDuration));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(point.x, terrainHeight(point.x, point.z) + 0.28, point.z);
  mesh.renderOrder = 2;
  G.fxRoot.add(mesh);
  overgrowths.push(mesh);
}

function pruneOvergrowths() {
  for (let i = overgrowths.length - 1; i >= 0; i--) {
    const m = overgrowths[i];
    if (m.material.uniforms.wl_life.value > 0) continue;
    G.fxRoot.remove(m);
    m.geometry.dispose();
    m.material.dispose();
    overgrowths.splice(i, 1);
  }
}

/* Overgrowth: root every machine unit in a radius. */
export function castOvergrowth(point) {
  spawnOvergrowthField(point);
  let hit = 0;
  for (const e of G.entities) {
    if (!e.alive || e.team !== TEAM.MACHINE || e.isBuilding) continue;
    if (dist2D(e.pos, point) > RULES.spellRadius) continue;
    e.rootedUntil = G.time + RULES.spellDuration;
    hit++;
  }
  return hit;
}
