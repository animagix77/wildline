# CRITTERS VS COMPUTE — Gauntlet Loop Development Plan

**Target:** a single, self-contained, production-ready `wildline.html` — a 3D RTS in which
you command a valley's wildlife against a fortified hyperscale data centre.
Benchmark genre: Command & Conquer / Warcraft III / They Are Billions.

**Hard constraints**
- One file. No external assets. No `.gltf`, `.png`, `.mp3`, no CDN at runtime.
  Three.js r169 (MIT) is vendored and inlined; every mesh, texture, material and sound
  is generated in code.
- Custom GLSL for all environment texturing and FX.
- All audio synthesised through the Web Audio API.
- Explicit win state, explicit loss state, no placeholders.

---

## 1. Core game loop

```
   ┌──────────────────────────────────────────────────────────┐
   │  EXPAND            take neutral Groves with any unit      │
   │    ↓               → biomass income                       │
   │  GROW              spend biomass at the Heart Tree        │
   │    ↓               → wolves / boars / bears / ravens      │
   │  DEFEND            machine sweeps: first at 95s, then every 108s     │
   │    ↓               → they target your groves, then base   │
   │  BREACH            walls, turrets, guards                 │
   │    ↓                                                      │
   │  KILL 3 COOLANT TOWERS → core shield fails → KILL CORE    │
   └──────────────────────────────────────────────────────────┘
```

Loss: the Heart Tree dies. A wholly passive player survives sweeps 1-3 and dies to the
fourth at ~7:20 (about one run in five, the third gets through at ~6:05). Survival is a
step function on wave index, so the design target is "three sweeps of grace", not a
specific second.

## 2. Mechanics

| System | Design |
|---|---|
| **Economy** | Presence-based, not build-based. 4s of uncontested occupation blooms a Grove (+2/s). Machines drain a bloomed grove back. Income is therefore a map-control problem, not a build-order problem. |
| **Production** | Single serial queue at the Heart Tree, rally point, cancel-with-refund. Pop cap 40 with per-unit pop cost. |
| **Combat** | `dealt = max(1, dmg − armour)`. Siege multiplier vs. structures (Bear 2.2×, Boar 1.4×) makes composition matter. Melee applies instantly; ranged spawns homing tracers. |
| **Targeting** | Auto-acquire inside vision, leashed at 30m so units don't chase across the map. Attack-move chases; plain move only fires at what's already in range. |
| **Movement** | No navmesh. Direct steering + neighbour separation (spatial hash) + circle/AABB push-out + wall slide. Blocked >1.1s ⇒ attack the blocker — this is *why* the perimeter is destructible. |
| **Ability** | Overgrowth: roots all machines in 14m for 5s, 90 biomass, 35s cooldown. |
| **Enemy AI** | Depot trickle spawns, interior patrol routes, escalating raid waves that prioritise your bloomed groves over your base. |
| **Fog of war** | Grid visibility from wild-unit vision. Unexplored = black, explored-but-unseen = dimmed with last-known structure ghosts. Gates scouting value and hides wave composition. |
| **Score** | Kills weighted by unit value, structures, groves held, time bonus, streak multiplier. Final rank on the game-over screen. |

## 3. State management

One mutable `G` singleton (`state.js`). Systems are pure functions over it, run in a fixed
order each frame so ordering bugs are impossible to introduce accidentally:

```
grid.rebuild → entity.update ×N → ai → world(economy/queue/groves) → fog → reap
             → combatFX → shaders.tick → camera → hud → render
```

Phases: `BOOT → MENU → PLAYING → (VICTORY | DEFEAT)`. `G.over` freezes simulation but
keeps FX and camera alive so explosions finish.

## 4. Rendering

- **Terrain**: `MeshStandardMaterial` + `onBeforeCompile` GLSL injection — keeps three's
  shadow/fog/tonemap chain while replacing albedo with procedural fbm blending of
  grass / dry / ash / tarmac driven by a per-vertex blight attribute, plus macro
  variation, fine grain and normal perturbation. No textures uploaded.
- **Sky**: ShaderMaterial dome, gradient + sun disc + drifting cloud fbm.
- **FX shaders**: core hologram shield (fresnel + scanline + hex), grove water,
  Overgrowth energy field, fog-of-war mask.
- Directional sun with a 2048 shadow map whose frustum rides the camera target,
  hemisphere fill, cold rim light from the campus side.
- Instanced forest / rocks / brush. Pooled particles. Target: 60fps at 150+ entities.

## 5. Audio

Web Audio only: oscillator + filtered-noise voices for shots, bites, metal impacts,
explosions, spawns, grove blooms, alarms, UI. Per-voice throttling so 40 wolves cannot
detonate the mixer. Master gain + mute.

## 6. UI

Start screen (animated, difficulty select) · HUD (biomass + rate, pop, groves, objective
pips, clock, score) · selection panel (solo stat card / multi chip grid) · command cards
with cost gating and cooldowns · production queue with cancel · fog-aware minimap with
camera frustum · toasts · F3 performance overlay (fps, frame ms, draw calls, tris) ·
victory/defeat screens with a scored breakdown.

## 7. Build

Source stays modular under `src/`. `build.mjs` inlines three.js (rewriting its trailing
`export{}` into a `THREE` namespace), strips import/export from each module, concatenates
in dependency order, inlines CSS and HTML, and emits `wildline.html`. A collision guard
fails the build if two modules declare the same top-level name.

## 8. Gauntlet Loop

| Round | Builder | Critic gate |
|---|---|---|
| 1 | GLSL shader suite · start/score/perf UI · fog of war | integration correctness, no placeholders |
| 2 | Fixes from round 1 verdict | fluid movement, collision accuracy, perf tracking, win/loss completeness |
| 3 | Fixes from round 2 verdict | genre benchmark parity — reject on any bug, stub, or unpolished surface |

Ship only on an explicit Critic PASS.
