# Music prompts — Critters vs Compute

Prompts for a generative music tool (Suno, Udio, Stable Audio, MusicGen). Every
track is **instrumental** and needs to **loop**, so each prompt ends with the
constraints that actually matter for game audio rather than for a song.

## The sound of this game

One sentence, because every prompt below is a variation on it:

> **Living instruments versus a machine that will not stop.** Organic
> texture — hand percussion, low strings, breath, wood — carrying the melody,
> against a synthetic pulse underneath that never varies and never resolves.

Two rules that make the set hang together:

- **The forest has melody; the data centre has rhythm.** When the wild side is
  winning, the acoustic layer is on top. When the compound is winning, the
  machine pulse buries it.
- **One shared motif.** Write a four-note phrase for the main theme and bury it
  in every other track — inverted, slowed, on a different instrument. It is what
  makes eight loops sound like one score rather than a playlist.

Practical: **60–110 BPM**, drone-based or modal rather than strong chord
progressions (loops with functional harmony announce their seam every time they
wrap). Leave headroom around **200 Hz–2 kHz**, where nearly all the gunfire,
explosions and animal voices live.

---

## Core tracks

### 1. Main theme (title / splash)

> Cinematic orchestral folk, 82 BPM, D minor. Solo cello states a stubborn
> four-note motif over low taiko and bowed double bass. Layer in tin whistle and
> a wordless low choir. Under everything, a quiet 8-bit-adjacent synth arpeggio
> in a different time signature that never quite locks with the drums. Builds to
> a defiant full-ensemble statement, then falls back to solo cello. Hopeful, not
> triumphant — underdogs. Instrumental, no vocals, seamless loop.

### 2. Standard combat — the valley (Verdant Hollow, The Campus)

> Propulsive orchestral action with folk instrumentation, 104 BPM, D dorian.
> Driving frame drums and bodhrán, staccato low strings, fiddle playing an
> urgent ostinato. Underneath, a cold analog synth pulse on straight eighths
> like a server rack cooling fan. Building tension, no resolution, no obvious
> cadence. Instrumental, no vocals, seamless loop.

### 3. Night operations

> Dark ambient orchestral, 68 BPM, sparse. Sustained low strings and a slow
> pulsing sub-bass. Distant hand percussion with lots of air around it. A
> muted, breathy alto flute plays fragments of a melody that never finishes.
> Cold synth pad drifting slightly out of tune. Patient, predatory, held
> breath. Instrumental, no vocals, seamless loop.

---

## Weather variants

These map onto the game's actual weather states, so a track plays because the
scenario calls for it.

### 4. Rain (Milltown, The Groundbreaking)

> Melancholy orchestral folk, 76 BPM, A minor. Damp, close-miked upright piano
> with the sustain pedal down. Bowed cello, soft brushed snare like rain on a
> tin roof. A low synth drone rising and falling like wind. Wistful and tired
> but not defeated — people who have been standing outside for hours and are
> not leaving. Instrumental, no vocals, seamless loop.

### 5. Snow (Substation Gary)

> Sparse cinematic ambient, 62 BPM, C minor. Glassy bowed vibraphone and
> harmonics on solo violin. Very long reverb tails. Deep, slow sub-bass swells.
> Almost no percussion — just an occasional soft mallet strike, wide apart.
> Beautiful, still, and genuinely cold. A single low synth tone underneath like
> distant machinery through snow. Instrumental, no vocals, seamless loop.

### 6. Mist / fog (Relay Shed 9, The Mirefen Exchange)

> Unsettling ambient orchestral, 66 BPM, drone-based. Sustained cluster of low
> strings holding a minor second. Prepared piano with felt over the strings.
> Faint metallic scrapes and bowed cymbal. A synth pad that phases in and out
> of tune. Deeply uncertain — something is out there and the score will not tell
> you where. Instrumental, no vocals, seamless loop.

### 7. Storm (Coldrake Logistics Hub, Pourhouse Flats)

> Aggressive orchestral hybrid action, 112 BPM, E minor. Hammering low brass
> and detuned string ostinato. Heavy taiko and industrial metallic percussion —
> struck sheet metal, chains, anvil. A distorted synth bass on a relentless
> sixteenth-note pulse. Violent, industrial, overwhelming. Instrumental, no
> vocals, seamless loop.

---

## Situational stingers and states

### 8. Wetland (The Mirefen Exchange — the drained lakes)

> Slow atmospheric orchestral folk, 70 BPM. Fretless bass, hand drums with a
> loose skin, low wooden flute. Watery delay on everything. A recurring
> descending figure that sounds like something draining away. Underneath, a
> mechanical pumping rhythm that gets slightly louder each cycle. Instrumental,
> no vocals, seamless loop.

### 9. Under attack (security sweep incoming)

> Urgent orchestral action, 118 BPM. Panicked tremolo strings climbing in
> register, staccato brass stabs, alarm-like repeating minor third. Machine-gun
> snare rolls and industrial percussion. A harsh synth siren pulse rising in
> pitch. Maximum tension, no release. Loops tightly — 30 to 45 seconds is
> enough. Instrumental, no vocals, seamless loop.

### 10. Victory

> Triumphant orchestral folk, 88 BPM, D major. The main theme's four-note motif
> finally resolving, stated by full strings and horns. Celebratory bodhrán and
> fiddle, a whole ensemble joining in. Tin whistle carries the melody up an
> octave. The synth pulse from the combat tracks fragments, stutters and dies
> out. Earned, warm, a little exhausted. Instrumental, no vocals, 40–60 seconds,
> ending on a clean resolved chord — this one does NOT loop.

### 11. Defeat

> Somber orchestral, 58 BPM, D minor. Solo cello playing the main theme's motif
> slowly and incompletely, breaking off before the last note. Sparse piano.
> A low synth drone swelling to swallow the acoustic instruments entirely, then
> holding alone. Grief, then machinery. Instrumental, no vocals, 30–45 seconds,
> does NOT loop.

### 12. Campaign map (between missions)

> Contemplative orchestral folk, 72 BPM. Solo acoustic guitar fingerpicking a
> gentle ostinato. Warm low strings underneath. Distant, soft hand percussion.
> The main theme's motif appears once, quietly, on a lone horn. Reflective —
> counting losses and planning the next move. Instrumental, no vocals, seamless
> loop.

---

## If the tool ignores "instrumental"

Add these negatives explicitly: `no vocals, no singing, no lyrics, no vocal
chops, no spoken word, no applause, no fade-in, no fade-out`.

## Mixing for the game, not for headphones

- Render **-14 LUFS integrated** or quieter. Music sits under gunfire here.
- **High-pass at 40 Hz.** The explosion voices in `src/audio.js` own everything
  below that, and they will fight the mix if the music is down there too.
- **Duck 200 Hz–2 kHz by 2–3 dB** in the master. That band carries the animal
  voices, the welder, and the shield ping — the sounds the player needs to
  hear to make decisions.
- Trim the loop to an **exact bar boundary** and cross-check that the last
  sample meets the first. Most generators will not do this for you.

## Wiring it in

Music would be the first runtime asset this project has — everything else is
synthesised or inlined (see the README's opening claim). Two honest options:

1. **Keep the single-file promise.** Encode as low-bitrate Opus and base64 it
   into a module, the way `src/splash-art.js` already inlines the key art. A
   90-second loop at 48 kbps Opus is roughly 540 KB, ~720 KB as base64. Twelve
   tracks is not viable; three or four is.
2. **Break the promise deliberately.** Ship an `audio/` folder, fetch on demand,
   and update the README so the claim stays true. Better fidelity, more tracks,
   and the game still runs without them if the fetch fails.
