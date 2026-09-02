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
    armor: 2, vision: 26, cost: 13, build: 2.1, pop: 1, death: 'topple',
    blurb: 'Loses to a rifle. Beats three. Bring more than three.'
  },
  boar: {
    name: 'Boar', team: TEAM.WILD, icon: '🐗', key: 'X',
    hp: 125, dmg: 22, rate: 1.25, range: 2.8, speed: 8.0, radius: 1.25,
    armor: 3, vision: 25, cost: 24, build: 3.4, pop: 2, siege: 1.4, death: 'topple',
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
    armor: 4, vision: 25, cost: 20, build: 3.0, pop: 2, death: 'topple',
    /* Taunt biases enemy target selection toward this unit (see acquire()).
       Without it the capybara is merely tanky and the swarm still gets shot
       out from behind it; with it, putting capybaras in front is a real and
       discoverable answer to turret splash. */
    taunt: 20,
    /* SOLACE. The swarm had no in-combat healing of ANY kind: mend() only ever
       targets buildings, and regen() needs five seconds out of contact, so the
       only way to heal a hurt animal was to walk it home and wait. That is a
       large part of why a committed push evaporates and no second army is ever
       fielded -- measured repeatedly, armies peak near 45 and fall to single
       digits without recovering.

       The capybara is the right carrier for it. It already wants to stand at
       the front (taunt), the animals already want to stand behind it, and a
       calm centre that everything else gathers around is what the animal is.
       So the aura rewards the formation the unit was already asking for.

       DELIBERATELY WEAK PER SECOND. A Sentry Turret at full wind-up does about
       42 dps to one target; solace is 3.5 hp/s and stacks at half each, so no
       clump of capybaras ever beats a gun (the cap is ~7 hp/s on one animal).
       It is sustain BETWEEN trades and through chip damage, never a healer
       that wins a fight standing still -- the same lesson mendStack encodes
       for beavers on the Heart Tree. */
    solace: 3.5, solaceRange: 9,
    blurb: 'A wall that walks. Barely fights, soaks punishment, draws the guns off your wolves — and the swarm heals just by staying close to it.'
  },
  raven: {
    name: 'Raven', team: TEAM.WILD, icon: '🦅', key: 'V',
    hp: 48, dmg: 12, rate: 0.55, range: 10, speed: 14, radius: 0.9,
    armor: 2, vision: 30, cost: 26, build: 3.2, pop: 1, flying: true, ranged: true, death: 'fall',
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
    armor: 3, vision: 25, cost: 32, build: 4.5, pop: 2, siege: 1.8, death: 'topple',
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
    /* CUT from 1300, and the cut is the direct consequence of the towers no
       longer dying. At 1300 a tower was priced as a PERMANENT kill: pay it once,
       bank it forever. The meltdown asks for all three down AT THE SAME TIME
       instead, which is a different and much larger bill — measured, a 35-unit
       army that had taken groves and left a garrison could put exactly ONE
       tower down (to 186hp, 342 scar) before it was spent, and the technicians
       had it back to 973 within thirty seconds. Three simultaneous kills at the
       old price is not a hard objective, it is an impossible one.

       CUT AGAIN, 650 -> 450, on a measurement rather than a feeling. At 650 the
       bill for three simultaneous take-downs is 1950 tower-damage; a committed
       34-unit army that had taken groves and left a ten-pop garrison delivered
       about 1300 of it before it was spent — two towers to 0 and 21, and the
       third never touched. 450 puts the bill at 1350, just inside what one
       assault can carry, so the first push arrives with the hold in reach and
       scarring makes the follow-up genuinely cheaper. */
    hp: 450, radius: 4.6, armor: 2, building: true, critical: true,
    /* Goes OFFLINE at zero instead of dying: the tower stays standing and dark,
       and a technician can relight it. See RULES.meltdownSeconds for why the
       objective stopped being a kill. */
    downs: true,
    blurb: 'Knock it offline and it stays down only as long as you hold the ground.'
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
  /* --- WHAT THE OUTCOME VARIANCE ACTUALLY IS (correction) -------------------
     Commit 43a8905 concluded that outcomes are "dominated by compound layout --
     where the third tower sits relative to the other two". THAT IS WRONG, and
     it is recorded here rather than quietly dropped because the same commit
     recommended a whole programme of work on the strength of it.

     Quick battles always load DEFAULT_MAP, and coolant, turret, depot and grove
     positions are authored literals in maps.js. Verified directly: seeds 2001
     and 2006 -- which produced peak heat 0.00 and 0.76 -- have byte-identical
     coolants [[26,-68],[26,-30],[86,-50]], identical turrets, identical groves.
     The layout never varied at all. The seed moves garrison spawn scatter by a
     few metres, unit spawn jitter, and patrol assignment. Nothing else.

     So the real finding is worse and more interesting: a match swings from
     never-starting-a-meltdown to 76% of one on the strength of where seven
     guards happened to stand at t=0. That is chaotic sensitivity, not map
     variety -- a knife-edge somewhere in the middle of the match amplifying a
     few metres into the whole result. Fragility, not depth. */

  /* --- Surge lanes: the comeback the economy did not have -------------------
     Production lanes are one per two bloomed groves, capped at three. That
     solved the rich case — see the note in world.js — and left the poor case
     wide open, which turns out to be the same bug wearing a different hat.

     MEASURED, and reported from a real session with a screenshot: 1148 banked
     biomass, one grove, fourteen animals on the field. One grove is ONE lane,
     so the player could not convert the bank no matter what they queued. That
     is a doom loop with no exit: lose groves -> fewer lanes -> cannot rebuild
     the army -> lose more groves. It is also precisely why no run ever fielded
     a second assault, which is the thing blocking the meltdown rework.

     A bank you cannot spend now opens a lane on its own. Self-correcting by
     construction: the lane exists only while the surplus does, so it cannot be
     farmed as a substitute for taking ground, and it disappears the moment the
     player spends the bank down. Thresholds sit well clear of startBiomass so
     the opening is unchanged. */
  surgeLaneAt:   [420, 820],
  /* Ceiling on parallel production lanes. Was hardcoded at 3 in world.js with a
     note that four "was a promise the economy could not keep" — true at the
     income of the time, when the player held two or three groves. A line that
     actually defends its economy now holds five or six, and the measured
     bottleneck moved: with popCap raised the army still peaked at 45 and
     collapsed to 15 within thirty seconds of committing, never once reaching
     the pop ceiling. Lanes, not population and not money, are what caps a
     swarm's ability to replace losses mid-assault. */
  maxLanes:       4,
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
  /* RAISED from 96. Measured back-to-back on the same bot: peak heat 0.44 ->
     0.63, damage onto the coolant towers 934 -> 1248, match 5:18 -> 6:17. The
     design brief is a swarm that is individually weaker and wins through
     numbers; at 96, with an average pop cost near two, that swarm was 45
     bodies. */
  /* ARMOUR IS SUBTRACTIVE, so it bites hardest on exactly what was killing the
     swarm. Measured: guards do 60% of all damage the player takes and they do
     it in 1648 small hits; a point of armour is therefore worth far more
     against the gun line than against anything else. Buffed on the MANY (wolf
     0->2, raven 0->2, boar 2->3, capybara 3->4, beaver 2->3) and NOT on bear or
     porcupine -- "individually weaker, wins through numbers" means the cheap
     bodies stop evaporating, not that the big ones become unkillable. A test
     arm that pushed bear to 9 left it taking the floor of 1 damage per guard
     hit, which is a different game. */
  /* RAISED AGAIN, 128 -> 280, from a PROFILE rather than a guess. Headless
     frames are not render-gated -- __step runs the water reflection and the
     whole post chain like any other frame -- so these are full frame costs:

       100 wild units (159 entities)   3.45 ms/frame
       200 wild units (259 entities)   6.29 ms/frame
       300 wild units (361 entities)   9.18 ms/frame

     Linear, about 0.029 ms per additional unit. At an average pop cost near
     two, 280 buys roughly 140 animals for ~4.5 ms/frame, leaving most of a
     60fps budget free even on hardware several times slower than this one.

     CAVEAT, because it matters: performance.now() around a draw call measures
     CPU submit time, not GPU completion, so this bounds the CPU side only. A
     machine that struggles will be GPU fill- or draw-call-bound, which this
     profile cannot see.

     SEPARATELY: in bot runs the ECONOMY binds long before the pop cap does --
     armies peaked at 45 units with the cap at 128 and never came near it.
     Raising the ceiling does not raise the floor. */
  popCap:         280,
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

  /* --- Meltdown: the Core dies to a HOLD, not to a kill ---------------------
     THE PROBLEM THIS REPLACES. Coolant kills used to be permanent, so the whole
     match was a one-way ratchet: three towers down, shield off forever, Core
     cooks itself on a 90s clock. Nothing the compound did could take a metre
     back. That is why the design's own premise never bound — "should I leave
     some at home?" had no cost attached to saying no, because progress banked
     while you were away could not be lost. Measured on the pinned clock: the
     all-in guardrail (nobody home at all) WON at 5:17, and 15/15 offensive
     variants won. The good line was unlosable.

     A coolant tower now goes OFFLINE at zero rather than dying (def.downs). It
     stays standing, dark, and a Field Technician can bring it back. The Core
     overheats only while ALL of them are offline at once, so the ending is a
     window the player has to hold open with the compound actively trying to
     shut it — which is exactly when the valley is emptiest and the sweep that
     splits off for the Heart Tree is landing. That is the question the design
     was always selling and has never once asked.

     Nothing is lost by failing the hold. Heat bleeds back at a fraction of the
     fill rate (not instantly), and scarring means every take-down is cheaper
     than the last, so a hold that breaks at 80% is real progress, not a reset.

     meltdownSeconds is DELIBERATELY short. This is a climax, not an endurance
     test: long enough that the compound gets to fight for it, short enough that
     a player who has genuinely won the fight is not made to stand around.

     LENGTH SET FROM WHAT AN ARMY CAN ACTUALLY HOLD, not from taste. Measured
     across ten full runs: a player fields ONE assault army per match (peaks
     around 45 units, then settles near 10 and never rebuilds to strike
     strength), and that army holds the towers for 14-22 seconds before it is
     spent. A 45-second hold at half rate is a 90-second bar. Nobody was ever
     going to clear it, which is why every good-line run ended the same way — a
     hold that began, reached 16-25%, and died. */
  /* 30 -> 20, and this is the number that produced this project's first
     measured WIN. Calibrated to what an army can actually hold, on a
     zero-noise paired test: across every configuration tried, the swarm took
     two towers, held them, and peaked at 0.58-0.66 heat before it was spent.
     At meltdownSeconds 30 that is a ~20-second hold against a 30-second bar --
     always short, and never by much. Pricing the bar at the measured hold
     turns the same assault into a finish rather than a near miss.

     PAIRED RESULT, three seeds, identical in every other respect:
       baseline      heat 0 / 0    / 0.66   0 wins
       meltdown 20   heat 0 / 0    / 1.00   1 win
       + armour      heat 0 / 0.99 / 0.87   mean heat 0.22 -> 0.62 */
  meltdownSeconds:  20,
  /* How many towers must be offline before the Core starts cooking, and how
     much faster it cooks once MORE of them are.

     ALL THREE AT ONCE was the wrong bar and the measurement is unambiguous. It
     prices the objective at 1350 tower-damage delivered simultaneously across
     three positions inside a defended compound; a committed army that has taken
     groves, kept beavers on the Heart Tree and cast Overgrowth measurably
     delivers about 700 before it is spent. Every run stalled the same way — two
     towers down and held, the third never touched — and the good line lost at
     5:09, 6:03 and 8:03. A gate nobody can reach is not difficulty, it is a
     wall with a countdown painted on it.

     Two-of-three starts the meltdown at half rate: a real hold, reachable by a
     real army, and still long enough (90s) that the compound gets to fight for
     it. The third tower is then an ACCELERANT rather than a gate — taking it
     doubles the rate and turns a grind into a finish — which is a much better
     shape for the last tower anyway, because it makes the hardest one to reach
     the one that actually decides the match. */
  /* --- Cooling is CONTINUOUS, and this is the fix for the knife-edge --------
     THE MEASUREMENT. Two seeds on the identical authored map, differing only in
     where the garrison happened to spawn: their grove and income curves are
     almost the same (both 6 -> 4 -> 3 -> 2 -> 1 -> 0), and at t111 one had 42
     animals and the other 47. That five-unit gap produced peak heat 0.00 versus
     0.76. One match never started a meltdown; the other got three quarters of
     the way to winning.

     The cause was a STEP FUNCTION. Cooling counted standing towers, so a tower
     at 1hp cooled exactly as well as a tower at full and 90% of an assault paid
     nothing at all. Being ten percent short of a threshold returned zero, which
     is what turned a few metres of spawn scatter into the whole result -- and
     it is the same "a failed push must leave a mark" principle as scarFraction,
     which this violated at the level of the objective itself.

     Cooling is now the sum of each tower's remaining health fraction. Damage
     counts the instant it lands, the Core warms as the towers are worn down,
     and taking one fully offline is simply the biggest single step available
     rather than the only one that exists.

     SET FROM MEASUREMENT, not from taste. Instrumented the lowest cooling
     fraction an assault ever forces, across three out-of-sample seeds:

       s2003  coolMin 0.603
       s2001  coolMin 0.569
       s2006  coolMin 0.333

     So a committed swarm wrecks between a third and two thirds of the plant.
     A line at 0.34 caught none of them and a line at 0.50 caught one; both were
     step functions wearing a smaller costume. At 0.65 every one of those
     assaults warms the Core, and because the rate scales with the DEPTH below
     the line the reward is proportional: wrecking 40% of cooling is a slow
     creep, stripping two thirds is a genuine race. Heat also barely bleeds off
     (coolRecovery), so the creep accumulates across a long match instead of
     being wasted. */
  meltdownCool:     0.65,   // total cooling fraction below which the Core warms
  meltdownAt:       2,      // (legacy) towers offline before the Core cooks
  /* Full rate at TWO, not three — so the bar a single army can reach is the bar
     that finishes the job. The third tower is still worth taking: the rate is
     down/meltdownFullAt, so three-of-three cooks at 1.5x and turns a 30-second
     hold into a 20-second one. Accelerant, not gate. */
  meltdownFullAt:   2,
  /* Heat barely bleeds off at all, and that is the single most important number
     in the endgame. It makes the meltdown CUMULATIVE across a whole match
     rather than a one-perfect-window puzzle.

     MEASURED at 0.5: a competent line — groves taken, beavers mending the
     Heart, Overgrowth cast on raiders, a fourteen-pop garrison — fought to wave
     5 and 8:03, scarred all three towers, got every tower offline at once, and
     peaked at 22% heat before the emergency welders relit one. Ten seconds of
     hold. Then all of it drained away and the match was unwinnable despite the
     player doing everything the design asks for.

     At 0.12 those holds still drained faster than a rebuilt army could return:
     measured, a hold that reached 55% was back down to 22% two minutes later
     and the second assault started from nothing.

     THE DECISIVE MEASUREMENT. With the objective made almost free — one tower
     offline for a full-rate meltdown — the good line STILL lost, peaking at 55%
     and collapsing. So the objective was never what was stopping the player: a
     42-unit army loses 31 units in thirty seconds inside the compound, and the
     old permanent-kill design simply HID that, because damage banked forever
     and you could lose three armies and still be ahead. Take the hiding place
     away and the underlying army-versus-gun-line trade is what decides matches.

     So heat banks too, at 0.03 — near-latching, deliberately the same shape as
     scarFraction. A push that dies short still bought something, and the match
     becomes a campaign against the Core across several assaults instead of one
     perfect window nobody can hold. This does NOT fix the army trade; it stops
     that trade from silently deciding the match on its own. */
  coolRecovery:     0.03,
  /* An offline tower welded back to this fraction of its (scarred) ceiling comes
     back online and stops the meltdown.

     RAISED from 0.30, which was far too cheap to be counterplay. At repair 16/s
     a single technician brought a 330-ceiling tower back over a 30% bar in
     about two seconds; measured, three of them relit BOTH downed towers inside
     sixteen seconds and ended a hold at 20%. A tower that works again after two
     seconds of welding is not a repair, it is a light switch, and it made the
     hold impossible to sustain no matter how well the player fought for it.

     At 0.85 the compound has to actually rebuild the thing, which takes long
     enough that killing the welder is a real answer — and killing the welder is
     the entire counterplay the meltdown is built around. */
  coolantRelight:   0.85,
  /* A tower that has just been knocked over cannot be relit for this long, no
     matter how many technicians stand on it.

     This is what makes SEQUENTIAL play possible, and without it the objective
     was arithmetic nobody could do. "All three offline at once" sounds like one
     requirement; with instant relighting it is really "deal 1350 damage spread
     across three positions inside a defended compound before any of it decays",
     and measured, a committed 35-unit army got two towers low and never touched
     the third. The lockout turns that back into the thing a player actually
     does: knock them over one at a time and chain the windows.

     Deliberately SHORTER than meltdownSeconds. The first tower's lockout has
     expired by the time the third goes down, so the technicians are free to
     start relighting the moment the hold begins — the player gets a realistic
     path to the all-down state and still has to fight to keep it. */
  coolantLockout:   25,

  /* --- Emergency response: what makes the hold a FIGHT and not a wait --------
     The hold only asks a question if the compound is trying to break it. It was
     not: technicians come from Security Depots and are capped at two, so a
     player who razed the depots on the way in — which is the normal, correct
     line, since depots delay sweeps — would face literally no repair response.
     The ending would have been a 45-second wait with the outcome already known,
     which is the exact failure mode this whole rework exists to remove.

     So a meltdown triggers a response the player cannot pre-empt by demolition:

     1. The Core itself dispatches technicians while it cooks. Slower than a
        depot and hard-capped, so razing depots still MATTERS (it halves the
        rate) without switching the counterplay off entirely.
     2. Every raider in the field turns around.

     (2) is the important one, and it is what makes the wave clock a tool rather
     than a threat: start the hold just after a sweep leaves and you have most
     of a minute before it can be back on top of you. Start it with a sweep
     still mustering and you are holding against the whole compound. The HUD has
     always shown "next sweep" and it has never once been something the player
     could USE. Now the single most important decision in the match is read off
     a number that was already on screen. */
  emergencyEvery:   9,      // seconds between Core-dispatched technicians
  emergencyTechs:   4,      // hard cap on live technicians during a meltdown

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
  solaceStack:    0.50,     // each additional capybara healing one animal, vs the last
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
