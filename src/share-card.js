/* Judge Dean LLC — local result cards and explicit, player-initiated sharing. */
import { G } from './state.js';
import { DEFS } from './config.js';

const SHARE_RAID_IDS = new Set(['first-raid', 'beaver-raid']);
const GAME_PUBLIC_URL = 'https://animagix77.github.io/wildline/';

export function raidURL(id, { publicLink = false } = {}) {
  const url = new URL(publicLink ? GAME_PUBLIC_URL : location.href);
  url.search = '';
  url.hash = '';
  if (SHARE_RAID_IDS.has(id)) url.searchParams.set('raid', id);
  return url.href;
}

function resultDetails(win, stats) {
  const raid = G.raid;
  const hero = raid?.hero;
  const survivor = hero?.alive;
  const species = hero ? (DEFS[hero.type]?.name || 'Beaver') : '';
  const heroName = raid?.heroName || hero?.nickname || species;
  const seconds = Math.max(0, Math.floor(stats?.timeSec || 0));
  const mode = raid?.title || `${G.map?.name || 'Quick Battle'} · ${G.difficulty?.name || 'Grove'}`;
  const title = win ? (raid?.heroAction ? 'UNSCHEDULED BEAVER MAINTENANCE.' : 'THE VALLEY HAS THE LAST WORD.') : 'THE VALLEY WILL TRY AGAIN.';
  return {
    title, mode, win,
    time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    score: Math.max(0, Math.round(stats?.score || 0)),
    lost: Math.max(0, Math.round(stats?.unitsLostTotal || 0)),
    hero: hero ? (heroName === species ? species : `${heroName} the ${species}`) : '',
    heroState: hero ? (survivor ? 'Survived the raid.' : 'Remembered by the valley.') : '',
    action: raid?.heroAction || '',
    url: raidURL(raid?.id || 'beaver-raid', { publicLink: true }),
  };
}

/* All art is drawn here: the card works offline and never captures private UI. */
export function createResultCard({ win, stats }) {
  const data = resultDetails(win, stats);
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser.');
  const gradient = ctx.createLinearGradient(0, 0, 1200, 800);
  gradient.addColorStop(0, '#203a2d'); gradient.addColorStop(1, '#071510');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800);
  ctx.strokeStyle = '#78915e'; ctx.lineWidth = 2; ctx.strokeRect(24, 24, 1152, 752);
  ctx.fillStyle = '#b4d887'; ctx.font = '600 19px sans-serif';
  ctx.fillText('CRITTERS VS COMPUTE  /  FIELD REPORT', 66, 87);
  ctx.fillStyle = '#f0efdf'; ctx.font = '800 50px sans-serif';
  const lines = data.title === 'UNSCHEDULED BEAVER MAINTENANCE.'
    ? ['UNSCHEDULED', 'BEAVER MAINTENANCE.']
    : data.win ? ['THE VALLEY HAS', 'THE LAST WORD.'] : ['THE VALLEY', 'WILL TRY AGAIN.'];
  lines.forEach((line, i) => ctx.fillText(line, 66, 170 + i * 61));
  ctx.fillStyle = '#acbba5'; ctx.font = '24px sans-serif'; ctx.fillText(data.mode, 68, 281, 1030);

  // A beaver portrait, framed like a corporate employee-of-the-month badge.
  const ellipse = (x, y, rx, ry, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  };
  ellipse(936, 465, 158, 158, '#2b4431');
  ellipse(860, 390, 30, 32, '#b39666'); ellipse(1009, 390, 30, 32, '#b39666');
  ellipse(936, 459, 108, 107, '#8c744e'); ellipse(936, 500, 86, 62, '#c4ab76');
  ellipse(893, 449, 8, 10, '#102017'); ellipse(977, 449, 8, 10, '#102017');
  ctx.fillStyle = '#eee7c9'; ctx.fillRect(917, 522, 17, 39); ctx.fillRect(939, 522, 17, 39);
  ellipse(936, 504, 26, 16, '#26382b');
  ctx.fillStyle = '#b4d887'; ctx.font = '600 18px sans-serif';
  ctx.fillText(data.win ? 'CAMPUS OFFLINE' : 'RAID ATTEMPT', 68, 346);
  ctx.fillStyle = '#f0efdf'; ctx.font = '700 69px sans-serif'; ctx.fillText(data.time, 66, 422);
  ctx.fillStyle = '#acbba5'; ctx.font = '20px sans-serif';
  ctx.fillText(`${data.score.toLocaleString('en-US')} points  ·  ${data.lost} wildlife lost`, 68, 466);
  if (data.hero) {
    ctx.fillStyle = '#e5eacf'; ctx.font = '600 24px sans-serif'; ctx.fillText(data.hero, 68, 535, 650);
    ctx.fillStyle = '#acbba5'; ctx.font = '20px sans-serif'; ctx.fillText(data.heroState, 68, 570, 650);
    if (data.action) { ctx.font = '17px sans-serif'; ctx.fillText(data.action, 68, 602, 650); }
  } else {
    ctx.fillStyle = '#acbba5'; ctx.font = '20px sans-serif'; ctx.fillText('Can you do it with only beavers?', 68, 546);
  }
  ctx.strokeStyle = '#4c6446'; ctx.beginPath(); ctx.moveTo(66, 647); ctx.lineTo(1134, 647); ctx.stroke();
  ctx.fillStyle = '#b4d887'; ctx.font = '600 21px sans-serif'; ctx.fillText(G.raid ? 'TRY THE SAME RAID' : 'TAKE THE BEAVERS ONLY CHALLENGE', 68, 688);
  ctx.fillStyle = '#e5eacf'; ctx.font = '19px sans-serif'; ctx.fillText(data.url.replace('https://', ''), 68, 724, 1060);
  ctx.fillStyle = '#91a58a'; ctx.font = '14px sans-serif'; ctx.fillText('Judge Dean LLC  ·  Play free in your browser', 68, 758);
  return canvas;
}

