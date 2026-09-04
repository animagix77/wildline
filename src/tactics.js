import * as THREE from 'three';
import { HALF } from './config.js';
import { terrainHeight } from './utils.js';

/* Front faces the destination. Assign nearby slots within each role so a
   command doesn't make the whole army cross itself. Outputs retain input order. */
export function makeFormation(units, center) {
  if (!units.length) return [];
  const n = units.length;
  const cx = units.reduce((s, u) => s + u.pos.x, 0) / n;
  const cz = units.reduce((s, u) => s + u.pos.z, 0) / n;
  const dx = center.x - cx, dz = center.z - cz;
  const len = Math.hypot(dx, dz);
  const fx = len > 0.1 ? dx / len : 0, fz = len > 0.1 ? dz / len : -1;
  const spacing = Math.max(3, ...units.map(u => u.radius * 2 + 0.7));
  const cols = Math.ceil(Math.sqrt(n * 1.3)), rows = Math.ceil(n / cols);
  const slots = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols);
    const side = ((i % cols) - (inRow - 1) / 2) * spacing;
    const depth = ((rows - 1) / 2 - row) * spacing;
    slots.push(new THREE.Vector3(center.x - fz * side + fx * depth, 0,
      center.z + fx * side + fz * depth));
  }
  // Translate the entire footprint at map edges; clamping each slot would stack units.
  const margin = Math.max(...units.map(u => u.radius)) + 1;
  const bound = HALF - margin;
  for (const axis of ['x', 'z']) {
    const low = Math.min(...slots.map(p => p[axis])), high = Math.max(...slots.map(p => p[axis]));
    const shift = low < -bound ? -bound - low : high > bound ? bound - high : 0;
    for (const p of slots) p[axis] += shift;
  }
  const role = u => u.def.taunt ? 0 : u.def.ranged ? 2 : 1;
  const ordered = units.map((u, i) => ({ u, i })).sort((a, b) => role(a.u) - role(b.u) || a.u.id - b.u.id);
  const out = new Array(n);
  let start = 0;
  while (start < n) {
    let end = start + 1;
    while (end < n && role(ordered[end].u) === role(ordered[start].u)) end++;
    const available = slots.slice(start, end);
    for (let j = start; j < end; j++) {
      const { u, i } = ordered[j];
      let best = 0, distance = Infinity;
      available.forEach((p, k) => {
        const d = (p.x - u.pos.x) ** 2 + (p.z - u.pos.z) ** 2;
        if (d < distance) { best = k; distance = d; }
      });
      const p = available.splice(best, 1)[0];
      p.y = terrainHeight(p.x, p.z);
      out[i] = p;
    }
    start = end;
  }
  return out;
}
