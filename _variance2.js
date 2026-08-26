/* ==========================================================================
   VARIANCE HARNESS v2  (test scaffolding, not shipped game code)
   VARIANCE CRITIC round 2.

   Built on round 1's key discovery: main.js keeps a free-running rAF loop
   alive even in ?headless=1, so between two harness evals the sim advances at
   WALL-CLOCK rate (re-measured this run: 6.93s of G.time across one round
   trip, ratio 1.00). G.paused gates `G.time += dt`, so we hold the sim paused
   at ALL times except inside one synchronous burst. Sim time is then a pure
   function of frames stepped and is independent of round-trip latency and of
   how many other browser tabs are competing for CPU.

   v2 adds the instrumentation the divergence analysis needs:
     - coolant tower kill timestamps + coreExposed time
       (the Core is INVULNERABLE until every coolant is dead - combat.js:185)
     - cumulative wild losses / machine kills, sampled at 0.495s
     - per-structure-class survival (turrets, depots, walls, coolants)
     - the opening RNG fingerprint (depot spawn timers, starting wolf spawns)
   ========================================================================== */
(function () {
  const G = window.G, api = window.__api;

  const COMP = {
    siege: ['boar', 'capybara', 'boar', 'porcupine', 'bear', 'boar', 'capybara', 'porcupine', 'bear', 'boar'],
    swarm: ['wolf', 'wolf', 'boar', 'wolf', 'raven', 'wolf', 'wolf', 'capybara', 'boar', 'raven'],
  };

  let cfg = null, S = null;

  const P = e => (e.def.pop || 1);
  function units() {
    const a = [];
    for (const e of G.entities) if (e.alive && e.team === 'wild' && !e.isBuilding) a.push(e);
    return a;
  }
  function machineUnits() {
    let n = 0;
    for (const e of G.entities) if (e.alive && e.team === 'machine' && !e.isBuilding) n++;
    return n;
  }
  function d2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  const aliveOf = t => G.entities.filter(e => e.alive && e.type === t).length;

  function order(e, kind, pos, tag) {
    if (e.__tag === tag && e.order.type !== 'idle') return;
    e.__tag = tag;
    e.setOrder(kind, pos);
  }

  function heartPost(i) {
    const p = G.heart.pos.clone();
    const a = (i % 8) / 8 * Math.PI * 2;
    p.x += Math.cos(a) * 11; p.z += Math.sin(a) * 11;
    return p;
  }

  /* Round-1 bot logic, unchanged, so the two rounds are comparable. */
  function botTick() {
    const us = units();
    let gp = 0, sp = 0, tot = 0;
    for (const e of us) { const p = P(e); tot += p; if (e.__r === 'g') gp += p; else sp += p; }
    for (const e of us) {
      if (e.__r) continue;
      if (cfg.garrisonFrac > 0 && gp < cfg.garrisonFrac * Math.max(tot, 1)) { e.__r = 'g'; gp += P(e); }
      else { e.__r = 's'; sp += P(e); }
    }

    let guard = 0;
    while (G.queue.length < cfg.queueDepth && guard++ < 8) {
      const t = COMP[cfg.comp][S.bi % COMP[cfg.comp].length];
      if (!api.queueUnit(t)) break;
      S.bi++;
    }

    const capturing = new Set();
    if (cfg.groveUnits > 0) {
      for (let gi = 0; gi < G.groves.length; gi++) {
        const gr = G.groves[gi];
        if (!gr.alive || gr.owned) continue;
        const pool = us.filter(e => e.__r === 's' && !capturing.has(e))
          .sort((a, b) => d2(a.pos, gr.pos) - d2(b.pos, gr.pos));
        for (let k = 0; k < Math.min(cfg.groveUnits, pool.length); k++) {
          const e = pool[k];
          capturing.add(e);
          order(e, 'attackmove', gr.pos, 'grove' + gi);
        }
      }
    }

    let strikePop = 0;
    for (const e of us) if (e.__r === 's' && !capturing.has(e)) strikePop += P(e);
    if (!S.committed && strikePop >= cfg.commitPop) { S.committed = true; S.commitAt = G.time; }

    /* cfg.target: 'core' reproduces round 1 exactly. 'coolant' is the variant
       that actually aims at the thing gating the win condition. */
    let aim = G.core.pos;
    if (cfg.target === 'coolant') {
      const c = G.coolants.filter(k => k.alive);
      if (c.length) aim = c.sort((a, b) => d2(a.pos, G.heart.pos) - d2(b.pos, G.heart.pos))[0].pos;
    }

    let gi2 = 0;
    for (const e of us) {
      if (e.__r === 'g') { order(e, 'attackmove', heartPost(gi2++), 'home'); continue; }
      if (capturing.has(e)) continue;
      if (S.committed) order(e, 'attackmove', aim, cfg.target === 'coolant' ? 'aim' + Math.round(aim.x) : 'core');
      else order(e, 'attackmove', heartPost(gi2++), 'stage');
    }
  }

  /* Sampled every bot tick (0.495s), not every 10s, so event times are sharp. */
  function sample() {
    const nb = G.bloomed || 0;
    while (S.bloomT.length < nb) S.bloomT.push(+G.time.toFixed(1));

    /* Per-grove ownership transitions. A grove flipping owned->false is the
       event the whole divergence analysis turns on: it costs income, starts an
       18s dormancy (RULES.groveDormant) during which the ground cannot be
       retaken, and can drop a production lane (lanes = 1+floor(bloomed/2)). */
    for (let i = 0; i < G.groves.length; i++) {
      const g = G.groves[i], was = S.own[i];
      if (was === undefined) { S.own[i] = !!g.owned; continue; }
      if (!!g.owned !== was) {
        S.own[i] = !!g.owned;
        (g.owned ? S.gain : S.loss).push({ g: i, t: +G.time.toFixed(1) });
      }
    }

    const cool = G.coolants.filter(c => c.alive).length;
    while (S.coolT.length < (G.coolants.length - cool)) S.coolT.push(+G.time.toFixed(1));
    if (G.coreExposed && S.exposedAt === null) S.exposedAt = +G.time.toFixed(1);

    /* deaths, by id transition */
    for (const e of G.entities) {
      if (S.seen.has(e.id)) {
        if (!e.alive && S.seen.get(e.id)) {
          S.seen.set(e.id, false);
          if (e.isBuilding) { if (e.team === 'machine') S.structKilled++; }
          else if (e.team === 'wild') S.wildLost += P(e);
          else S.machKilled++;
        }
      } else S.seen.set(e.id, e.alive);
    }

    if (G.time < S.nextTele) return;
    S.nextTele = Math.floor(G.time / 10) * 10 + 10;
    const us = units();
    let sp = 0, gp = 0;
    for (const e of us) { if (e.__r === 'g') gp += P(e); else sp += P(e); }
    S.tele.push({
      t: +G.time.toFixed(1),
      pop: G.pop, units: us.length, strikePop: sp, garrPop: gp,
      bio: Math.round(G.biomass), inc: +(G.income || 0).toFixed(2),
      groves: G.bloomed || 0, lanes: G.lanes || 0,
      heart: Math.round(G.heart.hp), core: Math.round(G.core.hp),
      mUnits: machineUnits(), wave: G.waveNum || 0,
      cool, turr: aliveOf('turret'), dep: aliveOf('depot'), wall: aliveOf('wall'),
      lost: S.wildLost, killed: S.machKilled, struct: S.structKilled,
      committed: S.committed ? 1 : 0,
    });
  }

  window.__H2 = {
    setup(c) {
      cfg = Object.assign({
        comp: 'siege', garrisonFrac: 0.20, commitPop: 55,
        queueDepth: 3, groveUnits: 3, mode: 'bot', target: 'core',
      }, c || {});
      S = { bi: 0, committed: false, commitAt: null, tele: [], nextTele: 0,
            bloomT: [], coolT: [], exposedAt: null,
            wildLost: 0, machKilled: 0, structKilled: 0, seen: new Map(),
            own: [], gain: [], loss: [],
            /* the opening RNG draws: the only things that differ between two
               fresh loads of an otherwise identical setup */
            fp: {
              wolves: G.entities.filter(e => e.alive && e.team === 'wild' && !e.isBuilding)
                        .map(e => ({ x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1) })),
              depotT: G.depots.map(d => +d.spawnTimer.toFixed(2)),
              guards: G.entities.filter(e => e.alive && e.type === 'guard')
                        .map(e => +d2(e.pos, G.core.pos).toFixed(1)).sort((a, b) => a - b),
            } };
      return cfg;
    },

    /* One synchronous burst; nothing can interleave. */
    run(simSec, capSec) {
      const t0 = G.time;
      G.paused = false;
      while (G.time - t0 < simSec && !G.over && G.time < (capSec || 1e9)) {
        window.__step(15);              // 0.495s of sim per bot tick
        if (cfg.mode !== 'passive') botTick();
        sample();
      }
      G.paused = true;
      return { t: +G.time.toFixed(1), over: !!G.over };
    },

    /* Wall budget only decides how many evals a match takes; it never changes
       what the sim does, because every burst is still synchronous. */
    runTo(maxSim, wallBudget) {
      const w0 = performance.now();
      while (!G.over && G.time < maxSim && (performance.now() - w0) / 1000 < wallBudget) this.run(8, maxSim);
      return { t: +G.time.toFixed(1), over: !!G.over,
               win: !!G.over && !G.core.alive, loss: !!G.over && !G.heart.alive,
               wall: +((performance.now() - w0) / 1000).toFixed(1) };
    },

    /* ---- LEAK REPRODUCTION -------------------------------------------------
       Models the PRE-FIX methodology: `chunkSec` of sim with the bot driving,
       then `L` seconds of sim in which the bot issues NOTHING and queues
       NOTHING - exactly what the free-running rAF loop does while the harness
       waits for its next round trip (re-measured this run at 1.00x wall
       clock, 6.93s per trip). Sweeping L is a dose-response for "how much
       does unattended sim time distort the outcome". */
    leak(L, chunkSec, maxSim, wallBudget) {
      const w0 = performance.now();
      let unattended = 0;
      while (!G.over && G.time < maxSim && (performance.now() - w0) / 1000 < wallBudget) {
        G.paused = false;
        const t1 = G.time + chunkSec;
        while (G.time < t1 && !G.over && G.time < maxSim) { window.__step(15); botTick(); sample(); }
        const t2 = G.time + L;
        while (G.time < t2 && !G.over && G.time < maxSim) { window.__step(15); sample(); unattended += 0.495; }
        G.paused = true;
      }
      return { t: +G.time.toFixed(1), over: !!G.over,
               win: !!G.over && !G.core.alive, loss: !!G.over && !G.heart.alive,
               unattended: +unattended.toFixed(1),
               unattendedFrac: +(unattended / Math.max(G.time, 1)).toFixed(3),
               wall: +((performance.now() - w0) / 1000).toFixed(1) };
    },

    summary() {
      const at = s => { let b = null; for (const r of S.tele) if (r.t <= s + 0.001) b = r; return b; };
      const pick = r => r && { t: r.t, pop: r.pop, units: r.units, bio: r.bio, inc: r.inc,
        groves: r.groves, heart: r.heart, core: r.core, mUnits: r.mUnits, wave: r.wave,
        cool: r.cool, turr: r.turr, dep: r.dep, lost: r.lost, killed: r.killed,
        struct: r.struct, committed: r.committed };
      return {
        over: !!G.over, t: +G.time.toFixed(1),
        win: !!G.over && !G.core.alive, loss: !!G.over && !G.heart.alive,
        heart: Math.round(G.heart.hp), core: Math.round(G.core.hp),
        commitAt: S.commitAt === null ? null : +S.commitAt.toFixed(1),
        exposedAt: S.exposedAt, coolT: S.coolT, bloomT: S.bloomT,
        groveLoss: S.loss, groveGain: S.gain,
        lossBy120: S.loss.filter(x => x.t <= 120).length,
        lost: S.wildLost, killed: S.machKilled, struct: S.structKilled,
        waves: G.waveNum || 0,
        at60: pick(at(60)), at120: pick(at(120)), at180: pick(at(180)), at240: pick(at(240)),
        fp: S.fp,
      };
    },
    tele() { return S.tele; },
  };
})();
