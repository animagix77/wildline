/* Actual recordings, trimmed at their natural pitch. Credits also ship in the
   field guide so the portable HTML carries its own attribution. */
export const ANIMAL_CUES = {
  porcupine: { deploy: ['porcupine-call-1'], select: ['porcupine-call-2'], order: ['porcupine-call-1'], charge: ['porcupine-charge'], attack: ['porcupine-attack'], idle: ['porcupine-call-2'] },
  beaver: { deploy: ['beaver-call-1'], select: ['beaver-call-2'], order: ['beaver-call-1'], charge: ['beaver-charge'], attack: ['beaver-attack'], idle: ['beaver-call-2'] },
  wolf: { deploy: ['wolf-howl-1', 'wolf-howl-2'], select: ['wolf-growl'], order: ['wolf-snarl-2'], charge: ['wolf-growl'], attack: ['wolf-snarl-1', 'wolf-snarl-2'], idle: ['wolf-howl-2'] },
  bear: { deploy: ['bear-call-1', 'bear-call-2'], select: ['bear-call-3', 'bear-call-4'], order: ['bear-call-2'], charge: ['bear-call-1'], attack: ['bear-call-2', 'bear-call-4'], idle: ['bear-call-3'] },
  boar: { deploy: ['boar-call-1'], select: ['boar-call-2'], order: ['boar-call-1'], charge: ['boar-charge'], attack: ['boar-attack-1', 'boar-attack-2'], idle: ['boar-call-2'] },
  raven: { deploy: ['raven-charge'], select: ['raven-call-1', 'raven-call-2'], order: ['raven-call-2'], charge: ['raven-charge'], attack: ['raven-attack-1', 'raven-attack-2'], idle: ['raven-call-1'] },
};
// build.mjs replaces this with data URLs; development serves local MP3s.
export const EMBEDDED_ANIMAL_AUDIO = null;
