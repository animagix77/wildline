import * as THREE from 'three';
import { G } from './state.js';
import { WORLD, HALF, BASE, COMPOUND, DEFS, RULES, TEAM } from './config.js';
import { terrainHeight, blight, insideCompound, rand, vrand, vrandInt, dist2D, clamp, fbm, Grid } from './utils.js';
import { enableCanopyFade, M, GLOW, VC_MAT, makeForest, makeScatter, buildWall, buildGateGantry, box, cyl, sph, propBushGeo, propLogGeo, propStumpGeo, propMushroomGeo, propFlowerGeo, propLitterGeo } from './meshes.js';
import { applyFogMask } from './fog.js';
import { makeTerrainMaterial, makeSkyDome, makeShieldMaterial, setAtmosphere, enableCanopySway } from './shaders.js';
import { setPostGrade } from './post.js';
import { initWeather } from './weather.js';
import { initWater, groveWaterFactor } from './water.js';
import { Entity, spawn } from './entity.js';
import { toast } from './ui.js';
import { showEndScreen } from './screens.js';
import { addScore, getStats } from './score.js';
import { commsEvent } from './comms.js';
import { recordResult, setPending, campState, bankSurvivors } from './campaign.js';
import { SFX, animalVoice } from './audio.js';
import { musicStop, musicStinger } from './music.js';
import { ring, burst, kill, fireProjectile } from './combat.js';
import { explode, chainExplosion, igniteNear } from './vfx.js';

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

  /* --- the air: sky, aerial perspective, cloud shadow, wind, grade -------
     All of it reads the same palette/mood blocks as the lights above, so a
     map is one place to author. The sky dome takes its sun from the SAME
     offset the DirectionalLight uses; the aerial-perspective fog takes its
     far colour from the dome's horizon; the water (initWater, below) blends
     toward that horizon too; and the post grade is the last word on top.
     The order matters only in that G.sunOffset must exist first. */
  const sky = makeSkyDome(pal, G.sunOffset);
  scene.add(sky);
  G.sky = sky;
  setAtmosphere(pal, mood);
  setPostGrade(pal.grade);       // held in post.js; survives the initPost() that follows

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
  // The ground palette is the map's: this is where winter stops being green.
  const mat = makeTerrainMaterial(G.map && G.map.palette && G.map.palette.ground);
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
      const a = vrand(0, 6.2832), d = vrand(HALF + 3, HALF + 62);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      return { x, y: -6 + vrand(0, 2), z };
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
  /* Same height for trunk and canopy so the trunk top and the canopy base
     move as one piece of wood; see enableCanopySway. After the clone, after
     the fade — the sway extends the program cache key the mask pinned. */
  enableCanopySway(borderLeaves, 9.8);
  enableCanopySway(borderTrunks, 9.8);
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
    const x = vrand(-HALF + 6, HALF - 6), z = vrand(-HALF + 6, HALF - 6);
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
  const season = (G.map && G.map.season) || '';
  const arche = (G.map && G.map.archetype) || 'valley';
  const hue = (G.map && G.map.palette && G.map.palette.treeHue) || 0.26;
  const winter = season === 'winter' || arche === 'alpine';
  const spring = season === 'spring';
  const autumn = season === 'autumn';
  const wet = arche === 'wetland';

  /* Blighted ground: the ring around the compound where the machine has
     poisoned the soil. Snags and dead sticks live here and nothing green does. */
  const blightSpot = (minC = 3) => {
    for (let i = 0; i < 20; i++) {
      const a = vrand(0, 6.28), d = vrand(COMPOUND.hw, COMPOUND.hw + 30);
      const x = COMPOUND.x + Math.cos(a) * d, z = COMPOUND.z + Math.sin(a) * d * 0.8;
      if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) continue;
      if (insideCompound(x, z, minC)) continue;
      return { x, y: terrainHeight(x, z), z };
    }
    return null;
  };

  /* Forest: a species mix chosen by season and archetype. The shares are the
     map's character -- alpine goes to firs, wetland and autumn to broadleaves,
     and the valley default keeps the pine as the majority read -- plus a fixed
     stand of dead snags on the blight. Each species is its own instanced pair
     with the same fade contract, so the loop below treats them identically. */
  const mix = winter ? [{ kind: 'pine', share: 0.35 }, { kind: 'fir', share: 0.55 }, { kind: 'broadleaf', share: 0.1 }]
    : (wet || spring) ? [{ kind: 'pine', share: 0.25 }, { kind: 'broadleaf', share: 0.6 }, { kind: 'fir', share: 0.15 }]
    : autumn ? [{ kind: 'pine', share: 0.3 }, { kind: 'broadleaf', share: 0.55 }, { kind: 'fir', share: 0.15 }]
    : [{ kind: 'pine', share: 0.5 }, { kind: 'broadleaf', share: 0.32 }, { kind: 'fir', share: 0.18 }];
  mix.push({ kind: 'snag', count: 70, place: () => blightSpot(4) });
  const forest = makeForest(density.trees || 820, () => freeSpot(10), mix);
  G.canopy = forest[1];
  for (let i = 0; i < forest.length; i += 2) {
    const trunks = forest[i], leaves = forest[i + 1];
    trunks.material = scenic(trunks.material);
    leaves.material = scenic(leaves.material);
    enableCanopyFade(leaves, trunks);  // must follow the material swap, not precede it
    /* Wind. Trunk and leaf share one sway height so a tree bends as one piece
       rather than the canopy sliding off its pole. Same ordering rule as the
       fade: after scenic() has cloned the material, never before. */
    enableCanopySway(leaves, 9.8);
    enableCanopySway(trunks, 9.8);
    (G.canopies || (G.canopies = [])).push(leaves);
    scene.add(trunks); scene.add(leaves);
  }

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
        const i = Math.floor(vrand(0, pts.length - 1));
        const a = pts[i], b = pts[i + 1];
        const t = vrand(0, 1);
        const x0 = a.x + (b.x - a.x) * t, z0 = a.z + (b.z - a.z) * t;
        let nx = -(b.z - a.z), nz = (b.x - a.x);
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const side = vrand(0, 1) > 0.5 ? 1 : -1;
        const d = 6.4 + vrand(0.2, 2.6);          // just past the widest bank
        const x = x0 + nx * d * side, z = z0 + nz * d * side;
        if (insideCompound(x, z, 4)) return null;
        return { x, y: terrainHeight(x, z) - 0.25, z };
      }, [0.35, 1.1]));
  }

  // ferns / low brush
  const fern = new THREE.ConeGeometry(0.8, 1.6, 5);
  fern.translate(0, 0.8, 0);
  const ferns = makeScatter(fern, scenic(M(0x3d7a35, { rough: 1 })), density.ferns || 520,
    () => freeSpot(6), [0.6, 1.5]);
  /* brush shivers in the same wind as the canopy, at a fraction of the travel
     -- a 1.6 m fern moving 30 cm would read as an animal */
  enableCanopySway(ferns, 1.6, 0.35);
  scene.add(ferns);

  // dead sticks in the blighted zone
  const stick = new THREE.CylinderGeometry(0.12, 0.2, 4, 5);
  stick.translate(0, 2, 0);
  scene.add(makeScatter(stick, scenic(M(0x453f36, { rough: 1 })), 120, () => blightSpot(3), [0.7, 1.5]));

  /* ---- ground dressing: instanced, vertex-coloured, standing upright ----
     Each prop is one buffer from meshes.js with its own two or three tones
     baked in; the season decides which appear and instanceColor tints the
     ones whose colour is the map's (bushes, litter, petals). Small things
     skip the shadow pass: a mushroom's shadow is a pixel nobody sees. */
  const vc = () => scenic(VC_MAT);
  const green = (l0, l1) => () => new THREE.Color().setHSL(hue + vrand(-0.04, 0.04), vrand(0.35, 0.55), vrand(l0, l1));
  scene.add(makeScatter(propBushGeo(), vc(), winter ? 120 : 260, () => freeSpot(5),
    [0.7, 1.5], { upright: true, colorFn: green(0.18, 0.32) }));
  scene.add(makeScatter(propLogGeo(), vc(), 70, () => freeSpot(6), [0.8, 1.4],
    { upright: true, tilt: 0.1, sink: 0.15 }));
  scene.add(makeScatter(propStumpGeo(), vc(), 60, () => freeSpot(6), [0.8, 1.3],
    { upright: true, tilt: 0.06 }));
  if (!winter) {
    scene.add(makeScatter(propMushroomGeo(), vc(), (wet || autumn) ? 200 : 110, () => freeSpot(5),
      [0.5, 1.1], { upright: true, tilt: 0.08, shadow: false }));
  }
  if (spring || /summer/.test(season)) {
    const petals = spring ? [0xf2f2f2, 0xf5c7e0, 0xffe27a, 0xb9a6ff] : [0xffe27a, 0xf2a25a, 0xf2f2f2];
    scene.add(makeScatter(propFlowerGeo(), vc(), spring ? 260 : 140, () => freeSpot(5), [0.7, 1.3],
      { upright: true, tilt: 0.1, shadow: false, colorFn: () => new THREE.Color(petals[vrandInt(0, petals.length - 1)]) }));
  }
  if (autumn) {
    scene.add(makeScatter(propLitterGeo(), vc(), 200, () => freeSpot(4), [1.0, 2.2], {
      upright: true, tilt: 0.02, shadow: false,
      colorFn: () => new THREE.Color().setHSL(hue + vrand(-0.03, 0.05), vrand(0.5, 0.7), vrand(0.22, 0.34)),
    }));
  }

  // yard clutter inside the compound: containers + pipe runs
  const yard = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const x = COMPOUND.x + vrand(-COMPOUND.hw + 8, COMPOUND.hw - 8);
    const z = COMPOUND.z + vrand(-COMPOUND.hd + 8, COMPOUND.hd - 8);
    if (Math.hypot(x - 58, z + 50) < 20) continue;
    const b = box(scenic(M([0x394048, 0x4a4038, 0x2f3a42][vrandInt(0, 2)], { metal: 0.4, rough: 0.6 })),
      vrand(5, 9), 2.8, 2.6, x, terrainHeight(x, z) + 1.4, z);
    b.rotation.y = vrand(0, 6.28);
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
    /* THE COMPOUND COOKS OFF before the end card. Killing the Core used to set
       G.over and show the results screen on the same frame, so the chain
       explosion kill() fires was drawn behind a full-screen panel and the
       match the player just won ended on a cut. Now the win is a sequence you
       watch: see runFinale. G.over still goes true immediately, so nothing can
       be ordered, no wave lands and no score moves during it. */
    G.over = true;
    startFinale();
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

  /* Only the guns Stage I has finished stand at 0:00; the rest are pads that
     pour when the campus goes operational. See RULES.stages. */
  const standing = stageOpeningTurrets(TURRETS);
  for (const [x, z] of standing) {
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

  /* The site's stage clock, its pads, crane and the opening garrison. The
     groundbreak maps' old `construction` timer and the old siteWorks list are
     both folded into this one schedule -- see RULES.stages. The garrison is
     sized by difficulty AND by the opening stage: a Groundbreak site has not
     hired everybody yet. */
  initStages();
  const s0 = RULES.stages[0];
  garrisonTo(s0.garrison);
}

