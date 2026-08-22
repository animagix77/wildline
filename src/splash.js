import { INTRO_SKY, INTRO_BG, INTRO_MID, INTRO_FG, INTRO_TITLE } from './intro-art.js';

/* =========================================================================
   Intro screen — the key art split into depth layers with mouse parallax.

   Shown immediately on boot while the world is built behind it. The Get
   Started button only appears once everything is actually ready — the caller
   signals that with splashReady(). Until then the player sees honest progress
   rather than a button that does nothing when pressed.

   Parallax model: four scene layers slide *against* the cursor, farther layers
   less, which reads as looking past a window. The title slides *with* the
   cursor a little, which pops it off the scene. Everything is lerped, and a
   slow Lissajous drift keeps the scene breathing before the mouse ever moves
   (and on machines with no mouse at all). prefers-reduced-motion gets a still
   image.
   ========================================================================= */

let spEl = null, bar = null, note = null, btn = null, onGo = null, ready = false;
let raf = 0, compact = false;

/* The parallax intro is a first-impression, not a loading screen. Every mission
   transition in this game is a real page reload (see world.js endMission), so
   without this the player watches the full title sequence between every single
   mission. sessionStorage is the right scope: it survives reloads inside a
   visit and clears when the tab closes, so a genuinely new visit still gets
   the intro. */
const SEEN = 'cvc.introSeen';
function introSeen() {
  try { return sessionStorage.getItem(SEEN) === '1'; } catch { return false; }
}
function markIntroSeen() {
  try { sessionStorage.setItem(SEEN, '1'); } catch {}
}

const STEPS = [
  'Waking the forest…',
  'Surveying the valley floor…',
  'Counting the trees…',
  'Reading TerraByte’s planning application…',
  'Sharpening claws…',
];

/* [image, depth px at full deflection, direction] — depth carries the illusion */
const LAYERS = [
  ['sp-sky', INTRO_SKY,  6, -1],
  ['sp-bg',  INTRO_BG,  16, -1],
  ['sp-mid', INTRO_MID, 30, -1],
  ['sp-fg',  INTRO_FG,  48, -1],
];

export function showSplash(onContinue) {
  onGo = onContinue;
  ready = false;
  compact = introSeen();
  spEl = document.createElement('div');
  spEl.id = 'splash';

  if (compact) {
    /* Between missions: a plain progress bar that gets out of the way by
       itself. No key art decode, no button, no ceremony. */
    spEl.className = 'sp-compact';
    spEl.innerHTML = `
      <div class="sp-body">
        <div class="sp-cmark">CRITTERS <i>VS</i> COMPUTE</div>
        <div class="sp-load">
          <div class="sp-barwrap"><i class="sp-bar"></i></div>
          <div class="sp-note">Waking the forest…</div>
        </div>
      </div>`;
    document.getElementById('app').appendChild(spEl);
    bar = spEl.querySelector('.sp-bar');
    note = spEl.querySelector('.sp-note');
    btn = null;
    window.addEventListener('keydown', spKey);
    runProgress();
    return spEl;
  }

  spEl.innerHTML = `
    ${LAYERS.map(([cls, src]) =>
      `<div class="sp-layer ${cls}" style="background-image:url('${src}')"></div>`).join('')}
    <div class="sp-vig"></div>
    <img class="sp-title" alt="Critters vs Compute" src="${INTRO_TITLE}">
    <div class="sp-body">
      <div class="sp-sub">A real-time strategy game about a valley that has had enough</div>
      <div class="sp-load">
        <div class="sp-barwrap"><i class="sp-bar"></i></div>
        <div class="sp-note">Waking the forest…</div>
      </div>
      <button class="sp-btn" id="sp-continue" type="button" disabled><span>Get Started</span></button>
      <div class="sp-foot">TerraByte Solutions is not affiliated with this product and would like that on the record.</div>
    </div>`;
  document.getElementById('app').appendChild(spEl);
  bar = spEl.querySelector('.sp-bar');
  note = spEl.querySelector('.sp-note');
  btn = spEl.querySelector('#sp-continue');

  btn.addEventListener('click', dismiss);
  window.addEventListener('keydown', spKey);
  startParallax();

  runProgress();
  return spEl;
}

