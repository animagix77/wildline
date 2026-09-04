# September 4 game review

The strongest parts of the current game are its asymmetric factions, map-control
economy, water pressure, and distinctive procedural world. This pass focuses on
making those systems easier to read and more satisfying to command.

## Changes

- **3D models and motion:** quadruped torsos, shoulders, necks, and heads now use
  faceted organic volumes while retaining the shared, merged animation rigs.
  Walking advances a continuous phase instead of multiplying elapsed time by a
  changing speed, which previously caused sudden jumps in leg pose.
- **Rendering:** the HDR scene target now receives multisample antialiasing;
  canvas antialiasing alone was bypassed by the offscreen post-processing path.
  Bloom is more restrained, the Green overlay preserves more terrain shading,
  and one instanced draw adds soft, slope-aligned contact shadows for visible
  units. Shadow slope samples are cached for stationary units.
- **Orders:** formation orientation follows travel direction. Tanks receive front
  slots, melee the middle, and ranged wildlife the rear. Nearest available slots
  within each role reduce crossing. Whole formations translate inward at map
  edges so destinations do not collapse onto the same clamped point.
- **Tactical feedback:** a compact command toolbar exposes selection, attack-move,
  hold, stop, drinking, and Overgrowth. Spell targeting shows the actual radius
  on terrain and counts visible machines and guns. The preview and spell share
  their eligibility predicate; hidden units never enter the preview count.
- **Input:** gameplay commands are blocked during both help and player pauses;
  recruitment, root upgrades, and queue cancellation have matching UI guards.
  Losing window focus clears an unfinished selection drag. The resource bar
  reflows at narrower desktop widths instead of pushing controls offscreen.
- **Sound:** sparse positional footsteps distinguish soft ground, paving, and
  heavier animals. Attack and hold orders get distinct acknowledgements.
  Synth sources are capped at 48, release their connected nodes on completion,
  and do not allocate while muted or suspended. Muting persists between visits;
  keyboard-first players can also unlock audio.

## Verification

- Build syntax, module import validation, and flattened-name collision guards.
- Deterministic formation tests: empty and single-unit orders, four travel
  directions, role placement, nonoverlapping slots, and 280-unit formations at
  all four map corners.
- Browser integration checks for modular and standalone entry points: startup,
  map layout validation, selection, hold/stop, pause/help guards, recruitment,
  fog-aware spell previews, actual rooting and gun suppression, resource charges,
  cooldown enforcement, geometry reuse, and WebGL shader compilation.
- Browser audio checks: a user gesture unlocks audio, bursts respect the source
  cap, sources return to zero, and muted effects create no sources.
- Visual inspection of the battlefield, command strip, and spell radius.

This was a presentation and control pass, not a full campaign rebalance. Damage,
prices, wave pacing, and campaign progression remain at their existing values.
Long-match balance and performance across lower-end GPUs were not benchmarked.
Multisampling increases GPU work, while contact shadows add one instanced draw.


## UI design follow-up

The field console now uses pine surfaces, ivory typography, and line icons for
resources. The title screen has a mission-first layout with an expandable field
guide. The production dock shows all ten unit, upgrade, and ability cards in two
rows, includes role labels, and contains the order toolbar. Cards are native
keyboard-operable buttons with accessible names and availability states. The
selection panel has an instructional empty state and live selection count; the
square minimap includes a faction legend. A dedicated `ui-design.css` carries the
visual system and responsive layouts and is included in the standalone build.


## Recorded sound follow-up

Replaced the synthetic wolf, bear, boar, raven and porcupine imitations with
recordings, and added recorded beaver chewing. There are 27 locally served clips,
embedded in the portable build. Capybara remains an explicitly documented synth
placeholder. All recordings have source and license attribution in the field
guide and `sounds/CREDITS.md`; exact edit offsets are reproducible with
`tools/pack-animal-audio.py`.

Selection, recruitment completion, explicit attack approaches, automatic charge
starts, actual attacks and idle calls now dispatch contextual recorded cues.
The raven also no longer uses the rifle sound for its projectile. A priority mix
keeps direct responses audible, limits animal overlap, respects fog for world
sounds, and cleans up source nodes. The field guide includes a keyboard-accessible
species/event audition panel.

Recorded-audio validation passed in both modular and portable browser builds:
all 27 clips decoded; all six species played selection, deployment, charge and
attack cues; recruitment completion, the selection toolbar, attack approach and
entity attacks reached the audio dispatcher; fog suppressed unseen combat;
rapid clicks and mixed swarms respected source budgets; completed and muted
recordings released their nodes. The in-game audition panel was inspected and
its event selector and wolf selection/deployment previews exercised with native
controls. Every processed asset was also checked as a nonempty mono MP3.

## Combat animation and army interface pass

Wildlife attacks now have short windups and recoveries at the existing attack
cadence. Damage, projectile release, and recorded attack calls occur on the strike.
Move/retarget orders, roots, death, and targets leaving melee reach can prevent an
uncommitted hit. This deliberately changes first-hit timing; campaign-wide balance
has not been re-tuned around the windups.

Wolf jaws open for bites; boars brace and thrust; bears rear and swipe with two
independently animated forepaws; ravens fold their wings and dive; porcupines,
beavers, and capybaras have their own smaller attack poses. Cached geometry remains
shared across each species. Selected wildlife uses a single instanced marker draw
with facing notches, windup arcs, hit flashes, and visible target indicators.
Health bars briefly retain lost health in amber before easing down. Markers obey
fog visibility, and all new per-unit health materials are released on teardown.

The selected army panel groups animals by species, with counts, weighted health,
role and combat state. Click selects a species, Shift-click removes it, and a
wounded shortcut selects animals below 40% health. A return control restores the
original pack. Production and selection panels share consistent vector portraits.
Live single-unit status also updates watering time and veterancy.

`tools/combat-pass.html` checks strike timing, cancellation, recovery, rig sharing,
army filtering, health feedback, shader compilation, and dock containment. Add
`?bundle=1&width=900` for portable/narrow checks or `?bundle=1&stress=1` for a large
army geometry/marker check. The existing gameplay and recorded-audio regression
suite also covers the new strike timing.