/* Top the standing garrison up to `mult` x the difficulty's own numbers.
   Counts what was already hired by previous stages rather than what is alive,
   so killing guards is never "refunded" by a stage transition. */
function garrisonTo(mult, extraGuards = 0) {
  const st = G.stage;
  const wantG = Math.round(st.base.guards * mult) + extraGuards;
  const wantD = Math.round(st.base.drones * mult);
  for (; st.hiredG < wantG; st.hiredG++) {
    const g = spawn('guard', COMPOUND.x + rand(-COMPOUND.hw + 8, COMPOUND.hw - 8),
                             COMPOUND.z + rand(-COMPOUND.hd + 8, COMPOUND.hd - 8));
    assignPatrol(g);
  }
  for (; st.hiredD < wantD; st.hiredD++) {
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

/* ------------------------------------------------------------- finale ----
   The data centre going up. Runs on the real clock (not sim time) after
   G.over, walks outward from the Core detonating what is left of the compound
   one structure at a time, then hands over to the end screen.

   Deliberately NOT routed through kill(): these buildings are already
   irrelevant to the result, and running the real death path would fire their
   onDeath toasts ("Generator down -- 1 still feeding the guns") over the top
   of a victory. This is pyrotechnics on corpses. */
const FINALE_SECS = 5.0;

function startFinale() {
  const cx = G.core.pos.x, cz = G.core.pos.z;
  /* everything still standing in the yard, nearest the Core first, so the
     blast reads as travelling outward rather than popping at random */
  const targets = G.entities
    .filter(e => e.alive && e.isBuilding && e.team === TEAM.MACHINE && e !== G.core
                 && e.type !== 'wall')
    .sort((a, b) => dist2D(a.pos, { x: cx, z: cz }) - dist2D(b.pos, { x: cx, z: cz }));

  G.finale = { t: 0, next: 0.25, i: 0, targets, done: false };

  SFX.boomBig(G.core.pos);
  if (G.rts) {
    /* push in on the compound and hold it there -- the player should be
       looking at the thing they just killed, wherever their camera was */
    G.rts.focus({ x: cx, y: 0, z: cz }, false, 78);
    G.rts.shake = Math.min(2.2, (G.rts.shake || 0) + 1.2);
  }
  toast('The Core is gone. The compound is cooking off.', 'warn');
}

/* Driven from main.js's frame loop, which keeps running after G.over. */
export function updateFinale(dt) {
  const F = G.finale;
  if (!F || F.done) return;
  F.t += dt;

  if (F.t >= F.next && F.i < F.targets.length) {
    /* accelerate: the first few land slowly, then it runs away */
    const gap = Math.max(0.10, 0.34 - F.i * 0.035);
    F.next = F.t + gap;
    const e = F.targets[F.i++];
    const p = e.pos.clone(); p.y += e.def.radius * 0.5;
    const power = e.type === 'coolant' ? 2.4 : e.type === 'depot' ? 2.0
                : e.type === 'generator' ? 2.2 : 1.4;
    explode(p, power, {});
    igniteNear(e.pos, 14, 0.8);          // the treeline round the yard catches
    if (e.mesh) e.mesh.visible = false;
    e.alive = false;
    if (G.rts) G.rts.shake = Math.min(2.4, (G.rts.shake || 0) + 0.3);
  }

  /* a last big one on the Core itself, halfway through */
  if (!F.big && F.t > FINALE_SECS * 0.55) {
    F.big = true;
    chainExplosion(G.core.pos, G.core.def.radius * 1.4, 9, 2.6, {});
    if (G.rts) G.rts.shake = Math.min(3, (G.rts.shake || 0) + 1.6);
  }

  if (F.t >= FINALE_SECS) {
    F.done = true;
    endMission(true);
  }
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

  const northKept = [], westKept = [];
  for (let x = cx - hw; x < cx + hw - 0.1; x += seg) {
    const mid = x + seg / 2;
    // south wall (always solid)
    addWall(mid, cz - hd, 0, seg);
    // north wall with gate
    if (Math.abs(mid - gateN.c) > gateN.half + seg / 2 - 1) { addWall(mid, cz + hd, 0, seg); northKept.push(mid); }
  }
  for (let z = cz - hd; z < cz + hd - 0.1; z += seg) {
    const mid = z + seg / 2;
    addWall(cx + hw, mid, Math.PI / 2, seg);
    if (Math.abs(mid - gateW.c) > gateW.half + seg / 2 - 1) { addWall(cx - hw, mid, Math.PI / 2, seg); westKept.push(mid); }
  }

  /* Gate gantries: a pylon planted on the wall end either side of each gap
     and a lit beam across. The clear span is measured from the segments that
     were actually built, so the pylons land on the posts whatever the
     compound's size. Dressing only -- no obstacle, the gap stays pathable. */
  const gantry = (kept, c, place) => {
    let lo = -Infinity, hi = Infinity;
    for (const m of kept) {
      if (m < c && m + seg / 2 > lo) lo = m + seg / 2;
      if (m > c && m - seg / 2 < hi) hi = m - seg / 2;
    }
    if (!isFinite(lo) || !isFinite(hi)) return;
    place((lo + hi) / 2, hi - lo);
  };
  gantry(northKept, gateN.c, (mid, span) => {
    const gt = buildGateGantry(span);
    gt.position.set(mid, terrainHeight(mid, cz + hd), cz + hd);
    G.scene.add(gt);
  });
  gantry(westKept, gateW.c, (mid, span) => {
    const gt = buildGateGantry(span);
    gt.position.set(cx - hw, terrainHeight(cx - hw, mid), mid);
    gt.rotation.y = Math.PI / 2;
    G.scene.add(gt);
  });
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
      if (G.evo && G.evo.thornwall) dir *= RULES.thornDecap;      // Thornwall: the briars hold
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

  /* --- the site's stage clock (see RULES.stages) --- */
  updateStages(dt);
  updateEvolve(dt);

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
    /* Warren lifts the ceiling AND the floor: one grove still builds two at a
       time, which is the rebuild a broken economy could never afford. */
    const w = evo().warren ? RULES.warrenLanes : 0;
    return Math.min((RULES.maxLanes || 3) + w, Math.max(fromGroves + w, 1 + surge));
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
      /* Evolved forms wear their species' body (see applyForm); Forward Den
         moves the hatchery up to the front grove (see hatchPoint). */
      const idef = DEFS[item.type];
      const hp = hatchPoint();
      const e = spawn(idef.form || item.type, hp.x + Math.cos(a) * hp.r, hp.z + Math.sin(a) * hp.r);
      if (idef.form) applyForm(e, item.type);
      if (G.rally) e.setOrder('attackmove', rallySlot());
      if (!animalVoice(e, 'deploy')) SFX.spawn();
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

/* =========================================================================
   SITE STAGES — the campus grows on an announced clock, and the swarm can
   slow it down. See RULES.stages for the measurement behind every field.

   G.stage.clock is SITE PROGRESS, not match time: it runs at one second per
   second and every structure the swarm levels takes RULES.stageDelay off it,
   so "the next stage lands at 4:00" becomes "4:00 plus whatever you knock
   down first". The HUD shows the live estimate.

   Legible in the world, not just in a toast: pads with scaffolding stand
   where the Stage II guns will pour, a tower crane over the Core carries a
   beacon in the current stage's colour, and Hyperscale clads the coolant
   towers in visible armour bands.
   ========================================================================= */
const STAGE_TINT = [0xffb648, 0x39d7ea, 0xff4b3a];   // amber, cyan, red
const STAGE_KIND = ['depot', 'generator', 'pump', 'well', 'turret'];

/* Which authored turrets stand at 0:00. The ones nearest the Heart Tree are
   the approach face, and those are what a Groundbreak site has not finished:
   a swarm that comes early meets a gun line with its front half on pads. A
   map authored as a construction site already IS its groundbreak state. */
function stageOpeningTurrets(list) {
  const con = layout().construction;
  const share = con ? 1 : (RULES.stages[0].turrets ?? 1);
  const byReach = list.map(p => ({ p, d: Math.hypot(p[0] - BASE.x, p[1] - BASE.z) }))
                      .sort((a, b) => b.d - a.d);          // farthest first
  const keep = Math.max(1, Math.round(list.length * share));
  G._stagePads = byReach.slice(keep).map(o => o.p);
  return byReach.slice(0, keep).map(o => o.p);
}

function initStages() {
  const con = layout().construction;
  const S = RULES.stages;
  const st = G.stage = {
    i: 0, clock: 0, noticed: false, pushed: 0,
    /* the difficulty's own numbers, captured once: a stage is a multiple */
    base: {
      guards: RULES.garrisonGuards, drones: RULES.garrisonDrones,
      popCap: RULES.machinePopCap, spawnEvery: DEFS.depot.spawnEvery,
      coolArmor: DEFS.coolant.armor, meltdownCool: RULES.meltdownCool,
      turretDmg: DEFS.turret.dmg, turretSplash: DEFS.turret.splash,
    },
    hiredG: 0, hiredD: 0,
    /* A construction map authors its own Stage II: the timer and the guns. */
    at: S.map((s, k) => (k === 1 && con && con.time) ? con.time : (s.at || 0)),
    extraGuards: (con && con.addGarrison) || 0,
    pads: [], counts: stageCounts(),
  };
  const padSpots = (G._stagePads || []).concat(con ? (con.addTurrets || []) : []);
  for (const [x, z] of padSpots) st.pads.push(makePad(x, z));
  G._stagePads = null;
  st.crane = makeCrane();
  applyStage(0);
}

function stageCounts() {
  const c = {};
  for (const k of STAGE_KIND) c[k] = 0;
  for (const o of G.entities) if (o.alive && o.team === TEAM.MACHINE && c[o.type] !== undefined) c[o.type]++;
  return c;
}

/* The multipliers that are pure numbers. Garrison top-ups and new concrete
   happen in advanceStage, once, because they spawn things. */
function applyStage(k) {
  const s = RULES.stages[k], b = G.stage.base;
  RULES.machinePopCap = Math.max(4, Math.round(b.popCap * (s.popCap ?? 1)));
  DEFS.depot.spawnEvery = b.spawnEvery * (s.spawnEvery ?? 1);
  DEFS.coolant.armor = b.coolArmor + (s.coolArmor || 0);
  RULES.meltdownCool = s.meltdownCool ?? b.meltdownCool;
  DEFS.turret.dmg = Math.round(b.turretDmg * (s.turretDmg ?? 1));
  DEFS.turret.splash = b.turretSplash * (s.turretSplash ?? 1);
  if (G.stage.crane) G.stage.crane.lamp.material = GLOW(STAGE_TINT[k] ?? 0xffffff);
}

/* How long until the next stage, in seconds of site progress. */
export function stageInfo() {
  const st = G.stage;
  if (!st) return null;
  const S = RULES.stages;
  const next = st.i + 1 < S.length ? S[st.i + 1] : null;
  return { i: st.i, name: S[st.i].name, next: next ? next.name : null,
           left: next ? Math.max(0, st.at[st.i + 1] - st.clock) : 0, pushed: st.pushed };
}

function updateStages(dt) {
  const st = G.stage;
  if (!st || G.over || !G.core || !G.core.alive) return;
  const S = RULES.stages;

  /* Setbacks: anything the swarm has levelled since last frame. Counted, not
     hooked into onDeath, so every way a structure can die is caught once. */
  const now = stageCounts();
  for (const k of STAGE_KIND) {
    const lost = st.counts[k] - now[k];
    if (lost > 0 && st.i + 1 < S.length) {
      const room = Math.max(0, RULES.stageDelayMax - st.pushed);
      const d = Math.min(room, lost * ((RULES.stageDelay || {})[k] || 0));
      if (d > 0) {
        st.clock -= d; st.pushed += d;
        toast(`Site delayed — ${S[st.i + 1].name} pushed back ${Math.round(d)}s`
              + (room - d <= 0 ? ' (the contractor has no slack left)' : ''), 'machine');
      }
    }
  }
  st.counts = now;

  /* The crane keeps working while there is a next stage to build. */
  if (st.crane) st.crane.jib.rotation.y += dt * 0.12;
  for (const p of st.pads) p.ring.material.opacity = 0.35 + 0.25 * Math.sin(G.time * 3);

  if (st.i + 1 >= S.length) return;
  st.clock += dt;
  const at = st.at[st.i + 1];
  const next = S[st.i + 1];
  if (!st.noticed && st.clock >= at - RULES.stageNotice) {
    st.noticed = true;
    const secs = Math.max(1, Math.round(at - st.clock));
    toast(`${next.notice} (${secs}s — level a depot, generator or pump to delay it)`, 'machine');
    commsEvent('works', 1);
    SFX.alarm();
  }
  /* A setback can drag a noticed stage back out of its notice window; say it
     again when it comes back round rather than going quiet. */
  if (st.noticed && st.clock < at - RULES.stageNotice - 5) st.noticed = false;
  if (st.clock >= at) advanceStage();
}

function advanceStage() {
  const st = G.stage;
  const S = RULES.stages;
  const prev = S[st.i];
  st.i++; st.noticed = false; st.pushed = 0;
  const s = S[st.i];
  applyStage(st.i);

  /* Pads pour when a stage raises the turret share to full. */
  if ((s.turrets ?? 1) > (prev.turrets ?? 1) || (st.i === 1 && st.pads.length)) {
    for (const p of st.pads) {
      G.scene.remove(p.group);
      const t = spawn('turret', p.x, p.z);
      G.obstacles.push(t);
      ring(t.pos, STAGE_TINT[st.i], 14, 1.2);
    }
    st.pads.length = 0;
  }
  garrisonTo(s.garrison ?? 1, st.i >= 1 ? st.extraGuards : 0);

  for (const kind of (s.works || [])) {
    const spot = worksSpot(kind);
    if (!spot) continue;                         // campus full: skip it quietly
    const e = spawn(kind, spot.x, spot.z);
    G.obstacles.push(e);
    if (kind === 'pump') {
      G.pumps.push(e);
      e.onDeath = () => {
        const left = G.pumps.filter(q => q.alive).length;
        commsEvent('water', 0.8);
        toast(left ? `Intake pump destroyed — ${left} still drawing`
                   : 'The last pump is dead. The water is coming back.');
      };
    }
    ring(e.pos, STAGE_TINT[st.i], 16, 1.2);
  }
  if (s.coolArmor) for (const c of G.coolants) cladTower(c, st.i);
  /* Cladding is also bulk: every tower's ceiling rises by the same absolute
     amount, and a standing tower gets it as health (an offline one has to be
     welded up to the new line like any other). */
  if ((s.coolHp ?? 1) > (prev.coolHp ?? 1)) {
    for (const c of G.coolants) {
      const add = (c.baseHp || c.def.hp) * ((s.coolHp ?? 1) - (prev.coolHp ?? 1));
      c.maxHp += add;
      if (!c.downed && c.alive) c.hp += add;
    }
  }
  st.counts = stageCounts();          // new concrete is not a setback

  if (st.i + 1 >= RULES.stages.length && st.crane) {
    /* The site is finished: the crane comes down. */
    G.scene.remove(st.crane.group);
    st.crane = null;
  }
  SFX.alarm();
  commsEvent('built', 1);
  toast(s.done, 'warn');
}

/* A foundation pad: concrete, four scaffold posts and a pulsing ring, so the
   player can SEE where the Stage II guns will stand before they do. */
function makePad(x, z) {
  const g = new THREE.Group();
  const y = terrainHeight(x, z);
  g.position.set(x, y, z);
  const sm = siteMats();
  g.add(cyl(sm.concrete, 2.6, 0.5, 0, 0.25, 0));
  const steel = sm.padSteel;
  for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) g.add(box(steel, 0.22, 4.2, 0.22, ox, 2.3, oz));
  g.add(box(steel, 3.6, 0.2, 0.2, 0, 4.3, -1.6));
  g.add(box(steel, 3.6, 0.2, 0.2, 0, 4.3, 1.6));
  g.add(box(steel, 0.2, 0.2, 3.6, -1.6, 4.3, 0));
  g.add(box(steel, 0.2, 0.2, 3.6, 1.6, 4.3, 0));
  const rg = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.8, 32), sm.ring);
  rg.rotation.x = -Math.PI / 2; rg.position.y = 0.35;
  g.add(rg);
  G.scene.add(g);
  return { x, z, group: g, ring: rg };
}

