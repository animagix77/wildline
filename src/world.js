import * as THREE from 'three';
import { G } from './state.js';
import { WORLD, HALF, BASE, COMPOUND, DEFS, RULES, TEAM } from './config.js';
import { terrainHeight, blight, insideCompound, rand, randInt, dist2D, clamp, fbm, Grid } from './utils.js';
import { enableCanopyFade, M, GLOW, makeForest, makeScatter, buildWall, box, cyl } from './meshes.js';
import { applyFogMask } from './fog.js';
import { makeTerrainMaterial, makeSkyDome, makeShieldMaterial } from './shaders.js';
import { initWeather } from './weather.js';
import { initWater, groveWaterFactor } from './water.js';
import { Entity, spawn } from './entity.js';
import { toast } from './ui.js';
import { showEndScreen } from './screens.js';
import { addScore, getStats } from './score.js';
import { commsEvent } from './comms.js';
import { recordResult, setPending, campState, bankSurvivors } from './campaign.js';
import { SFX } from './audio.js';
import { musicStop, musicStinger } from './music.js';
import { ring, burst, kill } from './combat.js';

/* =========================================================================
   Scene construction
   ========================================================================= */

export function buildScene(scene) {
  const pal = (G.map && G.map.palette) || {};
  scene.background = new THREE.Color(pal.bg !== undefined ? pal.bg : 0x1b2f24);
  scene.fog = new THREE.Fog(pal.fog !== undefined ? pal.fog : 0x24402f,
    pal.fogNear || 170, pal.fogFar || 420);

  /* --- mood: the map's hour and season, in light ---------------------------
     Every value here used to be hardcoded, which is why all nine maps looked
     like the same overcast afternoon. A map's `mood` block now carries the sun
     (colour, intensity, and OFFSET -- the offset is the time of day: low and
     warm is golden hour, high and pale is noon) plus the hemisphere pair. The
     offset must ALSO drive camera.js, which re-pins the sun to the camera
     target every frame; it reads G.sunOffset rather than its old literals. */
  const mood = (G.map && G.map.mood) || {};
  const hemi = new THREE.HemisphereLight(
    mood.hemiSky !== undefined ? mood.hemiSky : 0xbde4ff,
    mood.hemiGround !== undefined ? mood.hemiGround : 0x3d4f2e,
    mood.hemiI !== undefined ? mood.hemiI : 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(
    mood.sunC !== undefined ? mood.sunC : 0xfff0d2,
    mood.sunI !== undefined ? mood.sunI : 1.85);
  G.sunOffset = mood.sunOffset || [-70, 110, 60];
  sun.position.set(G.sunOffset[0], G.sunOffset[1], G.sunOffset[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  /* widened from 130: a golden-hour sun sits lower, and long shadows walked
     straight out of the old frustum and vanished mid-screen */
  c.left = -170; c.right = 170; c.top = 170; c.bottom = -170;
  c.near = 10; c.far = 420;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.5;
  scene.add(sun);
  scene.add(sun.target);
  G.sun = sun;

  // cold rim light from the datacenter side
  const rim = new THREE.DirectionalLight(0x4fd8ea, 0.35);
  rim.position.set(120, 40, -110);
  scene.add(rim);

  const sky = makeSkyDome();
  scene.add(sky);
  G.sky = sky;

  buildTerrain(scene);
  initWater(scene, G.map && G.map.water);
  buildProps(scene);
  initWeather(scene, (G.map && G.map.weather) || 'clear');
}

function buildTerrain(scene) {
  const seg = 190;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const blightAttr = new Float32Array(pos.count);   // consumed by the terrain shader
  const cGrass = new THREE.Color(0x2f5a29);
  const cLush  = new THREE.Color(0x47803a);
  const cDry   = new THREE.Color(0x4f5233);
  const cAsh   = new THREE.Color(0x2f2e2a);
  const cTar   = new THREE.Color(0x212328);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    // jitter the blight edge so the dead zone doesn't read as a clean rectangle
    const jitter = (fbm(x * 0.035, z * 0.035, 2) - 0.5) * 0.4;
    const b = Math.max(0, Math.min(1, blight(x, z) + jitter));
    const n = fbm(x * 0.05, z * 0.05, 3);
    tmp.copy(cGrass).lerp(cLush, n);
    tmp.multiplyScalar(0.82 + fbm(x * 0.11, z * 0.11, 2) * 0.36);
    if (b > 0.02) {
      tmp.lerp(cDry, Math.min(0.9, b * 1.25));
      tmp.lerp(cAsh, Math.max(0, b - 0.45) * 1.6);
      if (insideCompound(x, z, 2 + jitter * 10)) tmp.lerp(cTar, 0.8);
    }
    // a lighter ring of moss right around the heart tree
    const dh = Math.hypot(x - BASE.x, z - BASE.z);
    if (dh < 40) tmp.lerp(cLush, (1 - dh / 40) * 0.5);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    blightAttr[i] = insideCompound(x, z, 2 + jitter * 10) ? 1.0 : Math.min(0.72, b);
  }
  geo.setAttribute('blight', new THREE.BufferAttribute(blightAttr, 1));
  geo.computeVertexNormals();

  // albedo is generated in GLSL from the `blight` attribute — see shaders.js.
  // Deliberately NOT vertexColors: <color_fragment> would multiply the procedural
  // result by the legacy per-vertex colours and wash it out.
  const mat = makeTerrainMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  G.terrain = mesh;

  // a dark apron beyond the playable area so the map never ends in empty space.
  // It is fog-masked like everything else, otherwise it stays lit past the veil's
  // edge and the unexplored world reads as a lit plain surrounding a dark hole.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 4, WORLD * 4),
    applyFogMask(new THREE.MeshStandardMaterial({ color: 0x1d3324, roughness: 1 }))
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -7;
  scene.add(apron);

  // a dense band of trees ringing the map, purely scenic
  const [borderTrunks, borderLeaves] = makeForest(700, () => {
    for (let i = 0; i < 12; i++) {
      const a = rand(0, 6.2832), d = rand(HALF + 3, HALF + 62);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      return { x, y: -6 + rand(0, 2), z };
    }
    return null;
  });
  borderTrunks.material = applyFogMask(borderTrunks.material.clone());
  borderLeaves.material = applyFogMask(borderLeaves.material.clone());
  /* THE BORDER FOREST NEVER FADED, and it was the remaining invisible shooter.
     The band starts at HALF+3 -- three units past the playable edge -- and its
     trees stand well into view, so a machine fighting near the edge could sit
     behind them from the camera with no way to fade them: enableCanopyFade was
     only ever wired to the inner forest. Reported (twice) as "something firing
     from the same spot in the trees my units can't see".

     Enabled AFTER the fog-mask material swap, same ordering rule as the inner
     forest. The active-index list keeps the per-frame cost honest: only trees
     within reach of the playable area can ever occlude a unit, so the ~500
     pure-backdrop trees deeper in the band are never even iterated. */
  enableCanopyFade(borderLeaves, borderTrunks);
  const reach = [];
  for (let i = 0; i < borderLeaves.count; i++) {
    const x = borderLeaves.userData.pos[i * 3], z = borderLeaves.userData.pos[i * 3 + 2];
    if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 16) reach.push(i);
  }
  borderLeaves.userData.active = reach;
  (G.canopies || (G.canopies = [])).push(borderLeaves);
  scene.add(borderTrunks); scene.add(borderLeaves);
}

function freeSpot(minDistCompound = 6) {
  for (let tries = 0; tries < 30; tries++) {
    const x = rand(-HALF + 6, HALF - 6), z = rand(-HALF + 6, HALF - 6);
    if (insideCompound(x, z, minDistCompound)) continue;
    if (Math.hypot(x - BASE.x, z - BASE.z) < 28) continue;
    let ok = true;
    for (const g of G.map.groves) if (Math.hypot(x - g.x, z - g.z) < 9) { ok = false; break; }
    if (ok && G.map.water) for (const w of G.map.water) if (Math.hypot(x - w.x, z - w.z) < w.r + 3) { ok = false; break; }
    if (!ok) continue;
    return { x, y: terrainHeight(x, z), z };
  }
  return null;
}

function buildProps(scene) {
  /* Scenery materials are cloned before being fog-masked: `M()` hands back cached,
     shared instances, so patching them in place would drag every unit and building
     that happens to share a colour key into the fog shader too. */
  const scenic = (mat) => applyFogMask(mat.clone());

  const density = (G.map && G.map.props) || {};

  // forest
  const [trunks, leaves] = makeForest(density.trees || 820, () => freeSpot(10));
  trunks.material = scenic(trunks.material);
  leaves.material = scenic(leaves.material);
  enableCanopyFade(leaves, trunks);  // must follow the material swap, not precede it
  G.canopy = leaves;
  (G.canopies || (G.canopies = [])).push(leaves);
  scene.add(trunks); scene.add(leaves);

  // rocks
  scene.add(makeScatter(
    new THREE.DodecahedronGeometry(1, 0), scenic(M(0x6a6b64, { rough: 1 })), density.rocks || 240,
    () => { const p = freeSpot(4); if (p) p.y -= 0.3; return p; }, [0.6, 2.4]
  ));

  /* Riverbank stones. A ribbon of water laid on open grass reads as a decal;
     a scattering of rock along its edges is what makes it read as a CUT — the
     same job the stone ring does for the groves. Placed by sampling the
     authored polyline and offsetting past the ribbon's half-width. */
  if (G.map && G.map.river) {
    const pts = G.map.river;
    scene.add(makeScatter(
      new THREE.DodecahedronGeometry(1, 0), scenic(M(0x63645c, { rough: 1 })), 90,
      () => {
        const i = Math.floor(rand(0, pts.length - 1));
        const a = pts[i], b = pts[i + 1];
        const t = rand(0, 1);
        const x0 = a.x + (b.x - a.x) * t, z0 = a.z + (b.z - a.z) * t;
        let nx = -(b.z - a.z), nz = (b.x - a.x);
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const side = rand(0, 1) > 0.5 ? 1 : -1;
        const d = 6.4 + rand(0.2, 2.6);          // just past the widest bank
        const x = x0 + nx * d * side, z = z0 + nz * d * side;
        if (insideCompound(x, z, 4)) return null;
        return { x, y: terrainHeight(x, z) - 0.25, z };
      }, [0.35, 1.1]));
  }

  // ferns / low brush
  const fern = new THREE.ConeGeometry(0.8, 1.6, 5);
  fern.translate(0, 0.8, 0);
  scene.add(makeScatter(fern, scenic(M(0x3d7a35, { rough: 1 })), density.ferns || 520,
    () => freeSpot(6), [0.6, 1.5]));

  // dead sticks in the blighted zone
  const stick = new THREE.CylinderGeometry(0.12, 0.2, 4, 5);
  stick.translate(0, 2, 0);
  scene.add(makeScatter(stick, scenic(M(0x453f36, { rough: 1 })), 120, () => {
    for (let i = 0; i < 20; i++) {
      const a = rand(0, 6.28), d = rand(COMPOUND.hw, COMPOUND.hw + 30);
      const x = COMPOUND.x + Math.cos(a) * d, z = COMPOUND.z + Math.sin(a) * d * 0.8;
      if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) continue;
      if (insideCompound(x, z, 3)) continue;
      return { x, y: terrainHeight(x, z), z };
    }
    return null;
  }, [0.7, 1.5]));

  // yard clutter inside the compound: containers + pipe runs
  const yard = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const x = COMPOUND.x + rand(-COMPOUND.hw + 8, COMPOUND.hw - 8);
    const z = COMPOUND.z + rand(-COMPOUND.hd + 8, COMPOUND.hd - 8);
    if (Math.hypot(x - 58, z + 50) < 20) continue;
    const b = box(scenic(M([0x394048, 0x4a4038, 0x2f3a42][randInt(0, 2)], { metal: 0.4, rough: 0.6 })),
      rand(5, 9), 2.8, 2.6, x, terrainHeight(x, z) + 1.4, z);
    b.rotation.y = rand(0, 6.28);
    yard.add(b);
  }
  for (let i = 0; i < 5; i++) {
    const z = COMPOUND.z - COMPOUND.hd + 8 + i * 13;
    const p = cyl(scenic(M(0x5b6470, { metal: 0.6, rough: 0.4 })), 0.5, 40, COMPOUND.x - 22, 1.6, z);
    p.rotation.z = Math.PI / 2;
    yard.add(p);
  }
  scene.add(yard);
}

