import * as THREE from 'three';
import { G, addEntity } from './state.js';
import { DEFS, TEAM, RULES } from './config.js';
import { BUILDERS, GLOW } from './meshes.js';
import { terrainHeight, clamp, dist2D, rand } from './utils.js';
import { fireProjectile, applyDamage, burst } from './combat.js';
import { lakeAt } from './water.js';
import { muzzleFlash, burnTick, dustPuff, deathTrail, explode, ripple, bloodDrip, threatMark } from './vfx.js';
import { HALF } from './config.js';
import { SFX } from './audio.js';
import { toast } from './ui.js';

const HB_Y = {
  wolf: 2.7, boar: 3.0, bear: 4.3, raven: 1.6, guard: 3.2, drone: 1.5, local: 3.2,
  porcupine: 2.6, beaver: 2.5, pump: 6.5,
  turret: 5.8, depot: 9.5, coolant: 15.6, core: 13.5, wall: 5.6,
  hearttree: 34, grove: 5.5,
};
const FLY_H = { raven: 7.5, drone: 6.5 };
/* Units are drawn a little larger than life so they read at RTS zoom levels. */
const V_SCALE = { wolf: 1.35, boar: 1.3, bear: 1.15, raven: 1.4, guard: 1.3, drone: 1.35, local: 1.3,
  porcupine: 1.3, beaver: 1.3 };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _neigh = [];
const _face = new THREE.Vector3();
const _slideGoal = new THREE.Vector3();
const HIT_TIME = 0.18;
const PACK_ALERT = 15;      // metres a cry for help carries
const RANK_GEO = new THREE.OctahedronGeometry(0.16, 0);

/* ------------------------------------------------------------- watered -- */
/* Pre-tinted twins of the shared body materials, one per base material, built
   on first use. See Entity.showWatered for why this may NOT be done by mutating
   the emissive in place: meshes.js hands out cached materials shared by every
   animal of a species. */
const WATERED_TINT = 0x1b4a63;
const wateredTwins = new Map();
function wateredTwin(base) {
  let m = wateredTwins.get(base);
  if (!m) {
    m = base.clone();
    m.emissive.setHex(WATERED_TINT);
    wateredTwins.set(base, m);
  }
  return m;
}

/* --------------------------------------------------------------- health -- */
const hbBgGeo = new THREE.PlaneGeometry(1, 1);

function makeHealthBar(width) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(hbBgGeo, new THREE.MeshBasicMaterial({ color: 0x0a0f0b, transparent: true, opacity: 0.75, depthTest: false }));
  bg.scale.set(width, width * 0.14, 1);
  const fill = new THREE.Mesh(hbBgGeo, new THREE.MeshBasicMaterial({ color: 0x7fd44a, depthTest: false }));
  fill.scale.set(width * 0.94, width * 0.09, 1);
  fill.position.z = 0.01;
  /* A thin amber tick marking permanent structural damage — the ceiling a
     technician can no longer weld past. */
  const scar = new THREE.Mesh(hbBgGeo, new THREE.MeshBasicMaterial({ color: 0xffb15a, depthTest: false }));
  scar.scale.set(width * 0.02, width * 0.17, 1);
  scar.position.z = 0.02;
  scar.visible = false;
  g.add(bg); g.add(fill); g.add(scar);
  g.renderOrder = 999;
  g.visible = false;
  return { g, bg, fill, scar, width: width * 0.94 };
}

/* =========================================================================
   Entity
   ========================================================================= */