/* Site dressing is scenery, so it goes dark under unexplored fog exactly like
   the props do (applyFogMask) -- cloned once, because M() materials are shared
   with the rest of the compound. The crane's beacon is deliberately NOT masked:
   it is the one thing about the site you can read from across the valley. */
let _siteMats = null;
function siteMats() {
  if (_siteMats) return _siteMats;
  const fm = m => applyFogMask(m.clone());
  return (_siteMats = {
    concrete: fm(M(0x8a8780)),
    padSteel: fm(M(0xd08a2a, { metal: 0.4, rough: 0.6 })),
    craneSteel: fm(M(0xe0a830, { metal: 0.3, rough: 0.6 })),
    weight: fm(M(0x55524c)),
    ring: applyFogMask(new THREE.MeshBasicMaterial({ color: STAGE_TINT[0], transparent: true, opacity: 0.5,
                                                     side: THREE.DoubleSide, depthWrite: false })),
  });
}

/* A tower crane beside the Core. The beacon on its jib is the stage, in
   colour, from anywhere the compound can be seen. */
function makeCrane() {
  const cp = G.core.pos;
  const x = cp.x + 12, z = cp.z + 10;
  const g = new THREE.Group();
  g.position.set(x, terrainHeight(x, z), z);
  const sm = siteMats();
  const steel = sm.craneSteel;
  g.add(box(sm.concrete, 3.2, 1, 3.2, 0, 0.5, 0));
  g.add(box(steel, 1.1, 30, 1.1, 0, 15.5, 0));
  const jib = new THREE.Group();
  jib.position.y = 30.5;
  jib.add(box(steel, 26, 0.9, 0.9, 7, 0, 0));
  jib.add(box(sm.weight, 3, 2, 2, -6.5, -0.6, 0));          // counterweight
  jib.add(box(steel, 0.12, 9, 0.12, 16, -4.5, 0));          // hook line
  const lamp = sph(GLOW(STAGE_TINT[0]), 0.9, 19.5, 0.9, 0);
  jib.add(lamp);
  g.add(jib);
  G.scene.add(g);
  return { group: g, jib, lamp };
}

