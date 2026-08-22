import * as THREE from 'three';
import { G } from './state.js';
import { queueUnit, buildScene, populate, updateWorld, reapDead } from './world.js';
import { RTSCamera } from './camera.js';
import { initInput } from './input.js';
import { initHUD, updateHUD } from './hud.js';
import { updateAI } from './ai.js';
import { updateCombatFX } from './combat.js';
import { updateVFX, initVFXLights } from './vfx.js';
import { commsEvent, updateComms } from './comms.js';
import { updateWeather } from './weather.js';
import { updateWater, renderWaterReflection } from './water.js';
import { initPost, renderPost, resizePost } from './post.js';
import { SFX, updateListener, ambientVoices } from './audio.js';
import { tickShaders } from './shaders.js';
import { BASE, COMPOUND } from './config.js';
import { toast } from './ui.js';
import { showSplash, splashReady } from './splash.js';
import { vw, vh } from './utils.js';
import { initFog, updateFog, fogRevealAll } from './fog.js';
import { initVerdant, updateVerdant } from './verdant.js';
import { showStartScreen, applyDifficulty, showBriefing, showCampaignMap, DIFFICULTIES } from './screens.js';
import { loadMap, DEFAULT_MAP, validateAllMaps } from './maps.js';
import { SITES, pendingMission, setPending, applyCampaignMods, campState, exportCode, importCode } from './campaign.js';
import { initScore, updateScore, setProjector } from './score.js';
import { initPerf, perfFrame } from './perf.js';

const gameCanvas = document.getElementById('scene');
window.G = G;                       // handy for tinkering from the console
window.THREE = THREE;               // ditto — the flat build has no import map
window.addEventListener('error', e => { window.__lastErr = (e.error && e.error.stack) || e.message; });

/* ----------------------------------------------------------- renderer -- */
const renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(vw(), vh());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/* Shadows are redrawn on OUR schedule: every other frame, once — not on every
   render() call. A 2048 map twice a frame was ~1.3ms of CPU nobody could see. */
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, vw() / vh(), 1, 900);

G.scene = scene;
G.camera = camera;
G.renderer = renderer;
G.entityRoot = new THREE.Group();
G.fxRoot = new THREE.Group();
scene.add(G.entityRoot);
scene.add(G.fxRoot);

/* Which map? A pending campaign strike decides; otherwise the home valley.
   loadMap() must run before buildScene(): terrain, shader uniforms and the
   compound footprint are all read at construction time. */
const pending = pendingMission();
// hasOwnProperty: `{"site":"constructor"}` used to resolve to a truthy non-site
// and crash the boot before the title screen could render
const pendingSite = (pending && pending.mode === 'campaign'
  && Object.prototype.hasOwnProperty.call(SITES, pending.site)) ? SITES[pending.site] : null;
loadMap(pendingSite ? pendingSite.map : DEFAULT_MAP);

/* Data check: overlapping structures used to ship silently. Loud in the console
   and reachable from the page so a layout edit can be checked in one call. */
window.__validateMaps = validateAllMaps;
{
  const bad = validateAllMaps();
  const ids = Object.keys(bad);
  if (ids.length) console.error('[wildline] map layout problems:', bad);
}

/* The world is built immediately so the title/briefing screen has a live 3D
   backdrop to orbit, but no entities exist until the player commits. */
buildScene(scene);
initPost(renderer);          // HDR + bloom chain
initVFXLights(scene);        // fixed light pool, never added or removed after this

const rtsCamera = new RTSCamera(camera);
G.rts = rtsCamera;
rtsCamera.cinematic = { x: (BASE.x + COMPOUND.x) * 0.5, z: (BASE.z + COMPOUND.z) * 0.5 };
rtsCamera.update(0.016);

initInput(gameCanvas, rtsCamera);
initHUD();
initPerf(renderer);

/* Score popups need world→screen; keep three out of score.js entirely. */
const _proj = new THREE.Vector3();
setProjector(w => {
  _proj.set(w.x, (w.y || 0) + 2, w.z).project(camera);
  return { x: (_proj.x * 0.5 + 0.5) * vw(), y: (-_proj.y * 0.5 + 0.5) * vh(), behind: _proj.z > 1 };
});

function fitViewport() {
  camera.aspect = vw() / vh();
  camera.updateProjectionMatrix();
  renderer.setSize(vw(), vh());
  resizePost(renderer);
}
window.addEventListener('resize', fitViewport);
document.addEventListener('visibilitychange', fitViewport);

document.getElementById('loading').remove();

/* The splash goes up first and the title screen waits behind it. Continue only
   lights up once the world is actually built and a frame has been presented. */
let splashDone = false;
showSplash(() => { splashDone = true; openTitle(); });

/* -------------------------------------------------------------- boot --- */
G.phase = 'menu';
document.body.classList.add('menu');       // hides the HUD behind the title/briefing