export function addShareActions(container, { win, stats }) {
  const data = resultDetails(win, stats);
  const section = document.createElement('section');
  section.className = 'share-moment';
  const heading = document.createElement('h2'); heading.textContent = data.title;
  section.append(heading);
  const summary = document.createElement('p');
  summary.textContent = `${data.mode} · ${data.time} · ${data.win ? 'Campus offline' : 'Raid attempt'}`;
  section.append(summary);
  if (data.hero) {
    const hero = document.createElement('p'); hero.className = 'share-hero';
    hero.textContent = `${data.hero}. ${data.heroState}${data.action ? ' ' + data.action : ''}`;
    section.append(hero);
  }
  const actions = document.createElement('div'); actions.className = 'share-actions';
  const download = document.createElement('button'); download.type = 'button';
  download.id = 'share-download'; download.textContent = 'Download result card';
  const copy = document.createElement('button'); copy.type = 'button';
  copy.id = 'share-copy'; copy.textContent = G.raid ? 'Copy this raid link' : 'Copy beaver challenge link';
  const link = document.createElement('input'); link.id = 'share-link'; link.type = 'text';
  link.readOnly = true; link.value = data.url; link.hidden = true;
  link.setAttribute('aria-label', 'Playable challenge link');
  const status = document.createElement('p'); status.id = 'share-status';
  status.setAttribute('role', 'status'); status.textContent = 'A card for your friends. No account needed.';
  actions.append(download, copy); section.append(actions, link, status);
  copy.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(data.url);
      status.textContent = 'Raid link copied. Send it to someone who could use a beaver army.';
    } catch (_) {
      link.hidden = false; link.focus(); link.select();
      status.textContent = 'Copy the selected link to share this raid.';
    }
  });
  download.addEventListener('click', () => {
    try {
      const card = createResultCard({ win, stats });
      const a = document.createElement('a');
      a.href = card.toDataURL('image/png');
      a.download = `critters-vs-compute-${G.raid?.id || 'field-report'}-${data.win ? 'victory' : 'attempt'}.png`;
      document.body.append(a); a.click(); a.remove();
      status.textContent = 'Result card ready. Your browser will save the PNG.';
    } catch (_) { status.textContent = 'Image export is unavailable here. You can still copy the raid link.'; }
  });
  container.append(section);
  return section;
}
