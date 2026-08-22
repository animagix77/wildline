import * as THREE from 'three';
import { G } from './state.js';
import { WORLD } from './config.js';
import { rand, terrainHeight } from './utils.js';

/* =========================================================================
   Weather — rain, snow and drifting mist.

   Precipitation is ONE Points object with a custom shader: particles live in a
   box that follows the camera, and each one wraps vertically in the vertex
   shader, so 6000 drops cost one draw call and zero CPU per frame. Nothing is
   allocated after init.

   Weather is a MapDef property, not a random event — a player planning a strike
   should know what they are walking into, so Coldrake is always sleeting and
   Substation Gary is always snowbound.
   ========================================================================= */

const PRECIP_COUNT = 6000;
const BOX = 190;          // side of the follow-box around the camera
const TOP = 90;

let precip = null, mist = null, uni = null, listeners = null;

const PRESETS = {
  clear: { kind: 0, density: 0, mist: 0, wind: [0, 0] },
  rain:  { kind: 0, density: 1.0, mist: 0.35, wind: [-7, 2], colour: 0x9fc4d8, streak: 3.4, speed: 62 },
  storm: { kind: 0, density: 1.0, mist: 0.55, wind: [-15, 5], colour: 0x8fb6cc, streak: 5.0, speed: 78 },
  snow:  { kind: 1, density: 0.85, mist: 0.5, wind: [3, -2], colour: 0xeaf2ff, streak: 1.0, speed: 9 },
  mist:  { kind: 0, density: 0, mist: 0.85, wind: [1, 1] },
};

export function initWeather(scene, name = 'clear') {
  disposeWeather();
  const p = PRESETS[name] || PRESETS.clear;
  G.weather = { name, ...p };

  if (p.density > 0) {
    const n = Math.round(PRECIP_COUNT * p.density);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-BOX / 2, BOX / 2);
      pos[i * 3 + 1] = rand(0, TOP);
      pos[i * 3 + 2] = rand(-BOX / 2, BOX / 2);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX);

    uni = {
      uTime:   { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uBox:    { value: BOX },
      uTop:    { value: TOP },
      uSpeed:  { value: p.speed },
      uWind:   { value: new THREE.Vector2(p.wind[0], p.wind[1]) },
      uColour: { value: new THREE.Color(p.colour) },
      uStreak: { value: p.streak },
      uSize:   { value: p.kind === 1 ? 2.6 : 1.5 },
      uFlake:  { value: p.kind },
      uFade:   { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false,
      blending: p.kind === 1 ? THREE.NormalBlending : THREE.AdditiveBlending,
      vertexShader: `
        attribute float seed;
        uniform float uTime, uBox, uTop, uSpeed, uSize, uFlake;
        uniform vec2 uWind;
        uniform vec3 uOrigin;
        varying float vSeed;
        void main() {
          vSeed = seed;
          vec3 p = position;
          /* fall, then wrap inside a box that rides with the camera — no CPU
             work and no particle ever leaves the visible volume */
          float t = uTime * (0.7 + seed * 0.6);
          p.y -= t * uSpeed;
          p.x += uWind.x * t;
          p.z += uWind.y * t;
          if (uFlake > 0.5) {                        // snow drifts sideways
            p.x += sin(uTime * (0.5 + seed) + seed * 30.0) * 2.4;
            p.z += cos(uTime * (0.4 + seed) + seed * 21.0) * 2.4;
          }
          p.x = mod(p.x - uOrigin.x + uBox * 0.5, uBox) - uBox * 0.5 + uOrigin.x;
          p.z = mod(p.z - uOrigin.z + uBox * 0.5, uBox) - uBox * 0.5 + uOrigin.z;
          p.y = mod(p.y, uTop);
          p.y += uOrigin.y;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (300.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: `
        uniform vec3 uColour;
        uniform float uStreak, uFlake, uFade;
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a;
          if (uFlake > 0.5) {
            a = smoothstep(0.5, 0.05, length(c));           // soft round flake
          } else {
            c.y /= uStreak;                                  // elongate into a streak
            a = smoothstep(0.5, 0.0, length(c)) * 0.75;
          }
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColour, a * (0.35 + vSeed * 0.5) * uFade);
        }`,
    });

    precip = new THREE.Points(geo, mat);
    precip.frustumCulled = false;
    precip.renderOrder = 7;          // over the fog veil, like real weather
    scene.add(precip);
  }

  if (p.mist > 0) buildMist(scene, p.mist);
  return G.weather;
}

/* Ground mist: a few big soft billboards drifting low over the terrain. */
function buildMist(scene, strength) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColour: { value: new THREE.Color(0xbcd0d8) },
      uStrength: { value: strength },
      uFade: { value: 0 },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColour; uniform float uStrength, uFade, uTime;
      varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5); }
      float n(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y); }
      void main(){
        vec2 p = vUv * 3.0 + vec2(uTime * 0.03, uTime * 0.017);
        float f = n(p) * 0.6 + n(p * 2.3) * 0.3;
        float edge = smoothstep(0.5, 0.12, length(vUv - 0.5));
        gl_FragColor = vec4(uColour, f * edge * uStrength * 0.5 * uFade);
      }`,
  });
  mist = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(geo, mat);
    const x = rand(-WORLD / 2, WORLD / 2), z = rand(-WORLD / 2, WORLD / 2);
    m.position.set(x, terrainHeight(x, z) + rand(2, 7), z);
    m.rotation.x = -Math.PI / 2.2;
    m.scale.setScalar(rand(45, 90));
    m.renderOrder = 6;
    m.raycast = () => {};
    mist.add(m);
  }
  scene.add(mist);
}


