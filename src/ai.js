import * as THREE from 'three';
import { G } from './state.js';
import { RULES, TEAM, COMPOUND, BASE, HALF } from './config.js';
import { rand, dist2D, clamp } from './utils.js';
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
  keepColumn();         // strike groups close up before they land

  /* --- depot reinforcements --- */
  for (const d of G.depots) {
    if (!d.alive) continue;
    d.spawnTimer -= dt;
    if (d.spawnTimer <= 0) {
      d.spawnTimer = d.def.spawnEvery;
      /* The pop cap does not apply to a meltdown. MEASURED, and it is the whole
         reason this exemption is written down: a sweep surges to waveCapMult of
         the standing cap, so during the sweep that a smart player is holding
         BEHIND, machinePop sits around 31 against a cap of 19 — and the plain
         `>= cap` guard silently blocked every technician. The compound stood
         thirty-one strong and watched its own Core melt with zero welders sent.
         An emergency the defender is structurally unable to respond to is not a
         hold, it is a cutscene. */
      if (G.machinePop >= RULES.machinePopCap && !G.coreExposed) continue;
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
      /* The cap lifts while the Core is cooking. Two welders is the right number
         for chip damage; it is not the right number when the compound is about
         to melt. */
      const techCap = G.coreExposed ? RULES.emergencyTechs : 2;
      if ((needsRepair || G.coreExposed) && countMachine('tech') < techCap) kind = 'tech';
      /* Over cap only a welder is worth the exemption — a meltdown must not
         become a licence to print guards. */
      else if (G.machinePop >= RULES.machinePopCap) continue;
      else if (d.spawnN % 4 === 0) kind = 'drone';
      const g = spawn(kind,
        d.pos.x + rand(-7, 7), d.pos.z + (d.mesh.rotation.y ? -7 : 7));
      if (kind !== 'tech') assignPatrol(g);   // techs go where the damage is
    }
  }

  /* --- waves --- */
  if (G.time >= G.nextWave) {
    /* Every depot levelled pushes the next sweep further out. Aggression used
       to buy the player literally nothing — true passive died at 6:51 and an
       all-in that fought for four minutes died at 6:50 — because the wave
       timer was the only clock in the game and nothing on the board moved it.
       Now demolition is time, and the toast on a depot's death says how much. */
    /* ...and the rota compresses with the size of the swarm. See
       RULES.sweepHasteFloor: this is the frequency half of the trade that took
       the escort bonus down, so the valley is asked "can you afford to be away"
       three or four times a match at a survivable price instead of once at a
       near-fatal one. Below the floor — which is where a passive valley lives,
       by construction — this multiplies by exactly one. */
    const gap = RULES.waveEvery * (1 + deadDepots() * RULES.depotWaveDelay) / (1 + sweepHaste());
    G.nextWave = G.time + gap;
    G.nextDetail = G.time + gap * 0.55;
    launchWave();
  }

  emergencyResponse(dt);

  /* --- the mid-cycle landscaping detail --- */
  if (G.time >= G.nextDetail) {
    G.nextDetail = Infinity;          // one per cycle; the next wave reschedules it
    launchDetail();
  }

  /* --- per unit behaviour --- */
  for (const e of G.entities) {
    if (!e.alive || e.isBuilding || e.team !== TEAM.MACHINE) continue;
    if (e.target) continue;
    if (e.order.type !== 'idle') continue;

    if (e.mission === 'raid') {
      /* A raider that has reached its flank waypoint turns for the tree. Going
         idle is the ONLY signal that the leg is finished, which is why the
         column also carries a hard deadline (see keepColumn) — a waypoint a
         raider cannot physically reach must never park the whole sweep. */
      if (e.raidHome) {
        e.flankUntil = 0;
        if (G.heart.alive) { e.setOrder('attack', G.heart.pos, G.heart); continue; }
        e.raidHome = false;
      }
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

/* MELTDOWN RESPONSE. See RULES.emergencyEvery for why this exists: without it
   a player who had razed the Security Depots — the normal line — held an
   uncontested Core for 45 seconds and the ending was a countdown with no game
   attached to it.

   Two parts. The Core dispatches its own technicians, at half a depot's rate
   and hard-capped, so demolition still buys a slower response without buying a
   free win. And every raider in the field turns around, which is what makes the
   sweep clock on the HUD into a thing the player can spend. */
function emergencyResponse(dt) {
  if (!G.coreExposed || !G.core.alive) { G._recalled = false; return; }

  /* --- the Core's own welders --- */
  G._emergencyT = (G._emergencyT || 0) - dt;
  if (G._emergencyT <= 0) {
    G._emergencyT = RULES.emergencyEvery;
    /* Deliberately NOT gated on machinePop — see the depot loop above. */
    if (countMachine('tech') < RULES.emergencyTechs) {
      const a = rand(0, Math.PI * 2), r = G.core.def.radius + 4;
      spawn('tech', G.core.pos.x + Math.cos(a) * r, G.core.pos.z + Math.sin(a) * r);
    }
  }

  /* --- everyone comes home, once per meltdown --- */
  if (!G._recalled) {
    G._recalled = true;
    let n = 0;
    for (const e of G.entities) {
      if (!e.alive || e.isBuilding || e.team !== TEAM.MACHINE) continue;
      if (e.mission !== 'raid') continue;
      e.mission = null;
      e.raidHome = false;
      e.flankUntil = 0;
      e.target = null;
      /* Sent to a DOWNED TOWER, not to the Core. The player is standing on the
         towers — that is what holding the meltdown means — so this puts the
         recall where the fight actually is instead of parking it on a building
         nobody is hitting. */
      const dark = G.coolants.filter(c => c.downed);
      const to = dark.length ? dark[n % dark.length].pos : G.core.pos;
      e.setOrder('attackmove', _v.set(to.x + rand(-6, 6), 0, to.z + rand(-6, 6)).clone());
      n++;
    }
    if (n > 0) {
      toast(`EMERGENCY RECALL — ${n} raider${n > 1 ? 's turn' : ' turns'} back for the compound`, 'warn');
      commsEvent('coreExposed', 0.9);
      SFX.alarm();
    }
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

/* How much the campus has shortened its own rota because of how many animals
   there now are. Reads fielded POP, not unit count — a bear is four — for the
   same three reasons the escort does: it is already on the player's HUD, it is
   the number the escalation is a response to, and it is ZERO for somebody who
   never built anything. That last property is the safety guarantee on the
   true-passive death clock and it is why there is a floor here at all. */
function sweepHaste() {
  const pop = wildPop().total;
  const over = pop - (RULES.sweepHasteFloor || 0);
  if (over <= 0) return 0;
  return Math.min(RULES.sweepHasteMax || 0, over * (RULES.sweepHastePerPop || 0));
}

function deadDepots() {
  let n = 0;
  for (const d of G.depots) if (!d.alive) n++;
  return n;
}

/* THE SERVICE ROAD. A waypoint set off to one side of the compound->base line,
   so the home column does not walk straight into the army walking the other way
   down the same corridor. See RULES.flankAlong for the measurement that made
   this necessary. The side alternates with the sweep number, which keeps it
   learnable — the player can watch two sweeps and know where the third comes
   from — rather than a dice roll. */
function flankPoint(gate) {
  const dx = G.heart.pos.x - gate.x, dz = G.heart.pos.z - gate.z;
  const L = Math.hypot(dx, dz) || 1;
  const side = (G.waveNum % 2) ? 1 : -1;
  const px = -dz / L * side, pz = dx / L * side;
  const cx = gate.x + dx * RULES.flankAlong + px * RULES.flankOffset;
  const cz = gate.z + dz * RULES.flankAlong + pz * RULES.flankOffset;
  const lim = HALF - 14;
  const x = clamp(cx, -lim, lim), z = clamp(cz, -lim, lim);
  return new THREE.Vector3(x, terrainHeight(x, z), z);
}

/* Which way is "out of the compound" from this gate. Compared in half-extent units
   so a wide, shallow compound still resolves the near face correctly. */
function gateOutward(g) {
  const dx = g.x - COMPOUND.x, dz = g.z - COMPOUND.z;
  const ax = Math.abs(dx) / Math.max(1, COMPOUND.hw);
  const az = Math.abs(dz) / Math.max(1, COMPOUND.hd);
  return ax >= az ? { x: Math.sign(dx) || 1, z: 0 } : { x: 0, z: Math.sign(dz) || 1 };
}

/* =========================================================================
   THE STRIKE COLUMN.

   A sweep bound for the Heart Tree left the gate together and arrived smeared
   across about 39 metres and ten seconds, because a drone moves at 12 and a
   guard at 6.4. The Heart Tree shoots for 20 dps at 24 metres and never has to
   reload, so it met that smear a few raiders at a time and beat it — measured,
   it killed four of nine raiders inside ten seconds of contact with no garrison
   present at all. That is why a six-pop garrison held the base for an entire
   match and why the "defend while you attack" premise was never actually tested.

   So raiders bound for home now travel as a column. Anyone who pulls more than
   strikeSpread metres ahead of the body stops and waits; they still shoot, they
   just stop outrunning their escort. The sweep lands as one punch.

   The pace-setter is the 75th-percentile straggler, not the very last one, so a
   single raider stuck on a fence cannot stall the whole column — and strikeFormUp
   is a hard deadline after which nobody waits for anybody. Two independent
   guards against the one failure mode this kind of logic always has.
   ========================================================================= */
const columns = [];

function keepColumn() {
  for (let i = columns.length - 1; i >= 0; i--) {
    const col = columns[i];
    const alive = col.members.filter(e => e.alive);
    if (!alive.length) { columns.splice(i, 1); continue; }
    /* Everyone marches by default; only leaders are told to wait, and only for
       as long as the deadline allows. Clearing EVERY living member first — not
       just the ones still on the raid — means a unit that drops out of the
       mission, or a column that ages out, can never be left frozen in place. */
    for (const e of alive) e.keepingPace = false;
    /* The flank leg's hard deadline, for exactly the reason strikeFormUp
       exists. If the waypoint is unreachable — a lake, a rock, a wall — the
       raider gives up on it and turns for the tree anyway. */
    for (const e of alive) {
      if (!e.flankUntil || G.time < e.flankUntil) continue;
      e.flankUntil = 0;
      if (e.raidHome && G.heart.alive) e.setOrder('attack', G.heart.pos, G.heart);
    }
    const live = alive.filter(e => e.mission === 'raid');
    if (!live.length || G.time > col.formUpUntil || !G.heart.alive) continue;
    const ds = live.map(e => dist2D(e.pos, G.heart.pos)).sort((a, b) => a - b);
    const pace = ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.75))];
    for (const e of live) {
      if (pace - dist2D(e.pos, G.heart.pos) > RULES.strikeSpread) e.keepingPace = true;
    }
  }
}

/* How much of the player's standing army is NOT at the Heart Tree, right now.

   This is the whole "can I afford to leave" question, read off the board at the
   moment the sweep is dispatched. A valley that is still garrisoned gets a
   lighter strike and loses groves instead; a valley that has been stripped bare
   gets the entire sweep through the front door.

   It moves mass around INSIDE a sweep and never changes its size, which is what
   makes it safe: a player who never built an army at all (no units, nothing
   away) sees exactly the behaviour they saw before, and the passive-death clock
   is untouched. It is also not a dice roll — it is a direct, announced
   consequence of a disposition the player chose and can see on the minimap. */
function wildPop() {
  let home = 0, away = 0;
  for (const e of G.entities) {
    if (!e.alive || e.team !== TEAM.WILD || e.isBuilding) continue;
    const p = e.def.pop || 1;
    if (dist2D(e.pos, G.heart.pos) < 42) home += p; else away += p;
  }
  /* POP, not unit count. A bear is four. Anything that thresholds on the length
     of a list here is measuring the wrong number and will quietly never fire. */
  return { home, away, total: home + away };
}

function strippedFraction(field) {
  if (field.total === 0) return 1;      // nothing fielded: behave exactly as before
  return field.away / field.total;
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
  /* THE ESCORT. Added AFTER the surge clamp on purpose: this is not part of the
     standing garrison the campus can afford to field, it is extra people hired
     for one afternoon because of how many animals there now are. It is read off
     the player's fielded POP, so a player who never built anything adds exactly
     nothing and the true-passive clock is untouched. Every one of them walks
     home with the column. */
  const field = wildPop();
  const escort = Math.min(RULES.escortMax, Math.round(field.total * RULES.escortPerPop));
  const escortDrones = Math.floor(escort / 3);
  const escortGuards = escort - escortDrones;
  guards += escortGuards;
  drones += escortDrones;
  const gate = G.gates[G.waveNum % G.gates.length];
  /* Muster OUTSIDE the fence. Raiders used to appear centred on the gate line
     itself, and the north gate's line is the north WALL — so half a sweep spawned
     inside the compound. A beeline to a Heart Tree that lies west then walked them
     along the inside of that wall into the north-west corner, where they wedged
     against their own perimeter and stayed: measured, seven raiders holding an
     explicit "attack the Heart Tree" order sat at one coordinate for 286 seconds
     while the tree finished the match untouched. Stepping the muster point out
     past the wall means a straight run home never crosses their own fence. */
  const out = gateOutward(gate);
  const tanX = -out.z, tanZ = out.x;
  const mx = gate.x + out.x * 7, mz = gate.z + out.z * 7;
  const at = (spread, push) => [
    mx + tanX * rand(-spread, spread) + out.x * rand(0, push),
    mz + tanZ * rand(-spread, spread) + out.z * rand(0, push),
  ];
  const made = [];
  for (let i = 0; i < guards; i++) { const [x, z] = at(9, 8);  made.push(spawn('guard', x, z)); }
  for (let i = 0; i < drones; i++) { const [x, z] = at(11, 10); made.push(spawn('drone', x, z)); }

  /* Two thirds of the sweep goes for the base, the rest peels off to whatever
     grove is closest to home. The player can no longer be safe by simply owning
     ground; they have to decide what to leave behind. */
  const home = raidTarget(true);
  const grove = raidTarget(false);
  /* The share is read off the valley, not off a constant. Fully garrisoned and
     it is a probe that mostly goes after groves; stripped bare and the whole
     sweep walks in the front door. */
  const stripped = strippedFraction(field);
  const share = RULES.strikeHomeMin + (RULES.strikeHomeMax - RULES.strikeHomeMin) * stripped;
  const body = made.length - escort;
  const wantHome = Math.min(made.length, Math.round(body * share) + escort);
  /* Only worth swinging wide if there is an army on the direct road. See
     RULES.flankMinAway — without this gate the detour massed the column and
     killed a true-passive valley three minutes early. */
  const flank = field.away >= RULES.flankMinAway ? flankPoint(gate) : null;
  const col = { members: [], formUpUntil: G.time + RULES.strikeFormUp };
  columns.push(col);
  let toHome = 0;
  for (let i = 0; i < made.length; i++) {
    const e = made[i];
    e.mission = 'raid';
    /* Spread the pick evenly across the sweep rather than taking the first N.
       `made` is guards-then-drones, so a naive prefix would send an all-guard
       column home and hand every drone to the groves — quietly deleting the
       fast, wall-ignoring half of the threat. */
    const picked = Math.floor((i + 1) * wantHome / made.length)
                 > Math.floor(i * wantHome / made.length);
    const goHome = picked || !grove || grove === home;
    if (goHome) {
      /* A strike group has to COMMIT. On attackmove they stopped for every wolf
         and grove between the compound and the base and died in the middle of
         the map: measured, the closest raider of a sweep got 57m from a Heart
         Tree it never touched. Targeting the tree directly means they beeline
         and only break off for whatever physically blocks them (provoke() still
         gives a 4s retaliation window, so they are not immune to being
         intercepted — they just no longer wander off to fight a grove). */
      toHome++;
      col.members.push(e);
      /* raidHome is the column's IDENTITY, not its route: a raider knocked off
         its order finds the tree again rather than wandering off to a grove. */
      if (G.heart.alive) e.raidHome = true;
      if (G.heart.alive && flank) {
        /* Out to the service road first, on a plain MOVE so nothing distracts
           them, then the idle handler turns them for the tree. */
        e.flankUntil = G.time + RULES.strikeFormUp;
        e.setOrder('move', flank);
      } else if (G.heart.alive) e.setOrder('attack', G.heart.pos, G.heart);
      else if (home) e.setOrder('attackmove', home);
    } else if (grove) e.setOrder('attackmove', grove);
  }
  if (!col.members.length) {
    const ci = columns.indexOf(col);
    if (ci >= 0) columns.splice(ci, 1);
  }
  SFX.alarm();
  musicStinger('attack');   // 30s of panic strings over the ducked bed
  /* Say the number out loud. The share now depends on what the player left at
     home, so the one thing it must never be is a surprise: the toast reports how
     many are coming for the tree, and a stripped valley gets its own line from
     Corporate so the mechanism is legible rather than mysterious. */
  commsEvent(stripped > 0.85 && toHome > 4 ? 'stripped' : 'sweep', 0.5);
  toast(`SECURITY SWEEP ${n} — ${guards} guards, ${drones} drones inbound`
        + (toHome ? ` · ${toHome} HEADING FOR THE HEART TREE` : ''), 'warn');
  /* Say the escort out loud as its own line. It is the one part of a sweep the
     player caused, so it must never read as the numbers quietly getting bigger
     on their own. */
  if (escort > 0) toast(`${escort} of them were added because of the size of your swarm`, 'machine');
}

/* =========================================================================
   THE LANDSCAPING DETAIL.

   The half-cycle event. A small crew leaves a gate for whichever bloomed grove
   sits nearest the compound and starts trampling it. Four wolves settle it; a
   player who ignores it loses the grove, and trampled ground stays dormant
   (RULES.groveDormant), so the income does not come straight back.

   It only exists if the player owns a grove, which means it cannot appear in a
   run where nothing was ever built or taken — the true-passive death clock does
   not see this function at all.
   ========================================================================= */
function launchDetail() {
  if (G.over || !G.heart.alive) return;
  const owned = G.groves.filter(g => g.alive && g.owned);
  if (!owned.length) return;
  if (G.machinePop >= RULES.machinePopCap + 10) return;   // the campus is already out
  let best = owned[0], bd = 1e9;
  for (const g of owned) {
    const d = dist2D(g.pos, { x: COMPOUND.x, z: COMPOUND.z });
    if (d < bd) { bd = d; best = g; }
  }
  const gate = G.gates[(G.waveNum + 1) % G.gates.length];
  const out = gateOutward(gate);
  const mx = gate.x + out.x * 7, mz = gate.z + out.z * 7;
  /* Capped. This is harassment, not a second sweep — an uncapped crew turns
     into one by about wave 6 and simply deletes the economy of anybody who
     cannot spare units to sit on groves. */
  const nG = Math.min(RULES.detailMax,
                      RULES.detailGuards + Math.max(0, G.waveNum - 1) * RULES.detailGrowth);
  const nD = RULES.detailDrones;
  for (let i = 0; i < nG + nD; i++) {
    const e = spawn(i < nG ? 'guard' : 'drone',
                    mx + rand(-6, 6) + out.x * rand(0, 6),
                    mz + rand(-6, 6) + out.z * rand(0, 6));
    e.mission = 'raid';
    e.setOrder('attackmove', best.pos);
  }
  commsEvent('grove', 0.9);
  toast(`Landscaping detail dispatched — ${nG + nD} heading for a grove`, 'machine');
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

/* Overgrowth: root every machine unit in a radius, and smother the guns.

   It used to skip `e.isBuilding` outright, which meant the ability did nothing
   about turrets — the one thing that actually kills a swarm on the approach was
   immune to the swarm's only spell. Now the vines go in the barrel too: a
   caught turret goes dark for the duration exactly as if its generator had
   died, which is a tell the player already knows how to read. */
export function castOvergrowth(point) {
  commsEvent('overgrowth', 0.7);
  spawnOvergrowthField(point);
  let hit = 0, guns = 0;
  for (const e of G.entities) {
    if (!e.alive || e.team !== TEAM.MACHINE) continue;
    if (dist2D(e.pos, point) > RULES.spellRadius + (e.isBuilding ? e.radius : 0)) continue;
    if (e.isBuilding) {
      if (!e.def.ranged) continue;          // no point smothering a wall
      e.smotheredUntil = G.time + RULES.spellDuration;
      e.target = null;
      guns++;
    } else {
      e.rootedUntil = G.time + RULES.spellDuration;
      hit++;
    }
  }
  return { rooted: hit, guns };
}

function countMachine(type) {
  let n = 0;
  for (const e of G.entities) if (e.alive && e.type === type) n++;
  return n;
}
