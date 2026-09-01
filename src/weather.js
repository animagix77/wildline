import * as THREE from 'three';
import { G } from './state.js';
import { WORLD } from './config.js';
import { rand, terrainHeight } from './utils.js';
import { toast } from './ui.js';

/* =========================================================================
   Weather — rain, snow and drifting mist.

   Precipitation is ONE Points object with a custom shader: particles live in a
   box that follows the camera, and each one wraps vertically in the vertex
   shader, so 6000 drops cost one draw call and zero CPU per frame. Nothing is
   allocated after init.

   Weather is a MapDef property, not a random event — a player planning a strike
   should know what they are walking into, so Coldrake is always sleeting and
   Substation Gary is always snowbound.

   A map may instead carry `fronts`: an authored [preset, seconds] timetable
   that loops on the sim clock. Still not a random event — the same front
   arrives at the same second of every attempt, so it is something to plan a
   push around rather than something that happens to you. See FRONTS below.
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

function buildWeather(scene, name = 'clear') {
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

/* ------------------------------------------------------------- fronts -- */
/* A looping, authored timetable of skies: [presetName, seconds]. The clock is
   G.time, which only advances while the match is actually running, so the front
   that arrives at 1:40 arrives at 1:40 every single attempt. That is the whole
   point — 'verdant-hollow' shipped as weather:'clear', RAINFALL.clear is 0, and
   so the entire rain system did nothing on the one map every new player starts
   on. Rather than repaint the opening valley as permanently wet (and change its
   music and its whole first impression), the sky moves: the hollow opens clear
   with the lake visibly draining, the rain arrives and roughly halves the loss,
   and a storm later on makes breaking the intakes actually push the water back
   UP. Three lessons, in order, on the map where they are cheapest to learn. */
const FRONT_FADE = 2.5;        // seconds the old sky takes to clear out

let cycle = null, cycleTotal = 0, curName = 'clear';
let frontTo = null, frontT = 0, sceneRef = null;

const FRONT_TOAST = {
  clear:  'The sky is clearing',
  rain:   'Rain moving in',
  storm:  'A storm is coming over the ridge',
  snow:   'Snow moving in',
  mist:   'Mist is settling in the low ground',
};

function installCycle(map) {
  cycle = null; cycleTotal = 0;
  const f = map && map.fronts;
  if (!f || !f.length) return;
  let total = 0;
  for (const [, secs] of f) total += secs;
  if (total <= 0) return;
  cycle = f; cycleTotal = total;
}

/** Which preset the timetable calls for at sim-time t. Pure arithmetic. */
function nameAt(t) {
  let x = ((t % cycleTotal) + cycleTotal) % cycleTotal;
  for (const [n, secs] of cycle) { if (x < secs) return n; x -= secs; }
  return cycle[0][0];
}

export function initWeather(scene, name = 'clear') {
  sceneRef = scene;
  frontTo = null; frontT = 0;
  installCycle(G.map);
  curName = cycle ? nameAt(0) : name;
  buildMotes(scene, G.map);          // survives fronts: the season does not change mid-match
  return buildWeather(scene, curName);
}


/* ------------------------------------------------------------- motes --
   Ambient particles: pollen in late summer, seed-fluff in spring, ice
   glitter in winter, falling leaves in autumn, dry dust at high noon. The
   thing that makes air look like air. Same construction as the rain — ONE
   Points object in a box that rides the camera, every particle wrapped in
   the vertex shader — so 700 of them are one draw call and zero CPU.

   Draw order matters. Rain sits at renderOrder 7, OVER the fog-of-war veil,
   because weather over unexplored ground is right. Motes sit at 4, UNDER it:
   a glowing drift of pollen across the black unknown would read as a bug,
   and dimmed through the explored-but-unseen veil is exactly right.

   `palette.motes` on a MapDef overrides the season default, either a preset
   name or an object merged over one; `motes: false` switches them off.     */
