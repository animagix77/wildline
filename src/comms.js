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
  overgrowth: [
    'Legal is reviewing whether roots constitute trespassing.',
    'Facilities reports the floor is now "load-bearing salad".',
    'We have escalated the vine situation to a cross-functional task force.',
  ],
  wall: [
    'A section of our perimeter has embraced open-plan.',
    'That wall was scheduled for demolition anyway. By us. Later.',
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
  heartLow: [
    'TerraByte extends its condolences in advance.',
    'Our expansion roadmap has never looked greener. Or closer.',
  ],
};

let queue = [];
const used = {};
let cooldownUntil = 0;
let commsEl = null, timer = 0;

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
  timer -= dt;
  if (timer > 0 || !queue.length) {
    if (commsEl && timer < 1.2) commsEl.classList.remove('on');   // slide out ahead of the next one
    if (timer > -8) return;                             // minimum gap between statements
  }
  if (!queue.length) return;
  const line = queue.shift();
  const box = ensureEl();
  box.querySelector('.comms-line').textContent = '“' + line + '”';
  box.classList.add('on');
  timer = 7;
}