export class Entity {
  constructor(type, x, z, opts = {}) {
    const def = DEFS[type];
    this.type = type;
    this.def = def;
    this.team = opts.team || def.team;
    this.baseHp = opts.hp || def.hp;
    this.hp = this.maxHp = this.baseHp;
    this.radius = def.radius;
    this.flying = !!def.flying;
    this.isBuilding = !!def.building;
    this.needsPower = this.type === 'turret';   // see updateBuilding
    this.alive = true;
    this.cooldown = 0;          // seeded from the id once addEntity has assigned one
    this.target = null;
    this.order = { type: 'idle', pos: null, target: null };
    this.leash = null;
    this.hitT = 0;
    this.hitDirX = 0; this.hitDirZ = 1;
    this.kills = 0;
    this.vet = 0;                 // veterancy rank, 0..3
    this.watered = 0;             // seconds of Watered left (see drink())
    this.sip = 0;                 // seconds spent at the shore this visit
    this.provokedBy = null;
    this.provokeUntil = 0;
    this.chargeT = 0;
    this.rootedUntil = 0;
    /* Set each tick by the machine brain for raiders in a strike column: the
       unit holds its ground so the rest of the column can close up. Deliberately
       NOT isRooted() — a unit keeping pace still shoots what comes into range,
       it just stops walking away from its escort. */
    this.keepingPace = false;
    this.stuck = 0;
    this.lastPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.selected = false;
    this.animT = rand(0, 100);
    this.lastHitAt = -99;

    this.pos = new THREE.Vector3(x, terrainHeight(x, z), z);
    if (this.flying) this.pos.y += FLY_H[type] || 6;

    // mesh
    this.mesh = opts.mesh || BUILDERS[type]();
    this.mesh.position.copy(this.pos);
    if (opts.rotY !== undefined) this.mesh.rotation.y = opts.rotY;
    // YXZ: yaw first, then pitch/roll in the yawed frame — so "fall on your side"
    // means the unit's side, not the world's
    this.mesh.rotation.order = 'YXZ';
    this.mesh.userData.entity = this;
    this.mesh.traverse(o => { o.userData.entity = this; });
    this.vScale = V_SCALE[type] || 1;
    this.mesh.scale.setScalar(this.vScale);
    G.entityRoot.add(this.mesh);

    // health bar
    const w = this.isBuilding ? Math.max(6, def.radius * 1.8) : Math.max(2.2, def.radius * 2.4);
    const hb = makeHealthBar(w);
    hb.g.position.y = HB_Y[type] || 3;
    this.hb = hb;
    hb.g.raycast = () => {};        // HUD furniture, never a click target
    hb.bg.raycast = () => {};
    hb.fill.raycast = () => {};
    this.mesh.add(hb.g);

    // selection ring
    if (!opts.noRing) {
      const rr = Math.max(1.4, def.radius * 1.25);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(rr, rr * 1.22, 26),
        new THREE.MeshBasicMaterial({
          color: this.team === TEAM.WILD ? 0x9bff6a : this.team === TEAM.MACHINE ? 0xff6a3d : 0xffe27a,
          transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      // local space is scaled by vScale, so undo it to keep the ring on the ground
      ring.position.y = (this.flying ? -(FLY_H[type] || 6) + 0.25 : 0.22) / this.vScale;
      ring.visible = false;
      ring.raycast = () => {};
      this.ring = ring;
      this.mesh.add(ring);
    }

    addEntity(this);
    /* De-synchronise the first shot without a dice roll: the offset comes from the
       entity id, which only exists after addEntity(), so identical armies behave
       identically every run instead of trading coin flips on who shoots first. */
    this.cooldown = ((this.id * 0.6180339887) % 1) * (def.rate || 1);

    if (opts.kills) { this.kills = opts.kills; this.refreshVeterancy(); }
    this.anim = this.mesh.userData.anim || null;
    if (this.anim && this.anim.torso) this.anim.torsoY = this.anim.torso.position.y;
  }

  get speed() {
    /* Melee animals get a closing burst. Without it a wolf crosses a guard's
       17m firing lane at walking pace and simply dies on the way in — the whole
       reason claws felt hopeless against rifles. */
    const base = this.def.speed || 0;
    return this.chargeT > 0 ? base * 1.45 : base;
  }
  isRooted() { return G.time < this.rootedUntil; }

  aimPoint() {
    _v1.copy(this.pos);
    _v1.y += this.isBuilding ? (HB_Y[this.type] || 4) * 0.55 : (this.flying ? 0 : this.radius + 0.5);
    return _v1;
  }

  muzzlePoint(out) {
    out.copy(this.pos);
    const m = this.anim && this.anim.muzzle;
    if (m) {
      _v2.copy(m).applyQuaternion(this.mesh.quaternion);
      out.add(_v2);
    } else {
      out.y += (HB_Y[this.type] || 3) * 0.6;
    }
    return out;
  }

  /* Kills earn rank: tougher, and they hit harder. Applied on the spot so a unit
     that earns a rank mid-fight feels it immediately. */
  refreshVeterancy() {
    const k = this.kills || 0;
    const rank = k >= 13 ? 3 : k >= 7 ? 2 : k >= 3 ? 1 : 0;
    if (rank === this.vet) return;
    const frac = this.hp / this.maxHp;
    this.vet = rank;
    this.maxHp = Math.round((this.baseHp || this.def.hp) * (1 + 0.15 * rank));
    this.hp = Math.min(this.maxHp, Math.max(this.hp, this.maxHp * frac));
    this.dmgMult = 1 + 0.12 * rank;
    this.showRank();
    if (rank > 0) SFX.promote(this.pos);
  }

  /* Rank pips floating over the unit — cheap, unlit, and only on veterans. */
  showRank() {
    if (this.rankPips) { this.mesh.remove(this.rankPips); this.rankPips = null; }
    if (!this.vet) return;
    const g = new THREE.Group();
    for (let i = 0; i < this.vet; i++) {
      const pip = new THREE.Mesh(RANK_GEO, GLOW(0xffe27a));
      pip.position.set((i - (this.vet - 1) / 2) * 0.42, 0, 0);
      pip.raycast = () => {};
      g.add(pip);
    }
    g.position.y = ((HB_Y[this.type] || 3) + 0.75) / (this.vScale || 1);
    g.renderOrder = 6;
    this.rankPips = g;
    this.mesh.add(g);
  }

  /* Something shot us. Animals are not passive: unless the player gave an
     explicit attack order (which is a contract we honour), the unit turns on
     whoever is hurting it, chases within a leash of where it was standing, and
     then resumes what it was doing. */
  provoke(attacker, quiet) {
    if (!attacker || !attacker.alive || attacker.team === this.team) return;
    this.lastAttacker = attacker;
    if (this.isBuilding) { if (!this.target) this.target = attacker; return; }

    /* A unit that has decided to chew through a blocker STAYS on it. Without this
       a turret's next shot retargets the unit onto something it cannot reach, the
       wall never falls, and the army dies against it — and whether that happened
       came down to where the enemy's randomly-placed patrol nudged the pack.
       Measured: breaches 2/8 -> 6/8, survivor variance CV 141% -> 12%. */
    if (this.target && this.target.alive && G.time < (this._blockUntil || 0)) return;

    /* Pack response. Shooting one wolf brings the ones beside it — this is what
       actually makes claws viable against rifles, because the answer to a gun
       line is focused numbers arriving together, not one animal at a time.
       `quiet` stops the alert cascading across the whole army. */
    if (!quiet) {
      const near = G.grid.near(this.pos.x, this.pos.z, PACK_ALERT, _neigh);
      let alerted = 0;
      for (let i = 0; i < near.length && alerted < 5; i++) {
        const o = near[i];
        if (o === this || !o.alive || o.isBuilding || o.team !== this.team) continue;
        if (o.provokedBy || o.order.type === 'attack') continue;
        if (dist2D(o.pos, this.pos) > PACK_ALERT) continue;
        o.provoke(attacker, true);
        alerted++;
      }
    }

    if (this.order.type === 'attack') return;          // obeying a direct order

    /* Retarget only toward something closer. Swapping to a distant shooter is how
       attack-move ended up choosing 76-87% of a player's targets for them. */
    if (this.target && this.target.alive && this.target !== attacker &&
        dist2D(this.pos, attacker.pos) > dist2D(this.pos, this.target.pos)) return;

    if (!this.provokedBy) {
      this.resumeOrder = {
        type: this.order.type,
        pos: this.order.pos ? this.order.pos.clone() : null,
        target: this.order.target,
      };
      this.provokeAnchor = this.pos.clone();
    }
    this.provokedBy = attacker;
    this.provokeUntil = G.time + 5;
    this.target = attacker;
    // and it breaks into a run to get there
    if (!this.def.ranged && dist2D(this.pos, attacker.pos) > 6) this.chargeT = 2.4;
  }

  /* ------------------------------------------------------------ orders -- */
  setOrder(type, pos, target) {
    /* Re-issuing the order a unit is ALREADY carrying out is a no-op, not a
       reset. Click-spamming an attack order used to pin a squad in place: every
       call cleared `stuck`, and `stuck` is what accumulates to 1.1s before
       breakBlocker() chews through the wall in the way. A player hammering the
       click on a wall-blocked target therefore reset the timer faster than it
       could ever fill, and the wolves stood there forever — measured at 5 of 12
       idle at seven minutes. Spam should be redundant, never harmful.
       A provoked unit is deliberately excluded: there, the repeat click is the
       player overriding a grudge, and it must still land. */
    if (type === 'attack' && target && !this.provokedBy &&
        this.order.type === 'attack' && this.order.target === target) return;

    /* A player order is by definition newer than any grudge, so it clears the
       provoke state outright. Without this the update loop kept overwriting
       `target` with the provoker and, on expiry, replayed the order the player
       had ALREADY replaced — so a squad re-tasked while under fire (the normal
       case in an RTS) obeyed neither the old order nor the new one. */
    this.provokedBy = null;
    this.resumeOrder = null;
    this.provokeAnchor = null;
    this.order.type = type;
    this.order.pos = pos ? pos.clone() : null;
    this.order.target = target || null;
    if (type === 'attack') this.target = target;
    if (type === 'move' || type === 'attackmove') this.target = null;
    if (type === 'stop' || type === 'hold') { this.target = null; this.order.type = type === 'stop' ? 'idle' : 'hold'; }
    this.leash = null;
    this.stuck = 0;
    this._slideUntil = 0;
  }

  /* ------------------------------------------------------------ update -- */
  update(dt) {
    if (!this.alive) return;
    this.animT += dt;

    if (this.isBuilding) { this.updateBuilding(dt); this.postUpdate(dt, 0); return; }
    if (this.def.repair) { this.updateTech(dt); return; }

    if (this.chargeT > 0) this.chargeT -= dt;

    /* resolve an outstanding grudge */
    if (this.provokedBy) {
      const done = !this.provokedBy.alive
        || G.time > this.provokeUntil
        || dist2D(this.pos, this.provokeAnchor) > 26;      // don't be led away
      if (done) {
        this.provokedBy = null;
        this.target = null;
        if (this.resumeOrder) {
          const r = this.resumeOrder; this.resumeOrder = null;
          this.setOrder(r.type === 'idle' ? 'stop' : r.type, r.pos, r.target);
        }
      } else {
        this.target = this.provokedBy;
      }
    }

    /* --- target validity & acquisition --- */
    if (this.target && (!this.target.alive)) { this.target = null; this.leash = null; }
    const ot = this.order.type;
    if (this.order.target && !this.order.target.alive) {
      this.order.target = null;
      if (ot === 'attack') this.order.type = 'idle';
    }
    if (!this.target) {
      if (ot === 'attack' && this.order.target) this.target = this.order.target;
      else {
        const t = acquire(this);
        // anchor to the post it was standing on, not to wherever the chase reached
        if (t) {
          this.target = t;
          if (ot !== 'move' && !this.leash) this.leash = this.pos.clone();
          if (!this.def.ranged && dist2D(this.pos, t.pos) > 8) this.chargeT = 2.2;
        }
      }
    }
    // leash: don't chase forever when auto-acquired. Blacklist the target briefly,
    // otherwise vision (26) < leash (30) re-acquires it on the very next frame, and
    // walk back to the post instead of stopping wherever the chase ended.
    if (this.target && this.leash && dist2D(this.pos, this.leash) > 30) {
      this._shunned = this.target;
      this._shunnedUntil = G.time + 6;
      this.target = null;
      this.leash = null;
      /* Cancel the CHASE, never the order. setOrder('stop') used to fire here, which
         wiped order.pos — so one contact anywhere along the route deleted the
         player's attack-move and the army stopped mid-map. Measured: an un-babysat
         96-pop push arrived with 13 idle survivors and zero coolants killed. Now the
         unit drops the target and the movement-goal block below picks its own
         order.pos back up on the very next frame, so it keeps walking. A unit whose
         order really is 'idle' has no order.pos and stands still exactly as before. */
    }

    /* --- decide movement goal --- */
    let goal = null, goalRadius = 2.2;
    const tgt = this.target;
    let inRange = false;
    if (tgt) {
      const d = dist2D(this.pos, tgt.pos) - tgt.radius;
      inRange = d <= this.def.range;
      const mayChase = !!this.provokedBy || (ot !== 'move' && ot !== 'hold');
      if (!inRange && mayChase) {
        goal = tgt.pos; goalRadius = this.def.range + tgt.radius - 0.4;
      }
    }
    if (!goal && !this.provokedBy && (ot === 'move' || ot === 'attackmove') && this.order.pos) {
      // attack-move means "fight what you meet"; standing still to shoot is the
      // whole point of having a range stat
      if (!(inRange && ot === 'attackmove')) goal = this.order.pos;
    }

    /* --- move ---
       Displacement is measured across the WHOLE step, after separation and
       collision have had their say. Measuring what steer() asked for instead
       reports full speed while pinned against a wall. */
    const wasX = this.pos.x, wasZ = this.pos.z;
    this._stepX = wasX; this._stepZ = wasZ;
    let pushing = false;
    if (goal && !this.isRooted() && !this.keepingPace) {
      const d = dist2D(this.pos, goal);
      if (d <= goalRadius) {
        if (goal === this.order.pos) { this.order.type = 'idle'; this.order.pos = null; }
      } else {
        /* A live wall-slide overrides the beeline for its duration: pressing
           straight at the goal is exactly what wedged the unit in the first place. */
        if (G.time < (this._slideUntil || 0)) {
          _slideGoal.set(this.pos.x + this._slideX * 12, 0, this.pos.z + this._slideZ * 12);
          this.steer(_slideGoal, dt);
        } else this.steer(goal, dt);
        pushing = true;
      }
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 8));
    }

    this.separate(dt);
    if (!this.flying) this.resolveObstacles(dt, wasX, wasZ);
    this.clampToWorld();
    const moved = Math.hypot(this.pos.x - wasX, this.pos.z - wasZ);

    /* --- attack --- */
    this.cooldown -= dt;
    if (tgt && tgt.alive) {
      const d = dist2D(this.pos, tgt.pos) - tgt.radius;
      if (d <= this.def.range + 0.35) {
        this.faceTo(tgt.pos, dt, 10);
        if (this.cooldown <= 0 && !this.isRooted()) this.attack(tgt);
      }
    } else if (moved > 0.001) {
      _face.copy(this.pos).add(this.vel);
      this.faceTo(_face, dt, 7);
    }

    /* --- stuck detection: chew through whatever is in the way --- */
    if (pushing && moved < this.speed * dt * 0.25 && !this.isRooted()) {
      this.stuck += dt;
      if (this.stuck > 1.1 && !this.flying) { this.breakBlocker(); this.stuck = 0; }
    } else this.stuck = Math.max(0, this.stuck - dt);

    this.postUpdate(dt, moved / Math.max(0.0001, dt));
  }

