import * as THREE from 'three';
import { G } from './state.js';
import { GLOW } from './meshes.js';
import { rand, terrainHeight, dist2D } from './utils.js';
import { SFX } from './audio.js';
import { TEAM } from './config.js';
import { addScore } from './score.js';
import { toast } from './ui.js';
import { explode, chainExplosion, spiritWisp } from './vfx.js';
import { commsEvent } from './comms.js';

/* ============================ PARTICLES ================================= */

const partGeo = new THREE.OctahedronGeometry(0.35, 0);
const pool = [];
const live = [];

function grab(color) {
  let p = pool.pop();
  if (!p) {
    p = new THREE.Mesh(partGeo, GLOW(color));
    G.fxRoot.add(p);
  }
  p.material = GLOW(color);
  p.visible = true;
  return p;
}

export function burst(pos, color, n = 8, power = 9, life = 0.55, size = 1) {
  for (let i = 0; i < n; i++) {
    const m = grab(color);
    m.position.copy(pos);
    const s = size * rand(0.4, 1.1);
    m.scale.setScalar(s);
    live.push({
      m, life, t: life, grav: -22, spin: rand(-9, 9),
      v: new THREE.Vector3(rand(-1, 1), rand(0.3, 1.4), rand(-1, 1)).normalize().multiplyScalar(power * rand(0.4, 1.2)),
    });
  }
}

/* One unit-radius ring geometry, scaled per use. Rings fire on every order click,
   grove bloom and building death; building and disposing a RingGeometry each time
   churned the GPU for no reason. Meshes are pooled and keep their own material so
   each can fade independently. */
const ringGeo = new THREE.RingGeometry(0.7, 1.0, 40);
const ringPool = [];

export function ring(pos, color, radius, life = 0.6) {
  let m = ringPool.pop();
  if (!m) {
    m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    G.fxRoot.add(m);
  }
  m.visible = true;
  m.material.color.set(color);
  m.material.opacity = 0.8;
  m.position.copy(pos); m.position.y += 0.4;
  m.scale.setScalar(radius);
  live.push({ m, life, t: life, ring: true, r0: radius });
}

function updateParticles(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i];
    p.t -= dt;
    if (p.t <= 0) {
      p.m.visible = false;
      (p.ring ? ringPool : pool).push(p.m);
      live.splice(i, 1);
      continue;
    }
    const k = p.t / p.life;
    if (p.ring) {
      const s = p.r0 * (1 + (1 - k) * 1.7);
      p.m.scale.set(s, s, s);
      p.m.material.opacity = 0.8 * k;
    } else {
      p.v.y += p.grav * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt * 0.7;
      p.m.scale.setScalar(Math.max(0.02, p.m.scale.x * (1 - dt * 1.6)));
      const gy = terrainHeight(p.m.position.x, p.m.position.z);
      if (p.m.position.y < gy + 0.1) { p.m.position.y = gy + 0.1; p.v.y *= -0.35; p.v.multiplyScalar(0.6); }
    }
  }
}

/* =========================== PROJECTILES ================================ */

const shots = [];
const shotGeo = new THREE.BoxGeometry(1, 1, 1);

/* Tracer meshes are pooled and PARKED (visible=false) rather than removed —
   at 96 pop the old alloc + scene-graph churn was measurable GC pressure.
   Their material is an HDR-boosted glow: >1.0 colour so every tracer feeds the
   bloom pass and gunfire reads as light, not as coloured sticks. */
const shotPool = [];
const hdrGlow = new Map();
function shotMat(c) {
  let m = hdrGlow.get(c);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c });
    m.color.multiplyScalar(2.3);
    hdrGlow.set(c, m);
  }
  return m;
}

export function fireProjectile(from, target, dmg, pdef, attacker) {
  const m = shotPool.pop() || new THREE.Mesh(shotGeo);
  m.material = shotMat(pdef.color);
  m.scale.set(pdef.size, pdef.size, pdef.size * 7);
  m.position.copy(from);
  m.visible = true;
  if (!m.parent) G.fxRoot.add(m);
  shots.push({ m, target, dmg, speed: pdef.speed, attacker, t: 3 });
  burst(from, pdef.color, 2, 3, 0.14, 0.35);
}

const _shotDir = new THREE.Vector3();
const _shotLook = new THREE.Vector3();

function updateShots(dt) {
  const tmp = _shotDir;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.t -= dt;
    const alive = s.target && s.target.alive;
    if (!alive || s.t <= 0) {
      s.m.visible = false;
      shotPool.push(s.m);
      shots.splice(i, 1);
      continue;
    }
    tmp.copy(s.target.aimPoint()).sub(s.m.position);
    const d = tmp.length();
    const step = s.speed * dt;
    if (d <= step + 0.6) {
      applyDamage(s.target, s.dmg, s.attacker);
      /* Turret shells burst: the Terran answer to a wolf carpet. Armour is
         applied per victim, so the splash shreds unarmoured swarm and only
         dents boars/bears — which is what finally makes mixed comps matter. */
      const spl = s.attacker && s.attacker.alive && s.attacker.def.splash;
      if (spl) {
        for (const o of G.entities) {
          if (o === s.target || !o.alive || o.isBuilding || o.team !== s.target.team) continue;
          if (dist2D(o.pos, s.target.pos) < spl) applyDamage(o, s.dmg * 0.5, s.attacker);
        }
      }
      burst(s.target.aimPoint(), s.m.material.color.getHex(), 5, 7, 0.3, 0.5);
      s.m.visible = false;
      shotPool.push(s.m);
      shots.splice(i, 1);
      continue;
    }
    tmp.divideScalar(d);
    s.m.position.addScaledVector(tmp, step);
    s.m.lookAt(_shotLook.copy(s.m.position).add(tmp));
  }
}