/* =========================================================================
   Map population
   ========================================================================= */

/* Layout arrays live on the MapDef now — see src/maps.js. These getters exist
   so the rest of this file reads naturally. */
const layout = () => G.map;

export function populate() {
  const GROVE_POINTS = layout().groves;
  const TURRETS = layout().turrets;
  const COOLANTS = layout().coolants;
  const DEPOTS = layout().depots;
  G.grovePoints = GROVE_POINTS;
  G.obstacles = [];
  G.grid = new Grid(10);

  /* ---- player base ---- */
  const heart = spawn('hearttree', BASE.x, BASE.z);
  heart.onDeath = () => {
    G.over = true;
    endMission(false);
  };
  G.heart = heart;
  G.obstacles.push(heart);
  G.rally = new THREE.Vector3(BASE.x + 14, 0, BASE.z - 10);

  for (let i = 0; i < 4; i++)
    spawn('wolf', BASE.x + rand(6, 16), BASE.z + rand(-10, 8));

  /* Veterans who survived the last strike muster at the Heart Tree, rank intact. */
  if (G.campaignSite) {
    const pack = campState().pack || [];
    pack.forEach((u, i) => {
      const a = (i / Math.max(1, pack.length)) * Math.PI * 2;
      const e = spawn(u.type, BASE.x + Math.cos(a) * 15, BASE.z + Math.sin(a) * 15, { kills: u.kills });
      if (e.vet) commsEvent('grove', 0.12);   // the corp notices familiar faces
    });
    if (pack.length) toast(`${pack.length} veteran${pack.length > 1 ? 's' : ''} answered the call`);
  }

  /* ---- groves ---- */
  G.groves = GROVE_POINTS.map(p => {
    const g = spawn('grove', p.x, p.z);
    g.owned = false;
    g.prog = 0;
    return g;
  });

  /* ---- compound ---- */
  buildPerimeter();

  /* Authored per map, defaulting to the compound's own centre. The literal that
     used to live here was verdant-hollow's, so on relay-shed the Core's collision
     radius swallowed a Depot centre and ejected units at 256 m/s. */
  const cp = layout().core || { x: COMPOUND.x, z: COMPOUND.z };
  const core = spawn('core', cp.x, cp.z);
  core.onDeath = () => {
    G.over = true;
    endMission(true);
  };
  G.core = core;
  G.obstacles.push(core);

  /* Hologram shield: the visible reason the Core cannot be hurt yet. It tears and
     flickers as coolant towers go dark, then drops entirely while every one of
     them is offline — and comes BACK if a technician relights one — so the
     objective reads without needing the HUD. */
  const shield = new THREE.Mesh(new THREE.SphereGeometry(17, 44, 30), makeShieldMaterial());
  shield.position.set(core.pos.x, core.pos.y + 5, core.pos.z);
  shield.renderOrder = 3;
  G.scene.add(shield);
  G.coreShield = shield;

  G.coolants = COOLANTS.map(([x, z]) => {
    const c = spawn('coolant', x, z);
    /* A tower goes OFFLINE, it does not die. See RULES.meltdownSeconds. */
    c.onDowned = () => {
      const left = coolantsOnline();
      const down = G.coolants.length - left;
      ring(c.pos, 0x39d7ea, 26, 1.4);
      /* Cooling is continuous now, so a tower going fully offline is a big step
         rather than a threshold crossing. Announce it as capacity lost, and
         save the alarm for the moment the Core actually starts to warm. */
      if (!G.coreExposed) {
        commsEvent('coolant');
        toast(`Coolant tower offline — ${left} still cooling`, 'machine');
      } else if (down > 1) {
        commsEvent('coolant');
        SFX.alarm();
        toast(`Another tower down — the Core is cooking ${down >= G.coolants.length ? 'at full rate' : 'faster'}`, 'warn');
      } else {
        commsEvent('coreExposed');
        SFX.shieldDown();
        SFX.alarm();
        /* Name the shape of the ending, not just the fact of it. The player has
           to know this is a HOLD — that walking away now gives it all back — or
           they will do what every previous build trained them to do and leave. */
        toast('MELTDOWN — the Core is cooking. Keep the coolant towers down and '
              + 'wrecked; every one you let them rebuild slows it.', 'warn');
      }
    };
    c.onRelit = () => {
      toast(`A technician relit a coolant tower — ${coolantsOnline()} cooling again`, 'machine');
      commsEvent('coolant', 0.8);
    };
    G.obstacles.push(c);
    return c;
  });

  G.depots = DEPOTS.map(([x, z]) => {
    const d = spawn('depot', x, z, { rotY: z > COMPOUND.z ? Math.PI : 0 });
    d.spawnTimer = rand(4, 10);
    d.onDeath = () => {
      commsEvent('depot');
      /* Name the time. "Fewer reinforcements" is a number the player cannot
         see; seconds off the next sweep is one they can. */
      const secs = Math.round(RULES.waveEvery * RULES.depotWaveDelay);
      toast(`Security Depot destroyed — every sweep from here is ${secs}s further out`, 'machine');
    };
    G.obstacles.push(d);
    return d;
  });

  for (const [x, z] of TURRETS) {
    const t = spawn('turret', x, z);
    G.obstacles.push(t);
  }

  /* Intake pumps: the reason the water is leaving. Killing one permanently
     removes its share of the draw, so there is a real decision every mission
     between rushing the Core and peeling off to save the valley's water. */
  G.pumps = (layout().pumps || []).map(([x, z]) => {
    const p = spawn('pump', x, z);
    p.onDeath = () => {
      const left = G.pumps.filter(q => q.alive).length;
      commsEvent('water', 0.8);
      toast(left ? `Intake pump destroyed — ${left} still drawing` : 'The last pump is dead. The water is coming back.');
    };
    G.obstacles.push(p);
    return p;
  });

  /* Generators. The compound's gun line runs off these, so a swarm that cannot
     out-trade a turret has a second route: cut the power and walk in. */
  G.generators = (layout().generators || []).map(([x, z]) => {
    const g = spawn('generator', x, z);
    g.onDeath = () => {
      const left = G.generators.filter(q => q.alive).length;
      /* Count the guns AT THE MOMENT OF DEATH. The line used to fire off the
         derived `powered` flag and landed at 6:06 of a match in which the live
         turret count had already been zero for some time — the joke played to
         an empty stage. Naming the number fixes it in both directions: if there
         is nothing left to switch off, it says that instead. */
      const guns = G.entities.filter(q => q.alive && q.type === 'turret').length;
      commsEvent(left ? 'turret' : 'power', 0.9);
      toast(left ? `Generator down — ${left} still feeding the guns`
                 : (guns ? `THE POWER IS OUT — ${guns} turret${guns > 1 ? 's go' : ' goes'} dark`
                         : 'THE POWER IS OUT — there was nothing left to switch off'), 'warn');
      if (!left) SFX.shieldDown();
    };
    G.obstacles.push(g);
    return g;
  });

  /* Deep wells. Groundwater, so they keep drawing after every surface intake
     is scrap — the reason killing pumps is not automatically the whole answer
     to the water. */
  G.wells = (layout().wells || []).map(([x, z]) => {
    const w = spawn('well', x, z);
    w.onDeath = () => {
      commsEvent('water', 0.8);
      toast('A deep well is capped');
    };
    G.obstacles.push(w);
    return w;
  });

  /* A site caught mid-build finishes on a clock if you let it. */
  const con = layout().construction;
  if (con) {
    G.construction = { time: con.time, left: con.time, def: con, done: false, warned: {} };
  } else {
    G.construction = null;
  }

  /* SITE WORKS. See RULES.siteWorks for the measurement that made these
     necessary. A map that already carries a construction timer is already a
     race against a building site, so it does not get a second one. */
  G.works = con ? [] : (RULES.siteWorks || []).map(w => ({ def: w, noticed: false, built: false }));

  // starting garrison — sized by difficulty, not hard-coded
  for (let i = 0; i < RULES.garrisonGuards; i++) {
    const g = spawn('guard', COMPOUND.x + rand(-COMPOUND.hw + 8, COMPOUND.hw - 8),
                             COMPOUND.z + rand(-COMPOUND.hd + 8, COMPOUND.hd - 8));
    assignPatrol(g);
  }
  for (let i = 0; i < RULES.garrisonDrones; i++) {
    const d = spawn('drone', COMPOUND.x + rand(-COMPOUND.hw + 8, COMPOUND.hw - 8),
                             COMPOUND.z + rand(-COMPOUND.hd + 8, COMPOUND.hd - 8));
    assignPatrol(d);
  }
}

