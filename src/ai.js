import * as THREE from 'three';
import { G } from './state.js';
import { RULES, TEAM, COMPOUND, BASE } from './config.js';
import { rand, dist2D } from './utils.js';
import { spawn } from './entity.js';
import { assignPatrol } from './world.js';
import { toast } from './ui.js';
import { SFX } from './audio.js';
import { musicStinger } from './music.js';
import { makeEnergyFieldMaterial } from './shaders.js';
import { commsEvent } from './comms.js';
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
      /* Deterministic 1-in-4 cycle rather than a dice roll. Drones and guards are
         different threats, so rolling several drones early made a run materially
         harder for reasons the player could not see or plan around. */
      d.spawnN = (d.spawnN || 0) + 1;
      /* Technicians are capped hard. Three is enough to make chip damage stop
         paying; more than that and a player who cannot yet reach the depots has
         no line of play at all, which is the failure mode repair units usually
         have. */
      let kind = 'guard';
      /* Techs spawn when there is something to weld, not on a blind cycle — the
         %6 rota meant they effectively never appeared in real games. */
      const needsRepair = G.entities.some(e =>
        e.alive && e.isBuilding && e.team === TEAM.MACHINE && e.hp < e.maxHp * 0.9);
      if (needsRepair && countMachine('tech') < 2) kind = 'tech';
      else if (d.spawnN % 4 === 0) kind = 'drone';
      const g = spawn(kind,
        d.pos.x + rand(-7, 7), d.pos.z + (d.mesh.rotation.y ? -7 : 7));
      if (kind !== 'tech') assignPatrol(g);   // techs go where the damage is
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

/* Where a sweep goes, and it is the most important function in the file.

   It used to send every raider to the owned grove NEAREST THE COMPOUND, and
   only remember the Heart Tree when the player held zero groves. The effect,
   measured: at wave 5 the nearest surviving raider was 115m from a base at full
   health. Holding a single grove made you structurally invulnerable, so the
   game had two states — untouchable, or already dead — and no middle. Every
   promise the HUD makes (the countdown, the minimap pulse, "10 guards, 3 drones
   inbound") was a lie, because they were walking to a grove and dying there.

   A sweep now SPLITS: the outriders still take the nearest grove, and the main
   body goes for the Heart Tree. That single change is what turns "when am I big
   enough to attack" into "can I afford to leave", which is the decision this
   whole design has been reaching for. */
function raidTarget(forHome) {
  if (!forHome) {
    const owned = G.groves.filter(g => g.owned);
    if (owned.length) {
      let best = owned[0], bd = 1e9;
      for (const g of owned) {
        const d = dist2D(g.pos, { x: COMPOUND.x, z: COMPOUND.z });
        if (d < bd) { bd = d; best = g; }
      }
      return best.pos;
    }
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
  // the surge ceiling rises with the sweep number too, or the clamp re-caps them
  const surgeRoom = Math.max(2, Math.round(RULES.machinePopCap * (RULES.waveCapMult + n * 0.25)) - G.machinePop);
  /* Sweeps must keep growing. Capping them at 10 guards meant wave 8 and wave 20
     were identical, so a player who took the map and massed to the pop cap could
     simply sit there forever — which removes the commit-timing decision entirely.
     Early waves are unchanged; it is the late ones that now keep escalating. */
  /* Escalation is only real if it never stops. The min(20) cap made wave 8 and
     wave 20 identical, and a 96-pop turtle measured ZERO heart damage across 20
     waves — the sweeps simply could not scale to the new swarm cap. Past wave 8
     the caps lift 2 guards + 1 drone per wave, forever. */
  /* Pulled forward. The old curve (~4.5n-9) needed wave 11, t~1175s, to field
     40 units — matches end at 6-11 minutes, so the escalation the comment above
     promises arrived roughly twice as late as anyone actually plays. */
  let guards = Math.min(24 + Math.max(0, n - 6) * 3, 5 + n * 2 + Math.max(0, n - 3) * 3);
  let drones = Math.min(12 + Math.max(0, n - 6), 1 + n + Math.max(0, n - 4));
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

  /* Two thirds of the sweep goes for the base, the rest peels off to whatever
     grove is closest to home. The player can no longer be safe by simply owning
     ground; they have to decide what to leave behind. */
  const home = raidTarget(true);
  const grove = raidTarget(false);
  let toHome = 0;
  for (let i = 0; i < made.length; i++) {
    const e = made[i];
    e.mission = 'raid';
    const goHome = (i % 3) !== 2 || !grove || grove === home;
    if (goHome) {
      /* A strike group has to COMMIT. On attackmove they stopped for every wolf
         and grove between the compound and the base and died in the middle of
         the map: measured, the closest raider of a sweep got 57m from a Heart
         Tree it never touched. Targeting the tree directly means they beeline
         and only break off for whatever physically blocks them (provoke() still
         gives a 4s retaliation window, so they are not immune to being
         intercepted — they just no longer wander off to fight a grove). */
      toHome++;
      if (G.heart.alive) e.setOrder('attack', G.heart.pos, G.heart);
      else if (home) e.setOrder('attackmove', home);
    } else if (grove) e.setOrder('attackmove', grove);
  }
  SFX.alarm();
  musicStinger('attack');   // 30s of panic strings over the ducked bed
  commsEvent('sweep', 0.5);
  toast(`SECURITY SWEEP ${n} — ${guards} guards, ${drones} drones inbound`
        + (toHome ? ' · HEADING FOR THE HEART TREE' : ''), 'warn');
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
  commsEvent('overgrowth', 0.7);
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

function countMachine(type) {
  let n = 0;
  for (const e of G.entities) if (e.alive && e.type === type) n++;
  return n;
}