function runProgress() {
  /* Safety net, and it belongs HERE so both the intro and the compact loader
     get it. Readiness is normally signalled by the first presented frame, but
     rAF is suspended in a background tab — without this, tabbing away during a
     mission transition leaves you staring at a bar that never finishes. */
  setTimeout(() => splashReady(), 6000);

  /* Progress is driven by real boot milestones via splashProgress(); this only
     animates between them so the bar never sits frozen. */
  /* The compact loader exists to get out of the way, so it ramps roughly three
     times faster than the first-run reveal, which is paced to be looked at. */
  const climb = compact ? 0.035 : 0.012;
  const ease  = compact ? 0.40  : 0.18;
  let shown = 0, target = 0.06, step = 0;
  spEl._tick = setInterval(() => {
    target = Math.min(ready ? 1 : 0.92, target + climb);
    /* Once the world is genuinely up, converge in a couple of ticks whatever the
       tick rate. Background tabs throttle setInterval to ~1Hz, and a bar paced
       purely by tick count sat on screen for 25s with the game ready behind it. */
    shown += ready ? Math.max((target - shown) * ease, 0.34) : (target - shown) * ease;
    bar.style.width = (shown * 100).toFixed(1) + '%';
    const s = Math.min(STEPS.length - 1, Math.floor(shown * STEPS.length));
    if (s !== step) { step = s; note.textContent = STEPS[s]; }
    if (ready && shown > 0.985) {
      clearInterval(spEl._tick); spEl._tick = null;
      bar.style.width = '100%';
      note.textContent = 'Ready.';
      spEl.classList.add('sp-ready');
      /* Compact mode has nothing to press — it is a loading bar, so it simply
         hands over as soon as the world is up. */
      if (compact) { dismiss(); return; }
      btn.disabled = false;
      /* Reveal inline rather than through a class transition. A transition that
         was armed while the tab was backgrounded can latch at its start value and
         never run, which left the button enabled but invisible. */
      btn.style.opacity = '1';
      btn.style.transform = 'none';
      btn.style.pointerEvents = 'auto';
      btn.focus();
    }
  }, 40);
}

/* ------------------------------------------------------------- parallax -- */
function startParallax() {
  if (compact) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const els = LAYERS.map(([cls]) => spEl.querySelector('.' + cls));
  const title = spEl.querySelector('.sp-title');
  let tx = 0, ty = 0;        // target, from the pointer, -1..1
  let cx = 0, cy = 0;        // current, lerped
  const t0 = performance.now();

  const onMove = (e) => {
    tx = (e.clientX / window.innerWidth) * 2 - 1;
    ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onMove);
  spEl._unMove = () => window.removeEventListener('pointermove', onMove);

  const frame = (now) => {
    if (!spEl) return;
    /* the drift is added to the pointer target, not mixed with it, so the scene
       keeps breathing while the player aims at the button */
    const t = (now - t0) / 1000;
    const dx = Math.sin(t * 0.21) * 0.14 + Math.sin(t * 0.083) * 0.08;
    const dy = Math.cos(t * 0.17) * 0.09;
    cx += (tx + dx - cx) * 0.055;
    cy += (ty + dy - cy) * 0.055;
    for (let i = 0; i < els.length; i++) {
      const d = LAYERS[i][2], dir = LAYERS[i][3];
      els[i].style.transform =
        `translate3d(${(cx * d * dir).toFixed(2)}px, ${(cy * d * 0.6 * dir).toFixed(2)}px, 0)`;
    }
    /* the title rides WITH the cursor and bobs on its own clock */
    const bob = Math.sin(t * 0.9) * 5;
    title.style.transform =
      `translate(-50%, 0) translate3d(${(cx * 14).toFixed(2)}px, ${(cy * 9 + bob).toFixed(2)}px, 0)`;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

/* Called by the boot sequence once the world exists and the first frame is up. */
export function splashReady() { ready = true; }

function spKey(e) {
  if (!ready) return;
  if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); dismiss(); }
}

function dismiss() {
  if (!spEl || !ready) return;
  markIntroSeen();
  window.removeEventListener('keydown', spKey);
  if (spEl._tick) clearInterval(spEl._tick);
  if (spEl._unMove) spEl._unMove();
  cancelAnimationFrame(raf);
  spEl.classList.add('sp-out');
  const node = spEl; spEl = null;
  setTimeout(() => { node.remove(); if (onGo) onGo(); }, 420);
}
