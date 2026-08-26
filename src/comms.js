import { G } from './state.js';

/* =========================================================================
   TerraByte Solutions — Corporate Communications.

   The humor layer. As the campus is dismantled, the corporation never stops
   doing PR: every setback in the game triggers a media statement, and the
   statements get more desperate the worse things go. The joke is that the
   voice never breaks — the buildings do.

   commsEvent(name) is fired from world/ai/combat. Statements are queued,
   throttled, and never repeated until a category is exhausted.
   ========================================================================= */

const LINES = {
  start: [
    'TerraByte Solutions is proud to be carbon-neutral by 2087.',
    'Reminder: this facility is a Certified Wildlife-Adjacent Workplace.',
    'TerraByte: Putting the "centre" in "data centre" since Series B.',
    'Our uptime is 99.999%. Our biodiversity impact statement is pending.',
  ],
  grove: [
    'Unauthorized photosynthesis detected in the growth corridor.',
    'We are monitoring reports of "flowers" near our perimeter.',
    'TerraByte respects nature, from a distance, behind a wall.',
    'A community garden has appeared. Legal has been notified.',
  ],
  sweep: [
    'A routine landscaping deployment is underway. Please remain calm.',
    'Our wellness associates are proactively engaging local stakeholders.',
    'Scheduled fauna outreach commencing. Bring your lanyard.',
  ],
  /* Fired when a sweep launches into a valley the player has emptied. This is
     the tell for the escort-protocol share: the sweep is heavier at the door
     BECAUSE the door was left open, and Corporate says so out loud. */
  stripped: [
    'Satellite reports the treeline has gone quiet. Reallocating the escort.',
    'Nobody appears to be home. We are taking the liberty of letting ourselves in.',
    'Facilities notes the Heart Tree is currently unsupervised. Sending the full detail.',
    'Our stakeholders have left the engagement. We will engage the stakeholder they left.',
  ],
  overgrowth: [
    'Legal is reviewing whether roots constitute trespassing.',
    'Facilities reports the floor is now "load-bearing salad".',
    'We have escalated the vine situation to a cross-functional task force.',
  ],
  wall: [
    'A section of our perimeter has embraced open-plan.',
    'That wall was scheduled for demolition anyway. By us. Later.',
  ],
  power: [
    'A brownout is affecting the west wing. And the guns. Mostly the guns.',
    'We are operating on emergency lighting and corporate optimism.',
    'Facilities confirms the generators were, in hindsight, load-bearing.',
  ],
  turret: [
    'We are aware of reports of a tower-shaped outage.',
    'A sentry unit has transitioned to horizontal deployment.',
    'Security coverage remains robust in all directions we still cover.',
  ],
  depot: [
    'Today we said goodbye to a Security Depot. Our thoughts are with its subscribers.',
    'Reinforcement cadence has entered a quiet period.',
    'The depot is fine. The depot is f— [STATEMENT ENDS]',
  ],
  scarred: [
    'Structural review finds the coolant housing is now "characterful".',
    'That damage is load-bearing now. We are calling it a design feature.',
    'Maintenance has downgraded the repair target from "as new" to "standing".',
  ],
  coolant: [
    'Server temperatures remain within accept— within— parameters.',
    'We have initiated our Thermal Resilience Journey.',
    'Have you tried turning the forest off and on again?',
  ],
  coreExposed: [
    'ATTN INVESTORS: everything is fine.',
    'The Server Core enjoys fresh air. This was planned.',
    'We are pivoting to an open-air compute strategy, effective immediately.',
  ],
  local: [
    'We categorically deny that the community dislikes us.',
    'TerraByte loves Milltown. Milltown, please call us back.',
  ],
  water: [
    'The aquifer is performing exactly as modelled. The model is being revised.',
    'Reports of a "missing lake" are being handled by our Narrative team.',
    'TerraByte uses only the water it needs. It needs all of it.',
    'The wetland has been reclassified as a car park in our filings.',
  ],
  build: [
    'Phase two remains on schedule and under budget, unlike the fence.',
    'Hard hats are mandatory beyond this point. So are non-disclosure agreements.',
  ],
  /* Site works: the campus pouring concrete while the player waits. Same
     register as `build`, but these fire in a match that is otherwise silent
     between sweeps, so they carry the weight of "we are not waiting for you". */
  works: [
    'Phase two has broken ground. Wildlife are welcome to observe from a distance.',
    'A permit was filed for this. We filed it. With ourselves. It was approved.',
    'Expansion continues. The valley has been consulted and did not respond in writing.',
    'Please excuse our dust. Please excuse everything, really.',
  ],
  built: [
    'The new site is live. Please direct all wildlife enquiries to the portal.',
    'We are pleased to announce expanded capacity and expanded fencing.',
  ],
  /* Fired on a timer whenever nothing else is queued. Measured on a winning
     run: from 2:00 to 3:08 not one comms line and not one toast appeared, and
     the machine unit count never moved — so the best-written thing in the build
     went silent at exactly the moment the player had nothing else to look at.
     Corporate abhors a vacuum. Same voice, same register, no self-awareness:
     these are things a communications department says when there is nothing
     whatsoever to communicate. */
  idle: [
    'Q3 remains a story of resilience and adjacent green space.',
    'Personnel are reminded that the perimeter is both decorative and structural.',
    'Our Wildlife Liaison position is still open. Applications close Friday.',
    'The campus shuttle will not be stopping at the treeline until further notice.',
    'Compliance wishes to clarify that the badgers are not employees.',
    'We remain the region\u2019s largest employer of security consultants.',
    'Please do not feed anything. Please do not name anything.',
    'This quarter we planted six trees. Elsewhere. In another country.',
    'A reminder that the pond on the site plan is aspirational.',
    'Morale is up, attendance is down, and we are investigating the relationship.',
    'TerraByte is proud to be a good neighbour to whoever remains.',
    'The break room has been relocated to make room for more break room.',
    'All hands is at four. There will be an agenda. There will not be questions.',
    'Our Series C deck describes this valley as "largely empty".',
  ],
  heartLow: [
    'TerraByte extends its condolences in advance.',
    'Our expansion roadmap has never looked greener. Or closer.',
  ],
};