/* Hyperscale cladding: armour bands round every coolant tower. The armour is
   real (DEFS.coolant.armor), so the tell has to be too. */
function cladTower(c, stage) {
  /* Parented to the tower's own mesh so it shares the tower's fog, fate and
     finale; the mesh is scaled by vScale, so the bands are drawn in its space.
     One band per stage that armours the plant, lit in that stage's colour, so
     "how armoured is that tower" reads off the tower itself. */
  if (!c._clad) {
    c._clad = new THREE.Group();
    c._clad.scale.setScalar(1 / (c.vScale || 1));
    c.mesh.add(c._clad);
  }
  const g = c._clad;
  const n = g.children.length / 2;                 // bands already fitted
  const plate = M(0x3a3d44, { metal: 0.6, rough: 0.4 });
  const h = 2.2 + n * 2.6;
  g.add(cyl(plate, c.radius + 0.35 + n * 0.08, 1.1, 0, h, 0));
  g.add(cyl(GLOW(STAGE_TINT[stage] ?? STAGE_TINT[2]), c.radius + 0.45 + n * 0.08, 0.18, 0, h + 0.7, 0));
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

/* ------------------------------------------------------------- Evolve ----
   The swarm's tech path. See RULES.evolve for the measured problem each tier
   answers. Three tiers, two options each, one pick per tier for the match. */
const evo = () => (G.evo || (G.evo = {}));
export function evolveOwned(id) { return !!evo()[id]; }

/* 'owned' | 'open' | 'closed' (its twin was bought) | 'tier' (earlier tier
   not bought yet). One place, so the panel, the hotkeys and the harness agree. */
export function evolveStatus(id) {
  const opt = RULES.evolve.find(o => o.id === id);
  if (!opt) return 'closed';
  if (evo()[id]) return 'owned';
  if (RULES.evolve.some(o => o.tier === opt.tier && o.id !== id && evo()[o.id])) return 'closed';
  if (opt.tier > 1 && !RULES.evolve.some(o => o.tier === opt.tier - 1 && evo()[o.id])) return 'tier';
  return 'open';
}

export function evolve(id) {
  const opt = RULES.evolve.find(o => o.id === id);
  if (!opt || !G.heart.alive || G.over) return false;
  const s = evolveStatus(id);
  if (s !== 'open') {
    if (s === 'tier') toast(`${opt.name} needs a tier ${opt.tier - 1} evolution first`, 'warn');
    else if (s === 'closed') toast(`The valley already chose the other path at tier ${opt.tier}`, 'warn');
    SFX.deny(); return false;
  }
  if (G.biomass < opt.cost) { toast(`Not enough biomass to evolve ${opt.name} (${opt.cost})`, 'warn'); SFX.deny(); return false; }
  G.biomass -= opt.cost;
  evo()[id] = G.time || 0.001;
  ring(G.heart.pos, 0xc9ff7a, 26, 1.4);
  burst(G.heart.pos.clone().setY(G.heart.pos.y + 8), 0xc9ff7a, 26, 12, 1.2, 1);
  SFX.bloom();
  toast(`The valley evolves — ${opt.name}: ${opt.desc}`);
  return true;
}

/* Tier III forms replace a species on the roster: the Wolf card, the Z key
   and every queue call all produce the evolved form once it is bought. */
export function rosterType(type) {
  if (type === 'wolf' && evo().alpha) return 'alpha';
  if (type === 'boar' && evo().ironhide) return 'ironhide';
  return type;
}

/* What a unit costs right now. Warren makes the litter cheaper; everything
   that shows or charges a price reads it from here. */
export function unitCost(type) {
  const c = DEFS[type].cost;
  return evo().warren ? Math.round(c * RULES.warrenCost) : c;
}

/* Put an evolved form on a freshly spawned body of its base species. The mesh,
   gait, voice and portrait stay the species'; stats, size and colour change. */
const _tint = new THREE.Color();
function applyForm(e, formType) {
  const d = DEFS[formType];
  e.def = d;
  e.formType = formType;
  e.baseHp = e.hp = e.maxHp = d.hp;
  e.radius = d.radius;
  e.vScale *= d.formScale || 1;
  e.mesh.scale.setScalar(e.vScale);
  if (d.formTint !== undefined) {
    _tint.setHex(d.formTint);
    const skip = new Set();
    if (e.hb) e.hb.g.traverse(o => skip.add(o));
    if (e.ring) skip.add(e.ring);
    e.mesh.traverse(o => {
      if (!o.isMesh || skip.has(o) || !o.material || Array.isArray(o.material)) return;
      const src = o.material;
      if (!src.color) return;
      const m = src.clone();
      /* Material.copy drops these, and a shader patch lost silently is how
         this codebase has been bitten before (see meshes.js). */
      if (src.onBeforeCompile) m.onBeforeCompile = src.onBeforeCompile;
      if (src.customProgramCacheKey) m.customProgramCacheKey = src.customProgramCacheKey;
      m.color.multiply(_tint);
      o.material = m;
    });
  }
}

/* Where a new animal hatches: the Heart Tree, or with Forward Den the bloomed
   grove nearest the compound that is not being trampled right now. */
function hatchPoint() {
  if (evo().den) {
    let best = null, bd = 1e9;
    for (const g of G.groves) {
      if (!g.owned || g.losing) continue;
      const d = Math.hypot(g.pos.x - COMPOUND.x, g.pos.z - COMPOUND.z);
      if (d < bd) { bd = d; best = g; }
    }
    if (best) return { x: best.pos.x, z: best.pos.z, r: 6 };
  }
  return { x: BASE.x, z: BASE.z, r: 11 };
}

const _thornNear = [];
const THORN_SHOT = { color: 0x9bff6a, speed: 55, size: 0.2 };
let packT = 0;
function updateEvolve(dt) {
  const E = G.evo;
  if (!E || G.over) return;

  /* Mycelium: the dead feed the tree. Read off corpses the frame they fall,
     so every way an animal can die is caught once. */
  if (E.mycelium) {
    for (const e of G.entities) {
      if (e.alive || e._myc || e.team !== TEAM.WILD || e.isBuilding) continue;
      e._myc = true;
      if (G.wallTime - (e.deadAt || 0) > 1) continue;      // died before the rite
      G.biomass += (e.def.cost || 0) * RULES.myceliumRefund;
      burst(e.pos.clone().setY(e.pos.y + 0.6), 0xc9ff7a, 6, 3, 0.9, 0.5);
    }
  }

  /* Thornwall: every bloomed grove is a small, patient gun. */
  if (E.thornwall) {
    for (const g of G.groves) {
      if (!g.owned) continue;
      g._thornT = (g._thornT || 0) - dt;
      if (g._thornT > 0) continue;
      const list = G.grid.near(g.pos.x, g.pos.z, RULES.thornRange + 2, _thornNear);
      let best = null, bd = 1e9;
      for (const o of list) {
        if (!o.alive || o.team !== TEAM.MACHINE || o.isBuilding) continue;
        const d = dist2D(o.pos, g.pos) - o.radius;
        if (d <= RULES.thornRange && d < bd) { bd = d; best = o; }
      }
      if (!best) { g._thornT = 0.25; continue; }
      g._thornT = RULES.thornRate;
      fireProjectile(new THREE.Vector3(g.pos.x, g.pos.y + 3, g.pos.z), best, RULES.thornDmg, THORN_SHOT, null);
    }
  }

  /* Alpha: a wolf running with an Alpha and at least packSize-1 others hits
     harder. Re-derived four times a second on top of veterancy's multiplier. */
  if (E.alpha) {
    packT -= dt;
    if (packT <= 0) {
      packT = 0.25;
      const wolves = G.entities.filter(e => e.alive && e.type === 'wolf' && e.team === TEAM.WILD);
      const packed = new Set();
      const r2 = RULES.packRange * RULES.packRange;
      for (const a of wolves) {
        if (a.formType !== 'alpha') continue;
        const near = wolves.filter(w => (w.pos.x - a.pos.x) ** 2 + (w.pos.z - a.pos.z) ** 2 <= r2);
        if (near.length >= RULES.packSize) for (const w of near) packed.add(w);
      }
      for (const w of wolves) {
        const vet = 1 + 0.12 * (w.vet || 0);
        w.dmgMult = vet * (packed.has(w) ? RULES.packDmg : 1);
      }
    }
  }
}

export function queueUnit(type) {
  type = rosterType(type);
  const def = DEFS[type];
  if (!G.heart.alive) return false;
  if (G.lockedUnits && G.lockedUnits.includes(type)) {
    toast('The Locals have not joined yet — liberate Milltown', 'warn');
    SFX.deny(); return false;
  }
  if (type === 'local' && !G._localPr) { G._localPr = true; commsEvent('local'); }
  const cost = unitCost(type);
  if (G.biomass < cost) { toast(`Not enough biomass for ${def.name} (${cost})`, 'warn'); SFX.deny(); return false; }
  if (G.pop + queuedPop() + (def.pop || 1) > G.popCap) { toast('Wildlife limit reached — the forest can hold no more', 'warn'); SFX.deny(); return false; }
  if (G.queue.length >= 24) { SFX.deny(); return false; }
  G.biomass -= cost;
  /* Groves also quicken each lane a little, on top of adding lanes. Kept mild:
     the lanes are the real lever, and stacking both at the old 7% made a maxed
     economy produce faster than the pop cap could absorb. */
  const haste = 1 - 0.04 * (G.bloomed || 0);
  const build = def.build * Math.max(0.55, haste) * (evo().warren ? RULES.warrenBuild : 1)
              * (evo().den ? RULES.denBuild : 1);
  G.queue.push({ type, remaining: build, total: build, paid: cost });
  return true;
}

export function queuedPop() {
  return G.queue.reduce((s, q) => s + (DEFS[q.type].pop || 1), 0);
}

export function cancelQueue(i) {
  const item = G.queue[i];
  if (!item) return;
  G.biomass += item.paid ?? DEFS[item.type].cost;
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
