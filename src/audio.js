/* =========================================================================
   Web Audio synth. No asset files -- every voice here is oscillators, filtered
   noise, and a procedurally generated impulse response for the room.

   Three things separate this from a beep library:

   * Variation. Ninety wolves biting the identical 200Hz noise burst reads as a
     glitch, not a pack. Every voice jitters pitch, length and filter.
   * Position. Sounds are panned and attenuated against the camera, so a fight
     at the edge of the screen sounds like it is over there. This is most of
     what makes an RTS feel like a place rather than a spreadsheet.
   * Headroom. Forty simultaneous voices will clip a naive master gain, so the
     bus runs through a compressor and the throttles are per-voice.
   ========================================================================= */

import { G } from './state.js';

let ctx = null, master = null, comp = null, verb = null, verbSend = null;
let listenX = 0, listenZ = 0, rightX = 1, rightZ = 0;

const MASTER = 0.35;
let muted = false;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    /* master -> compressor -> out. The compressor is not for taste, it is so a
       coolant tower going up during a 40-unit melee does not clip to a click. */
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22;
    comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.22;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    master.connect(comp);

    /* A short valley-ish tail. Built from decaying noise rather than shipped as
       a file, which keeps the single-file build honest. */
    verb = ctx.createConvolver();
    verb.buffer = makeImpulse(1.6, 2.6);
    const vg = ctx.createGain(); vg.gain.value = 0.9;
    verb.connect(vg); vg.connect(comp);
    verbSend = ctx.createGain(); verbSend.gain.value = muted ? 0 : MASTER * 0.5;
    verbSend.connect(verb);
  } catch (e) { ctx = null; }
}

function makeImpulse(seconds, decay) {
  const n = Math.max(1, (ctx.sampleRate * seconds) | 0);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      /* early reflections thin out into a smooth tail */
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < n * 0.02 ? 1.6 : 1);
    }
  }
  return buf;
}

export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.02);
  if (verbSend) verbSend.gain.setTargetAtTime(muted ? 0 : MASTER * 0.5, ctx.currentTime, 0.02);
  return muted;
}
export function toggleMute() { return setMuted(!muted); }

/* ------------------------------------------------------------- listener -- */
/* Called once a frame from the render loop. We use the camera's ground-plane
   position and its right vector, so panning follows Q/E rotation correctly --
   spinning the camera swaps which ear a fight is in, as it should. */
export function updateListener() {
  const cam = G.camera;
  if (!cam) return;
  listenX = cam.position.x; listenZ = cam.position.z;
  const e = cam.matrixWorld.elements;
  const rx = e[0], rz = e[2];
  const len = Math.hypot(rx, rz) || 1;
  rightX = rx / len; rightZ = rz / len;
}

const AUDIBLE = 150;      // beyond this a sound is simply not played

/* Returns {gain, pan} for a world position, or null if it is out of earshot. */
function place(pos) {
  if (!pos) return { gain: 1, pan: 0 };
  const dx = pos.x - listenX, dz = pos.z - listenZ;
  const d = Math.hypot(dx, dz);
  if (d > AUDIBLE) return null;
  /* rolloff, not linear: things nearby should dominate */
  const gain = 1 / (1 + Math.pow(d / 34, 1.7));
  const pan = Math.max(-0.9, Math.min(0.9, (dx * rightX + dz * rightZ) / 46));
  return { gain, pan };
}

const rnd = (a, b) => a + Math.random() * (b - a);

/* --------------------------------------------------------------- voices -- */
/* Every voice routes: source -> [filters] -> env gain -> panner -> master
                                                      \-> panner -> reverb send */
function voiceOut(node, t0, a, d, peak, opt) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  node.connect(g);

  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = opt.pan || 0; g.connect(p); p.connect(master); }
  else g.connect(master);

  /* send to the room, dry-heavy so the mix stays readable */
  if (verbSend && (opt.wet || 0) > 0) {
    const s = ctx.createGain(); s.gain.value = opt.wet;
    (p || g).connect(s); s.connect(verbSend);
  }
  return g;
}

