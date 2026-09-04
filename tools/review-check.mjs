// Run: node --experimental-vm-modules tools/review-check.mjs
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = vm.createContext({ console, Math });
const cache = new Map();
function load(file) {
  if (!cache.has(file)) cache.set(file, fs.readFile(file, 'utf8').then(source =>
    new vm.SourceTextModule(source, { context, identifier: file })));
  return cache.get(file);
}
const module = await load(path.join(root, 'src/tactics.js'));
await module.link((specifier, ref) => load(specifier === 'three'
  ? path.join(root, 'vendor/three.module.min.js') : path.resolve(path.dirname(ref.identifier), specifier)));
await module.evaluate();
const { makeFormation } = module.namespace;
const { Vector3 } = (await cache.get(path.join(root, 'vendor/three.module.min.js'))).namespace;
const { DEFS, HALF } = (await cache.get(path.join(root, 'src/config.js'))).namespace;
let id = 0;
const unit = (type, x, z) => ({ id: ++id, pos: new Vector3(x, 0, z), def: DEFS[type], radius: DEFS[type].radius });
assert.equal(makeFormation([], new Vector3()).length, 0);
const solo = makeFormation([unit('wolf', 0, 0)], new Vector3(12, 0, 16));
assert.equal(solo[0].x, 12); assert.equal(solo[0].z, 16);
for (const target of [new Vector3(50, 0, 0), new Vector3(-50, 0, 0), new Vector3(0, 0, 50), new Vector3(0, 0, -50)]) {
  const units = [unit('local', -2, 0), unit('wolf', 1, 0), unit('capybara', 0, 1), unit('porcupine', 0, -1), unit('bear', 2, 0), unit('wolf', 1, 1)];
  const slots = makeFormation(units, target);
  const depth = i => slots[i].x * target.x + slots[i].z * target.z;
  assert.ok(depth(2) >= depth(0) && depth(2) >= depth(3), 'tank leads ranged troops in every direction');
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++)
    assert.ok(slots[i].distanceTo(slots[j]) >= units[i].radius + units[j].radius, 'arrival slots do not overlap');
  const repeat = makeFormation(units, target);
  assert.deepEqual(slots.map(p => p.toArray()), repeat.map(p => p.toArray()), 'deterministic assignment');
}
const swarm = Array.from({ length: 280 }, (_, i) => unit(i % 3 ? 'wolf' : 'bear', i % 20, Math.floor(i / 20)));
for (const corner of [[119,119],[-119,119],[119,-119],[-119,-119]]) {
  const slots = makeFormation(swarm, new Vector3(corner[0], 0, corner[1]));
  assert.equal(new Set(slots.map(p => `${p.x},${p.z}`)).size, swarm.length);
  slots.forEach((p, i) => {
    assert.ok(Number.isFinite(p.y));
    assert.ok(Math.abs(p.x) + swarm[i].radius < HALF && Math.abs(p.z) + swarm[i].radius < HALF, 'whole footprint fits map');
  });
}
console.log('PASS: formation roles, cardinal directions, spacing, determinism, empty/single squads and 280-unit map-edge destinations.');