  /* ---------------------------------------------------------------- tech --
     The compound's answer to attrition. A swarm wins by trading cheap bodies
     for permanent chip damage on expensive structures; the technician is what
     makes that trade stop paying. It is unarmed and flees fights, so the
     counterplay is simply to shoot it -- which costs the player attention at
     exactly the moment they have least to spare.                            */
  updateTech(dt) {
    let best = null, bd = 1e9;
    for (const o of G.entities) {
      if (!o.alive || !o.isBuilding || o.team !== this.team) continue;
      if (o.hp >= o.maxHp) continue;
      /* Once the Core is cooking it is past welding, permanently — so it is not
         a repair target at all. Every other building stays a target even while
         it is being chewed: the technician still walks into the fight, which is
         what makes "Kill it first" a real instruction. What is gated is the
         WELD, not the walk (see below). */
      if (o === G.core && G.coreExposed) continue;
      const d = dist2D(this.pos, o.pos);
      /* prefer things that are nearly dead -- saving a wall is worth less than
         saving the coolant tower the player has spent two minutes on */
      const score = d * (0.35 + 0.65 * (o.hp / o.maxHp));
      if (score < bd) { bd = score; best = o; }
    }

    let moved = 0;
    const fromX = this.pos.x, fromZ = this.pos.z;
    if (best) {
      const gap = dist2D(this.pos, best.pos) - best.radius;
      if (gap > this.def.range) {
        if (!this.isRooted()) moved = this.steer(best.pos, dt);
      } else {
        this.faceTo(best.pos, dt, 8);
        const before = best.hp;
        /* The player's own regeneration is gated on five seconds out of combat
           precisely so it "must never win a fight". The machine's had no gate
           at all, so two technicians at repair 16 out-healed a swarm standing
           on top of the building — measured at +32.5 hp/s on a Core the player
           was actively hitting, which made a fully disarmed compound literally
           unkillable. Same rule for both sides now: you cannot weld a hull
           somebody is still biting.

           Deliberately gated here rather than in target selection. If the
           technician simply skipped whatever was under fire it would never come
           to the fight at all, and the one counterplay the design gives the
           player — shoot the welder — would stop existing. It still walks in.
           It just cannot undo damage while the damage is happening. */
        if (G.time - (best.lastHitAt || -999) >= RULES.techRepairDelay) {
          /* Weld up to the CEILING, not to full. Structural damage is
             permanent, so every assault that gets through lowers what the
             compound can ever be restored to. */
          const ceiling = best.maxHp - (best.scar || 0);
          if (best.hp < ceiling) best.hp = Math.min(ceiling, best.hp + this.def.repair * dt);
        }
        this.repairing = best.hp > before;
        /* one spark per half second, not per frame */
        this._weldT = (this._weldT || 0) + dt;
        if (this.repairing && this._weldT > 0.5) {
          this._weldT = 0;
          SFX.weld(this.pos);
          _v1.copy(best.pos); _v1.y += best.radius * 0.6;
          burst(_v1, 0x59e5ff, 5, 3);
        }
      }
    } else {
      this.repairing = false;
      /* nothing to fix: drift home and wait to be useful */
      if (G.core && G.core.alive && dist2D(this.pos, G.core.pos) > 18) {
        if (!this.isRooted()) moved = this.steer(G.core.pos, dt);
      } else this.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
    }

    /* same collision contract as every other walker — a welder does not phase
       through the perimeter it is welding */
    this.resolveObstacles(dt, fromX, fromZ);
    this.clampToWorld();

    if (!best || moved > 0.001) { _face.copy(this.pos).add(this.vel); this.faceTo(_face, dt, 7); }
    this.postUpdate(dt, moved / Math.max(0.0001, dt));
  }