/* ---------------------------------------------------------- rainfall -- */
/* Weather has been pure decoration until now — it picked a music track and
   nothing else. Rain feeding the lakes gives it a job, and it turns five of
   the nine maps into a genuinely different economic problem: the intakes are
   still draining, but the sky is fighting them.

   Rates are fractions of a lake's own drain rate, so a wetter map does not
   also have to be a slower one. Deliberately below 1.0 even for a storm: rain
   should SLOW the loss, not cancel it, so killing pumps still matters. Break
   the intakes during a downpour and the lake actually climbs — which is the
   combination worth playing for. */
const RAINFALL = { storm: 0.75, rain: 0.5, snow: 0.12, mist: 0.06, clear: 0 };

/** 0..1-ish multiplier of a lake's drain rate, currently falling as water. */
export function rainfall() {
  const w = G.weather;
  if (!w) return 0;
  const base = RAINFALL[w.name] || 0;
  if (base <= 0) return 0;
  /* Bands, not a constant. A downpour that comes and goes gives the water a
     rhythm the player can read off the top bar and time a push against. */
  const t = G.wallTime || 0;
  const band = 0.6 + 0.4 * Math.sin(t * 0.055) + 0.18 * Math.sin(t * 0.21);
  return base * Math.max(0, band);
}

/** True while it is coming down hard enough to be worth telling the player. */
export function isPouring() { return rainfall() > 0.42; }

export function updateWeather(dt) {
  const cam = G.camera;
  if (precip && uni) {
    uni.uTime.value += dt;
    uni.uFade.value = Math.min(1, uni.uFade.value + dt * 0.6);
    if (cam) uni.uOrigin.value.set(cam.position.x, 0, cam.position.z);
  }
  if (mist) {
    const mu = mist.children[0].material.uniforms;
    mu.uTime.value += dt;
    mu.uFade.value = Math.min(1, mu.uFade.value + dt * 0.4);
    if (cam) for (const m of mist.children) m.lookAt(cam.position.x, m.position.y, cam.position.z);
  }
}

export function disposeWeather() {
  for (const o of [precip, mist]) {
    if (!o) continue;
    o.parent && o.parent.remove(o);
    o.traverse ? o.traverse(c => { c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); })
               : (o.geometry.dispose(), o.material.dispose());
  }
  precip = null; mist = null; uni = null;
}
