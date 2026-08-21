/* =========================================================================
   WILDLINE — F3 performance overlay.

   Hidden by default and genuinely free when hidden: perfFrame() returns on a
   single boolean before touching the clock, the DOM is not built until the
   first reveal, and the sparkline redraws at 8 Hz rather than per frame.
   ========================================================================= */

const PERF_SAMPLES = 120;          // sparkline width, in frames
const PERF_FPS_WINDOW = 60;        // rolling average window, in frames

const PF = {
  renderer: null,
  visible: false,
  built: false,
  root: null,
  fpsEl: null, msEl: null, bandEl: null,
  canvas: null, ctx: null, dpr: 1,
  rows: null,
  keyHandler: null,

  ring: new Float32Array(PERF_SAMPLES),   // frame times in ms
  head: 0,
  filled: 0,
  sum: 0,                            // rolling sum over the FPS window
  fpsRing: new Float32Array(PERF_FPS_WINDOW),
  fpsHead: 0,
  fpsFilled: 0,
  uiAccum: 0,
  sparkAccum: 0,
};

const PERF_ROWS = [
  ['draws', 'draw calls'],
  ['tris', 'triangles'],
  ['progs', 'programs'],
  ['geos', 'geometries'],
  ['texs', 'textures'],
  ['ents', 'entities'],
];

/** Register the overlay and bind F3. Pass the WebGLRenderer (may be null). */
export function initPerf(renderer) {
  PF.renderer = renderer || null;
  if (!PF.keyHandler) {
    PF.keyHandler = (ev) => {
      if (ev.key === 'F3' || (ev.code === 'F3')) {
        ev.preventDefault();
        ev.stopPropagation();
        togglePerf();
      }
    };
    window.addEventListener('keydown', PF.keyHandler, true);
  }
  return PF;
}

/** Show / hide the overlay. Returns the new visibility. */
export function togglePerf(force) {
  const next = force === undefined ? !PF.visible : !!force;
  if (next === PF.visible) return PF.visible;
  PF.visible = next;
  if (PF.visible) {
    buildPerfDom();
    perfResetSamples();
    PF.root.classList.remove('hidden');
  } else if (PF.root) {
    PF.root.classList.add('hidden');
  }
  return PF.visible;
}

/** Is the overlay currently on screen? */
export function perfVisible() { return PF.visible; }

/** Call once per frame with the frame delta in seconds. No-op when hidden. */
export function perfFrame(dt) {
  if (!PF.visible) return;

  const ms = Math.min(1000, Math.max(0, (dt || 0) * 1000));

  PF.ring[PF.head] = ms;
  PF.head = (PF.head + 1) % PERF_SAMPLES;
  if (PF.filled < PERF_SAMPLES) PF.filled++;

  const out = PF.fpsRing[PF.fpsHead];
  PF.sum += ms - (PF.fpsFilled === PERF_FPS_WINDOW ? out : 0);
  PF.fpsRing[PF.fpsHead] = ms;
  PF.fpsHead = (PF.fpsHead + 1) % PERF_FPS_WINDOW;
  if (PF.fpsFilled < PERF_FPS_WINDOW) PF.fpsFilled++;

  const secs = ms / 1000;
  PF.uiAccum += secs;
  PF.sparkAccum += secs;

  if (PF.uiAccum >= 0.2) { PF.uiAccum = 0; perfRefreshText(); }
  if (PF.sparkAccum >= 0.125) { PF.sparkAccum = 0; perfDrawSpark(); }
}

/* --------------------------------------------------------------- build -- */
function buildPerfDom() {
  if (PF.built && PF.root && PF.root.isConnected) return;

  const app = document.getElementById('app') || document.body;
  const root = document.createElement('div');
  root.id = 'perfhud';
  root.className = 'hidden';

  const head = document.createElement('div');
  head.className = 'pf-head';
  head.innerHTML =
    '<span class="pf-title">PERF</span>' +
    '<span class="pf-fps"><b>--</b>fps</span>' +
    '<span class="pf-ms">-- ms</span>';
  root.appendChild(head);

  const canvas = document.createElement('canvas');
  canvas.className = 'pf-spark';
  root.appendChild(canvas);

  const band = document.createElement('div');
  band.className = 'pf-band';
  band.textContent = 'min -- · max --';
  root.appendChild(band);

  const grid = document.createElement('div');
  grid.className = 'pf-grid';
  const rows = {};
  for (const [key, label] of PERF_ROWS) {
    const k = document.createElement('span');
    k.className = 'pf-k';
    k.textContent = label;
    const v = document.createElement('b');
    v.className = 'pf-v';
    v.textContent = '--';
    grid.appendChild(k);
    grid.appendChild(v);
    rows[key] = v;
  }
  root.appendChild(grid);

  const foot = document.createElement('div');
  foot.className = 'pf-foot';
  foot.textContent = 'F3 to close';
  root.appendChild(foot);

  app.appendChild(root);

  PF.root = root;
  PF.fpsEl = head.querySelector('.pf-fps b');
  PF.msEl = head.querySelector('.pf-ms');
  PF.bandEl = band;
  PF.rows = rows;
  PF.canvas = canvas;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  PF.dpr = dpr;
  canvas.width = Math.round(196 * dpr);
  canvas.height = Math.round(38 * dpr);
  PF.ctx = canvas.getContext('2d');
  if (PF.ctx) PF.ctx.scale(dpr, dpr);

  PF.built = true;
}