const MOTE_PRESETS = {
  /*                colour     count size  fall  drift wobble alpha  add  leaf */
  pollen:  { colour: 0xffd98a, count: 700, size: 1.5, fall: -0.35, drift: 1.1, wobble: 1.2, alpha: 0.42, add: true,  leaf: false },
  seeds:   { colour: 0xf2f7e6, count: 520, size: 1.9, fall:  0.45, drift: 1.6, wobble: 1.6, alpha: 0.38, add: true,  leaf: false },
  glitter: { colour: 0xdcefff, count: 460, size: 1.1, fall:  1.40, drift: 0.7, wobble: 0.5, alpha: 0.55, add: true,  leaf: false },
  leaves:  { colour: 0xb8602a, count: 300, size: 2.6, fall:  2.80, drift: 3.2, wobble: 2.4, alpha: 0.90, add: false, leaf: true },
  dust:    { colour: 0xfff1cf, count: 480, size: 1.2, fall:  0.15, drift: 0.9, wobble: 0.9, alpha: 0.30, add: true,  leaf: false },
};
const SEASON_MOTES = {
  'late summer': 'pollen', spring: 'seeds', winter: 'glitter',
  autumn: 'leaves', 'high summer': 'dust',
};
const MOTE_BOX = 150, MOTE_TOP = 28;

let motes = null, moteUni = null;

function buildMotes(scene, map) {
  disposeMotes();
  const pal = (map && map.palette) || {};
  if (pal.motes === false) return;
  let p = MOTE_PRESETS[SEASON_MOTES[map && map.season] || 'pollen'];
  if (typeof pal.motes === 'string') p = MOTE_PRESETS[pal.motes] || p;
  else if (pal.motes && typeof pal.motes === 'object') p = { ...p, ...pal.motes };
  if (!p || !(p.count > 0)) return;

  const n = p.count | 0;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rand(-MOTE_BOX / 2, MOTE_BOX / 2);
    pos[i * 3 + 1] = rand(0, MOTE_TOP);
    pos[i * 3 + 2] = rand(-MOTE_BOX / 2, MOTE_BOX / 2);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), MOTE_BOX);

  moteUni = {
    uTime:   { value: 0 },
    uOrigin: { value: new THREE.Vector3() },
    uBox:    { value: MOTE_BOX },
    uTop:    { value: MOTE_TOP },
    uFall:   { value: p.fall },
    uDrift:  { value: p.drift },
    uWobble: { value: p.wobble },
    uSize:   { value: p.size },
    uColour: { value: new THREE.Color(p.colour) },
    uAlpha:  { value: p.alpha },
    uLeaf:   { value: p.leaf ? 1 : 0 },
    uFade:   { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: moteUni, transparent: true, depthWrite: false,
    blending: p.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `
      attribute float seed;
      uniform float uTime, uBox, uTop, uFall, uDrift, uWobble, uSize;
      uniform vec3 uOrigin;
      varying float vSeed, vFade;
      void main() {
        vSeed = seed;
        vec3 p = position;
        float t = uTime * (0.6 + seed * 0.8);
        p.y -= uFall * t;
        p.x += uDrift * t + sin(uTime * (0.4 + seed) + seed * 40.0) * uWobble;
        p.z += uDrift * 0.4 * t + cos(uTime * (0.35 + seed * 0.7) + seed * 23.0) * uWobble;
        p.x = mod(p.x - uOrigin.x + uBox * 0.5, uBox) - uBox * 0.5 + uOrigin.x;
        p.z = mod(p.z - uOrigin.z + uBox * 0.5, uBox) - uBox * 0.5 + uOrigin.z;
        p.y = mod(p.y, uTop) + uOrigin.y;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = uSize * (260.0 / max(1.0, d));
        /* soft box edges so a mote never pops in at the wrap seam, and a
           distance fade so the far field is not a haze of dots */
        float ex = 1.0 - smoothstep(uBox * 0.34, uBox * 0.5, abs(p.x - uOrigin.x));
        float ez = 1.0 - smoothstep(uBox * 0.34, uBox * 0.5, abs(p.z - uOrigin.z));
        vFade = ex * ez * (1.0 - smoothstep(150.0, 250.0, d));
      }`,
    fragmentShader: `
      uniform vec3 uColour;
      uniform float uAlpha, uLeaf, uTime, uFade;
      varying float vSeed, vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a;
        if (uLeaf > 0.5) {
          /* a tumbling leaf: an ellipse whose width breathes with time */
          float sq = 0.55 + 0.45 * sin(uTime * (2.0 + vSeed * 3.0) + vSeed * 50.0);
          c.x /= max(0.22, sq);
          a = smoothstep(0.5, 0.28, length(c));
        } else {
          a = smoothstep(0.5, 0.08, length(c))
            * (0.55 + 0.45 * sin(uTime * (1.5 + vSeed * 2.0) + vSeed * 30.0));   // twinkle
        }
        a *= uAlpha * vFade * uFade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColour, a);
      }`,
  });
  motes = new THREE.Points(geo, mat);
  motes.frustumCulled = false;
  motes.renderOrder = 4;             // under the fog veil (5) — see above
  motes.raycast = () => {};
  scene.add(motes);
}

