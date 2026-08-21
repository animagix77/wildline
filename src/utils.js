import { COMPOUND, BASE } from './config.js';

/* Viewport size that never returns 0 — a hidden/background tab can report 0,
   which would otherwise poison the camera aspect with NaN. */
export const vw = () => Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
export const vh = () => Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);

export const clamp  = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp   = (a, b, t) => a + (b - a) * t;
export const rand   = (a, b) => a + Math.random() * (b - a);
export const randInt= (a, b) => Math.floor(rand(a, b + 1));
export const pick   = arr => arr[Math.floor(Math.random() * arr.length)];
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* Deterministic-ish value noise so the terrain looks the same-ish each run. */
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi),     hash(xi + 1, yi),     u),
              lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
export function fbm(x, y, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2; }
  return s;
}

/* --- terrain ------------------------------------------------------------ */
/* Flat pads under both bases so buildings sit properly and units read clean */
function pad(x, z, cx, cz, r0, r1) {
  return smoothstep(r0, r1, Math.hypot(x - cx, z - cz));
}

export function terrainHeight(x, z) {
  let h = fbm(x * 0.012, z * 0.012, 4) * 9 - 4;
  h += Math.sin(x * 0.05) * Math.cos(z * 0.043) * 1.4;
  const f = Math.min(
    pad(x, z, COMPOUND.x, COMPOUND.z, 46, 74),
    pad(x, z, BASE.x, BASE.z, 18, 40)
  );
  return h * f;
}

/* How "machine-blighted" a point is: 1 at the compound, 0 out in the wild. */
export function blight(x, z) {
  const dx = Math.max(0, Math.abs(x - COMPOUND.x) - COMPOUND.hw);
  const dz = Math.max(0, Math.abs(z - COMPOUND.z) - COMPOUND.hd);
  return 1 - smoothstep(0, 34, Math.hypot(dx, dz));
}

export function insideCompound(x, z, margin = 0) {
  return Math.abs(x - COMPOUND.x) < COMPOUND.hw + margin &&
         Math.abs(z - COMPOUND.z) < COMPOUND.hd + margin;
}

/* --- spatial hash for neighbour queries --------------------------------- */
export class Grid {
  constructor(cell = 12) { this.cell = cell; this.map = new Map(); }
  key(x, z) { return ((x / this.cell) | 0) + ',' + ((z / this.cell) | 0); }
  clear() { this.map.clear(); }
  insert(e) {
    const k = this.key(e.pos.x, e.pos.z);
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(e);
  }
  near(x, z, r, out) {
    out.length = 0;
    const c = this.cell, n = Math.ceil(r / c);
    const cx = (x / c) | 0, cz = (z / c) | 0;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const b = this.map.get((cx + i) + ',' + (cz + j));
      if (b) for (let k = 0; k < b.length; k++) out.push(b[k]);
    }
    return out;
  }
}
