/* ==========================================================================
   VARIANCE HARNESS  (test scaffolding, not shipped game code)

   WHY THIS EXISTS
   ---------------
   main.js schedule() keeps a free-running rAF/setTimeout loop alive even in
   ?headless=1. window.__step() does NOT own the clock: between two harness
   evals the simulation advances at WALL-CLOCK rate (measured: 5.68s of G.time
   with zero __step calls). Any bot driven across multiple evals therefore
   leaks an uncontrolled, latency-dependent amount of unattended sim time in
   which it issues no orders and queues no units.

   The fix used here: G.paused gates `G.time += dt`, so the sim is held paused
   at all times EXCEPT inside a single synchronous eval. All stepping and all
   bot decisions happen inside that one synchronous burst, so sim time is a
   pure function of frames stepped and is identical regardless of how slow the
   browser round-trip was.
   ========================================================================== */
(function () {
  const G = window.G, api = window.__api;

  const COMP = {
    // siege: the composition guardrail G3 names
    siege: ['boar', 'capybara', 'boar', 'porcupine', 'bear', 'boar', 'capybara', 'porcupine', 'bear', 'boar'],
    // swarm: the zerg-flavoured second composition
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

  /* Only re-issue when the intent actually changed, or the unit has gone idle.
     Spamming setOrder('attackmove') every tick resets the `stuck` counter that
     breakBlocker() needs, which pins squads against walls forever. */
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

  function botTick() {
    const us = units();

    /* ---- roles: garrison vs strike, by POP not unit count ---------------
       (G.pop is population; a bear is 4. Thresholding on array length here
       would silently never fire.) */
    let gp = 0, sp = 0, tot = 0;
    for (const e of us) { const p = P(e); tot += p; if (e.__r === 'g') gp += p; else sp += p; }
    for (const e of us) {
      if (e.__r) continue;
      if (cfg.garrisonFrac > 0 && gp < cfg.garrisonFrac * Math.max(tot, 1)) { e.__r = 'g'; gp += P(e); }
      else { e.__r = 's'; sp += P(e); }
    }

    /* ---- production ---- */
    let guard = 0;
    while (G.queue.length < cfg.queueDepth && guard++ < 8) {
      const t = COMP[cfg.comp][S.bi % COMP[cfg.comp].length];
      if (!api.queueUnit(t)) break;
      S.bi++;
    }

    /* ---- grove capture ---- */
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

    /* ---- commit decision: strike POP over threshold ---- */
    let strikePop = 0;
    for (const e of us) if (e.__r === 's' && !capturing.has(e)) strikePop += P(e);
    if (!S.committed && strikePop >= cfg.commitPop) { S.committed = true; S.commitAt = G.time; }

    /* ---- orders ---- */
    let gi2 = 0;
    for (const e of us) {
      if (e.__r === 'g') { order(e, 'attackmove', heartPost(gi2++), 'home'); continue; }
      if (capturing.has(e)) continue;
      if (S.committed) order(e, 'attackmove', G.core.pos, 'core');
      else order(e, 'attackmove', heartPost(gi2++), 'stage');
    }
  }

  function tele() {
    /* bloom timestamps are sampled every tick, not every 10s, so the first
       grove's exact bloom time is recorded at 0.5s resolution */
    const nb = G.bloomed || 0;
    while (S.bloomT.length < nb) S.bloomT.push(+G.time.toFixed(1));
    if (G.time < S.nextTele) return;
    S.nextTele = Math.floor(G.time / 10) * 10 + 10;
    const us = units();
    let sp = 0, gp = 0;
    for (const e of us) { if (e.__r === 'g') gp += P(e); else sp += P(e); }
    S.tele.push({
      t: +G.time.toFixed(1),
      pop: G.pop, units: us.length, strikePop: sp, garrPop: gp,
      bio: Math.round(G.biomass), inc: +(G.income || 0).toFixed(2),
      groves: G.bloomed || 0,
      heart: Math.round(G.heart.hp), core: Math.round(G.core.hp),
      mUnits: machineUnits(), wave: G.waveNum || 0,
      committed: S.committed ? 1 : 0,
    });
  }

  window.__H = {
    setup(c) {
      cfg = Object.assign({
        comp: 'siege', garrisonFrac: 0.20, commitPop: 55,
        queueDepth: 3, groveUnits: 3, mode: 'bot',
      }, c || {});
      S = { bi: 0, committed: false, commitAt: null, tele: [], nextTele: 0, bloomT: [],
            /* where the four free wolves happened to spawn: the only RNG that
               touches the opening, and the suspected root of the spread */
            wolf0: G.entities.filter(e => e.alive && e.team === 'wild' && !e.isBuilding)
                     .map(e => ({ x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1) })) };
      return cfg;
    },
    /* One synchronous burst. Nothing can interleave, so sim time advanced is
       exactly frames*33ms and does not depend on round-trip latency. */
    run(simSec, capSec) {
      const t0 = G.time, w0 = performance.now();
      G.paused = false;
      while (G.time - t0 < simSec && !G.over && G.time < (capSec || 1e9)) {
        window.__step(15);              // 0.495s of sim per bot tick
        if (cfg.mode !== 'passive') botTick();
        tele();
      }
      G.paused = true;
      return {
        t: +G.time.toFixed(1), over: !!G.over,
        win: !!G.over && !G.core.alive,
        loss: !!G.over && !G.heart.alive,
        wall: +((performance.now() - w0) / 1000).toFixed(2),
      };
    },

    /* Step until the match ends, the sim cap is hit, or the wall budget is
       spent. Wall budget only decides HOW MANY evals a match takes; it never
       changes what the sim does, because every burst is still synchronous. */
    runTo(maxSim, wallBudget) {
      const w0 = performance.now();
      let r = null;
      while (!G.over && G.time < maxSim && (performance.now() - w0) / 1000 < wallBudget) {
        r = this.run(8, maxSim);
      }
      return {
        t: +G.time.toFixed(1), over: !!G.over,
        win: !!G.over && !G.core.alive, loss: !!G.over && !G.heart.alive,
        wall: +((performance.now() - w0) / 1000).toFixed(1),
      };
    },

    /* ---- LEAK REPRODUCTION -------------------------------------------------
       Models the pre-fix methodology exactly: `chunkSec` of sim with the bot
       driving, then `L` seconds of sim in which the bot issues NOTHING —
       which is what the free-running rAF/setTimeout loop does while the
       harness waits for its next round-trip. Sweeping L is a dose-response
       for "how much does unattended sim time distort the outcome". */
    leak(L, chunkSec, maxSim, wallBudget) {
      const w0 = performance.now();
      G.paused = false;
      let unattended = 0;
      while (!G.over && G.time < maxSim && (performance.now() - w0) / 1000 < wallBudget) {
        const t1 = G.time + chunkSec;
        while (G.time < t1 && !G.over && G.time < maxSim) { window.__step(15); botTick(); tele(); }
        const t2 = G.time + L;
        while (G.time < t2 && !G.over && G.time < maxSim) { window.__step(15); tele(); unattended += 0.495; }
      }
      G.paused = true;
      return {
        t: +G.time.toFixed(1), over: !!G.over,
        win: !!G.over && !G.core.alive, loss: !!G.over && !G.heart.alive,
        unattended: +unattended.toFixed(1),
        wall: +((performance.now() - w0) / 1000).toFixed(1),
      };
    },
    /* Compact end-of-run summary: outcome, duration, and the 120s snapshot
       that the divergence analysis keys off. */
    summary() {
      const at = s => { let b = null; for (const r of S.tele) if (r.t <= s + 0.001) b = r; return b; };
      const m2 = at(120);
      return {
        over: !!G.over, t: +G.time.toFixed(1),
        win: !!G.over && !G.core.alive, loss: !!G.over && !G.heart.alive,
        heart: Math.round(G.heart.hp), core: Math.round(G.core.hp),
        commitAt: S.commitAt === null ? null : +S.commitAt.toFixed(1),
        at120: m2 && { pop: m2.pop, units: m2.units, bio: m2.bio, inc: m2.inc,
                       groves: m2.groves, heart: m2.heart, core: m2.core,
                       mUnits: m2.mUnits, wave: m2.wave, committed: m2.committed },
        waves: G.waveNum || 0,
        bloomT: S.bloomT, wolf0: S.wolf0,
      };
    },
    result() {
      return {
        over: !!G.over, t: +G.time.toFixed(1),
        win: !!G.over && !G.core.alive, loss: !!G.over && !G.heart.alive,
        heart: Math.round(G.heart.hp), core: Math.round(G.core.hp),
        commitAt: S.commitAt, tele: S.tele,
      };
    },
    tele() { return S.tele; },
  };
})();
