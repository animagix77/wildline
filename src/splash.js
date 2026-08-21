import { SPLASH_ART } from './splash-art.js';

/* =========================================================================
   Splash / loading screen.

   Shown immediately on boot, over the key art, while the world is built. The
   Continue button only appears once everything is actually ready — the caller
   signals that with splashReady(). Until then the player sees honest progress
   rather than a button that does nothing when pressed.
   ========================================================================= */

let spEl = null, bar = null, note = null, btn = null, onGo = null, ready = false;

const STEPS = [
  'Waking the forest…',
  'Surveying the valley floor…',
  'Counting the trees…',
  'Reading TerraByte’s planning application…',
  'Sharpening claws…',
];

export function showSplash(onContinue) {
  onGo = onContinue;
  ready = false;
  spEl = document.createElement('div');
  spEl.id = 'splash';
  spEl.innerHTML = `
    <div class="sp-art" style="background-image:url('${SPLASH_ART}')"></div>
    <div class="sp-scrim"></div>
    <div class="sp-body">
      <div class="sp-sub">A real-time strategy game about a valley that has had enough</div>
      <div class="sp-load">
        <div class="sp-barwrap"><i class="sp-bar"></i></div>
        <div class="sp-note">Waking the forest…</div>
      </div>
      <button class="sp-btn" id="sp-continue" type="button" disabled><span>Continue</span></button>
      <div class="sp-foot">TerraByte Solutions is not affiliated with this product and would like that on the record.</div>
    </div>`;
  document.getElementById('app').appendChild(spEl);
  bar = spEl.querySelector('.sp-bar');
  note = spEl.querySelector('.sp-note');
  btn = spEl.querySelector('#sp-continue');

  btn.addEventListener('click', dismiss);
  window.addEventListener('keydown', spKey);

  /* Safety net. Readiness is normally signalled by the first presented frame, but
     rAF is suspended in a background tab — without this a player who tabs away
     during load comes back to a splash whose button never lights. */
  setTimeout(() => splashReady(), 6000);

  /* Progress is driven by real boot milestones via splashProgress(); this only
     animates between them so the bar never sits frozen. */
  let shown = 0, target = 0.06, step = 0;
  spEl._tick = setInterval(() => {
    target = Math.min(ready ? 1 : 0.92, target + 0.012);
    shown += (target - shown) * 0.18;
    bar.style.width = (shown * 100).toFixed(1) + '%';
    const s = Math.min(STEPS.length - 1, Math.floor(shown * STEPS.length));
    if (s !== step) { step = s; note.textContent = STEPS[s]; }
    if (ready && shown > 0.985) {
      clearInterval(spEl._tick); spEl._tick = null;
      bar.style.width = '100%';
      note.textContent = 'Ready.';
      spEl.classList.add('sp-ready');
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
  return spEl;
}

/* Called by the boot sequence once the world exists and the first frame is up. */
export function splashReady() { ready = true; }

function spKey(e) {
  if (!ready) return;
  if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); dismiss(); }
}

function dismiss() {
  if (!spEl || !ready) return;
  window.removeEventListener('keydown', spKey);
  if (spEl._tick) clearInterval(spEl._tick);
  spEl.classList.add('sp-out');
  const node = spEl; spEl = null;
  setTimeout(() => { node.remove(); if (onGo) onGo(); }, 420);
}