let queue = [];
const used = {};
let cooldownUntil = 0;
let commsEl = null, timer = 0;
/* The lull filler. Deliberately long enough that it never competes with a real
   event — an event line always wins, because a queued statement pushes the idle
   clock back before it can be read. */
const IDLE_EVERY = 34;
let idleAt = IDLE_EVERY;

function commsPick(cat) {
  const list = LINES[cat];
  if (!list) return null;
  used[cat] = used[cat] || [];
  if (used[cat].length >= list.length) used[cat] = [];
  const avail = list.filter((_, i) => !used[cat].includes(i));
  const idx = list.indexOf(avail[Math.floor(Math.random() * avail.length)]);
  used[cat].push(idx);
  return list[idx];
}

export function commsEvent(cat, chance = 1) {
  if (Math.random() > chance) return;
  const line = commsPick(cat);
  if (!line) return;
  if (queue.length >= 2) queue.shift();      // stale statements are dropped, like ours
  queue.push(line);
}

function ensureEl() {
  if (commsEl) return commsEl;
  commsEl = document.createElement('div');
  commsEl.id = 'comms';
  commsEl.innerHTML = '<div class="comms-tag">▦ TERRABYTE SOLUTIONS · MEDIA STATEMENT</div><div class="comms-line"></div>';
  document.getElementById('app').appendChild(commsEl);
  return commsEl;
}

export function updateComms(dt) {
  if (G.phase !== 'playing' || G.over) { if (commsEl) commsEl.classList.remove('on'); return; }
  /* Keep talking through a quiet stretch. Anything already queued resets the
     clock, so this can only ever speak into an actual silence. */
  if (queue.length) idleAt = G.time + IDLE_EVERY;
  else if (G.time >= idleAt) { idleAt = G.time + IDLE_EVERY; commsEvent('idle'); }
  timer -= dt;
  if (timer > 0) {
    if (commsEl && timer < 1.2) commsEl.classList.remove('on');   // slide out ahead of the next one
    return;
  }
  if (commsEl) commsEl.classList.remove('on');
  /* Enforce a real gap between statements. The old guard sat inside a branch that
     could only be reached when it was already returning, so consecutive notices
     ran back to back with no breathing room at all. */
  if (timer > -2.5 || !queue.length) return;
  const line = queue.shift();
  const box = ensureEl();
  box.querySelector('.comms-line').textContent = '“' + line + '”';
  box.classList.add('on');
  timer = 7;
}
