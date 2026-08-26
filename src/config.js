import * as THREE from 'three';

/* =========================================================================
   Critters vs Compute — tuning constants. Everything gameplay-tweakable lives here.
   ========================================================================= */

export const WORLD = 240;          // world is WORLD x WORLD, centred on origin
export const HALF  = WORLD / 2;

export const TEAM = { WILD: 'wild', MACHINE: 'machine', NEUTRAL: 'neutral' };

export const BASE     = new THREE.Vector3(-72, 0, 68);           // Heart Tree
export const COMPOUND = { x: 56, z: -50, hw: 40, hd: 33 };        // datacenter half-extents

export const COLORS = {
  grass:    0x35592c,
  grassDry: 0x6b6a35,
  scorched: 0x2e2b26,
  bark:     0x4a3a28,
};

/* ---------------------------------------------------------------- units -- */
/* dmg is per shot; dps = dmg / rate. armour subtracts flat damage.           */

export const DEFS = {
  /* ---- WILDLIFE (player) ---- */
  wolf: {
    name: 'Wolf', team: TEAM.WILD, icon: '🐺', key: 'Z',
    hp: 56, dmg: 10, rate: 0.70, range: 2.6, speed: 10.5, radius: 1.0,
    armor: 0, vision: 26, cost: 13, build: 2.1, pop: 1, death: 'topple',
    blurb: 'Loses to a rifle. Beats three. Bring more than three.'
  },
  boar: {
    name: 'Boar', team: TEAM.WILD, icon: '🐗', key: 'X',
    hp: 125, dmg: 22, rate: 1.25, range: 2.8, speed: 8.0, radius: 1.25,
    armor: 2, vision: 25, cost: 24, build: 3.4, pop: 2, siege: 1.4, death: 'topple',
    blurb: 'Armoured battering ram. Shrugs off rifles.'
  },
  bear: {
    name: 'Bear', team: TEAM.WILD, icon: '🐻', key: 'C',
    hp: 380, dmg: 46, rate: 1.7, range: 3.4, speed: 5.6, radius: 1.7,
    armor: 7, vision: 25, cost: 80, build: 10, pop: 4, siege: 2.2, death: 'topple',
    blurb: 'Siege. Double damage to structures. Four pop \u2014 that is four wolves you are not fielding.'
  },
  capybara: {
    name: 'Capybara', team: TEAM.WILD, icon: '🦛', key: 'R',
    hp: 200, dmg: 6, rate: 1.4, range: 2.6, speed: 6.2, radius: 1.35,
    armor: 3, vision: 25, cost: 20, build: 3.0, pop: 2, death: 'topple',
    /* Taunt biases enemy target selection toward this unit (see acquire()).
       Without it the capybara is merely tanky and the swarm still gets shot
       out from behind it; with it, putting capybaras in front is a real and
       discoverable answer to turret splash. */
    taunt: 20,
    blurb: 'A wall that walks. Barely fights, soaks punishment, and the guns would rather shoot it than your wolves.'
  },
  raven: {
    name: 'Raven', team: TEAM.WILD, icon: '🦅', key: 'V',
    hp: 48, dmg: 12, rate: 0.55, range: 10, speed: 14, radius: 0.9,
    armor: 0, vision: 30, cost: 26, build: 3.2, pop: 1, flying: true, ranged: true, death: 'fall',
    projectile: { color: 0xdff0c0, speed: 60, size: 0.22 },
    blurb: 'Flies over walls. Ignores the perimeter entirely.'
  },

  local: {
    name: 'Local', team: TEAM.WILD, icon: '🎯', key: 'B',
    hp: 120, dmg: 16, rate: 0.65, range: 20, speed: 7.2, radius: 0.95,
    armor: 1, vision: 28, cost: 58, build: 7, pop: 2, ranged: true, death: 'topple',
    projectile: { color: 0xffe08a, speed: 95, size: 0.15 },
    blurb: 'The valley\'s people, armed and done asking. Expensive, and very good shots.'
  },

  porcupine: {
    name: 'Porcupine', team: TEAM.WILD, icon: '🦔', key: 'G',
    hp: 120, dmg: 14, rate: 1.15, range: 16, speed: 4.6, radius: 1.1,
    armor: 4, vision: 26, cost: 38, build: 5, pop: 2, ranged: true, death: 'topple',
    projectile: { color: 0xd9c08a, speed: 58, size: 0.13 },
    blurb: 'Quill volley. Slow, armoured, and the only thing on four legs that answers a rifle in kind.'
  },
  beaver: {
    name: 'Beaver', team: TEAM.WILD, icon: '🦫', key: 'N',
    hp: 105, dmg: 12, rate: 1.0, range: 2.8, speed: 5.4, radius: 1.05,
    armor: 2, vision: 25, cost: 32, build: 4.5, pop: 2, siege: 1.8, death: 'topple',
    mend: 14, mendRange: 7,
    blurb: 'Engineer. Gnaws through machine structures and rebuilds your own — the Heart Tree included — when it is not fighting.'
  },

  /* ---- MACHINE (enemy) ---- */
  guard: {
    name: 'Security Guard', team: TEAM.MACHINE, icon: '🔫',
    hp: 100, dmg: 10, rate: 0.55, range: 15, speed: 6.4, radius: 0.9,
    armor: 1, vision: 26, ranged: true, pop: 1, death: 'topple',
    projectile: { color: 0xffc85c, speed: 90, size: 0.16 },
  },
  drone: {
    name: 'Patrol Drone', team: TEAM.MACHINE, icon: '🛸', mech: true,
    hp: 75, dmg: 8, rate: 0.40, range: 15, speed: 12, radius: 0.85,
    armor: 0, vision: 32, ranged: true, flying: true, pop: 1, death: 'fall',
    projectile: { color: 0x59e5ff, speed: 95, size: 0.14 },
  },
  tech: {
    name: 'Field Technician', team: TEAM.MACHINE, icon: '\ud83d\udd27',
    hp: 90, dmg: 0, rate: 1, range: 6, speed: 7.0, radius: 0.85,
    armor: 1, vision: 24, pop: 1, death: 'topple', repair: 16,
    blurb: 'Unarmed. Welds the compound back together behind you. Kill it first.'
  },
  turret: {
    name: 'Sentry Turret', team: TEAM.MACHINE, icon: '🗼',
    /* MEASURED at dmg 15: a Sentry Turret did 11.8 dps to a bear (380hp, 7
       armour), and the whole six-gun line did about 120 dps to a swarm that
       brought four thousand effective hit points and killed a turret in a
       second. A scripted all-in that committed its entire army at 0:25 and gave
       it one attack-move order won at 2:40 — no formation, no screen, no focus
       fire, and not one cast of the only ability in the game. The guns were not
       a reason to approach the compound in a shape; they were scenery with a
       muzzle flash.

       TRIED AND BACKED OUT, and the measurement is left here so the next
       person does not spend the afternoon rediscovering it: at 26 dmg / 3.6
       splash the split-siege guardrail line went from a win to a LOSS at 10:18
       having never committed at all. The reason was not the assault. It was
       that Verdant Hollow's fourth grove sits 19m from the turret at (22,-22)
       and a capture squad has to stand inside its range to take it — so
       doubling turret damage did not make the compound harder to storm, it
       quietly doubled the price of a GROVE. Bloom times for groves 4-6 went
       from 25s / 39s / 49s to 169s / 171s / 471s and the economy never came
       back: income was still under 7/s at nine minutes.

       The gun line does need to threaten a mass — a scripted all-in still wins
       at 2:40 with one attack-move order and no formation, screen, focus fire
       or ability. But the lever has to be one that only bites INSIDE the fence.
       That lever is RULES.turretSpinUp, below: the base number stays where it
       is, and the gun earns its damage by being allowed to keep firing. */
    hp: 460, dmg: 15, rate: 0.85, range: 21, speed: 0, radius: 2.2,
    armor: 4, vision: 27, ranged: true, building: true, splash: 2.6,
    projectile: { color: 0xff8a3d, speed: 110, size: 0.25 },
  },
  depot: {
    name: 'Security Depot', team: TEAM.MACHINE, icon: '🏭',
    hp: 800, radius: 5.5, armor: 4, building: true, spawnEvery: 18,
  },
  pump: {
    name: 'Intake Pump', team: TEAM.MACHINE, icon: '🚱',
    hp: 520, radius: 3.4, armor: 3, building: true, pump: true,
  },
  generator: {
    name: 'Generator Bank', team: TEAM.MACHINE, icon: '⚡',
    hp: 700, radius: 3.6, armor: 3, building: true, powers: true,
    blurb: 'Everything with a barrel on this campus runs off these. Cut the power and the guns go quiet.'
  },
  well: {
    name: 'Deep Well', team: TEAM.MACHINE, icon: '🕳',
    hp: 480, radius: 2.8, armor: 2, building: true, well: true,
    blurb: 'Groundwater. It keeps pulling long after you have smashed every intake on the surface.'
  },
  coolant: {
    name: 'Coolant Tower', team: TEAM.MACHINE, icon: '🌀',
    hp: 1300, radius: 4.6, armor: 2, building: true, critical: true,
  },
  core: {
    name: 'Server Core', team: TEAM.MACHINE, icon: '🧊',
    hp: 3000, radius: 9, armor: 8, building: true,
  },
  wall: {
    name: 'Perimeter Wall', team: TEAM.MACHINE, icon: '🧱',
    hp: 320, radius: 4, armor: 6, building: true, wall: true,
  },

  /* ---- NEUTRAL / PLAYER STRUCTURES ---- */
  hearttree: {
    name: 'Heart Tree', team: TEAM.WILD, icon: '🌳',
    hp: 4200, radius: 6.5, armor: 3, building: true,
    /* Range MUST exceed the guard standoff or the tree never fires a shot.
       A guard (range 17) halts at 17 + tree radius 6.5 = 23.5m from centre, and
       the tree's reach is `range + target radius`. Anything under ~24 here makes
       the Heart Tree a decorative punching bag. */
    dmg: 25, rate: 1.25, range: 24, ranged: true,
    projectile: { color: 0x9bff6a, speed: 55, size: 0.22 },
    blurb: 'Your base. Flings thorns at anything machine that comes close.',
  },
  grove: {
    name: 'Grove', team: TEAM.NEUTRAL, icon: '🌱',
    hp: 500, radius: 3.2, armor: 2, building: true, capturable: true,
  },
};