function updateMotes(dt) {
  if (!motes || !moteUni) return;
  moteUni.uTime.value += dt;
  moteUni.uFade.value = Math.min(1, moteUni.uFade.value + dt * 0.5);
  /* anchor on the camera TARGET, not the camera: the box then straddles the
     ground the player is looking at, and its floor tracks the terrain there */
  const rts = G.rts, cam = G.camera;
  if (rts && rts.target) moteUni.uOrigin.value.set(rts.target.x, rts.target.y - 3, rts.target.z);
  else if (cam) moteUni.uOrigin.value.set(cam.position.x, 0, cam.position.z);
}

function disposeMotes() {
  if (!motes) return;
  motes.parent && motes.parent.remove(motes);
  motes.geometry.dispose(); motes.material.dispose();
  motes = null; moteUni = null;
}

/** The sky the timetable will hand you next, and in how long. For the HUD. */
export function nextFront() {
  if (!cycle) return null;
  let x = ((G.time % cycleTotal) + cycleTotal) % cycleTotal, i = 0;
  for (const [, secs] of cycle) { if (x < secs) break; x -= secs; i++; }
  const at = cycle[(i + 1) % cycle.length];
  return { name: at[0], in: cycle[i][1] - x };
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
/* Snow RAISED from 0.12. At that value snow was replenishment on paper only:
   the band multiplier peaks near 1.18, so snow topped out at 0.14 of a lake's
   drain rate — and, worse, it never cleared the isPouring() threshold, so the
   water bar showed no tell at all. A player watching thick snow fall while the
   lakes kept dropping was reading the game correctly; it just was not doing
   anything. Snowmelt is slower than rain, so it sits below it, but it is now a
   real contribution rather than a rounding error. */
const RAINFALL = { storm: 0.75, rain: 0.5, snow: 0.35, mist: 0.06, clear: 0 };

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
/* Threshold LOWERED from 0.42 so it means "water is coming back", which is
   what the HUD uses it for, rather than "it is specifically raining hard".
   At 0.42 snow could never trip it no matter how heavily it fell. */
export function isPouring() { return rainfall() > 0.24; }

/* What to CALL it in the HUD. Snow replenishing a lake is snowmelt, and saying
   "raining" over a blizzard is the kind of small lie that makes a player stop
   trusting the readout. */
export function precipWord() {
  const n = G.weather && G.weather.name;
  return n === 'snow' ? 'snowmelt' : n === 'mist' ? 'mist' : 'raining';
}

export function updateWeather(dt) {
  const cam = G.camera;
  updateMotes(dt);

  /* a front on the timetable: announce it, fade the old sky out, swap, and let
     the new one's existing uFade ramp bring it in */
  if (cycle && !frontTo) {
    const want = nameAt(G.time);
    if (want !== curName) {
      frontTo = want; frontT = FRONT_FADE;
      toast(FRONT_TOAST[want] || 'The weather is turning');
    }
  }
  let out = 1;
  if (frontTo) {
    frontT -= dt;
    out = Math.max(0, frontT / FRONT_FADE);
    if (frontT <= 0) {
      const n = frontTo; frontTo = null; curName = n;
      buildWeather(sceneRef, n);
      return;
    }
  }

  if (precip && uni) {
    uni.uTime.value += dt;
    uni.uFade.value = frontTo ? Math.min(uni.uFade.value, out)
                              : Math.min(1, uni.uFade.value + dt * 0.6);
    if (cam) uni.uOrigin.value.set(cam.position.x, 0, cam.position.z);
  }
  if (mist) {
    const mu = mist.children[0].material.uniforms;
    mu.uTime.value += dt;
    mu.uFade.value = frontTo ? Math.min(mu.uFade.value, out)
                             : Math.min(1, mu.uFade.value + dt * 0.4);
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