function perfResetSamples() {
  PF.ring.fill(0);
  PF.fpsRing.fill(0);
  PF.head = 0; PF.filled = 0;
  PF.fpsHead = 0; PF.fpsFilled = 0;
  PF.sum = 0;
  PF.uiAccum = 0; PF.sparkAccum = 0;
}

/* ---------------------------------------------------------------- text -- */
function perfFmtInt(n) {
  if (!isFinite(n)) return '--';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function perfRefreshText() {
  if (!PF.root) return;

  const n = PF.fpsFilled || 1;
  const avgMs = PF.sum / n;
  const fps = avgMs > 0.0001 ? 1000 / avgMs : 0;

  PF.fpsEl.textContent = fps >= 100 ? String(Math.round(fps)) : fps.toFixed(1);
  PF.fpsEl.parentElement.className = 'pf-fps ' + (fps >= 55 ? 'good' : fps >= 30 ? 'warn' : 'bad');
  PF.msEl.textContent = avgMs.toFixed(2) + ' ms';

  let min = Infinity, max = 0;
  const count = PF.filled;
  for (let i = 0; i < count; i++) {
    const v = PF.ring[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) min = 0;
  PF.bandEl.textContent = `min ${min.toFixed(1)} · max ${max.toFixed(1)} ms · ${count} frames`;

  const info = PF.renderer && PF.renderer.info;
  if (info) {
    PF.rows.draws.textContent = perfFmtInt(info.render.calls);
    PF.rows.tris.textContent = perfFmtInt(info.render.triangles);
    PF.rows.progs.textContent = info.programs ? perfFmtInt(info.programs.length) : '--';
    PF.rows.geos.textContent = perfFmtInt(info.memory.geometries);
    PF.rows.texs.textContent = perfFmtInt(info.memory.textures);
  } else {
    PF.rows.draws.textContent = '--';
    PF.rows.tris.textContent = '--';
    PF.rows.progs.textContent = '--';
    PF.rows.geos.textContent = '--';
    PF.rows.texs.textContent = '--';
  }

  const g = typeof window !== 'undefined' ? window.G : null;
  if (g && Array.isArray(g.entities)) {
    let alive = 0, wild = 0;
    for (const e of g.entities) {
      if (!e || !e.alive) continue;
      alive++;
      if (e.team === 'wild') wild++;
    }
    PF.rows.ents.textContent = `${alive} (${wild} wild)`;
  } else {
    PF.rows.ents.textContent = '--';
  }
}

/* ------------------------------------------------------------- sparkline */
function perfDrawSpark() {
  const c = PF.ctx;
  if (!c) return;
  const W = 196, H = 38;
  c.clearRect(0, 0, W, H);

  c.fillStyle = 'rgba(0,0,0,.35)';
  c.fillRect(0, 0, W, H);

  let max = 16.7;
  for (let i = 0; i < PF.filled; i++) if (PF.ring[i] > max) max = PF.ring[i];
  const scale = H / (max * 1.12);

  /* 60fps and 30fps guides */
  c.strokeStyle = 'rgba(127,212,74,.35)';
  c.lineWidth = 1;
  c.beginPath();
  const y60 = H - 16.7 * scale;
  c.moveTo(0, Math.round(y60) + 0.5); c.lineTo(W, Math.round(y60) + 0.5);
  c.stroke();
  const y30 = H - 33.3 * scale;
  if (y30 > 0) {
    c.strokeStyle = 'rgba(255,106,61,.28)';
    c.beginPath();
    c.moveTo(0, Math.round(y30) + 0.5); c.lineTo(W, Math.round(y30) + 0.5);
    c.stroke();
  }

  const bw = W / PERF_SAMPLES;
  for (let i = 0; i < PF.filled; i++) {
    /* oldest sample first, so the graph scrolls left */
    const idx = (PF.head - PF.filled + i + PERF_SAMPLES * 2) % PERF_SAMPLES;
    const v = PF.ring[idx];
    const h = Math.max(1, v * scale);
    c.fillStyle = v <= 17.5 ? 'rgba(127,212,74,.85)'
      : v <= 33.4 ? 'rgba(233,201,90,.85)'
        : 'rgba(255,106,61,.9)';
    c.fillRect(i * bw, H - h, Math.max(1, bw - 0.35), h);
  }
}
