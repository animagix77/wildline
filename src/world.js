import * as THREE from 'three';
import { G } from './state.js';
import { WORLD, HALF, BASE, COMPOUND, DEFS, RULES, TEAM } from './config.js';
import { terrainHeight, blight, insideCompound, rand, randInt, dist2D, clamp, fbm, Grid } from './utils.js';
import { M, GLOW, makeForest, makeScatter, buildWall, box, cyl } from './meshes.js';
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
import { ring, burst } from './combat.js';

/* =========================================================================
   Scene construction
   ========================================================================= */

export function buildScene(scene) {
  const pal = (G.map && G.map.palette) || {};
  scene.background = new THREE.Color(pal.bg !== undefined ? pal.bg : 0x1b2f24);
  scene.fog = new THREE.Fog(pal.fog !== undefined ? pal.fog : 0x24402f,
    pal.fogNear || 170, pal.fogFar || 420);

  const hemi = new THREE.HemisphereLight(0xbde4ff, 0x3d4f2e, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d2, 1.85);
  sun.position.set(-70, 110, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -130; c.right = 130; c.top = 130; c.bottom = -130;
  c.near = 10; c.far = 340;
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
  scene.add(trunks); scene.add(leaves);

  // rocks
  scene.add(makeScatter(
    new THREE.DodecahedronGeometry(1, 0), scenic(M(0x6a6b64, { rough: 1 })), density.rocks || 240,
    () => { const p = freeSpot(4); if (p) p.y -= 0.3; return p; }, [0.6, 2.4]
  ));

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
     flickers as coolant towers fall, then drops entirely on thermal runaway, so the
     objective reads without needing the HUD. */
  const shield = new THREE.Mesh(new THREE.SphereGeometry(17, 44, 30), makeShieldMaterial());
  shield.position.set(core.pos.x, core.pos.y + 5, core.pos.z);
  shield.renderOrder = 3;
  G.scene.add(shield);
  G.coreShield = shield;

  G.coolants = COOLANTS.map(([x, z]) => {
    const c = spawn('coolant', x, z);
    c.onDeath = () => {
      const left = G.coolants.filter(k => k.alive).length;
      ring(c.pos, 0x39d7ea, 26, 1.4);
      if (left > 0) {
        commsEvent('coolant');
        toast(`Coolant tower down — ${left} remaining`, 'machine');
      } else {
        commsEvent('coreExposed');
        G.coreExposed = true;
        SFX.shieldDown();
        SFX.alarm();
        toast('THERMAL RUNAWAY — the Server Core is exposed', 'warn');
      }
    };
    G.obstacles.push(c);
    return c;
  });

  G.depots = DEPOTS.map(([x, z]) => {
    const d = spawn('depot', x, z, { rotY: z > COMPOUND.z ? Math.PI : 0 });
    d.spawnTimer = rand(4, 10);
    d.onDeath = () => { commsEvent('depot'); toast('Security Depot destroyed — fewer reinforcements', 'machine'); };
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

  /* A site caught mid-build finishes on a clock if you let it. */
  const con = layout().construction;
  if (con) {
    G.construction = { time: con.time, left: con.time, def: con, done: false, warned: {} };
  } else {
    G.construction = null;
  }

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
    let wild = 0, machine = 0;
    for (const e of G.entities) {
      if (!e.alive || e.isBuilding) continue;
      if (dist2D(e.pos, g.pos) > 7) continue;
      if (e.team === TEAM.WILD) wild++; else if (e.team === TEAM.MACHINE) machine++;
    }
    const dir = wild > 0 && machine === 0 ? 1 : (machine > 0 && wild === 0 ? -1 : 0);
    /* Being pushed off a grove is expensive and used to happen in near-silence.
       Warn once per contest, and let the minimap pulse while it lasts. */
    g.losing = dir < 0 && g.owned;
    if (g.losing && !g._warned) {
      g._warned = true;
      SFX.heartAlarm();
      toast('A grove is being trampled — send something', 'warn');
    } else if (!g.losing && g._warned && dir >= 0) g._warned = false;
    if (dir !== 0) {
      g.prog = clamp(g.prog + dir * dt, 0, RULES.captureTime);
      if (!g.owned && g.prog >= RULES.captureTime) {
        g.owned = true;
        g.bloomAt = G.time;      // income ramps in — see below
        g.anim.bloom.visible = true;
        g.anim.pillar.material.opacity = 0.75;
        g.anim.water.material.uniforms.wl_bloom.value = 1;
        SFX.bloom();
        ring(g.pos, 0x9bff6a, 9, 1.1);
        burst(g.pos.clone().setY(g.pos.y + 1), 0x9bff6a, 22, 11, 1.1, 0.9);
        addScore('grove', 'bloom', g.pos);
        commsEvent('grove', 0.6);
        toast('Grove bloomed — biomass rising');
      } else if (g.owned && g.prog <= 0) {
        g.owned = false;
        g.anim.bloom.visible = false;
        g.anim.pillar.material.opacity = 0.45;
        g.anim.water.material.uniforms.wl_bloom.value = 0;
        toast('A grove has been trampled', 'warn');
      }
    }
    if (g.owned) bloomed++;
  }
  /* A new lane is a real step up in throughput, so it gets its own chime --
     otherwise the only feedback for the most important economic decision in the
     game is a number quietly changing in the build panel. */
  if (bloomed > (G.bloomed || 0) && G.lanes !== undefined && Math.min(4, 1 + bloomed) > Math.min(4, 1 + (G.bloomed || 0))) SFX.lane();
  G.bloomed = bloomed;

  /* --- core shield tracks the coolant towers --- */
  if (G.coreShield) {
    const alive = G.coolants.filter(c => c.alive).length;
    // it lives in the scene rather than under the core, so fog concealment has to
    // be forwarded explicitly or the objective is handed over before you scout
    G.coreShield.visible = !G.coreExposed && G.core.alive && G.core.mesh.visible;
    G.coreShield.material.uniforms.wl_health.value = alive / G.coolants.length;
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

  /* --- population --- */
  let pop = 0, mpop = 0;
  for (const e of G.entities) {
    if (!e.alive || e.isBuilding) continue;
    if (e.team === TEAM.WILD) pop += e.def.pop || 1;
    else if (e.team === TEAM.MACHINE) mpop += e.def.pop || 1;
  }
  G.pop = pop; G.machinePop = mpop;

  /* --- production queue -----------------------------------------------------
     Parallel lanes, one per bloomed grove. This is the single change that makes
     a swarm actually a swarm: a serial queue caps sustained spend at roughly one
     wolf per build time no matter how rich you are, so past the third grove the
     income simply piled up unspendable -- a playtest showed 1000 banked biomass
     next to ten units on the field. Lanes turn map control into *throughput*
     rather than just money, which is the reason to go take a grove at all. */
  if (G.queue.length && G.heart.alive) {
    const lanes = Math.min(4, 1 + (G.bloomed || 0));
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
  } else G.lanes = Math.min(4, 1 + (G.bloomed || 0));
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
  if (G.queue.length >= 12) { SFX.deny(); return false; }
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
