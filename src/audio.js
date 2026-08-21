/* Tiny WebAudio synth — no asset files, just oscillators and noise. */
let ctx = null, master = null;
let lastAt = 0;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

let muted = false;
const MASTER = 0.35;
export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.02);
  return muted;
}
export function toggleMute() { return setMuted(!muted); }

function env(node, t0, a, d, peak) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  node.connect(g); g.connect(master);
  return g;
}

function tone(freq, { type = 'sine', a = 0.005, d = 0.12, peak = 0.3, slide = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + a + d);
  env(o, t0, a, d, peak);
  o.start(t0); o.stop(t0 + a + d + 0.05);
}

let noiseBuf = null;
function noise({ d = 0.15, peak = 0.25, hp = 400, lp = 6000 } = {}) {
  if (!ctx) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass';  f2.frequency.value = lp;
  src.connect(f1); f1.connect(f2);
  env(f2, t0, 0.004, d, peak);
  src.start(t0); src.stop(t0 + d + 0.1);
}

/* throttle so 40 wolves don't detonate the mixer */
function gate(key, ms) {
  const now = performance.now();
  if (now - (gate[key] || 0) < ms) return false;
  gate[key] = now; return true;
}

export const SFX = {
  select:   () => gate('sel', 60)  && tone(660, { type: 'triangle', d: 0.07, peak: 0.12 }),
  order:    () => gate('ord', 60)  && tone(440, { type: 'triangle', d: 0.09, peak: 0.14, slide: 180 }),
  shot:     () => gate('sht', 55)  && noise({ d: 0.07, peak: 0.10, hp: 900, lp: 9000 }),
  bite:     () => gate('bit', 70)  && noise({ d: 0.09, peak: 0.12, hp: 200, lp: 2400 }),
  hitMetal: () => gate('hm', 70)   && tone(1200, { type: 'square', d: 0.05, peak: 0.06, slide: -700 }),
  death:    () => gate('dth', 90)  && tone(150, { type: 'sawtooth', d: 0.3, peak: 0.14, slide: -100 }),
  boom:     () => { noise({ d: 0.6, peak: 0.4, hp: 40, lp: 1400 }); tone(70, { type: 'sine', d: 0.7, peak: 0.4, slide: -40 }); },
  spawn:    () => tone(520, { type: 'sine', d: 0.22, peak: 0.16, slide: 260 }),
  bloom:    () => { tone(520, { type: 'sine', d: 0.3, peak: 0.14, slide: 300 }); tone(784, { type: 'sine', d: 0.4, peak: 0.10, slide: 200 }); },
  alarm:    () => { tone(330, { type: 'square', d: 0.25, peak: 0.12 }); setTimeout(() => tone(262, { type: 'square', d: 0.3, peak: 0.12 }), 220); },
  spell:    () => { tone(180, { type: 'sine', d: 0.9, peak: 0.28, slide: 120 }); noise({ d: 0.5, peak: 0.14, hp: 120, lp: 1200 }); },
  deny:     () => gate('dny', 200) && tone(160, { type: 'square', d: 0.12, peak: 0.12 }),
};