/* How many coolant towers are actually cooling. A tower that has been knocked
   offline is still ALIVE — it stands, it blocks, and a technician can relight
   it — so `alive` is the wrong question everywhere the objective is concerned.
   One place to ask it, because getting this wrong silently un-wins the match. */
export function coolantsOnline() {
  return G.coolants ? G.coolants.filter(c => c.alive && !c.downed).length : 0;
}

/* GROVE STATE, IN COLOUR.

   The tells for losing a grove used to be an opacity change (0.75 -> 0.18) and
   a toast. Opacity is a terrible carrier for "this is being taken from you":
   it reads as distance or weather, it is invisible against a bright sky, and at
   an RTS camera pitch the beam is foreshortened anyway. Players watched groves
   flip without noticing, which matters because a lost grove costs the income,
   the recapture AND 18 seconds of dormancy in which it cannot be retaken.

   Hue is unambiguous and reads at any size:
     green   yours, paying
     white   neutral, free to take
     amber   CONTESTED — machines on it, progress draining, go now
     red     lost, and dormant: nothing you do here works yet
   Amber and red also pulse, because a static colour reads as decoration. */
const GROVE_TINT = {
  owned:     0x8bffa0,
  neutral:   0xbfe8cf,
  contested: 0xffb03a,
  lost:      0xff4b3a,
};

