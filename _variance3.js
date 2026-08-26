/* ==========================================================================
   VARIANCE HARNESS v3   (test scaffolding, NOT shipped game code)
   VARIANCE CRITIC, round 3.

   Inherits the two hard-won facts from rounds 1 and 2:

   (1) main.js keeps a free-running rAF/setTimeout loop alive even under
       ?headless=1. Between two harness evals the sim advances at WALL-CLOCK
       rate. Any bot driven across multiple evals therefore leaks an
       uncontrolled, latency-dependent stretch of sim time in which it issues
       no orders and queues no units. G.paused gates `G.time += dt`, so we
       hold the sim paused at ALL times except inside one synchronous burst.
       Sim time is then a pure function of frames stepped.

   (2) G.pop is POPULATION, not unit count (boar 2, bear 4, capybara 2).
       Every threshold below is pop; unit counts are reported alongside.

   v3 adds the one experiment that can actually settle "is this luck":
       a seeded PRNG override installed BEFORE __begin(), so world
       generation and every gameplay draw become reproducible. With the seed
       held fixed, any remaining spread is NOT RNG. With the seed varied and
       nothing else, the spread measured IS exactly the RNG's contribution.
   ========================================================================== */
(function () {
  const COMP = {
    siege: ['boar', 'capybara', 'boar', 'porcupine', 'bear', 'boar', 'capybara', 'porcupine', 'bear', 'boar'],
    swarm: ['wolf', 'wolf', 'boar', 'wolf', 'raven', 'wolf', 'wolf', 'capybara', 'boar', 'raven'],
  };

  let cfg = null, S = null;

  /* ---- seeded PRNG (mulberry32) -------------------------------------------
     Installed over Math.random. Must be called before __begin() to also
     determinise world generation (starting wolf spawns, depot phase offsets,
     compound guard/drone placement, patrol routes).                         */
  window.__seedRandom = function (seed) {
    let a = seed >>> 0;
    Math.random = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return seed;
  };

  const G = () => window.G;
  const api = () => window.__api;
  const P = e => (e.def.pop || 1);
  function units() {
    const a = [];
    for (const e of G().entities) if (e.alive && e.team === 'wild' && !e.isBuilding) a.push(e);
    return a;
  }
  function machineUnits() {
    let n = 0;
    for (const e of G().entities) if (e.alive && e.team === 'machine' && !e.isBuilding) n++;
    return n;
  }
  function d2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  const aliveOf = t => G().entities.filter(e => e.alive && e.type === t).length;

  /* Re-issuing setOrder every tick resets the `stuck` counter breakBlocker()
     needs, which pins squads against walls forever. Only re-order on change. */
  function order(e, kind, pos, tag) {
    if (e.__tag === tag && e.order.type !== 'idle') return;
    e.__tag = tag;
    e.setOrder(kind, pos);
  }

  function heartPost(i) {
    const p = G().heart.pos.clone();
    const a = (i % 8) / 8 * Math.PI * 2;
    p.x += Math.cos(a) * 11; p.z += Math.sin(a) * 11;
    return p;
  }

  /* Bot logic byte-identical to round 2 so the rounds are comparable. */
  function botTick() {
    const g = G(), us = units();
    let gp = 0, sp = 0, tot = 0;
    for (const e of us) { const p = P(e); tot += p; if (e.__r === 'g') gp += p; else sp += p; }
    for (const e of us) {
      if (e.__r) continue;
      if (cfg.garrisonFrac > 0 && gp < cfg.garrisonFrac * Math.max(tot, 1)) { e.__r = 'g'; gp += P(e); }
      else { e.__r = 's'; sp += P(e); }
    }

    let guard = 0;
    while (g.queue.length < cfg.queueDepth && guard++ < 8) {
      const t = COMP[cfg.comp][S.bi % COMP[cfg.comp].length];
      if (!api().queueUnit(t)) break;
      S.bi++;
    }

    const capturing = new Set();
    if (cfg.groveUnits > 0) {
      for (let gi = 0; gi < g.groves.length; gi++) {
        const gr = g.groves[gi];
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
    if (!S.committed && strikePop >= cfg.commitPop) { S.committed = true; S.commitAt = g.time; }

    let aim = g.core.pos;
    if (cfg.target === 'coolant') {
      const c = g.coolants.filter(k => k.alive);
      if (c.length) aim = c.sort((a, b) => d2(a.pos, g.heart.pos) - d2(b.pos, g.heart.pos))[0].pos;
    }

    let gi2 = 0;
    for (const e of us) {
      if (e.__r === 'g') { order(e, 'attackmove', heartPost(gi2++), 'home'); continue; }
      if (capturing.has(e)) continue;
      if (S.committed) order(e, 'attackmove', aim, cfg.target === 'coolant' ? 'aim' + Math.round(aim.x) : 'core');
      else order(e, 'attackmove', heartPost(gi2++), 'stage');
    }
  }

  function sample() {
    const g = G();
    const nb = g.bloomed || 0;
    while (S.bloomT.length < nb) S.bloomT.push(+g.time.toFixed(1));

    for (let i = 0; i < g.groves.length; i++) {
      const gr = g.groves[i], was = S.own[i];
      if (was === undefined) { S.own[i] = !!gr.owned; continue; }
      if (!!gr.owned !== was) {
        S.own[i] = !!gr.owned;
        (gr.owned ? S.gain : S.loss).push({ g: i, t: +g.time.toFixed(1) });
      }
    }

    const cool = g.coolants.filter(c => c.alive).length;
    while (S.coolT.length < (g.coolants.length - cool)) S.coolT.push(+g.time.toFixed(1));
    if (g.coreExposed && S.exposedAt === null) S.exposedAt = +g.time.toFixed(1);

    for (const e of g.entities) {
      if (S.seen.has(e.id)) {
        if (!e.alive && S.seen.get(e.id)) {
          S.seen.set(e.id, false);
          if (e.isBuilding) { if (e.team === 'machine') S.structKilled++; }
          else if (e.team === 'wild') S.wildLost += P(e);
          else S.machKilled++;
        }
      } else S.seen.set(e.id, e.alive);
    }

    /* Integrate income over time: total biomass EARNED, which is the quantity
       a grove loss actually steals. Spot income at a sample point hides it. */
    S.bioIntegral += (g.income || 0) * 0.495;

    if (g.time < S.nextTele) return;
    S.nextTele = Math.floor(g.time / 10) * 10 + 10;
    const us = units();
    let sp = 0, gp = 0;
    for (const e of us) { if (e.__r === 'g') gp += P(e); else sp += P(e); }
    S.tele.push({
      t: +g.time.toFixed(1),
      pop: g.pop, units: us.length, strikePop: sp, garrPop: gp,
      bio: Math.round(g.biomass), earned: Math.round(S.bioIntegral),
      inc: +(g.income || 0).toFixed(2),
      groves: g.bloomed || 0, lanes: g.lanes || 0,
      heart: Math.round(g.heart.hp), core: Math.round(g.core.hp),
      mUnits: machineUnits(), wave: g.waveNum || 0,
      cool, turr: aliveOf('turret'), dep: aliveOf('depot'), wall: aliveOf('wall'),
      lost: S.wildLost, killed: S.machKilled, struct: S.structKilled,
      committed: S.committed ? 1 : 0,
    });
  }

  window.__H3 = {
    setup(c) {
      const g = G();
      cfg = Object.assign({
        comp: 'siege', garrisonFrac: 0.20, commitPop: 55,
        queueDepth: 3, groveUnits: 3, mode: 'bot', target: 'core',
      }, c || {});
      S = { bi: 0, committed: false, commitAt: null, tele: [], nextTele: 0,
            bloomT: [], coolT: [], exposedAt: null, bioIntegral: 0,
            wildLost: 0, machKilled: 0, structKilled: 0, seen: new Map(),
            own: [], gain: [], loss: [],
            fp: {
              wolves: g.entities.filter(e => e.alive && e.team === 'wild' && !e.isBuilding)
                        .map(e => ({ x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1) })),
              depotT: g.depots.map(d => +d.spawnTimer.toFixed(2)),
              guards: g.entities.filter(e => e.alive && e.type === 'guard')
                        .map(e => +d2(e.pos, g.core.pos).toFixed(1)).sort((a, b) => a - b),
            } };
      g.paused = true;
      return cfg;
    },

    /* One synchronous burst; nothing can interleave, so wall-clock latency
       between evals cannot leak sim time into the match. */
    run(simSec, capSec) {
      const g = G(), t0 = g.time;
      g.paused = false;
      while (g.time - t0 < simSec && !g.over && g.time < (capSec || 1e9)) {
        window.__step(15);              // 0.495s of sim per bot tick
        if (cfg.mode !== 'passive') botTick();
        sample();
      }
      g.paused = true;
      return { t: +g.time.toFixed(1), over: !!g.over };
    },

    runTo(maxSim, wallBudget) {
      const g = G(), w0 = performance.now();
      while (!g.over && g.time < maxSim && (performance.now() - w0) / 1000 < wallBudget) this.run(8, maxSim);
      return { t: +g.time.toFixed(1), over: !!g.over,
               win: !!g.over && !g.core.alive, loss: !!g.over && !g.heart.alive,
               wall: +((performance.now() - w0) / 1000).toFixed(1) };
    },

    summary() {
      const g = G();
      const at = s => { let b = null; for (const r of S.tele) if (r.t <= s + 0.001) b = r; return b; };
      const pick = r => r && { t: r.t, pop: r.pop, units: r.units, bio: r.bio, earned: r.earned,
        inc: r.inc, groves: r.groves, lanes: r.lanes, heart: r.heart, core: r.core,
        mUnits: r.mUnits, wave: r.wave, cool: r.cool, turr: r.turr, dep: r.dep,
        lost: r.lost, killed: r.killed, struct: r.struct, committed: r.committed };
      return {
        over: !!g.over, t: +g.time.toFixed(1),
        win: !!g.over && !g.core.alive, loss: !!g.over && !g.heart.alive,
        heart: Math.round(g.heart.hp), core: Math.round(g.core.hp),
        commitAt: S.commitAt === null ? null : +S.commitAt.toFixed(1),
        exposedAt: S.exposedAt, coolT: S.coolT, bloomT: S.bloomT,
        groveLoss: S.loss, groveGain: S.gain,
        lossBy120: S.loss.filter(x => x.t <= 120).length,
        lost: S.wildLost, killed: S.machKilled, struct: S.structKilled,
        waves: g.waveNum || 0,
        at60: pick(at(60)), at120: pick(at(120)), at180: pick(at(180)),
        at240: pick(at(240)), at300: pick(at(300)),
        fp: S.fp,
      };
    },
    tele() { return S.tele; },
  };
})();
