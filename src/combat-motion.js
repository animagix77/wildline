/* Seconds, at the existing attack cadence. Damage lands at the windup boundary. */
export const ATTACK_MOTION = {
  wolf: { windup: .13, recovery: .25 }, boar: { windup: .22, recovery: .34 },
  bear: { windup: .34, recovery: .48 }, raven: { windup: .14, recovery: .28 },
  porcupine: { windup: .22, recovery: .3 }, beaver: { windup: .16, recovery: .24 },
  capybara: { windup: .16, recovery: .28 },
};

export function readAttackPose(attack, out) {
  out.wind = out.hit = out.follow = out.progress = 0;
  if (!attack) return out;
  const { elapsed, windup, recovery } = attack;
  if (elapsed < windup) {
    out.progress = Math.max(0, elapsed / windup);
    out.wind = Math.sin(out.progress * Math.PI * .5);
  } else {
    const t = Math.min(1, (elapsed - windup) / recovery);
    out.wind = Math.max(0, 1 - t * 5);
    out.hit = Math.pow(Math.max(0, 1 - t * 3), 2);
    out.follow = Math.sin(t * Math.PI) * (1 - t);
  }
  return out;
}