function groveTint(g, t) {
  const a = g.anim;
  if (!a || !a.pillar) return;
  const dormant = G.time < (g.dormantUntil || 0);
  const key = g.losing ? 'contested' : dormant ? 'lost' : g.owned ? 'owned' : 'neutral';

  if (a._tintKey !== key) {
    a._tintKey = key;
    a.pillar.material.color.setHex(GROVE_TINT[key]);
    if (a.beaconRing) a.beaconRing.material.color.setHex(GROVE_TINT[key]);
  }

  /* Base opacity per state, then a pulse on the two that want attention. The
     pulse is on OPACITY rather than colour so it survives the additive blend
     without washing the hue out. */
  const base = key === 'owned' ? 0.75 : key === 'contested' ? 0.85
             : key === 'lost'  ? 0.55 : 0.45;
  const urgent = key === 'contested' || key === 'lost';
  const pulse = urgent ? 0.78 + 0.22 * Math.sin(t * (key === 'contested' ? 7.5 : 3.4)) : 1;
  a.pillar.material.opacity = base * pulse;
  if (a.beaconRing && a.beaconRing.visible) a.beaconRing.material.opacity = 0.46 * pulse;
}

/* Mission resolution: in a campaign, bank the result and route the end-screen
   button back to the territory map; in a quick battle, just offer a rerun. */
function endMission(win) {
  musicStop(1.2);
  musicStinger(win ? 'victory' : 'defeat');
  const stats = getStats(win);
  if (G.campaignSite) {
    /* Clear the strike HERE, not in the end-screen button. Leaving it set meant a
       refresh instead of a click dropped the player back into the briefing for a
       site they had just liberated — and re-winning it overwrote the banked
       veteran pack with whatever survived the replay. */
    setPending({ mode: 'return' });
    if (win) {
      bankSurvivors(G.entities.filter(e => e.alive && e.team === TEAM.WILD && !e.isBuilding));
    }
    recordResult(G.campaignSite, win, stats.rank);
    showEndScreen(win, stats, () => { setPending({ mode: 'return' }); location.reload(); },
      { buttonLabel: win ? 'Return to the valley' : 'Back to the valley map' });
  } else {
    showEndScreen(win, stats, () => location.reload());
  }
}