function tone(freq, o = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const a = o.a === undefined ? 0.005 : o.a;
  const d = (o.d === undefined ? 0.12 : o.d) * rnd(0.9, 1.12);
  const f = freq * (o.vary === false ? 1 : rnd(0.94, 1.07));
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(f, t0);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f + o.slide), t0 + a + d);
  let node = osc;
  if (o.lp) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; osc.connect(lp); node = lp; }
  voiceOut(node, t0, a, d, (o.peak === undefined ? 0.3 : o.peak) * (o.gain === undefined ? 1 : o.gain), o);
  osc.start(t0); osc.stop(t0 + a + d + 0.05);
}

let noiseBuf = null;
function noise(o = {}) {
  if (!ctx) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime;
  const d = (o.d === undefined ? 0.15 : o.d) * rnd(0.88, 1.15);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  /* random start offset: reusing sample 0 every time gives the burst a
     recognisable "click" fingerprint that the ear picks out instantly */
  const off = Math.random() * 0.7;
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass';
  f1.frequency.value = (o.hp === undefined ? 400 : o.hp) * rnd(0.85, 1.18);
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass';
  f2.frequency.value = (o.lp === undefined ? 6000 : o.lp) * rnd(0.85, 1.18);
  if (o.q) { f2.Q.value = o.q; f2.type = 'bandpass'; }
  src.connect(f1); f1.connect(f2);
  voiceOut(f2, t0, o.a === undefined ? 0.004 : o.a, d,
        (o.peak === undefined ? 0.25 : o.peak) * (o.gain === undefined ? 1 : o.gain), o);
  src.start(t0, off); src.stop(t0 + d + 0.15);
}

/* throttle so 40 wolves don't detonate the mixer */
const gates = Object.create(null);
function gate(key, ms) {
  const now = performance.now();
  if (now - (gates[key] || 0) < ms) return false;
  gates[key] = now; return true;
}

/* Wrap a voice so callers can pass a world position and get panning for free.
   `SFX.bite(unit.pos)` is the whole API. */
function sited(key, ms, play) {
  return (pos) => {
    if (!ctx) return false;
    const p = place(pos);
    if (!p) return false;                     // off-screen and far: skip entirely
    if (ms && !gate(key, ms)) return false;
    play(p.gain, p.pan);
    return true;
  };
}

const later = (ms, fn) => setTimeout(() => { if (ctx) fn(); }, ms);