/* ---------------------------------------------------------- economy/game -- */
export const RULES = {
  startBiomass:   200,
  baseIncome:     0.7,      // per second from the Heart Tree
  grovIncome:     3.2,      // per second per bloomed grove
  captureTime:    3.0,      // seconds standing on a grove
  /* --- Losing a grove is slower than taking one ----------------------------
     MEASURED across two full matches: end screens read "bloomed at peak 3/6,
     bloomed in total 15" and "4/6, in total 13". The player re-bloomed groves
     thirteen to fifteen times to hold three or four, because decapture ran at
     the SAME rate as capture — so one guard drifting within 7m flipped a grove
     in three seconds flat and locked it out for eighteen more. The warning
     toast fires the instant the contest starts, which gave three seconds of
     runway to cross a 240m map. That is not an intercept decision, it is a
     chore performed a dozen times a match.

     One machine now needs ~8.6 seconds, which is long enough that the toast is
     actually actionable. But a real trample crew still takes it fast: the rate
     scales with how many machines are standing on it, and the landscaping
     detail (RULES.detailMax = 4) reaches full speed — so ignoring a detail
     still costs the grove in three seconds, and the intercept the dormancy
     rule is trying to create keeps its price. */
  decapBase:      0.35,     // capture-seconds undone per second by ONE machine
  decapPerExtra:  0.22,     // ...and per additional machine, to a cap of 1.0
  popCap:         96,
  machinePopCap:  16,
  garrisonGuards: 7,        // scaled by difficulty alongside machinePopCap
  garrisonDrones: 3,
  waveCapMult:    2.0,      // a sweep may surge to this multiple of the standing cap
  /* Raised from 108 once sweeps started actually ARRIVING. Raiders used to muster
     inside their own fence and wedge in the north-west corner, so a large share of
     every wave never reached the valley at all; with that fixed, the old cadence
     killed a passive player in 6:19 against a 7-8 minute target. This restores the
     pace by sending slightly FEWER sweeps, not weaker ones — a sweep that lands
     still lands at full strength, which is the whole point. */
  waveEvery:      120,      // seconds between machine sweep attacks
  /* Raised from 95 to pay back what the escort protocol took. Massing the home
     strike into a column turned out to help a sweep even against an EMPTY
     valley — fewer raiders get picked off strung out, so more of them live to
     shoot — and true-passive death measured 6:39 / 6:39 / 6:38 against a
     6:45-8:00 target. Buying the time back out of the opening lull is the one
     adjustment that costs the home strike nothing: it delays every sweep by the
     same ~12s and changes neither how big one is nor how hard it lands. */
  firstWaveAt:    110,

  /* --- Escort protocol: the half of a sweep that goes for your base ---------
     MEASURED, before this existed: the split-siege bot won 8 runs out of 8 and
     the Heart Tree never once dropped below 3244/4200. A SIX-POP garrison —
     three boars — held the base for a whole match. The design is sold as "defend
     while you attack" and the game was not asking the question.

     Two things were wrong, and neither of them was the size of a sweep.

     First, the strike arrived STRUNG OUT. Drones move at 12 and guards at 6.4,
     so a sweep that left the gate together reached the tree across a ~39m,
     ~10-second smear. The Heart Tree (20 dps, 24m reach, free, never reloads)
     met that smear a few raiders at a time and beat it: measured, it killed four
     of nine raiders inside ten seconds of contact with NO garrison present at
     all. The tree was the garrison; the animals parked next to it were
     decoration.

     Second, the share sent home was a flat two thirds regardless of what the
     player had actually left behind, so stripping the valley bare cost exactly
     as much as garrisoning it properly. "Can I afford to leave" had no answer
     attached to it.

     Both levers move mass AROUND inside a sweep. Neither makes a sweep bigger,
     and neither makes one arrive sooner. That matters: a true-passive player
     already dies at 6:48, at the very bottom of the 6:45-8:00 target, so there
     is no room to add pressure that lands on somebody who never left home.

     MEASURED AFTER, one wave-3 sweep against a fixed garrison, three paired runs
     per arm on one map (spread of each arm was under +/-30 damage, so this is a
     mechanism and not a dice roll):

       arrival spread      10.2s  ->  4.7s
       raiders reaching it  13.3  ->  15.0   (fewer picked off strung out)
       Heart damage/sweep    633  ->  1063   at a 16-pop garrison

     ...and the whole point, damage from ONE sweep by garrison size, old vs new:

       guard  4 pop   2646 -> 3504     guard 12 pop    852 -> 1464
       guard  6 pop   2536 -> 3082     guard 16 pop    694 -> 1074
       guard  8 pop   1320 -> 2004     guard 24 pop    244 ->  578

     CORRECTION, and it matters more than the table. Those figures are a sound
     MECHANISM measurement — damage from one isolated sweep against a given
     garrison — and they were then generalised into a match-level claim ("the
     garrison that survives a match moved from ~6 pop to ~16-24") that is NOT
     TRUE of the game as it stands. An adjudicator ran the winning line twice
     with NOBODY home at all, guard fraction zero: WIN at 310.2s and WIN at
     213.6s. A match ends on wave 2, so not enough sweeps land for garrison size
     to decide anything.

     The mechanism is real and worth keeping. The conclusion drawn from it was
     not, and a wrong number recorded as measured is worse than no number —
     the next reader inherits it as settled. What the table actually shows is
     what a garrison is worth PER SWEEP, which only becomes a match-level
     decision if a match lasts long enough to see three or four of them. It
     currently does not. That is the open problem, not this constant. */
  strikeSpread:   26,       // metres a raider may lead its column before it waits
  strikeFormUp:   45,       // ...and the hard deadline on waiting, so nothing stalls
  strikeHomeMin:  0.55,     // share of a sweep aimed at the Heart Tree, valley fully held
  strikeHomeMax:  1.00,     // ...and when the valley has been stripped bare

  /* --- Escort escalation: the sweep answers the size of the swarm ----------
     MEASURED, before this existed (GROVE tier, verdant-hollow, scripted bot):
     an all-in line that left NO home guard at all won at 2:32 with the Heart
     Tree sitting on 4200/4200. It was never touched once. The reason was not
     the size of the garrison and not the share of the sweep sent home — both
     of those levers were already in. It was that a sweep is nine raiders no
     matter what it is walking into, and nine raiders lose to the eighty pop of
     animals coming the other way down the same road.

     Wave 1 of that run, probed every five seconds:
       t= 94   9 raiders on the heart mission, nearest 97m from the tree
       t= 99   5 raiders,                      nearest 84m
       t=105   1 raider,                       nearest 59m
       t=110   0 raiders. Heart Tree 4200/4200.

     A sweep now grows with the swarm it is answering. The bonus keys off the
     player's FIELDED POP — not unit count, and not the garrison — for three
     reasons: it is a number already on the player's own HUD, it is zero for
     somebody who never built anything (so the true-passive death clock is
     untouched by this entirely), and counting the infestation from orbit is
     exactly what TerraByte would be doing. Every escort raider joins the column
     bound for the Heart Tree, because that is what an escort is. */
  /* TUNED, three scripted runs after the mechanism went in (GROVE tier):
     at 0.22/18 a wave-4 sweep was 39 raiders and the split-siege line finished
     a WIN with the Heart Tree on 4 hit points out of 4200. Surviving by four is
     not tension, it is a coin toss, and this project's own rule is that
     outcomes must not feel like luck. Backed off to the numbers below, which
     put a sweep at roughly half that and leave the tree hurt rather than
     decided. */
  /* RE-TUNED, and this is the second time this number has moved, so the reason
     matters more than the value. Playtested at 0.14: across one full 14:52
     winning match the Heart Tree took 4,803 damage, and 2,738 of it — FIFTY
     SEVEN PERCENT — landed inside a single thirty-second window, the one where
     the player first committed away from home. Defence was not an activity. It
     was one scripted invoice, presented once, at a near-fatal price.

     The mechanism is right; the amplitude was wrong. So this trades amplitude
     for FREQUENCY, in two halves that have to be read together:

       · the escort per point of pop comes down (here), so any one sweep is
         survivable rather than decisive, and
       · the campus SCHEDULES sweeps more often the bigger the swarm gets
         (sweepHaste*, below), so the valley is asked "can you afford to be
         away" three or four times a match instead of once.

     Both halves key off fielded pop, both are announced, and both are exactly
     zero for a player who never built anything — which is the constraint that
     rules out simply shortening waveEvery. The passive death clock is the one
     number in this project that must not move. */
  escortPerPop:   0.09,     // extra raiders per point of fielded wildlife pop
  escortMax:      12,       // ...and the ceiling, so this can never run away

  /* --- Sweep cadence: the campus answers the size of the swarm with a ROTA ---
     The frequency half of the trade above. Above a floor of fielded pop, every
     further point shortens the gap to the next sweep, to a hard ceiling.

     MEASURED (GROVE tier, verdant-hollow) — gap between sweeps:
       4 pop (true passive)   98.4s  ->  98.4s   (the floor makes this exact)
       60 pop                 98.4s  ->  83.4s
       96 pop (at the cap)    98.4s  ->  72.4s

     The floor is not a rounding guard, it is the whole safety property: a
     passive valley is under it by construction, so G1's clock cannot move by so
     much as a frame. Read at the moment a sweep launches, off the same fielded
     pop the HUD already shows and the escort already uses. */
  sweepHasteFloor:  24,     // fielded pop below which the rota never changes
  sweepHastePerPop: 0.005,  // ...and how much each point above it compresses it
  sweepHasteMax:    0.36,   // ...and the ceiling on that compression

  /* --- The service road ----------------------------------------------------
     A sweep bound for the Heart Tree used to walk the straight line between the
     compound and the base — which is the same line the player's assault walks
     in the other direction. The two columns met in the middle every single
     time and the sweep, being much the smaller, simply died there (see the
     probe above: no raider got closer than 59m). The player was being defended
     by an accident of geometry rather than by a decision, so "can I afford to
     leave" still had no answer attached to it.

     The home column now marches to a waypoint set off to one side of that
     corridor and only then turns for the tree, so it arrives on a bearing the
     outbound army is not standing on. Nothing about a sweep's size or timing
     changes; it just stops being deleted on the road. The side alternates with
     the sweep number, so it is learnable rather than a dice roll. */
  /* GATED ON THERE BEING SOMETHING TO AVOID, and this gate is not optional.
     MEASURED without it: a TRUE PASSIVE run — no production, no orders, four
     free wolves — died at 3:54 against a 6:45-8:00 target, down from 6:51.
     Routing through one waypoint does not only dodge the player's army, it
     MASSES the column on the way: everybody converges on the same point and
     the sweep lands as a single punch instead of a smear. Against a valley
     with nothing in it that is a straight buff to a sweep, and the passive
     clock is the one number in this project that must not move.

     So the column only takes the service road when there is an army out on the
     direct one. Nobody in the valley, and it walks in the front door exactly as
     it always did. */
  flankAlong:     0.62,     // how far along the compound->base line the turn is
  flankOffset:    52,       // ...and how far off it
  flankMinAway:   8,        // player pop away from the tree before it is worth it

  /* --- Trampled ground -----------------------------------------------------
     A grove that lost its bloom was worth recapturing the instant the last
     raider fell, so ignoring the outriders of a sweep cost nothing at all.
     Trampled soil is now dormant for a while and cannot be re-taken until it
     recovers, which is what makes an outrider worth intercepting. Kept short:
     at 30s a player who cannot yet defend a grove loses the economy outright
     (measured: income at 2:00 fell from 14.2/s to 8.95/s), and a squeeze you
     cannot answer is not a decision. */
  groveDormant:   18,

  /* --- The landscaping detail ----------------------------------------------
     Something has to happen between sweeps. Measured on a winning run: from
     2:00 to 3:08 the machine unit count never moved, no raider was on a
     mission, the build queue was empty at every sample, and not one line of
     comms fired — sixty-eight seconds in which the only thing on screen that
     changed was a number going up.

     So at the half-cycle a small crew leaves the compound for the player's
     nearest bloomed grove and starts trampling it. It is small enough that four
     wolves settle it, and it only exists if the player owns a grove — which
     means it can never appear in a true-passive run, and the death clock is
     untouched. Ignore it and the grove goes, and trampled ground stays dormant,
     so the choice has a price on both sides of it. */
  detailGuards:   2,        // crew size at the first half-cycle...
  detailDrones:   1,
  detailGrowth:   1,        // ...and extra guards per sweep already launched
  detailMax:      4,        // ...but it never becomes a second sweep

  /* --- Demolition buys time ------------------------------------------------
     Measured: G1 true passive died at 6:51 and an all-in that fought for four
     straight minutes died at 6:50. Aggression bought exactly one second,
     because the wave timer was the only clock in the game and nothing the
     player did on the board moved it. Every depot levelled now pushes the next
     sweep out, so tearing the campus down reads as time bought rather than as
     score. */
  depotWaveDelay: 0.25,     // fraction added to waveEvery per depot destroyed

  /* --- Site works: the campus is not waiting for you -----------------------
     MEASURED across a full winning match: the pop bar reads 96/96 with an EMPTY
     build queue from 4:15 onward while biomass climbs 307 -> 683, and between
     2:30 and 5:45 the Heart Tree took twelve points of damage. Two sweeps
     arrived in that window and both were annihilated without a single order.
     Nine of fifteen minutes were "build, A-move, wait", and the dead stretch
     sits precisely between the moment the army is finished and the moment the
     compound is worth attacking.

     It cannot be closed from the sweep side: a true-passive valley already dies
     at 6:49 against a 6:45-8:00 target and there is no headroom whatsoever.

     So it closes from the COMPOUND side. TerraByte keeps building. Each entry
     is announced `notice` seconds before the concrete goes in, naming what and
     where, so a player sitting on a full army and an unspendable wallet at 4:30
     has a deadline on screen to race rather than a vibe to wait out. The works
     make the objectives measurably worse: a second intake means every pump you
     break is a smaller share of the draw, and a new gun on the approach face is
     a new gun on the approach face.

     Deliberately NOT a threat to a passive player — nothing here walks to the
     valley — so the death clock does not see this list at all. Maps that carry
     their own `construction` timer (the groundbreak sites) skip it: they are
     already a race against a building site and do not need two. */
  worksNotice:    30,       // seconds of warning before a work is raised
  siteWorks: [
    { at: 210, kind: 'pump',
      notice: 'SITE NOTICE — a second Intake Pump is scheduled inside the fence',
      done:   'A second Intake Pump is online — every intake you break is now a smaller share' },
    { at: 300, kind: 'turret',
      notice: 'SITE NOTICE — a Sentry Turret is scheduled on the approach face',
      done:   'A new Sentry Turret is live on the approach face' },
  ],

  /* --- Turret spin-up ------------------------------------------------------
     A Sentry Turret opens at its shipped damage and winds up the longer it is
     allowed to keep shooting, losing the wind-up quickly once it has nothing to
     shoot at. This is the separation the flat damage buff could not make: a
     squad that crosses a turret's arc to take a grove is inside it for three or
     four seconds and barely notices, while an army parked in front of the gun
     line is inside it for twenty and is fighting a very different weapon.

     It is also a thing the player can watch happen — the housing glow swells as
     the gun winds up — and it prices two tools that had no price before:
     Overgrowth resets a smothered turret to cold, and so does a Capybara
     pulling the gun's attention onto something that can take it. */
  turretSpinUp:   10,       // seconds of unbroken fire to reach full wind-up
  turretSpinMax:  2.4,      // ...and the damage multiplier once it is there
  turretSpinDown: 3.5,      // wind-up bleeds off this many times faster
  /* Overgrowth. Priced as a per-fight tool, not a five-wolf decision: at 65 it
     went uncast for whole matches, which is the worst thing an ability can do.
     It also SMOTHERS turrets for its duration — vines in the barrel — so the
     one thing that actually kills a swarm on the approach is no longer immune
     to the only spell the swarm has. That reuses the generator's power-out
     gate, so "those guns are off" already reads on screen. */
  /* --- Deepen the Roots (the late-game biomass sink) -----------------------
     Measured before this existed: a competent player hit 96/96 pop at 3:15 of a
     7:00 match and the build queue was EMPTY at every sample from then on, while
     biomass climbed 402 -> 1784 with income still running 6-8/s. Fifty-four
     percent of the match was spent discarding the entire economy, and matches
     ended holding 1958-2344 unspendable biomass. The cap was a wall, not a
     decision.

     Roots convert that surplus back into army, at a price that climbs steeply
     enough to stay a real question: the first is cheap relative to a late-game
     wallet, the fifth costs more than a full rebuild. Deliberately capped — this
     is a release valve for a stalled economy, not a route to an unbounded swarm,
     and 96 remains the number the whole roster is balanced around. */
  rootsCost:      140,      // price of the first Deepen the Roots
  rootsGrowth:    1.55,     // each one costs this much more than the last
  rootsStep:      6,        // popCap gained per purchase
  rootsMax:       5,        // ...and how many the valley will bear

  spellCost:      40,
  spellCooldown:  26,
  spellRadius:    16,
  spellDuration:  5,

  /* --- Thermal runaway -----------------------------------------------------
     Killing the last coolant tower used to hand the player an exposed Core and
     nothing else: technicians welded it back to 3000/3000 faster than a swarm
     could chew through armour 8, so the "objective" was a health bar that
     regrew. Now the last coolant starts a clock. The Core cooks itself from
     full in this many seconds, cannot be repaired, and the HUD counts it down —
     so coolant kills are permanent progress and the endgame is a race the
     player can see rather than an attrition slug they cannot win.

     Deliberately slower than a committed assault: killing it yourself is still
     much faster and still the point. This only guarantees the match ENDS. */
  /* CUT from 240. Measured on a full winning run: the last coolant fell at
     12:51 — the loudest, best-earned moment of the match — and then the Core
     ticked itself down from 2989 to 1857 across ninety seconds in which the
     game asked the player for nothing at all, before the army walked over and
     deleted the last 1,664 by hand. The four-minute countdown that was supposed
     to be a finale functioned as dead air between the real climax and the real
     ending, and was then mostly bypassed anyway.

     At 90 the clock is a sprint the player races rather than a bar they wait
     out, and it still is not the fast way to finish: a committed army kills a
     naked Core in about thirty seconds. This only guarantees the match ENDS. */
  runawaySeconds: 90,

  /* How long a machine structure must go unhit before a Field Technician will
     weld it. Mirrors regenDelay, which is the player's own out-of-combat rule —
     the machine's repair had no combat gate at all, so a fully disarmed
     compound was literally unkillable. */
  techRepairDelay: 5,

  /* --- Structural damage (scarring) ----------------------------------------
     The adjudicator's finding, and the one thing this project's design rule
     forbids: outcomes were bimodal because a FAILED PUSH LEFT NO MARK. The
     technicians restored every coolant you did not finish while your dead army
     stayed dead, so fewer bodies meant lost groves meant less income meant a
     smaller army — a spiral that only ran one way, with no comeback anywhere.

     A quarter of all damage dealt to a machine structure is now structural: it
     cannot be welded out. Four failed assaults leave a coolant at roughly 40%
     of its original ceiling, so the third attempt is genuinely easier than the
     first and a push that dies short still bought something. */
  scarFraction:   0.25,
  /* --- Mend stacking -------------------------------------------------------
     MEASURED: three Beavers (32 biomass, 2 pop each) parked at the Heart Tree
     healed it at roughly 40 hp/s, took it from 1023/4200 back to full in under
     two minutes, and out-healed a fifty-eight-machine sweep in real time while
     that sweep stood on top of it. Ninety-six biomass and six pop undoing an
     entire wave is the most cost-effective purchase in the game by an order of
     magnitude, and it made the whole defensive question optional.

     Menders on the SAME structure now fall off geometrically, so the answer is
     "bring a beaver", not "bring six": one gives 14 hp/s, two 21, three 24.5,
     and no number of them ever exceeds 28. A beaver spread across separate
     structures is unaffected, which is the behaviour worth encouraging anyway.

     Fixed together with the toast in world.js that tells the player the Heart
     Tree does not heal itself. Pricing a tool nobody can find just makes it
     strictly worse, so discoverability shipped in the same change. */
  mendStack:      0.50,     // each additional mender on one structure, vs the last
  /* --- The Green (creep) ---------------------------------------------------
     A swarm of individually weak things only works if losing bodies is
     survivable and hurt bodies come back. Both live here. Regeneration is
     gated on being out of combat so it never wins a fight for you -- it only
     saves you the biomass of rebuilding between fights. */
  regenDelay:     5,        // seconds out of combat before healing starts
  regenOnGreen:   0.040,    // fraction of max HP per second, on the Green
  regenOffGreen:  0.008,    // ...and out in the world, where you are alone
  greenHaste:     1.18,     // movement multiplier on the Green

  /* --- Watered (drinking) --------------------------------------------------
     The Green sustains you AT HOME; water sustains you AWAY from it. An animal
     that stops at a shore carries off a short, potent buff, so lakes become
     staging points on the route to the compound rather than scenery.

     Deliberately short: this is a decision about WHEN to commit, not a chore to
     keep topped up. Duration scales with how full the lake is, which is what
     finally makes TerraByte's pumps something the player feels rather than
     something that quietly edits their income.

     PRICED: Watered SUPPRESSES regeneration for its whole duration (see
     Entity.regen). The buff is a stimulant, not a rest stop — you cannot drink
     and heal at the same time, so drinking a hurt swarm costs it the recovery
     it was about to get. Without that, the lake being on the route made
     drinking free, and a free 1.38x damage swing is not a decision. */
  drinkTime:      1.8,      // seconds at the shore to drink
  drinkMin:       12,       // buff seconds from a nearly-dry lake
  drinkMax:       26,       // ...and from a full one
  wateredRate:    1.20,     // attack speed while Watered
  wateredDmg:     1.15,     // damage while Watered
  wateredSpeed:   1.10,     // movement while Watered
};

export const BUILDABLE = ['wolf', 'capybara', 'boar', 'bear', 'raven', 'porcupine', 'beaver', 'local'];