/* Perimeter fence with two gates: one facing north, one facing west. */
function buildPerimeter() {
  const { x: cx, z: cz, hw, hd } = COMPOUND;
  const seg = 10;
  const gateN = { c: cx, half: 9 };       // gap in the z = cz+hd wall
  const gateW = { c: cz, half: 9 };       // gap in the x = cx-hw wall

  const addWall = (x, z, rotY, len) => {
    const e = new Entity('wall', x, z, { mesh: buildWall(len), rotY, noRing: true });
    e.box = rotY === 0
      ? { hw: len / 2, hd: 0.8 }
      : { hw: 0.8, hd: len / 2 };
    G.obstacles.push(e);
    return e;
  };

  for (let x = cx - hw; x < cx + hw - 0.1; x += seg) {
    const mid = x + seg / 2;
    // south wall (always solid)
    addWall(mid, cz - hd, 0, seg);
    // north wall with gate
    if (Math.abs(mid - gateN.c) > gateN.half + seg / 2 - 1) addWall(mid, cz + hd, 0, seg);
  }
  for (let z = cz - hd; z < cz + hd - 0.1; z += seg) {
    const mid = z + seg / 2;
    addWall(cx + hw, mid, Math.PI / 2, seg);
    if (Math.abs(mid - gateW.c) > gateW.half + seg / 2 - 1) addWall(cx - hw, mid, Math.PI / 2, seg);
  }
  G.gates = [
    new THREE.Vector3(cx, 0, cz + hd),
    new THREE.Vector3(cx - hw, 0, cz),
  ];
}

export function assignPatrol(e) {
  const { x: cx, z: cz, hw, hd } = COMPOUND;
  e.patrol = [];
  for (let i = 0; i < 3; i++)
    e.patrol.push(new THREE.Vector3(cx + rand(-hw + 8, hw - 8), 0, cz + rand(-hd + 8, hd - 8)));
  e.patrolIdx = 0;
  e.home = e.pos.clone();
}

/* =========================================================================
   Per-frame world logic: economy, groves, production
   ========================================================================= */