export const SFX = {
  /* ---- interface: deliberately unpositioned, these are the player's own UI -- */
  select:   () => gate('sel', 60) && tone(660, { type: 'triangle', d: 0.07, peak: 0.12, vary: false }),
  order:    () => gate('ord', 60) && tone(440, { type: 'triangle', d: 0.09, peak: 0.14, slide: 180, vary: false }),
  deny:     () => gate('dny', 200) && tone(160, { type: 'square', d: 0.12, peak: 0.12, vary: false }),

  /* ---- gunfire ---- */
  shot: sited('sht', 40, (g, pan) => {
    noise({ d: 0.055, peak: 0.11, hp: 1100, lp: 9000, gain: g, pan, wet: 0.25 });
    tone(180, { type: 'square', d: 0.04, peak: 0.05, slide: -90, gain: g, pan });
  }),
  /* turrets are the same event but heavier, so the player can hear which one is
     shooting at them without looking */
  turretShot: sited('tsh', 55, (g, pan) => {
    noise({ d: 0.10, peak: 0.16, hp: 500, lp: 5200, gain: g, pan, wet: 0.4 });
    tone(96, { type: 'square', d: 0.09, peak: 0.14, slide: -46, gain: g, pan, wet: 0.3 });
  }),
  droneShot: sited('dsh', 55, (g, pan) => {
    tone(1450, { type: 'sawtooth', d: 0.07, peak: 0.07, slide: -900, lp: 5200, gain: g, pan, wet: 0.3 });
  }),
  quill: sited('qll', 60, (g, pan) => {
    noise({ d: 0.06, peak: 0.09, hp: 2200, lp: 11000, gain: g, pan, wet: 0.2 });
    tone(2100, { type: 'sine', d: 0.05, peak: 0.04, slide: -1300, gain: g, pan });
  }),

  /* ---- impacts ---- */
  bite: sited('bit', 55, (g, pan) => {
    noise({ d: 0.075, peak: 0.13, hp: 180, lp: 2100, gain: g, pan, wet: 0.15 });
    tone(rnd(90, 130), { type: 'sawtooth', d: 0.06, peak: 0.07, slide: -40, lp: 900, gain: g, pan });
  }),
  hitMetal: sited('hm', 55, (g, pan) => {
    tone(rnd(950, 1500), { type: 'square', d: 0.05, peak: 0.055, slide: -700, gain: g, pan, wet: 0.35 });
    noise({ d: 0.04, peak: 0.05, hp: 3000, lp: 12000, gain: g, pan, wet: 0.3 });
  }),
  /* wood/stone: walls and structures answer differently to flesh and metal */
  hitStone: sited('hs', 60, (g, pan) => {
    noise({ d: 0.12, peak: 0.13, hp: 260, lp: 1800, gain: g, pan, wet: 0.4 });
    tone(rnd(140, 210), { type: 'triangle', d: 0.10, peak: 0.08, slide: -70, gain: g, pan });
  }),
  gnaw: sited('gnw', 110, (g, pan) => {
    noise({ d: 0.18, peak: 0.08, hp: 700, lp: 3400, q: 3, gain: g, pan, wet: 0.2 });
  }),

  /* ---- death ---- */
  death: sited('dth', 80, (g, pan) => {
    tone(rnd(130, 175), { type: 'sawtooth', d: 0.3, peak: 0.13, slide: -95, lp: 1600, gain: g, pan, wet: 0.35 });
  }),
  /* a body actually landing: the thump is what sells "fell over" */
  thud: sited('thd', 90, (g, pan) => {
    noise({ d: 0.16, peak: 0.14, hp: 40, lp: 420, gain: g, pan, wet: 0.3 });
    tone(58, { type: 'sine', d: 0.20, peak: 0.16, slide: -22, gain: g, pan });
  }),
  boom: sited('bm', 45, (g, pan) => {
    noise({ d: 0.55, peak: 0.38, hp: 40, lp: 1300, gain: g, pan, wet: 0.75 });
    tone(72, { type: 'sine', d: 0.7, peak: 0.38, slide: -42, gain: g, pan, wet: 0.5 });
    /* debris scatter a beat later -- an explosion without it sounds like a drum */
    later(90, () => noise({ d: 0.4, peak: 0.07 * g, hp: 1800, lp: 9000, pan, wet: 0.6 }));
  }),
  /* the big one: a coolant tower or the Core */
  boomBig: sited('bmb', 120, (g, pan) => {
    noise({ d: 1.1, peak: 0.45, hp: 25, lp: 900, gain: g, pan, wet: 1.0 });
    tone(44, { type: 'sine', d: 1.5, peak: 0.45, slide: -24, gain: g, pan, wet: 0.6 });
    tone(150, { type: 'sawtooth', d: 0.5, peak: 0.18, slide: -110, lp: 1200, gain: g, pan, wet: 0.6 });
    later(140, () => noise({ d: 0.9, peak: 0.12 * g, hp: 1400, lp: 8000, pan, wet: 0.9 }));
    later(420, () => noise({ d: 1.2, peak: 0.06 * g, hp: 200, lp: 2600, pan, wet: 1.0 }));
  }),

  /* ---- species voices: the pack should sound like a pack ---- */
  howl: sited('hwl', 2600, (g, pan) => {
    const f = rnd(300, 380);
    tone(f, { type: 'sawtooth', a: 0.09, d: 0.75, peak: 0.10 * g, slide: f * 0.5, lp: 1500, pan, wet: 0.9, vary: false });
    later(120, () => tone(f * 1.5, { type: 'sine', a: 0.12, d: 0.6, peak: 0.04 * g, slide: -f * 0.3, pan, wet: 0.9, vary: false }));
  }),
  roar: sited('ror', 1400, (g, pan) => {
    tone(rnd(70, 95), { type: 'sawtooth', a: 0.05, d: 0.55, peak: 0.17 * g, slide: -28, lp: 700, pan, wet: 0.6 });
    noise({ d: 0.5, peak: 0.09 * g, hp: 90, lp: 900, pan, wet: 0.6 });
  }),
  snort: sited('snt', 900, (g, pan) => {
    noise({ d: 0.13, peak: 0.10 * g, hp: 150, lp: 1400, pan, wet: 0.25 });
    tone(rnd(110, 150), { type: 'square', d: 0.09, peak: 0.06 * g, slide: -50, lp: 800, pan });
  }),
  caw: sited('caw', 1100, (g, pan) => {
    const f = rnd(760, 1000);
    tone(f, { type: 'sawtooth', a: 0.01, d: 0.13, peak: 0.07 * g, slide: -f * 0.45, lp: 4200, pan, wet: 0.5, vary: false });
    later(150, () => tone(f * 0.9, { type: 'sawtooth', a: 0.01, d: 0.10, peak: 0.05 * g, slide: -f * 0.4, lp: 4000, pan, wet: 0.5, vary: false }));
  }),

  /* ---- the compound ---- */
  /* the technician's arc welder: the audio tell that your damage is being undone */
  weld: sited('wld', 260, (g, pan) => {
    noise({ d: 0.22, peak: 0.07 * g, hp: 2600, lp: 9000, q: 6, pan, wet: 0.45 });
    tone(rnd(2400, 3100), { type: 'square', d: 0.12, peak: 0.025 * g, slide: -600, pan, wet: 0.4 });
  }),
  droneHum: sited('dhm', 1500, (g, pan) => {
    tone(rnd(190, 230), { type: 'sawtooth', a: 0.3, d: 0.9, peak: 0.035 * g, lp: 900, pan, wet: 0.5 });
  }),
  /* the Core's shield taking a hit while the coolant towers still stand: this is
     the sound that teaches "you are hitting the wrong thing" */
  shieldPing: sited('shp', 300, (g, pan) => {
    tone(1760, { type: 'sine', a: 0.004, d: 0.45, peak: 0.09 * g, slide: 240, pan, wet: 0.8, vary: false });
    tone(2640, { type: 'sine', a: 0.004, d: 0.35, peak: 0.045 * g, slide: 300, pan, wet: 0.8, vary: false });
  }),
  shieldDown: () => {
    tone(880, { type: 'sine', a: 0.01, d: 1.1, peak: 0.18, slide: -700, wet: 0.9, vary: false });
    noise({ d: 0.9, peak: 0.12, hp: 300, lp: 6000, wet: 0.9 });
    later(160, () => tone(220, { type: 'sine', d: 1.2, peak: 0.14, slide: -120, wet: 0.9, vary: false }));
  },
  wallBreak: sited('wbk', 140, (g, pan) => {
    noise({ d: 0.5, peak: 0.22 * g, hp: 120, lp: 2400, pan, wet: 0.8 });
    tone(90, { type: 'triangle', d: 0.45, peak: 0.15 * g, slide: -40, pan, wet: 0.5 });
    later(110, () => noise({ d: 0.55, peak: 0.09 * g, hp: 900, lp: 5000, pan, wet: 0.8 }));
  }),

  /* ---- your side ---- */
  spawn: () => tone(520, { type: 'sine', d: 0.22, peak: 0.16, slide: 260, wet: 0.3 }),
  bloom: () => {
    /* a rising third, so blooming a grove is unmistakably a good-news chime */
    tone(523, { type: 'sine', d: 0.34, peak: 0.14, slide: 262, wet: 0.6, vary: false });
    tone(784, { type: 'sine', d: 0.45, peak: 0.10, slide: 196, wet: 0.6, vary: false });
    later(140, () => tone(1046, { type: 'sine', d: 0.5, peak: 0.07, slide: 130, wet: 0.7, vary: false }));
  },
  /* a lane opening is an economy milestone and deserves its own tell */
  lane: () => {
    tone(392, { type: 'triangle', d: 0.18, peak: 0.11, slide: 130, wet: 0.5, vary: false });
    later(130, () => tone(587, { type: 'triangle', d: 0.26, peak: 0.10, slide: 190, wet: 0.6, vary: false }));
  },
  /* promotion: three pips, three notes */
  promote: sited('prm', 200, (g, pan) => {
    tone(659, { type: 'triangle', d: 0.13, peak: 0.09 * g, pan, wet: 0.5, vary: false });
    later(95,  () => tone(880,  { type: 'triangle', d: 0.13, peak: 0.09 * g, pan, wet: 0.5, vary: false }));
    later(190, () => tone(1174, { type: 'triangle', d: 0.22, peak: 0.10 * g, pan, wet: 0.7, vary: false }));
  }),
  /* the Green taking new ground */
  spread: () => gate('spd', 4000) && (() => {
    tone(174, { type: 'sine', a: 0.4, d: 1.4, peak: 0.05, slide: 40, wet: 0.9, vary: false });
    tone(261, { type: 'sine', a: 0.5, d: 1.6, peak: 0.03, slide: 30, wet: 0.9, vary: false });
    return true;
  })(),
  alarm: () => {
    tone(330, { type: 'square', d: 0.25, peak: 0.12, wet: 0.5, vary: false });
    later(220, () => tone(262, { type: 'square', d: 0.3, peak: 0.12, wet: 0.5, vary: false }));
    later(520, () => tone(330, { type: 'square', d: 0.25, peak: 0.10, wet: 0.5, vary: false }));
  },
  spell: () => {
    tone(180, { type: 'sine', d: 0.9, peak: 0.28, slide: 120, wet: 0.8, vary: false });
    noise({ d: 0.5, peak: 0.14, hp: 120, lp: 1200, wet: 0.8 });
    later(200, () => noise({ d: 0.8, peak: 0.08, hp: 400, lp: 3000, wet: 0.9 }));
  },

  /* ---- water: the drain is a slow clock the player should be able to hear -- */
  drain: () => gate('drn', 7000) && (() => {
    noise({ d: 1.4, peak: 0.045, hp: 200, lp: 1100, q: 2, wet: 0.9 });
    tone(88, { type: 'sine', a: 0.5, d: 1.4, peak: 0.05, slide: -18, wet: 0.7, vary: false });
    return true;
  })(),
};