/* ============================= DAMAGE =================================== */

export function applyDamage(target, amount, attacker) {
  if (!target || !target.alive || G.over) return;

  /* The shield is the objective. Gating *acquisition* was not enough — an explicit
     right-click attack order writes order.target directly and bypassed it, which
     let the Core be killed with all three Coolant Towers intact. Gate the damage. */
  if (target.type === 'core' && !G.coreExposed) {
    if (G.time - (target._shieldPing || -9) > 0.25) {
      target._shieldPing = G.time;
      const p = target.aimPoint().clone();
      p.y += 6;
      burst(p, 0x39d7ea, 5, 8, 0.35, 0.5);
      SFX.shieldPing(target.pos);
    }
    return;
  }

  const def = target.def;
  const dealt = Math.max(1, amount - (def.armor || 0));
  target.hp -= dealt;
  target.lastHitAt = G.time;
  /* remember which way the blow came from so the body is knocked the right way */
  target.hitT = 0.18;
  if (attacker) {
    const dx = target.pos.x - attacker.pos.x, dz = target.pos.z - attacker.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    target.hitDirX = dx / d; target.hitDirZ = dz / d;
  }
  /* The one attack the player must never miss: the Heart Tree itself. */
  if (target === G.heart) {
    SFX.heartAlarm();
    /* A sound alone is not feedback: press M and the base can die in silence
       while you are across the map at the compound. */
    if (G.time - (G._heartToast || -99) > 8) {
      G._heartToast = G.time;
      toast('THE HEART TREE IS UNDER ATTACK', 'warn');
    }
  }

  /* Fight back. The old rule only fired when the victim was already idle AND had
     no target — i.e. almost never — so animals walked through rifle fire without
     reacting. Entity.provoke decides what to do with it. */
  if (attacker && target.team !== TEAM.NEUTRAL && target.provoke) target.provoke(attacker);
  /* three materials, three answers: a wall does not ring like a drone, and a
     wolf does not ring at all */
  if (target.team !== TEAM.MACHINE) SFX.bite(target.pos);
  else if (def.wall || def.building) SFX.hitStone(target.pos);
  else SFX.hitMetal(target.pos);
  if (target.hp <= 0) kill(target, attacker);
}

export function kill(e, killer) {
  if (!e.alive) return;
  if (killer && killer.alive && killer.team !== e.team && !killer.isBuilding) {
    killer.kills = (killer.kills || 0) + 1;
    if (killer.refreshVeterancy) killer.refreshVeterancy();
  }
  e.alive = false;
  e.hp = 0;
  e.deadAt = G.wallTime;
  const p = e.pos.clone(); p.y += e.def.building ? 3 : 1;
  if (e.def.building) {
    if (e.type === 'wall') SFX.wallBreak(e.pos);
    else if (e.type === 'coolant' || e.type === 'core' || e.type === 'hearttree') SFX.boomBig(e.pos);
    else SFX.boom(e.pos);
    const nature = e.team === TEAM.WILD;
    /* structure death scales the pyrotechnics to what just fell */
    const POWER = { wall: 0.9, turret: 1.2, depot: 2, coolant: 2.2, core: 3, grove: 1, hearttree: 2.6 };
    const pw = POWER[e.type] || 1;
    if (e.type === 'turret') commsEvent('turret', 0.7);
    else if (e.type === 'wall') commsEvent('wall', 0.2);
    explode(p, pw, { nature });
    if (e.type === 'core') chainExplosion(e.pos, e.def.radius, 6, 1.4, {});
    if (e.type === 'hearttree') chainExplosion(e.pos, e.def.radius, 4, 1.1, { nature: true });
  } else {
    SFX.death(e.pos);
    /* Nothing that walks on legs detonates. A drone is a machine falling out of
       the sky — its explosion happens when it hits the ground (see updateCorpse).
       A guard is a person in a hi-vis vest: sparks off the gear, then they go
       down. Only structures produce a fireball here. */
    if (e.def.death === 'fall' && e.team === TEAM.MACHINE) {
      burst(p, 0x59e5ff, 5, 7, 0.4, 0.5);
    } else if (e.team === TEAM.MACHINE) {
      burst(p, 0x59e5ff, 7, 7, 0.45, 0.55);
    } else {
      burst(p, 0x8a4a3a, 8, 7, 0.55, 0.7);
      spiritWisp(p);
    }
  }
  e.onKilled && e.onKilled();
  // signal only — importing input.js here would make combat -> input -> world -> combat
  if (G.hoverEntity === e) G.hoverEntity = null;
  if (e.team === TEAM.MACHINE) addScore(e.isBuilding ? 'structure' : 'kill', e.type, e.pos);
  else if (e.team === TEAM.WILD && !e.isBuilding) addScore('lost', e.type, e.pos);

  e.onDeath && e.onDeath();
}

export function updateCombatFX(dt) {
  updateShots(dt);
  updateParticles(dt);
}