function launchMission() {
  document.body.classList.remove('menu');
  populate();
  initFog();
  initVerdant(scene);
  initScore();
  rtsCamera.cinematic = null;
  rtsCamera.focus(BASE, true, 95);   // the orbit leaves dist at 150; reset to default
  rtsCamera.update(0.016);
  G.phase = 'playing';
  musicPlay(trackForMap(G.map));
  toast('Walk a beast onto a Grove to bloom it. F1 for orders, F3 for stats.');
}

function openTitle() {
  musicPlay('title');
  if (pendingSite) {
    /* Campaign strike: fixed GROVE baseline, then the campaign's scaling and the
       perks earned from liberated ground. Order matters: applyDifficulty first. */
    applyDifficulty(DIFFICULTIES[1]);
    const mods = applyCampaignMods(campState(), pendingSite.id);
    G.campaignSite = pendingSite.id;
    showBriefing(pendingSite, mods, launchMission);
  } else {
    showStartScreen(diff => {
      applyDifficulty(diff);        // must precede populate(): the starting garrison size
      launchMission();              // is read from RULES at spawn time
    });
    // returning from a finished mission drops you straight back onto the map
    if (pending && pending.mode === 'return') { setPending(null); showCampaignMap(); }
  }
}

/* ------------------------------------------------------------- loop ---- */
let last = performance.now();
let hudAccum = 0;

// ?headless=1 keeps the loop ticking when the tab is hidden (used for testing)
const HEADLESS = new URLSearchParams(location.search).has('headless');
function schedule() {
  if (HEADLESS && document.hidden) setTimeout(() => frame(performance.now()), 16);
  else requestAnimationFrame(frame);
}

if (HEADLESS) {
  // synchronous stepping so automated checks can fast-forward the simulation
  window.__step = (frames = 60, ms = 33) => { for (let i = 0; i < frames; i++) frame(last + ms, true); };
  window.__begin = () => {
    /* the splash sits in front of the menu, so a harness run has to clear it
       first or every automated check silently measures an empty menu */
    const cont = document.getElementById('sp-continue');
    if (cont) { cont.disabled = false; cont.click(); }
    const btn = document.getElementById('ss-begin');
    if (btn) btn.click();
    return G.phase;
  };
  /* balance checks need to actually play: queue units and issue orders */
  window.__api = { queueUnit, SFX, musicState, exportCode, importCode, campState, order(units, type, pos, target) {
    for (const u of units) u.setOrder(type, pos, target);
  } };
}

function frame(now, manual) {
  if (!manual) schedule();      // synthetic steps must not each spawn a new loop
  let dt = (now - last) / 1000;
  last = now;
  // clamp BOTH ends: a negative dt runs G.time backwards and invalidates every
  // deadline keyed off it (waves, cooldowns, roots, corpse ages, survival score)
  if (!(dt > 0)) dt = 0;
  else if (dt > 0.1) dt = 0.1;
  G.dt = dt;
  G.wallTime += dt;             // never pauses: FX and corpse decay run off this
  updateMusic(dt);              // music fades/ducking run in every phase, even menus

  if (G.over && G.phase === 'playing') G.phase = 'over';

  if (G.phase === 'playing' && !G.paused) {
    G.time += dt;

    // spatial index for neighbour + target queries
    G.grid.clear();
    for (const e of G.entities) if (e.alive) G.grid.insert(e);

    for (const e of G.entities) e.update(dt);

    updateListener();      // pan/attenuation for everything played this frame
    ambientVoices(dt);
    updateAI(dt);
    updateWorld(dt);
    updateWater(dt);
    updateFog(dt);
    updateVerdant(dt);
    reapDead(dt);
    updateScore(dt);
  } else if (G.phase === 'over') {
    // let the explosions finish playing out, and lift the veil for the flyover
    for (const e of G.entities) if (e.alive && e.isBuilding) e.update(dt);
    fogRevealAll();
    updateFog(dt);
    reapDead(dt);
  }

  if (camera.aspect !== vw() / vh()) fitViewport();

  tickShaders(G.time, dt);
  updateCombatFX(dt);
  updateVFX(dt);
  updateComms(dt);
  updateWeather(dt);
  rtsCamera.update(dt);

  if (G.phase === 'playing') {          // the end card owns the screen once it's over
    hudAccum += dt;
    if (hudAccum > 0.08) { hudAccum = 0; updateHUD(); }
  }
  perfFrame(dt);

  if ((framesPresented & 1) === 0) renderer.shadowMap.needsUpdate = true;
  renderWaterReflection(renderer, scene, camera);
  renderPost(renderer, scene, camera, dt);

  if (!framesPresented++) splashReady();   // the world is up and a frame is on screen
}
let framesPresented = 0;
schedule();
