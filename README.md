# WILDLINE — Nature vs. Data Centres

A browser 3D RTS in the spirit of Command & Conquer and Warcraft. You command a valley's
wildlife against a fortified hyperscale data centre.

**Ships as one file.** `wildline.html` is ~940 KB and completely self-contained: three.js
r169 is vendored and inlined, and every mesh, texture, material, particle and sound is
generated in code. Verified in the browser network panel: the document is the only
request — no scripts, stylesheets, fonts, images or audio are fetched at runtime.

```bash
node build.mjs          # regenerate wildline.html from src/
node serve.mjs          # dev server on http://localhost:8181
```

`index.html` is the modular dev entry point (same game, unbundled, also offline).

---

## The pitch

You start with a Heart Tree and four wolves. They start with walls, sentry turrets,
patrolling guards, and depots that keep printing more. You cannot out-produce them from
where you begin — you have to take ground first.

**Win:** destroy the three **Coolant Towers**. The hologram shield over the **Server Core**
tears and fails, and the Core can then be brought down.
**Lose:** the Heart Tree falls. On GROVE difficulty a wholly passive player survives
sweeps 1–3 and dies to the **fourth**, at about **7:20**; in roughly one run in five the
third sweep gets through instead, at about **6:05**.

That spread is not noise — survival is a step function on wave index, so clearing a
sweep buys you a whole `waveEvery` and the outcome jumps in ~75-second steps rather
than sliding. Measured across 11 passive runs (mine and an independent reviewer's).

## The loop

| | |
|---|---|
| **Economy** | Presence-based, not build-based. Occupy a neutral **Grove** uncontested for 4s to bloom it (+2/s). Machines standing on a bloomed grove drain it back, so income is a map-control problem rather than a build order. |
| **Production** | One serial queue at the Heart Tree, movable rally point, cancel-with-refund. Pop cap 40 with per-unit pop cost. Arrivals fan out on a spiral so the back ranks aren't shoving at a goal they can't reach. |
| **Combat** | `dealt = max(1, dmg − armour)`, with a siege multiplier against structures (Bear 2.2×, Boar 1.4×). Ranged units hold at their range and shoot; melee closes. |
| **Movement** | No navmesh. Steering + neighbour separation over a spatial hash + swept circle/AABB resolution + wall slide. Blocked for >1.1 s ⇒ attack the blocker, which is why the perimeter is destructible and breaching feels earned. |
| **Base defence** | The Heart Tree fires thorns at 24 m. That number is load-bearing: a guard's range is 17 and it halts at 17 + the tree's 6.5 radius = 23.5 m, so anything under ~24 leaves the tree unable to return fire at all. |
| **Fog of war** | 128² visibility grid, three states, soft-sampled in GLSL. Unexplored is black; explored-but-unseen keeps a dimmed "last known" ghost of machine structures. Groves are permanent landmarks — an unvisited one is marked by a pulsing ground ring and a column of light, with everything else about it concealed. |
| **Score** | Kills weighted by threat, structures, groves, survival time, plus a chain multiplier for kills that land close together. S–D rank on the end screen. |

## Your units

| | Unit | Cost | Role |
|---|---|---|---|
| 🐺 | **Wolf** | 20 | Cheap and fast. Dies to anything with a rifle. Bring twelve. |
| 🐗 | **Boar** | 35 | Armour 3 — small arms barely scratch it. 1.4× vs structures. |
| 🐻 | **Bear** | 70 | Siege. **2.2× vs structures.** What actually kills coolant towers. |
| 🦅 | **Raven** | 35 | Flies. Ignores the perimeter entirely — the only way in that isn't a gate. |
| 🎯 | **Local** | 110 | The valley's people — a woman or a man with a hunting rifle, decided at the door. Your only ground rifle: outranged only by turrets, out-damages a guard. Expensive. |
| 🌿 | **Overgrowth** | 90 | Roots every machine in a 14 m circle for 5 s. 35 s cooldown. |

The Heart Tree defends itself, flinging thorns at anything machine inside 24 m.

## The Reclamation — campaign

Dark Crusade school: a territory map of seven TerraByte sites with free strike order.
Every liberated site grants a permanent perk (Milltown's is the **Locals unlock** —
until the town joins, the card sits greyed out reading LIBERATE MILLTOWN), and the
corporation scales as it loses ground:

```
challenge = tier(site) × progress × adapt
```

`tier` is authored per site, `progress` grows +12% per liberation, and `adapt` is a
clamped band `[0.85 … 1.2]` read from your last two mission ranks — Homeworld's
fleet-scaling idea without Homeworld's death spiral. Scenarios span four terrain
archetypes (valley, wetland, alpine, industrial) driven entirely by parameters on the
same height function; the finale is The Campus, a tier-5 stronghold. Campaign state
lives in localStorage; every mission is a fresh page load, so scaling needs no
teardown machinery. Quick Battle remains the original standalone mission.

Humor rides on the **TerraByte Solutions media ticker**: every setback you inflict
triggers a corporate statement, and the statements get more desperate while the voice
never breaks. ("Have you tried turning the forest off and on again?")

## Controls

Classic RTS layout: **letters are commands, arrows and the screen edge move the camera.**

**Camera** — arrows / screen edge / middle-drag / minimap · **Q E** rotate · wheel zoom ·
**Shift** faster · **Space** snap to Heart Tree

**Units** — click select · drag box · double-click selects that species on screen ·
right click move or attack · **A**+click attack-move · **S** stop · **H** hold ·
**Ctrl+1..5** set group, **1..5** recall

**Build** — **Z** wolf · **X** boar · **C** bear · **V** raven · **B** local · **F**+click Overgrowth

**F1** reference · **F3** performance overlay · **M** mute

## Difficulty

Chosen on the title screen; every field is a multiplier over `config.js`.

| | Sweep gap | Garrison | Their damage | Starting biomass |
|---|---|---|---|---|
| **Sapling** | +35% | −25% | −25% | +45% |
| **Grove** | — | — | — | — |
| **Old Growth** | −25% | +35% | +30% | −20% |

---

## Code map

```
index.html      markup + HUD; modular dev entry point
style.css       HUD chrome          ui-extra.css   screens, score, perf overlay
build.mjs       single-file bundler (see below)
serve.mjs       zero-dependency static server
vendor/         three.js r169 (MIT), vendored for offline use
src/
  config.js     every tuning number: unit stats, costs, wave timers, rules
  state.js      the shared game-state object (also exposed as window.G)
  utils.js      terrain height field, noise, spatial hash, viewport helpers
  score.js      scoring, chain multiplier, floating popups, rank
  audio.js      Web Audio synth voices + master mute
  shaders.js    GLSL suite: terrain, sky, water, core shield, energy field
  meshes.js     every model, procedural; part merging for draw-call control
  combat.js     projectiles, damage, particle + ring pools, death
  entity.js     Entity: orders, steering, separation, collision, combat, animation
  fog.js        visibility grid, veil shader, prop mask, minimap overlay
  world.js      scene build, map layout, economy, production queue, win/loss
  ai.js         machine faction: patrols, depot spawns, raid waves, Overgrowth
  camera.js     RTS camera rig with inertial pan and eased zoom/rotate
  perf.js       F3 overlay: fps, frame ms, sparkline, draw calls, triangles
  screens.js    title screen with difficulty select, scored end screen
  input.js      selection, orders, hotkeys, minimap, command cards
  hud.js        HUD + fog-aware minimap
  main.js       bootstrap, phase machine, game loop
```

### The build

`build.mjs` inlines three.js (rewriting its trailing `export{}` into a `THREE` namespace
inside a closure, so its hundreds of one-letter minified bindings can't collide with game
names), strips import/export from each module, concatenates in dependency order, inlines
both stylesheets and the markup, and emits `wildline.html`.

Two guards run on every build: a fast regex scan for duplicate top-level names, and then
**the real parser** over the flattened payload via `node --check`. Flattening modules is
the one step that can silently change semantics, so it is verified rather than assumed.

### Fighting back

Animals used to walk through rifle fire without reacting: the old retaliation rule
only fired when a unit was *already idle and had no target*, which is almost never,
and a unit on a plain move order would acquire a target but never divert to it. Three
things fixed it, none of them magic numbers:

- **Provocation.** Being damaged makes a unit turn on its attacker, chase within a
  26 m leash of where it was standing, and then resume what it was doing. An explicit
  attack order is still honoured — that contract is not broken.
- **Pack response.** A cry for help carries 15 m. Shoot one wolf and its neighbours
  answer, up to five, without cascading across the army. This is what actually makes
  claws viable against rifles: the answer to a gun line is focused numbers arriving
  together. Measured — one wolf shot, all six engaged, guard dead, zero losses.
- **Charge.** Melee units get +45% speed for ~2 s when closing from range, so they
  cross a guard's 17 m firing lane in 0.75 s instead of 1.09 s.

Targeting is threat-aware too: whatever shot you last is preferred, then other
shooters, then bodies, then structures, with walls last.

### Veterans — the Honor Guard

Kills earn rank, and the pack that walks out of a won mission walks into the next one.

| rank | kills | HP | damage | |
|---|---|---|---|---|
| Green | 0–2 | base | ×1.00 | |
| Blooded | 3–6 | ×1.15 | ×1.12 | ◆ |
| Veteran | 7–12 | ×1.30 | ×1.24 | ◆◆ |
| Elite | 13+ | ×1.45 | ×1.36 | ◆◆◆ |

Survivors are banked on victory, sorted by experience, capped at 10 population so a
snowball can't carry the campaign, and mustered at the Heart Tree next mission with
gold rank pips over their heads. Structures don't earn rank — the Heart Tree's thorns
get plenty of kills and shouldn't level up.

### Impact and death

Getting hit reads as **displacement, never scale**. Inflating a unit when it is shot is
a cartoon pop that makes a wolf look like a squeaky toy, so the body is knocked back
along the actual hit vector (recorded from the attacker in `applyDamage`) and leans
away from it, recovering over 0.18 s. `mesh.scale` is locked for an entity's whole
life. Melee throws its weight forward the same way instead of ballooning.

Death is per-species, driven by a `death` field in `config.js` and animated by
`Entity.updateCorpse`:

| | |
|---|---|
| **Ground animals, Locals, Guards** | `topple` — angular velocity about the contact point, mass resisting (a bear falls visibly slower than a wolf), momentum carried from whatever they were doing, one small bounce, dust on landing, then they lie there before sinking. Because the mesh pivot is at the feet, a 90° roll lays the body out along the ground on its own. |
| **Raven, Drone** | `fall` — ballistic arc with tumble, forward momentum preserved. A raven comes to rest on its side; a drone trails smoke on the way down and **its explosion is the ground impact**, not the moment it died. |
| **Structures** | `collapse` — fireball, debris, scorch, then settling into their own footprint. |

Nothing that walks on legs detonates. A Security Guard is a person in a hi-vis vest:
sparks off the gear, then they go down. Verified by counting explosion primitives —
a guard death produces **zero**, a wall produces fourteen.

### Design notes

- **Draw calls were the frame budget**, not triangles. Each animal was a group of 9–13
  meshes, each re-drawn for the shadow pass. Parts that don't move relative to one another
  are baked into a single vertex-coloured buffer, a quadruped's four legs collapse to two
  (diagonal pairs move together in a real gait), and only the body and head cast shadows.

  What that changed, as mesh counts. The "now" column is countable in the current
  tree (traverse an entity's mesh, excluding its health bar and selection ring); the
  "before" column describes the implementation this replaced and is history, not
  something you can measure today:

  | | before the merge pass | now |
  |---|---|---|
  | wolf / boar / bear rig | 13 meshes | 5 |
  | guard | 11 | 4 |
  | raven | 13 | 3 |
  | wall (×25 on the map) | 5 | 2 |
  | Heart Tree | 55 | 6 |
  | Grove (×6) | 30 | 5 |

  Rigs are also built once per species and cloned, so geometry is shared by reference:
  measured **zero** growth in `renderer.info.memory.geometries` across repeated
  spawn/kill/reap cycles, where previously each 60 units added 300 buffers and released none.

  Earlier drafts of this file published whole-scene draw-call tables. Two independent
  measurements disagreed with them — the count is highly sensitive to camera framing (fog
  culls most machines) and to whether the shadow pass is counted, which differs between
  environments. Rather than publish a third number I cannot stand behind, measure it
  yourself with F3 in the situation you care about.


- **The terrain has no texture.** `MeshStandardMaterial` + `onBeforeCompile` injects GLSL
  that blends grass / dry / ash / tarmac from a per-vertex `blight` attribute with fbm
  noise, keeping three's shadow, fog and tone-mapping chain intact.
- **Obstacle resolution is swept.** Which side of a wall a unit was on at the *start* of
  the step decides which way it is ejected; using the current position instead lets crowd
  pressure push a centre past the midline and get helpfully ejected out the far side.
- `?headless=1` keeps the simulation stepping while the tab is hidden and exposes
  `window.__step(frames)` and `window.__begin()` for scripted testing.

### Not built yet

Veteran carry-over between campaign missions (the pack persisting, Dark Crusade's
Honor Guard) · counterattack raids on held territory · building placement · a
machine-side campaign (every MapDef already carries a `faction` field for it) ·
terrain visibly regrowing as you level the site.