  steer(goal, dt) {
    _v1.set(goal.x - this.pos.x, 0, goal.z - this.pos.z);
    const d = _v1.length();
    if (d < 0.0001) return 0;
    _v1.divideScalar(d);
    const sp = this.speed * this.greenMult();
    const accel = sp * 5;
    this.vel.x += (_v1.x * sp - this.vel.x) * Math.min(1, accel * dt / sp);
    this.vel.z += (_v1.z * sp - this.vel.z) * Math.min(1, accel * dt / sp);
    const before = this.pos.x, beforeZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    return Math.hypot(this.pos.x - before, this.pos.z - beforeZ);
  }

  separate(dt) {
    const list = G.grid.near(this.pos.x, this.pos.z, 6, _neigh);
    let px = 0, pz = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === this || !o.alive || o.isBuilding) continue;
      if (o.flying !== this.flying) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const need = this.radius + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > need * need || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (need - d) / need;
      px += (dx / d) * push; pz += (dz / d) * push;
    }
    if (this.isBuilding) return;
    /* Clamp the correction to what the unit could actually walk this step. Left
       unbounded a 120-unit pile-up produced 68 m/s displacements against a
       10.5 m/s top speed, which punched units clean through the perimeter. */
    let dx = px * 14 * dt, dz = pz * 14 * dt;
    const mag = Math.hypot(dx, dz);
    // budget the WHOLE step: steer() has already spent part of this frame's travel
    const spent = Math.hypot(this.pos.x - this._stepX, this.pos.z - this._stepZ);
    const cap = Math.max(0.05, this.speed * dt - spent * 0.5);
    if (mag > cap) { const k = cap / mag; dx *= k; dz *= k; }
    this.pos.x += dx;
    this.pos.z += dz;
  }

  /* Swept resolution: which side of an obstacle the unit was on at the START of
     the step decides which way it gets ejected. Using the current position instead
     means that once crowd pressure nudges a centre past the wall's midline the
     resolver helpfully ejects it out the far side — which is precisely how 22 of
     40 wolves ended up inside a sealed perimeter. */
  resolveObstacles(dt, fromX, fromZ) {
    for (const o of G.obstacles) {
      if (!o.alive) continue;
      if (o.box) {
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const ex = o.box.hw + this.radius, ez = o.box.hd + this.radius;
        if (Math.abs(dx) < ex && Math.abs(dz) < ez) {
          // push along the wall's own normal (its thin axis), never along its length
          const alongX = o.box.hw >= o.box.hd;
          if (alongX) {
            const side = Math.sign((fromZ - o.pos.z) || dz || 1);
            this.pos.z = o.pos.z + side * ez;
            if (Math.sign(this.vel.z) === -side) this.vel.z = 0;
          } else {
            const side = Math.sign((fromX - o.pos.x) || dx || 1);
            this.pos.x = o.pos.x + side * ex;
            if (Math.sign(this.vel.x) === -side) this.vel.x = 0;
          }
        }
      } else {
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const need = o.radius + this.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < need * need) {
          // degenerate centre-on-centre: fall back to where it came from
          let nx = dx, nz = dz, d = Math.sqrt(d2);
          if (d < 1e-3) {
            nx = fromX - o.pos.x; nz = fromZ - o.pos.z;
            d = Math.hypot(nx, nz);
            if (d < 1e-3) { nx = 1; nz = 0; d = 1; }
          }
          this.pos.x = o.pos.x + (nx / d) * need;
          this.pos.z = o.pos.z + (nz / d) * need;
        }
      }
    }
  }

  breakBlocker() {
    if (this.target && this.target.def.wall) return;
    let best = null, bd = 1e9;
    for (const o of G.obstacles) {
      if (!o.alive || o.team === this.team || o.team === TEAM.NEUTRAL) continue;
      const d = dist2D(this.pos, o.pos) - (o.box ? Math.max(o.box.hw, o.box.hd) : o.radius);
      if (d < bd && d < 6) { bd = d; best = o; }
    }
    if (best) {
      this.target = best;
      this._blockUntil = G.time + 4;   // commit to the breach for four seconds
      return;
    }
    this.slideOut();
  }

  /* Nothing hostile within reach and still going nowhere — so whatever is in the
     way is our own, and breakBlocker (which skips `o.team === this.team`) has no
     answer for it. A machine raider wedged in its own perimeter corner therefore
     had no recourse at all: it pressed into the fence until the match ended.
     Measured before this existed: a sweep carrying an explicit "attack the Heart
     Tree" order sat at one coordinate for 286 consecutive seconds while the tree
     finished at full health. Slide ALONG the blocker rather than into it. */
  slideOut() {
    let best = null, bd = 1e9;
    for (const o of G.obstacles) {
      if (!o.alive || o === this) continue;
      const d = dist2D(this.pos, o.pos) - (o.box ? Math.max(o.box.hw, o.box.hd) : o.radius);
      if (d < bd && d < 7) { bd = d; best = o; }
    }
    if (!best) return;
    let nx = this.pos.x - best.pos.x, nz = this.pos.z - best.pos.z;
    const n = Math.hypot(nx, nz);
    if (n < 1e-3) { nx = 1; nz = 0; } else { nx /= n; nz /= n; }
    /* An inside corner blocks BOTH tangents, so a slide that keeps picking the
       same one never escapes. Alternate on a repeat attempt. */
    if (G.time - (this._slideAt || -99) < 2.5) this._slideFlip = !this._slideFlip;
    else this._slideFlip = false;
    this._slideAt = G.time;
    const goal = (this.target && this.target.alive) ? this.target.pos : this.order.pos;
    const gx = goal ? goal.x - this.pos.x : -nx;
    const gz = goal ? goal.z - this.pos.z : -nz;
    const tx = -nz, tz = nx;
    let sgn = (gx * tx + gz * tz) >= 0 ? 1 : -1;
    if (this._slideFlip) sgn = -sgn;
    // a little outward bias too, or a unit pinched between two faces stays pinched
    let sx = tx * sgn + nx * 0.35, sz = tz * sgn + nz * 0.35;
    const m = Math.hypot(sx, sz) || 1;
    this._slideX = sx / m; this._slideZ = sz / m;
    this._slideUntil = G.time + 1.2;
  }

  clampToWorld() {
    this.pos.x = clamp(this.pos.x, -HALF + 4, HALF - 4);
    this.pos.z = clamp(this.pos.z, -HALF + 4, HALF - 4);
  }

  faceTo(p, dt, k = 8) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let d = want - this.mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.mesh.rotation.y += d * Math.min(1, k * dt);
  }

  attack(tgt) {
    this.cooldown = this.def.rate / (this.watered > 0 ? RULES.wateredRate : 1);
    // siege units hit structures far harder than they hit flesh
    const dmg = this.def.dmg * (tgt.isBuilding ? (this.def.siege || 1) : 1) * (this.dmgMult || 1)
              * (this.watered > 0 ? RULES.wateredDmg : 1);
    if (this.def.ranged) {
      this.muzzlePoint(_v2);
      muzzleFlash(_v2, this.def.projectile.color);
      fireProjectile(_v2.clone(), tgt, dmg, this.def.projectile, this);
      this.recoil = 1;
      this.lastFiredAt = G.wallTime;   // fog reads this: shooters reveal themselves
      this.shotSfx();
    } else {
      applyDamage(tgt, dmg, this);
      this.lunge = 1;
      /* melee species get their own bark on the lunge, throttled hard so a pack
         reads as a pack rather than a wall of noise */
      if (this.type === 'bear') SFX.roar(this.pos);
      else if (this.type === 'boar') SFX.snort(this.pos);
      else if (this.type === 'beaver') SFX.gnaw(this.pos);
      burst(tgt.aimPoint(), 0xffd9a0, 4, 6, 0.25, 0.4);
    }
  }

  /* Which gun is firing is tactical information, so give each one its own
     voice rather than a shared click. */
  shotSfx() {
    /* Machines shooting at the player wear a marker for half a second. Only
       machines, and only while firing: this is here so an ambush in the trees
       is answerable, not to strip cover from the whole map. */
    if (this.team === TEAM.MACHINE && this.target && this.target.team === TEAM.WILD) {
      this._markT = (this._markT || 0) - 1;
      if (this._markT <= 0) { this._markT = 3; threatMark(this.pos); }   // every 3rd shot
    }
    const t = this.type;
    if (t === 'turret') SFX.turretShot(this.pos);
    else if (t === 'drone') SFX.droneShot(this.pos);
    else if (t === 'porcupine') SFX.quill(this.pos);
    else if (t === 'hearttree') SFX.quill(this.pos);
    else SFX.shot(this.pos);
  }

  /* ------------------------------------------------- building behaviour -- */
  updateBuilding(dt) {
    const def = this.def;
    /* No power, no guns. This is the swarm's way past a gun line it cannot
       out-trade: find the generators instead of feeding wolves to the turrets.
       Deliberately absolute rather than a slowdown, because "the turrets are
       off" is a thing a player can SEE and act on, and a 40%-rate turret is
       just a turret. */
    /* Overgrowth smothers a gun the same way a dead generator does: vines in the
       barrel. Same absolute gate, same visible tell (the glow goes out), so the
       spell finally answers the one thing that was killing swarms on the
       approach — and the player can SEE which guns it caught. */
    const smothered = G.time < (this.smotheredUntil || -1);
    if (def.ranged && ((this.needsPower && !G.powered) || smothered)) {
      this.target = null;
      if (this.anim && this.anim.glow) this.anim.glow.visible = false;
      burnTick(this, dt);
      return;
    }
    /* ...and back on the moment it is neither. Gated on needsPower it could only
       ever restore a turret, so an Overgrowth cast on any other lit gun would
       have put its lamp out permanently. */
    if (this.anim && this.anim.glow) this.anim.glow.visible = true;
    if (def.ranged) {
      if (this.target && !this.target.alive) this.target = null;
      /* Wind-up. See RULES.turretSpinUp: the gun gets stronger the longer it is
         allowed to keep firing, and goes cold quickly when it is not. Held on
         the turret rather than on the target, so switching victims inside one
         engagement does not reset it — being denied a target does.

         SENTRY TURRETS ONLY. updateBuilding is shared with the Heart Tree,
         which is also a ranged building; letting the tree wind up would hand
         the player back the free garrison that the whole sweep rework exists to
         take away. */
      if (this.type === 'turret') {
        if (this.target) this.spin = Math.min(RULES.turretSpinUp, (this.spin || 0) + dt);
        else this.spin = Math.max(0, (this.spin || 0) - dt * RULES.turretSpinDown);
      }
      if (!this.target) this.target = acquire(this);
      if (this.target && dist2D(this.pos, this.target.pos) > def.range + this.target.radius + 2) this.target = null;
      this.cooldown -= dt;
      /* The tell: the housing glow swells with the wind-up, so "that gun has
         been on us a while" is readable off the board without a HUD. */
      if (this.type === 'turret' && this.anim && this.anim.glow) {
        this.anim.glow.scale.setScalar(1 + 0.7 * ((this.spin || 0) / RULES.turretSpinUp));
      }
      /* Introduce the spell NEXT TO THE PROBLEM IT SOLVES, once per match.
         MEASURED: Overgrowth was affordable and off cooldown for essentially
         all 892 seconds of a winning match — roughly thirty-four casts
         available — and the player cast it twice, because nothing in the flow
         of a match ever poses a question it is the answer to. The wind-up glow
         is the tell; the ability just needed saying out loud beside it, the
         first time a gun is genuinely winding up on the player's own animals.

         DELIBERATELY NOT nested in the glow branch above. That is exactly how
         the glow tell itself came to be dead code for however long: one missing
         object reference silently switched off everything downstream of it. */
      if (this.type === 'turret' && !G.spellHintDone
          && this.target && this.target.team === TEAM.WILD
          && (this.spin || 0) >= RULES.turretSpinUp * 0.45) {
        G.spellHintDone = true;
        toast('That turret is winding up — the longer it fires, the harder it hits. '
              + `[F] Overgrowth smothers it cold for ${RULES.spellDuration}s (${RULES.spellCost} biomass).`, 'warn');
      }
      if (this.target) {
        const h = this.anim && this.anim.head;
        if (h) {
          const want = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z) - this.mesh.rotation.y;
          let d = want - h.rotation.y;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          h.rotation.y += d * Math.min(1, 6 * dt);
        }
        if (this.cooldown <= 0) {
          this.cooldown = def.rate;
          this.muzzlePoint(_v2);
          muzzleFlash(_v2, def.projectile.color);
          const wind = 1 + (RULES.turretSpinMax - 1)
                     * ((this.spin || 0) / RULES.turretSpinUp);
          fireProjectile(_v2.clone(), this.target, def.dmg * wind, def.projectile, this);
          this.lastFiredAt = G.wallTime;
          this.shotSfx();
        }
      }
    }
    burnTick(this, dt);       // damaged structures smoke, then catch fire
    this.tick && this.tick(dt);
  }

  /* ------------------------------------------------------- presentation -- */
  /* A badly hurt animal leaves a trail. This is the informational half of the
     blood: at 96 pop the health bars are a thicket and nobody reads them mid
     fight, but "that one is dripping" is legible at a glance and at any zoom.
     Only below a third health, so it marks the ones actually worth pulling out. */
  bleed(dt) {
    if (this.isBuilding || this.def.mech || !this.alive) return;
    if (this.hp > this.maxHp * 0.34) return;
    this._dripT = (this._dripT || rand(0, 0.6)) - dt;
    if (this._dripT > 0) return;
    this._dripT = rand(0.35, 0.9);
    _v1.copy(this.pos); _v1.y += this.radius * 0.55;
    _v1.x += rand(-0.3, 0.3); _v1.z += rand(-0.3, 0.3);
    bloodDrip(_v1);
  }

  /* Movement multiplier from standing on the Green. Machines get nothing from
     it -- the living ground is not theirs. */
  greenMult() {
    if (this.team !== TEAM.WILD) return 1;
    let m = this.watered > 0 ? RULES.wateredSpeed : 1;
    if (this.flying || !G.verdant) return m;
    const v = G.verdant.at(this.pos.x, this.pos.z);
    return m * (1 + (RULES.greenHaste - 1) * v);
  }

  /* Drinking. A unit that is not fighting and is stood at a shore fills up over
     drinkTime and carries the buff away. The lake's fullness sets the duration,
     so every pump TerraByte keeps running shortens your next push. */
  drink(dt) {
    if (this.team !== TEAM.WILD || this.isBuilding || this.flying) return;
    if (this.watered > 0) { this.watered -= dt; if (this.watered <= 0) this.showWatered(false); }
    if (this.target || G.time - this.lastHitAt < 2) { this.sip = 0; return; }
    /* already well-watered: don't burn the animation topping up from 90% */
    if (this.watered > 4) { this.sip = 0; return; }
    /* ONLY on command. Pricing the buff (it now suppresses the Green's healing
       while it lasts) while leaving the drink automatic was the worst of both:
       a wounded animal parked at a shore re-drank forever and so never healed.
       Measured — two wolves at 28/56 for sixty seconds, one at the lake and one
       inland: the lake wolf gained 1 HP with `watered` cycling 14.4 -> 2.5 ->
       13.1 -> 22.8, the inland wolf healed all 28 and was full in fifteen
       seconds. The W order sets this; drinking clears it. */
    if (!this._wantsDrink) { this.sip = 0; return; }
    const L = lakeAt(this.pos.x, this.pos.z);
    if (!L) { this.sip = 0; return; }
    this.sip = (this.sip || 0) + dt;
    if (this.sip < RULES.drinkTime) return;
    this.sip = 0;
    this._wantsDrink = false;          // one order, one drink
    this.watered = RULES.drinkMin + (RULES.drinkMax - RULES.drinkMin) * L.level;
    this.showWatered(true);
    SFX.drink(this.pos);
    ripple(this.pos, 1.6, 0x8fe8ff);
  }

  /* The beaver's third job. Opportunistic, like drinking: no order to give and
     nothing to micromanage — a beaver that is not fighting patches up whatever
     of yours is hurt nearby, the Heart Tree included. Gated on being out of
     combat for the same reason regeneration is: it must never win a fight, only
     undo the damage between them. The machines have had this since the Field
     Technician shipped; this is the wild side's answer. */
  mend(dt) {
    if (!this.def.mend || this.isBuilding) return;
    this.mending = null;
    if (this.target || G.time - this.lastHitAt < 2 || this.isRooted()) return;
    const reach = this.def.mendRange || 7;
    let best = null, bd = 1e9;
    for (const o of G.entities) {
      if (!o.alive || !o.isBuilding || o.team !== this.team) continue;
      if (o.hp >= o.maxHp) continue;
      const d = dist2D(this.pos, o.pos) - o.radius;
      if (d > reach) continue;
      /* worst-hurt first, so a dying Heart Tree outranks a scratched grove */
      const score = (o.hp / o.maxHp) * 100 + d;
      if (score < bd) { bd = score; best = o; }
    }
    if (!best) return;
    /* Menders on ONE structure fall off geometrically. See RULES.mendStack:
       three beavers healing the Heart Tree at full rate undid an entire
       fifty-eight-machine sweep for ninety-six biomass, live, while that sweep
       stood on top of the tree. The k-th mender on the same target contributes
       mendStack^k, so one gives 14 hp/s, three give 24.5, and no number of them
       ever passes 28 — while the same beavers spread over separate structures
       are untouched, which is the habit worth rewarding.

       The counter self-resets off G.time rather than a frame id: every entity
       updated in one frame reads the same G.time, and the next frame reads a
       different one. No bookkeeping to forget to clear. */
    if (best._mendAt !== G.time) { best._mendAt = G.time; best._mendN = 0; }
    const k = best._mendN++;
    const falloff = Math.pow(RULES.mendStack !== undefined ? RULES.mendStack : 1, k);
    best.hp = Math.min(best.maxHp, best.hp + this.def.mend * falloff * dt);
    this.mending = best;
    this.faceTo(best.pos, dt, 6);
    this._mendT = (this._mendT || 0) + dt;
    if (this._mendT > 0.55) {
      this._mendT = 0;
      _v1.copy(best.pos); _v1.y += best.radius * 0.5;
      burst(_v1, 0x9bff6a, 5, 4, 0.5, 0.5);
      SFX.gnaw(this.pos);
    }
  }

  /* A blue sheen so a watered swarm is readable at a glance, without adding a
     per-unit sprite: swap the body material for a pre-tinted twin.

     This used to write `o.material.emissive.setHex(...)` in place, and that was
     wrong in a way that got worse the longer a match ran. M() in meshes.js is a
     CACHE: every wolf in the game shares one material object per (colour,
     emissive, roughness, ...) key. Mutating it tinted the whole species, and the
     restore path then made the tint permanent — the second wolf to drink read
     the already-blue emissive out of the shared material and stored THAT in
     `userData._em` as its "original", so when its buff ended it faithfully
     restored the wrong colour and every wolf stayed blue for the rest of the
     match.

     Measured before the fix, on three wolves of which one drank: after A alone
     drank, C (which never drank) read 1b4a63 on all five of its sub-meshes; and
     after every buff had expired all three were still 1b4a63.

     Swapping the reference never touches the shared original. The tinted twins
     are cached one-per-base-material, so a swarm of ninety-six animals allocates
     a handful of materials, not ninety-six. */
  showWatered(on) {
    const m = this.mesh;
    if (!m) return;
    m.traverse(o => {
      if (!o.material || !o.material.emissive) return;
      if (on) {
        if (o.userData._baseMat) return;            // already tinted; don't re-capture
        o.userData._baseMat = o.material;
        o.material = wateredTwin(o.material);
      } else if (o.userData._baseMat) {
        o.material = o.userData._baseMat;
        o.userData._baseMat = null;
      }
    });
  }

  /* Out-of-combat regeneration. Deliberately does NOT tick during a fight, so
     it can never win an engagement -- it only spares you the biomass of
     rebuilding the survivors, which is the whole economy of a swarm. */
  regen(dt) {
    if (!this.alive || this.isBuilding) return;
    if (this.team !== TEAM.WILD) return;
    if (this.hp >= this.maxHp) return;
    if (G.time - this.lastHitAt < RULES.regenDelay) return;
    /* WATERED AND HEALING ARE MUTUALLY EXCLUSIVE. This is the price of the buff.
       Watered used to ALSO grant full-Green regeneration anywhere, which made
       drinking strictly better than not drinking in every situation — and with
       the lake sitting 3m off the direct route to the compound, pressing W was
       a reflex with no question attached to it. Now the sip switches the swarm
       from recovering to fighting: +20% rate, +15% damage, +10% move, and for
       those 12-26 seconds nothing heals, not even standing on your own Green.
       So the order of operations becomes the decision. Heal at home FIRST, then
       drink, then commit — because a swarm that drinks while it is hurt has
       thrown away up to a full bar of free healing (0.040/s of max HP on the
       Green, over a 26s buff, is 1.04x max HP forgone) to get a buff it cannot
       yet use. Drink on the way in, never on the way out. */
    if (this.watered > 0) return;
    const v = G.verdant ? G.verdant.at(this.pos.x, this.pos.z) : 0;
    const rate = RULES.regenOffGreen + (RULES.regenOnGreen - RULES.regenOffGreen) * v;
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * rate * dt);
  }

  postUpdate(dt, speedNow) {
    this.regen(dt);
    this.drink(dt);
    this.mend(dt);
    this.bleed(dt);
    // fliers hold a constant clearance over the ground rather than over their
    // spawn point, so they neither clip peaks nor balloon over troughs
    if (this.flying) {
      const want = terrainHeight(this.pos.x, this.pos.z) + (FLY_H[this.type] || 6);
      this.pos.y += (want - this.pos.y) * Math.min(1, dt * 3.5);
    } else {
      this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    }
    this.mesh.position.copy(this.pos);

    /* Impact reads as DISPLACEMENT, not scale. Inflating a unit when it is shot
       is a cartoon pop — it makes a wolf look like a squeaky toy. Instead the body
       is knocked back along the hit vector and leans away from it, recovering over
       ~0.18s. Scale stays locked at vScale for the entity's whole life. */
    this.mesh.scale.setScalar(this.vScale);
    let lean = 0;
    if (this.hitT > 0) {
      this.hitT -= dt;
      const k = Math.max(0, this.hitT) / HIT_TIME;
      const shove = k * k * (this.isBuilding ? 0.12 : 0.5);
      this.mesh.position.x += this.hitDirX * shove;
      this.mesh.position.z += this.hitDirZ * shove;
      lean = k * k * 0.16;
    }
    if (this.lunge > 0) {
      this.lunge -= dt * 6;
      const k = Math.max(0, this.lunge);
      // a melee attack throws its weight forward instead of ballooning
      this.mesh.position.x += Math.sin(this.mesh.rotation.y) * k * 0.55;
      this.mesh.position.z += Math.cos(this.mesh.rotation.y) * k * 0.55;
      lean -= k * 0.10;
    }
    if (this.recoil > 0) this.recoil -= dt * 8;
    if (!this.isBuilding) this.mesh.rotation.x = lean;

    this.animate(dt, speedNow);

    // health bar
    const frac = clamp(this.hp / this.maxHp, 0, 1);
    const show = !!(this.selected
      || (frac < 0.999 && G.time - this.lastHitAt < 6)
      || (this.def.critical && this.team === TEAM.MACHINE));
    this.hb.g.visible = show;
    if (show) {
      this.hb.fill.scale.x = this.hb.width * frac;
      this.hb.fill.position.x = -this.hb.width * (1 - frac) / 2;
      /* Scar tick: a dark notch marking the ceiling this structure can never be
         welded back above. Without it the player has no way to know a failed
         assault achieved anything, which is most of the point of it. */
      if (this.scar > 0 && this.hb.scar) {
        const ceil = clamp(1 - this.scar / this.maxHp, 0, 1);
        this.hb.scar.visible = true;
        this.hb.scar.position.x = this.hb.width * (ceil - 0.5);
      } else if (this.hb.scar) this.hb.scar.visible = false;
      const c = this.team === TEAM.MACHINE ? 0x39d7ea : this.team === TEAM.NEUTRAL ? 0xffe27a : (frac > 0.5 ? 0x7fd44a : frac > 0.25 ? 0xffc85c : 0xff6a3d);
      this.hb.fill.material.color.setHex(c);
      this.hb.g.quaternion.copy(G.camera.quaternion);
      // keep bar upright regardless of parent yaw
      this.hb.g.quaternion.premultiply(_q.setFromAxisAngle(_yAxis, -this.mesh.rotation.y));
    }
    if (this.rankPips) {
      this.rankPips.quaternion.copy(G.camera.quaternion);
      this.rankPips.quaternion.premultiply(_q.setFromAxisAngle(_yAxis, -this.mesh.rotation.y));
    }
    if (this.ring) this.ring.visible = this.selected;
  }

  animate(dt, speedNow) {
    const a = this.anim;
    if (!a) return;
    const t = this.animT;
    switch (a.kind) {
      case 'quad': {
        const rel = clamp(speedNow / Math.max(1, this.speed), 0, 1.4);
        const ph = t * (6 + rel * 9);
        // two merged diagonal pairs, each baked at rest — swing them in antiphase
        for (let i = 0; i < a.legs.length; i++) {
          const l = a.legs[i];
          const sgn = i === 0 ? 1 : -1;
          const sw = Math.sin(ph) * sgn;
          l.position.z = sw * 0.45 * rel;
          l.position.y = Math.max(0, sw) * 0.16 * rel;
        }
        if (a.torso) a.torso.position.y = a.torsoY + Math.sin(ph * 2) * 0.07 * rel;
        if (a.head) a.head.rotation.x = Math.sin(t * 1.7) * 0.05 - rel * 0.12;
        if (a.tail) a.tail.rotation.y = Math.sin(t * 4) * 0.35 * (0.3 + rel);
        break;
      }
      case 'biped': {
        const rel = clamp(speedNow / Math.max(1, this.speed), 0, 1.4);
        const ph = t * (5 + rel * 8);
        a.legs[0].position.z = Math.sin(ph) * 0.42 * rel;
        a.legs[1].position.z = -Math.sin(ph) * 0.42 * rel;
        a.legs[0].position.y = 0.52 + Math.max(0, Math.sin(ph)) * 0.09 * rel;
        a.legs[1].position.y = 0.52 + Math.max(0, -Math.sin(ph)) * 0.09 * rel;
        a.torso.rotation.y = Math.sin(ph) * 0.08 * rel;
        if (a.gun) a.gun.position.z = 0.5 - Math.max(0, this.recoil || 0) * 0.35;
        break;
      }
      case 'bird': {
        const flap = Math.sin(t * 11 + a.hover);
        for (const { w, s } of a.wings) { w.rotation.z = -s * (flap * 0.6 + 0.15); w.rotation.x = flap * 0.1; }
        a.body.position.y = Math.sin(t * 2.3 + a.hover) * 0.45;
        a.body.rotation.x = -clamp(speedNow / 40, 0, 0.35);
        break;
      }
      case 'drone': {
        for (const r of a.rotors) r.rotation.y += dt * 40;
        a.body.position.y = Math.sin(t * 3 + a.hover) * 0.3;
        a.body.rotation.x = -clamp(speedNow / 45, 0, 0.3);
        break;
      }
      case 'coolant': {
        const h = this.hp / this.maxHp;
        a.fan.rotation.y += dt * (0.6 + h * 5.5);
        break;
      }
      case 'core': {
        // once the coolant is gone the racks strobe as the core cooks itself
        if (G.coreExposed) {
          for (let i = 0; i < a.strips.length; i++)
            a.strips[i].visible = Math.sin(t * 9 + i * 0.7) > -0.2;
        }
        break;
      }
      case 'tree': {
        a.canopy.rotation.z = Math.sin(t * 0.5 + a.phase) * 0.025;
        a.canopy.rotation.x = Math.cos(t * 0.4 + a.phase) * 0.02;
        a.heart.scale.setScalar(1 + Math.sin(t * 1.6) * 0.08);
        if (a.motes) {
          a.motes.rotation.y += dt * 0.22;
          a.motes.position.y = 18 + Math.sin(t * 0.7) * 0.8;
        }
        break;
      }
      case 'grove': {
        // Y-axis billboard: face the camera, stay upright
        const cp = G.camera.position;
        a.pillar.rotation.y = Math.atan2(cp.x - this.pos.x, cp.z - this.pos.z);
        if (a.beaconRing && a.beaconRing.visible) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + a.phase);
          const fade = a.beaconRing.userData.fade;
          a.beaconRing.scale.setScalar(0.86 + pulse * 0.22);
          a.beaconRing.material.opacity = (0.20 + pulse * 0.26) * (fade === undefined ? 1 : fade);
        }
        break;
      }
      case 'turret': break;
      case 'pump': {
        if (a.wheel) a.wheel.rotation.y += dt * 2.4;
        break;
      }
      case 'depot': {
        if (a.beacon) a.beacon.visible = Math.sin(t * 3) > -0.2;
        break;
      }
    }
  }

  /* --------------------------------------------------------- dying ------ */
  /* Called the instant hp hits zero. Sets up a corpse that behaves like the
     thing it was: flesh falls over, fliers fall out of the sky, machines that
     were holding themselves up stop. */
  onKilled() {
    const style = this.def.death || (this.isBuilding ? 'collapse' : 'topple');
    this.corpse = {
      style, t: 0, settled: false, sinking: 0,
      roll: 0, pitch: 0,
      side: Math.random() < 0.5 ? 1 : -1,
      rollVel: 0, pitchVel: 0, vy: 0,
      trail: 0,
      hold: this.isBuilding ? 1.6 : rand(2.6, 3.6),
    };
    const c = this.corpse;
    if (style === 'topple') {
      // a nudge to break the balance; heavier things start slower
      c.rollVel = c.side * rand(0.5, 1.1) / (0.5 + this.def.radius);
      // a body already moving carries that momentum into the fall
      c.pitch = 0;
      c.leadVel = { x: this.vel.x * 0.35, z: this.vel.z * 0.35 };
    } else if (style === 'fall') {
      c.vy = rand(0, 2);                       // a small kick before gravity wins
      c.rollVel = rand(-4, 4);
      c.pitchVel = rand(-3.5, 3.5);
      c.leadVel = { x: this.vel.x * 0.55, z: this.vel.z * 0.55 };
    }
  }

  /* Returns true when the corpse is finished and the entity can be removed. */
  updateCorpse(dt) {
    if (!this.corpse) return true;
    const c = this.corpse;
    const m = this.mesh;
    c.t += dt;

    if (c.style === 'fall') {
      c.vy -= 24 * dt;
      this.pos.y += c.vy * dt;
      this.pos.x += c.leadVel.x * dt;
      this.pos.z += c.leadVel.z * dt;
      c.roll += c.rollVel * dt;
      c.pitch += c.pitchVel * dt;

      // machines burn on the way down
      if (this.team === TEAM.MACHINE) {
        c.trail -= dt;
        if (c.trail <= 0) { c.trail = 0.07; deathTrail(this.pos, 0.55); }
      }

      const gy = terrainHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= gy + 0.35) {
        this.pos.y = gy + 0.35;
        dustPuff(this.pos, 1.1, 6);
        if (this.team === TEAM.MACHINE) {
          // a drone hitting the ground is the explosion — it does not lie there
          explode(this.pos.clone(), 0.5, {});
          return true;
        }
        // a bird that has been shot down comes to rest on its side
        c.style = 'topple'; c.settled = true; c.settleAt = c.t;
        c.roll = c.side * Math.PI / 2; c.pitch = 0;
      }
      m.position.copy(this.pos);
      m.rotation.set(c.pitch, m.rotation.y, c.roll);
      return false;
    }

    if (c.style === 'topple') {
      if (!c.settled) {
        // torque about the contact point; mass resists
        c.rollVel += c.side * (7.5 / (0.55 + this.def.radius)) * dt;
        c.roll += c.rollVel * dt;
        if (c.leadVel) {                       // momentum carries the body a little
          this.pos.x += c.leadVel.x * dt; this.pos.z += c.leadVel.z * dt;
          c.leadVel.x *= 1 - dt * 3; c.leadVel.z *= 1 - dt * 3;
        }
        const limit = Math.PI / 2;
        if (Math.abs(c.roll) >= limit) {
          c.roll = c.side * limit;
          if (Math.abs(c.rollVel) > 2.2) {
            c.rollVel *= -0.22;                // one small bounce off the ground
            dustPuff(this.pos, this.def.radius * 0.8, 4);
            SFX.thud(this.pos);
          } else {
            c.rollVel = 0; c.settled = true; c.settleAt = c.t;
            dustPuff(this.pos, this.def.radius * 0.9, 5);
            SFX.thud(this.pos);
          }
        }
      }
      /* The pivot is the feet, so a 90-degree roll lays the body out along the
         ground on its own — no fudge factor needed, just a hair of sink so it
         doesn't hover over uneven terrain. */
      m.position.set(this.pos.x, terrainHeight(this.pos.x, this.pos.z) - this.def.radius * 0.18, this.pos.z);
      m.rotation.set(0, m.rotation.y, c.roll);

      if (c.settled && c.t - c.settleAt > c.hold) {
        c.sinking += dt;
        m.position.y -= c.sinking * c.sinking * 2.2;
        if (c.sinking > 1.4) return true;
      }
      return false;
    }

    /* collapse — structures settle into their own footprint and are gone */
    const k = Math.min(1, c.t / 2.4);
    m.position.set(this.pos.x, this.pos.y - k * k * 13, this.pos.z);
    m.rotation.set(k * 0.10 * c.side, m.rotation.y, k * 0.16 * c.side);
    return c.t > 2.4;
  }

  destroyMesh() {
    G.entityRoot.remove(this.mesh);
    /* The selection ring and health bar are built per entity, so they are ours
       to release; everything else is shared from a cache and must be left alone. */
    if (this.ring) { this.ring.geometry.dispose(); this.ring.material.dispose(); this.ring = null; }
    if (this.hb) {
      this.hb.bg.material.dispose();
      this.hb.fill.material.dispose();
      if (this.hb.scar) this.hb.scar.material.dispose();
      this.hb = null;
    }
    if (this.rankPips) { this.rankPips.children.forEach(p => p.geometry === undefined || 0); this.rankPips = null; }
    this._shunned = null; this.lastAttacker = null; this.provokedBy = null;
  }
}

