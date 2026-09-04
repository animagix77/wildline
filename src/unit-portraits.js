/* Small, consistent field-guide portraits. Inline vectors also ship offline. */
export const UNIT_ROLES = { wolf: 'Fast melee', capybara: 'Frontline', boar: 'Armoured', bear: 'Siege', raven: 'Flying', porcupine: 'Ranged', beaver: 'Engineer', local: 'Marksman' };
const PORTRAIT_PATHS = {
  wolf: '<path fill="#98a99d" d="M8 7 18 12 29 6 33 25 24 36 13 30 7 19Z"/><path fill="#485e55" d="m10 10 6 6-7 4m19-10-5 7 7 4"/><path fill="#e2e7cf" d="m12 22 11-4 8 7-8 10-9-6Z"/><path fill="#192e28" d="m22 26 7-1-4 5-4-1Z"/><path d="m15 20 3 1m8-3 3-1"/>',
  bear: '<circle fill="#6b5845" cx="11" cy="10" r="6"/><circle fill="#6b5845" cx="29" cy="10" r="6"/><path fill="#927650" d="M7 14 14 8 27 9 34 19 31 31 21 36 9 30Z"/><path fill="#c3ac7c" d="m14 24 9-6 8 7-5 8-11-1Z"/><path fill="#29342b" d="m20 24 7-1-1 5-5 1Z"/><path d="m12 19 3 1m11-3 3 1"/>',
  boar: '<path fill="#735a49" d="m6 8 11 6 12-7 5 20-11 9L9 30 5 18Z"/><path fill="#af8868" d="m12 23 13-4 9 9-10 7-12-4Z"/><ellipse fill="#d0a581" cx="26" cy="28" rx="8" ry="5"/><path fill="#eee7c9" d="m12 29-2-9 7 9m16-2 3-9-1 13Z"/><path d="m14 19 4 1m6 7v2m5-3v2"/>',
  capybara: '<path fill="#b09263" d="m7 13 10-6 12 7 6 10-5 10-19-2-7-8Z"/><circle fill="#846b4b" cx="11" cy="12" r="4"/><circle fill="#846b4b" cx="25" cy="11" r="4"/><path fill="#d1b581" d="m14 22 15-2 6 6-5 7-16-2Z"/><path d="m12 19 3 1m10-3 3 1m0 8 3 1m-12 4h9"/>',
  raven: '<path fill="#536c70" d="m4 27 11-12 8-8 8 6-2 9-10 13-5-6Z"/><path fill="#263e43" d="m5 27 14-9 6 5-8 12Z"/><path fill="#c8ba85" d="m28 14 10 5-12 3Z"/><path fill="#93aeb0" d="m15 17 6-7 7 2-5 3Z"/><circle fill="#eadbb3" cx="26" cy="15" r="1.4"/>',
  porcupine: '<path fill="#d1bc87" d="m3 25 1-13 5 7 1-16 6 14 5-14 3 15 8-12-1 17 8-5-5 15-17 4Z"/><path fill="#665d46" d="m7 24 9-7 13 4 6 10-13 6-13-4Z"/><path fill="#ab9670" d="m22 24 10 2 6 7-13 2-5-5Z"/><path d="m26 28 2 1m6 3h2"/>',
  beaver: '<path fill="#786449" d="m5 17 8-10 15 3 7 12-4 12-17 2-9-8Z"/><circle fill="#a1865e" cx="10" cy="12" r="4"/><circle fill="#a1865e" cx="28" cy="13" r="4"/><path fill="#c0a878" d="m12 23 15-4 6 7-5 7-14-1Z"/><path fill="#efe6c9" d="m19 28 8-1-1 9-6 1Z"/><path fill="#303d30" d="m20 23 8 1-3 5-5-1Z"/><path d="m12 20 3 1m13-3 2 1m-7 12v5"/>',
  local: '<path fill="#b5a079" d="m12 10 16 1 3 15-9 9-12-8Z"/><path fill="#547062" d="m5 15 7-9 16 1 7 11-16-3Z"/><path fill="#9a754f" d="m10 23 11 7 10-5-3 10-13 1Z"/><path d="m14 20 3 1m8-1 3 1"/>',
};
export function unitPortrait(type, fallback = '•') {
  const shape = PORTRAIT_PATHS[type];
  return shape ? `<svg class="unit-portrait" viewBox="0 0 40 40" aria-hidden="true"><g stroke="#25382b" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>` : fallback;
}
