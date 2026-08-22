import { G } from './state.js';

/* =========================================================================
   Music. The first runtime asset this project loads — everything else is
   inlined or synthesised. Tracks stream lazily from music/ via <audio>, so
   the game boots without waiting for them and runs silent-but-fine if the
   folder is missing entirely (an error on a track marks it dead; no retries).

   Design (see MUSIC.md): each scenario picks its score from the map's own
   atmosphere — weather first, wetlands override weather, and the finale gets
   the night-operations track as its own identity. A security sweep swaps in
   the under-attack stinger and hands back to the ambient track when it ends.
   Combat ducks the score so the synth voices — the sounds the player makes
   decisions with — stay on top.
   ========================================================================= */

const MUS_BASE = 'music/';
const TRACKS = {
  title:    { file: 'main title.mp3',       vol: 0.34, loop: true },
  campaign: { file: 'campaign map.mp3',     vol: 0.30, loop: true },
  combat:   { file: 'standard combat.mp3',  vol: 0.26, loop: true },
  night:    { file: 'night operations.mp3', vol: 0.28, loop: true },
  rain:     { file: 'rain.mp3',             vol: 0.28, loop: true },
  snow:     { file: 'snow.mp3',             vol: 0.28, loop: true },
  mist:     { file: 'mist.mp3',             vol: 0.28, loop: true },
  storm:    { file: 'storm.mp3',            vol: 0.26, loop: true },
  wetland:  { file: 'wetland.mp3',          vol: 0.28, loop: true },
  attack:   { file: 'under attack.mp3',     vol: 0.34, loop: false },
  victory:  { file: 'victory.mp3',          vol: 0.36, loop: false },
  defeat:   { file: 'defeat.mp3',           vol: 0.32, loop: false },
};

/* Which score a mission gets. Wetland beats weather (the drained lakes ARE the
   story there), and the finale gets its own track rather than a second storm. */
export function trackForMap(map) {
  if (!map) return 'combat';
  if (map.id === 'the-campus') return 'night';
  if (map.archetype === 'wetland') return 'wetland';
  const w = map.weather;
  if (w === 'rain') return 'rain';
  if (w === 'snow') return 'snow';
  if (w === 'storm') return 'storm';
  if (w === 'mist') return 'mist';
  return 'combat';
}

let els = Object.create(null);   // name -> HTMLAudioElement (created on demand)
let dead = Object.create(null);  // name -> true when the file 404s / can't play
let current = null;              // name of the looping bed
let stinger = null;              // name of the one-shot riding on top
let musMuted = false;
let unlocked = false;            // browsers refuse play() before a user gesture
let duck = 1, fades = [];

const FADE = 1.6;

function musEl(name) {
  if (els[name]) return els[name];
  const t = TRACKS[name];
  const a = new Audio(MUS_BASE + encodeURIComponent(t.file));
  a.loop = !!t.loop;
  a.preload = 'auto';
  a.volume = 0;
  a.addEventListener('error', () => { dead[name] = true; }, { once: true });
  els[name] = a;
  return a;
}

function fadeTo(name, target, secs, thenStop) {
  fades = fades.filter(f => f.name !== name);
  fades.push({ name, target, rate: (secs > 0 ? 1 / secs : 1e9), thenStop });
}

function playInternal(name) {
  if (dead[name] || !TRACKS[name]) return;
  const a = musEl(name);
  if (a.paused) {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* pre-gesture: musicUnlock retries */ });
  }
  fadeTo(name, 1, FADE);
}

/** Switch the looping bed. Crossfades; a no-op if it is already playing. */
export function musicPlay(name) {
  if (name === current) return;
  if (current) fadeTo(current, 0, FADE, true);
  current = name;
  if (name && unlocked) playInternal(name);
}

/** One-shot on top of the bed (sweep stinger, victory, defeat). The bed ducks
    to a whisper and returns when the one-shot finishes. */
export function musicStinger(name) {
  if (!unlocked || dead[name]) return;
  if (stinger && els[stinger]) { els[stinger].pause(); }
  stinger = name;
  playInternal(name);
  const a = els[name];
  a.onended = () => { if (stinger === name) stinger = null; };
}

/** Hard stop of everything that is playing (mission teardown). */
export function musicStop(fade = 0.8) {
  if (current) fadeTo(current, 0, fade, true);
  if (stinger && els[stinger]) fadeTo(stinger, 0, fade, true);
  current = null; stinger = null;
}

/* The first user gesture unlocks playback; whatever was requested while locked
   starts now. Called alongside initAudio from the first pointerdown. */
export function musicUnlock() {
  if (unlocked) return;
  unlocked = true;
  if (current) playInternal(current);
}

export function musicSetMuted(v) { musMuted = !!v; }

/* --------------------------------------------------------------- update -- */
/* Called once a frame. Runs the fades, and ducks the bed while a fight is on
   so the informative sounds stay legible over the score. */
let duckT = 0;

export function updateMusic(dt) {
  /* combat intensity: anything hurt in the last 2.5s keeps the duck alive */
  duckT = Math.max(0, duckT - dt);
  if (G.phase === 'playing' && G.entities) {
    for (let i = 0; i < G.entities.length; i += 7) {   // sampled, not exhaustive
      const e = G.entities[i];
      if (e.alive && !e.isBuilding && G.time - (e.lastHitAt || -99) < 1.2) { duckT = 2.5; break; }
    }
  }
  const duckTarget = (stinger ? 0.25 : (duckT > 0 ? 0.55 : 1));
  duck += (duckTarget - duck) * Math.min(1, dt * 2.2);

  for (let i = fades.length - 1; i >= 0; i--) {
    const f = fades[i];
    const a = els[f.name];
    if (!a) { fades.splice(i, 1); continue; }
    const t = TRACKS[f.name];
    let lvl = a._lvl === undefined ? 0 : a._lvl;
    const step = f.rate * dt;
    lvl = lvl < f.target ? Math.min(f.target, lvl + step) : Math.max(f.target, lvl - step);
    a._lvl = lvl;
    if (lvl === f.target) {
      fades.splice(i, 1);
      if (f.thenStop && lvl === 0) a.pause();
    }
  }
  /* base level x fade x duck x mute, every frame — cheap, and it means mute and
     duck never fight the fade state machine */
  for (const name in els) {
    const a = els[name];
    if (a.paused) continue;
    const bedDuck = (name === stinger) ? 1 : duck;
    a.volume = Math.max(0, Math.min(1, (TRACKS[name].vol) * (a._lvl || 0) * bedDuck * (musMuted ? 0 : 1)));
  }
}

/* Harness probe: lets automated checks see what the score is doing without
   reaching into module internals. */
export function musicState() {
  const out = { current, stinger, playing: [] };
  for (const name in els) {
    const a = els[name];
    if (!a.paused) out.playing.push({ name, vol: +a.volume.toFixed(3), lvl: +(a._lvl || 0).toFixed(3) });
  }
  return out;
}