const _q = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------ target picking -- */
export function acquire(e) {
  const range = e.def.building ? (e.def.range || 0) : e.def.vision;
  if (!range) return null;
  const list = G.grid.near(e.pos.x, e.pos.z, range, _neigh);
  let best = null, bd = 1e9;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o.alive || o.team === e.team || o.team === TEAM.NEUTRAL) continue;
    if (o.type === 'core' && !G.coreExposed) continue;
    if (o === e._shunned && G.time < e._shunnedUntil) continue;
    const d = dist2D(e.pos, o.pos) - o.radius;
    if (d > range) continue;
    /* Prefer whatever is actually a threat: the thing shooting us first, then
       other shooters, then bodies, then structures, then walls last. Distance
       still breaks ties. */
    let score = d + (o.def.wall ? 40 : 0) + (o.isBuilding ? 12 : 0);
    if (o === e.lastAttacker) score -= 14;
    else if (o.def.ranged && !o.isBuilding) score -= 6;
    /* Taunt. A capybara is only a shield if the guns actually take the bait --
       tanky-but-ignored just means the swarm gets shot out from behind it.
       Weighted above "shot me last" so a wall of capybaras holds aggro even
       once the wolves behind them start biting. */
    if (o.def.taunt) score -= o.def.taunt;
    if (score < bd) { bd = score; best = o; }
  }
  return best;
}

export function spawn(type, x, z, opts) {
  return new Entity(type, x, z, opts);
}