/* ------------------------------------------------------------- ambience -- */
/* Occasional idle voices from whatever is actually on screen. Scheduling this
   centrally rather than per-unit means the density stays constant whether you
   have six animals or ninety -- a pack of ninety wolves each rolling their own
   dice would be a continuous howl.

   Only units that are NOT fighting speak, so combat never has to compete with
   flavour, and the sudden quiet when a fight starts does real work. */
let ambT = 0, humT = 0, drainT = 0;
const IDLE_VOICE = { wolf: 'howl', raven: 'caw', bear: 'roar', boar: 'snort' };

export function ambientVoices(dt) {
  if (!ctx || muted) return;

  ambT -= dt;
  if (ambT <= 0) {
    ambT = rnd(3.5, 8);
    const cands = [];
    for (const e of G.entities) {
      if (!e.alive || e.isBuilding || !IDLE_VOICE[e.type]) continue;
      if (e.target || G.time - (e.lastHitAt || -99) < 6) continue;   // busy or bleeding
      if (!place(e.pos)) continue;                                    // out of earshot
      cands.push(e);
    }
    if (cands.length) {
      const e = cands[(Math.random() * cands.length) | 0];
      const fn = SFX[IDLE_VOICE[e.type]];
      if (fn) fn(e.pos);
    }
  }

  /* the compound's own noises, so the machine side has a presence too */
  humT -= dt;
  if (humT <= 0) {
    humT = rnd(2.5, 5);
    const drones = G.entities.filter(e => e.alive && e.type === 'drone' && place(e.pos));
    if (drones.length) SFX.droneHum(drones[(Math.random() * drones.length) | 0].pos);
  }

  drainT -= dt;
  if (drainT <= 0) {
    drainT = rnd(9, 16);
    const pumps = G.entities.filter(e => e.alive && e.type === 'pump' && place(e.pos));
    if (pumps.length) SFX.drain();
  }
}