export function fmt(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function updateWorld(dt) {
  /* --- groves --- */
  let bloomed = 0;
  for (const g of G.groves) {
    /* Trampled ground recovers on a clock. Until it does the grove cannot be
       re-taken, which is the whole reason intercepting a landscaping detail is
       worth doing — see RULES.groveDormant. */
    if (g.dormantUntil && G.time >= g.dormantUntil) {
      g.dormantUntil = 0;
      /* opacity/colour are groveTint's job now — it reads dormantUntil directly */
      toast('The trampled ground has recovered — that grove can be taken again');
    }
    let wild = 0, machine = 0;
    for (const e of G.entities) {
      if (!e.alive || e.isBuilding) continue;
      if (dist2D(e.pos, g.pos) > 7) continue;
      if (e.team === TEAM.WILD) wild++; else if (e.team === TEAM.MACHINE) machine++;
    }
    /* Taking a grove and losing one are no longer the same speed. See
       RULES.decapBase: one wandering guard needs ~8.6 seconds, which is long
       enough for the warning toast below to be an order you can actually give,
       while a four-strong landscaping detail still strips it in three. */
    let dir = 0;
    if (wild > 0 && machine === 0) dir = 1;
    else if (machine > 0 && wild === 0) {
      dir = -Math.min(1, RULES.decapBase + RULES.decapPerExtra * (machine - 1));
    }
    if (dir > 0 && !g.owned && G.time < (g.dormantUntil || 0)) dir = 0;
    /* Being pushed off a grove is expensive and used to happen in near-silence.
       Warn once per contest, and let the minimap pulse while it lasts. */
    g.losing = dir < 0 && g.owned;
    if (g.losing && !g._warned) {
      g._warned = true;
      SFX.heartAlarm();
      toast('A grove is being trampled — its light has turned AMBER. Send something', 'warn');
    } else if (!g.losing && g._warned && dir >= 0) g._warned = false;
    if (dir !== 0) {
      g.prog = clamp(g.prog + dir * dt, 0, RULES.captureTime);
      if (!g.owned && g.prog >= RULES.captureTime) {
        g.owned = true;
        g.bloomAt = G.time;      // income ramps in — see below
        g.anim.bloom.visible = true;
        g.anim.water.material.uniforms.wl_bloom.value = 1;
        SFX.bloom();
        ring(g.pos, 0x9bff6a, 9, 1.1);
        burst(g.pos.clone().setY(g.pos.y + 1), 0x9bff6a, 22, 11, 1.1, 0.9);
        addScore('grove', 'bloom', g.pos);
        commsEvent('grove', 0.6);
        toast('Grove bloomed — biomass rising');
      } else if (g.owned && g.prog <= 0) {
        g.owned = false;
        g.dormantUntil = G.time + RULES.groveDormant;
        g.anim.bloom.visible = false;
        g.anim.water.material.uniforms.wl_bloom.value = 0;
        toast(`A grove has been trampled — its light turns RED and will not take a bloom for ${RULES.groveDormant}s`, 'warn');
      }
    }
    groveTint(g, G.time);
    if (g.owned) bloomed++;
  }
  /* A new lane is a real step up in throughput, so it gets its own chime --
     otherwise the only feedback for the most important economic decision in the
     game is a number quietly changing in the build panel. */
  if (bloomed > (G.bloomed || 0) && G.lanes !== undefined
      && Math.min(3, 1 + Math.floor(bloomed / 2)) > Math.min(3, 1 + Math.floor((G.bloomed || 0) / 2))) SFX.lane();
  G.bloomed = bloomed;

  /* --- the Heart Tree does not heal itself, and nobody ever said so -------
     MEASURED: a critic took the tree to 1023/4200, parked three Beavers beside
     it, and had it back at full inside two minutes — then discovered they had
     only tried it because they had read entity.js. The Beaver's card mentions
     the Heart Tree in a subordinate clause after two other jobs, and nothing
     else in the game points at the single most important defensive tool it
     has. A tool that is both undiscoverable AND underpriced is not a decision;
     it is a secret. The price moved in config (RULES.mendStack); this is the
     other half, and shipping only the price would have made things worse.

     Fires once, the first time the tree is genuinely hurt AND there is no
     mender already on it — so a player who has already worked it out is never
     told, and a player who has not is told at the exact moment it matters. */
  if (!G.mendHintDone && G.heart && G.heart.alive && G.heart.hp < G.heart.maxHp * 0.6) {
    let menderNear = false;
    for (const e of G.entities) {
      if (!e.alive || e.isBuilding || e.team !== TEAM.WILD || !e.def.mend) continue;
      if (dist2D(e.pos, G.heart.pos) - G.heart.radius <= (e.def.mendRange || 7)) { menderNear = true; break; }
    }
    if (!menderNear) {
      G.mendHintDone = true;
      commsEvent('heartLow', 1);
      toast('TerraByte Arboriculture confirms the Heart Tree does not self-repair. '
            + 'Nothing in this valley does — except a Beaver, and it will mend the tree for free.', 'machine');
    }
  }

  /* --- meltdown: the hold ---------------------------------------------------
     The Core overheats only while every coolant tower is offline AT ONCE, which
     is what turns the ending from a kill into a hold. See RULES.meltdownSeconds
     for the measurement that made this necessary — in short, coolant kills used
     to be permanent, so the match was a ratchet nobody could take a metre back
     from, and an all-in with nobody home won every time.

     Heat bleeds back rather than resetting, so a hold broken at 80% is real
     progress and not a wasted assault. */
  if (G.core.alive && !G.over) {
    /* COOLING IS CONTINUOUS, not a count of standing towers. This is the fix
       for the knife-edge — see RULES.meltdownCool. A tower cools in proportion
       to how intact it is, so every point of damage counts the moment it lands
       instead of counting for nothing until the tower falls over. */
    let cap = 0;
    for (const c of G.coolants) {
      if (!c.alive || c.downed) continue;
      cap += Math.max(0, c.hp) / Math.max(1, c.maxHp);
    }
    const cool = cap / Math.max(1, G.coolants.length);   // 1 = fully cooled
    const wasExposed = G.coreExposed;
    G.coreExposed = cool < RULES.meltdownCool;
    /* Rate scales with how far cooling has been pushed below the line, so
       stripping the last tower still finishes markedly faster than sitting at
       the threshold. */
    const heatMult = G.coreExposed
      ? Math.min(1, (RULES.meltdownCool - cool) / Math.max(0.01, RULES.meltdownCool)) : 0;
    G.coolFrac = cool;

    if (G.coreExposed && !wasExposed) G.holdStartedAt = G.time;
    if (!G.coreExposed && wasExposed) {
      G.holdStartedAt = 0;
      /* Losing the hold is the compound's one win condition against the player,
         so it gets said out loud. Silence here reads as a bug. */
      if (G.heat > 0.08) toast(`Meltdown stalled at ${Math.round(G.heat * 100)}% — the Core is cooling again`, 'warn');
    }

    const rate = 1 / Math.max(1, RULES.meltdownSeconds);
    if (G.coreExposed) G.heat = Math.min(1, G.heat + rate * heatMult * dt);
    else               G.heat = Math.max(0, G.heat - rate * RULES.coolRecovery * dt);
    G.heatPeak = Math.max(G.heatPeak, G.heat);

    /* Milestones, because a bar creeping up is not a clock. Only while actually
       holding — narrating a bar that is falling is just noise. */
    if (!G.heatSaid) G.heatSaid = {};
    if (G.coreExposed) {
      for (const mark of [25, 50, 75, 90]) {
        if (G.heat * 100 >= mark && !G.heatSaid[mark]) {
          G.heatSaid[mark] = true;
          const secsLeft = Math.round((1 - G.heat) * RULES.meltdownSeconds / Math.max(0.01, heatMult));
          toast(`Core temperature ${mark}% — ${secsLeft}s of hold left`, 'warn');
          commsEvent('coolant', 0.7);
        }
      }
    }

    if (G.heat >= 1) kill(G.core, null);
  }

  /* --- core shield tracks the coolant towers --- */
  if (G.coreShield) {
    // it lives in the scene rather than under the core, so fog concealment has to
    // be forwarded explicitly or the objective is handed over before you scout
    G.coreShield.visible = !G.coreExposed && G.core.alive && G.core.mesh.visible;
    G.coreShield.material.uniforms.wl_health.value = coolantsOnline() / G.coolants.length;
  }

  /* --- income --- */
  /* Each bloomed grove pays according to the water table beneath it, so letting
     the lakes drain is a slow, visible, entirely non-random economic defeat. */
  let groveYield = 0, groveFull = 0;
  for (const g of G.groves) if (g.owned) {
    /* A fresh grove pays out as it wakes: 30% at bloom, full after 25s. Instant
       full yield made three fast uncontested captures a 15x income spike in the
       first minute, and the whole early game collapsed into a scripted rush. */
    const ramp = 0.3 + 0.7 * Math.min(1, (G.time - (g.bloomAt || 0)) / 25);
    groveFull  += RULES.grovIncome * ramp;
    groveYield += RULES.grovIncome * ramp * groveWaterFactor(g.pos.x, g.pos.z);
  }
  /* What the groves WOULD pay with a full water table, so the HUD can show the
     player what the pumps are costing them instead of silently editing income. */
  G.waterTax = groveFull > 0.01 ? 1 - groveYield / groveFull : 0;
  G.income = (G.heart.alive ? RULES.baseIncome : 0) + groveYield;
  G.biomass += G.income * dt;

  /* A compound with no generators listed has always been powered — the flag has
     to default true or every legacy map loses its guns. */
  G.powered = !G.generators || !G.generators.length
    || G.generators.some(g => g.alive);

  /* --- construction clock --- */
  if (G.construction && !G.construction.done) {
    const c = G.construction;
    c.left -= dt;
    for (const mark of [0.5, 0.25]) {
      if (c.left / c.time <= mark && !c.warned[mark]) {
        c.warned[mark] = true;
        toast(`Construction ${Math.round((1 - mark) * 100)}% complete`, 'warn');
        commsEvent('build', 1);
      }
    }
    if (c.left <= 0) {
      c.done = true;
      for (const [x, z] of (c.def.addTurrets || [])) G.obstacles.push(spawn('turret', x, z));
      for (let i = 0; i < (c.def.addGarrison || 0); i++) {
        const g = spawn('guard', COMPOUND.x + rand(-COMPOUND.hw + 8, COMPOUND.hw - 8),
                                 COMPOUND.z + rand(-COMPOUND.hd + 8, COMPOUND.hd - 8));
        assignPatrol(g);
      }
      SFX.alarm();
      commsEvent('built', 1);
      toast('THE SITE IS OPERATIONAL — defences online', 'warn');
    }
  }

  updateSiteWorks();

  /* --- population --- */
  let pop = 0, mpop = 0;
  for (const e of G.entities) {
    if (!e.alive || e.isBuilding) continue;
    if (e.team === TEAM.WILD) pop += e.def.pop || 1;
    else if (e.team === TEAM.MACHINE) mpop += e.def.pop || 1;
  }
  G.pop = pop; G.machinePop = mpop;

  /* Lanes from groves, or from a bank the player cannot otherwise spend --
     whichever is greater. See RULES.surgeLaneAt for the doom loop this exits. */
  function laneCount() {
    const fromGroves = 1 + Math.floor((G.bloomed || 0) / 2);
    const surge = (RULES.surgeLaneAt || []).filter(t => G.biomass >= t).length;
    return Math.min(RULES.maxLanes || 3, Math.max(fromGroves, 1 + surge));
  }

  /* --- production queue -----------------------------------------------------
     Parallel lanes, one per bloomed grove. This is the single change that makes
     a swarm actually a swarm: a serial queue caps sustained spend at roughly one
     wolf per build time no matter how rich you are, so past the third grove the
     income simply piled up unspendable -- a playtest showed 1000 banked biomass
     next to ten units on the field. Lanes turn map control into *throughput*
     rather than just money, which is the reason to go take a grove at all. */
  if (G.queue.length && G.heart.alive) {
    /* One lane per TWO groves, capped at three. Four lanes was a promise the
       economy could not keep: saturating one lane costs ~8.2 biomass/s and
       maximum income is ~19.9/s, so lanes 3 and 4 sat idle all game. Raising
       income to feed four instead flooded the player to the pop cap by 1:30. */
    const lanes = laneCount();
    G.lanes = lanes;
    for (let i = Math.min(lanes, G.queue.length) - 1; i >= 0; i--) {
      const item = G.queue[i];
      item.remaining -= dt;
      if (item.remaining > 0) continue;
      G.queue.splice(i, 1);
      if (!G.queue.length) rallyN = 0;      // batch finished; start the next one centred
      const a = rand(0, 6.28);
      const e = spawn(item.type, BASE.x + Math.cos(a) * 11, BASE.z + Math.sin(a) * 11);
      if (G.rally) e.setOrder('attackmove', rallySlot());
      SFX.spawn();
      burst(e.pos.clone().setY(e.pos.y + 1), 0x9bff6a, 10, 7, 0.6, 0.6);
    }
  } else G.lanes = laneCount();
}

/* =========================================================================
   SITE WORKS — the compound builds while you wait.

   The dead stretch of a match runs from the moment the player's army is
   finished (~4:15, pop cap, empty queue) to the moment the compound is worth
   attacking (~8:00). It cannot be closed by sending more sweeps: a true-passive
   valley already dies at the bottom of its target window. So the campus keeps
   pouring concrete, on an announced clock, and the player watches the objective
   get worse in real time.

   Placement is DERIVED, not authored, for the plainest reason: there are nine
   maps and validateMap() only checks the arrays in maps.js. A runtime literal
   would be a data bug waiting to happen — that is exactly how a Core once
   landed on top of a Depot and flung units away at 256 m/s. The scan below
   clears every live obstacle and both gates by construction, on every map, and
   returns null rather than guessing if the campus is genuinely full.
   ========================================================================= */
const WORKS_RADIUS = { pump: 3.4, turret: 2.2 };

function worksSpot(kind) {
  const r = WORKS_RADIUS[kind] || 3.4;
  const { x: cx, z: cz, hw, hd } = COMPOUND;
  const margin = r + 5;
  if (hw <= margin || hd <= margin) return null;
  /* Face the valley. A new gun matters only if it is on the road the player's
     army actually walks, and a new structure matters only if the player can see
     it go up — both of which mean the side the Heart Tree is on. */
  const tx = Math.sign(BASE.x - cx) || -1;
  const tz = Math.sign(BASE.z - cz) || 1;
  let best = null, bestScore = -1e9;
  for (let ix = -hw + margin; ix <= hw - margin + 0.001; ix += 3) {
    for (let iz = -hd + margin; iz <= hd - margin + 0.001; iz += 3) {
      const x = cx + ix, z = cz + iz;
      let ok = true;
      for (const o of G.obstacles) {
        if (!o || !o.alive) continue;
        if (dist2D({ x, z }, o.pos) < r + o.radius + 3) { ok = false; break; }
      }
      if (!ok) continue;
      /* Never plug a gate: the campus has to be able to get its own sweeps out,
         and a wave that wedges on its own new building is the single worst bug
         this file has ever shipped. */
      for (const g of (G.gates || [])) {
        if (dist2D({ x, z }, g) < r + 14) { ok = false; break; }
      }
      if (!ok) continue;
      const score = ix * tx + iz * tz;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  }
  return best;
}

/* Which quarter of the compound a point sits in, said the way a site notice
   would say it, so the warning names somewhere the player can actually look. */
function worksFace(p) {
  const dx = p.x - COMPOUND.x, dz = p.z - COMPOUND.z;
  const ns = dz > COMPOUND.hd * 0.25 ? 'south' : (dz < -COMPOUND.hd * 0.25 ? 'north' : '');
  const ew = dx > COMPOUND.hw * 0.25 ? 'east' : (dx < -COMPOUND.hw * 0.25 ? 'west' : '');
  return (ns + (ns && ew ? '-' : '') + ew) || 'central';
}

function updateSiteWorks() {
  if (!G.works || !G.works.length || G.over || !G.core || !G.core.alive) return;
  for (const w of G.works) {
    if (w.built) continue;
    const at = w.def.at;
    if (!w.noticed && G.time >= at - RULES.worksNotice) {
      w.noticed = true;
      /* Pick the spot at NOTICE time and hold it, so the warning names the same
         place the concrete lands. */
      w.spot = worksSpot(w.def.kind);
      if (!w.spot) { w.built = true; continue; }   // campus full: skip it quietly
      const secs = Math.max(1, Math.round(at - G.time));
      toast(`${w.def.notice} (${worksFace(w.spot)} quarter, ${secs}s)`, 'machine');
      commsEvent('works', 1);
    }
    if (G.time < at) continue;
    w.built = true;
    if (!w.spot) continue;
    const e = spawn(w.def.kind, w.spot.x, w.spot.z);
    G.obstacles.push(e);
    if (w.def.kind === 'pump') {
      G.pumps.push(e);
      e.onDeath = () => {
        const left = G.pumps.filter(q => q.alive).length;
        commsEvent('water', 0.8);
        toast(left ? `Intake pump destroyed — ${left} still drawing`
                   : 'The last pump is dead. The water is coming back.');
      };
    }
    ring(e.pos, 0xffb648, 16, 1.2);
    SFX.alarm();
    commsEvent('built', 1);
    toast(`${w.def.done}`, 'warn');
  }
}

/* Spread arrivals over a widening spiral around the rally flag; a shared point
   leaves the outer ranks pushing at a goal radius they can never satisfy. */
let rallyN = 0;
const _rally = new THREE.Vector3();

/* The spiral only exists to stop a batch of simultaneous arrivals from piling onto
   one point. Left to increment for the whole match it walked new units tens of
   metres past the flag the player set, so it resets whenever the flag moves or the
   queue drains — i.e. whenever there is no longer a batch to spread out. */
export function resetRallySpiral() { rallyN = 0; }

/* Slots wrap. Resetting on queue-drain is not enough: keeping something in the
   queue is the standard macro habit (a wolf is 20 biomass / 3.5s against 2/s per
   grove, so the queue simply never empties), and an unbounded index walked new
   arrivals 29m from the flag over five minutes and kept going. Wrapping bounds the
   spread to the outermost ring the pattern uses. */
const RALLY_SLOTS = 19;               // rings 0..4 (i=16..18 reach ring 4), max 12.8m out

function rallySlot() {
  const i = rallyN++ % RALLY_SLOTS;
  const ringIdx = Math.floor(Math.sqrt(i));
  const per = Math.max(1, ringIdx * 6);
  const a = (i % per) / per * Math.PI * 2 + ringIdx * 0.7;
  const r = ringIdx * 3.2;
  return _rally.set(G.rally.x + Math.cos(a) * r, 0, G.rally.z + Math.sin(a) * r);
}

/* ------------------------------------------------- Deepen the Roots ------
   The late game's only other thing to buy. See RULES.rootsCost for why it
   exists: past ~3:00 a competent player is pinned at the pop cap with an empty
   queue and an income they cannot spend, so more than half the match had no
   purchasing decision in it at all. This converts a stalled economy back into
   army, at a price that climbs fast enough that "can I afford this AND rebuild
   what I am about to lose" stays a live question rather than a formality. */
export function rootsBought() { return G.rootsN || 0; }

export function rootsPrice() {
  return Math.round(RULES.rootsCost * Math.pow(RULES.rootsGrowth, rootsBought()));
}

export function rootsMaxed() { return rootsBought() >= RULES.rootsMax; }

export function deepenRoots() {
  if (!G.heart.alive) return false;
  if (rootsMaxed()) { toast('The roots are as deep as this valley goes', 'warn'); SFX.deny(); return false; }
  const price = rootsPrice();
  if (G.biomass < price) { toast(`Not enough biomass to deepen the roots (${price})`, 'warn'); SFX.deny(); return false; }
  G.biomass -= price;
  G.rootsN = rootsBought() + 1;
  G.popCap += RULES.rootsStep;
  ring(G.heart.pos, 0x9bff6a, 22, 1.2);
  SFX.bloom();   // the same good-news chime a grove gets; this is an economy milestone
  toast(`The roots go deeper — the valley will hold ${G.popCap} now`);
  return true;
}

export function queueUnit(type) {
  const def = DEFS[type];
  if (!G.heart.alive) return false;
  if (G.lockedUnits && G.lockedUnits.includes(type)) {
    toast('The Locals have not joined yet — liberate Milltown', 'warn');
    SFX.deny(); return false;
  }
  if (type === 'local' && !G._localPr) { G._localPr = true; commsEvent('local'); }
  if (G.biomass < def.cost) { toast(`Not enough biomass for ${def.name} (${def.cost})`, 'warn'); SFX.deny(); return false; }
  if (G.pop + queuedPop() + (def.pop || 1) > G.popCap) { toast('Wildlife limit reached — the forest can hold no more', 'warn'); SFX.deny(); return false; }
  if (G.queue.length >= 24) { SFX.deny(); return false; }
  G.biomass -= def.cost;
  /* Groves also quicken each lane a little, on top of adding lanes. Kept mild:
     the lanes are the real lever, and stacking both at the old 7% made a maxed
     economy produce faster than the pop cap could absorb. */
  const haste = 1 - 0.04 * (G.bloomed || 0);
  const build = def.build * Math.max(0.55, haste);
  G.queue.push({ type, remaining: build, total: build });
  return true;
}

export function queuedPop() {
  return G.queue.reduce((s, q) => s + (DEFS[q.type].pop || 1), 0);
}

export function cancelQueue(i) {
  const item = G.queue[i];
  if (!item) return;
  G.biomass += DEFS[item.type].cost;
  G.queue.splice(i, 1);
}

/* Remove corpses once their death animation has played out. */
export function reapDead(dt) {
  const step = dt || G.dt || 0.016;
  for (let i = G.entities.length - 1; i >= 0; i--) {
    const e = G.entities[i];
    if (e.alive) continue;
    // each corpse animates itself — see Entity.updateCorpse
    if (!e.updateCorpse(step)) continue;
    e.destroyMesh();
    G.entities.splice(i, 1);
    G.byId.delete(e.id);
    const oi = G.obstacles.indexOf(e);
    if (oi >= 0) G.obstacles.splice(oi, 1);
    const si = G.selection.indexOf(e);
    if (si >= 0) G.selection.splice(si, 1);
  }
}
