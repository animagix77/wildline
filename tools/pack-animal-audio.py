"""Derive short, naturally pitched game cues from credited field recordings.
Requires ffmpeg. Source recordings and licenses are listed in sounds/CREDITS.md.
"""
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parent.parent
# key: (source, offset, duration); different excerpts keep repeat calls varied.
CLIPS = {
    'porcupine-call-1': ('porcupine.mp3', .0, 1.5),
    'porcupine-call-2': ('porcupine.mp3', 4.48, 1.65),
    'porcupine-charge': ('porcupine.mp3', 11.82, 1.55),
    'porcupine-attack': ('porcupine.mp3', 14.03, 1.6),
    'beaver-call-1': ('beaver.mp3', 8.0, 1.35),
    'beaver-call-2': ('beaver.mp3', 12.0, 1.5),
    'beaver-charge': ('beaver.mp3', 13.2, 2.2),
    'beaver-attack': ('beaver.mp3', 22.0, .95),
    'wolf-howl-1': ('wolf.ogg', 13.25, 3.6),
    'wolf-howl-2': ('wolf.ogg', 20.0, 3.6),
    'wolf-growl': ('wolf-growl.mp3', .08, 2.35),
    'wolf-snarl-1': ('wolf-growl.mp3', .28, .78),
    'wolf-snarl-2': ('wolf-growl.mp3', 1.2, .8),
    'bear-call-1': ('bear.ogg', .16, .92),
    'bear-call-2': ('bear.ogg', 1.6, .8),
    'bear-call-3': ('bear.ogg', 3.27, .91),
    'bear-call-4': ('bear.ogg', 6.88, .88),
    'boar-call-1': ('boar.ogg', .18, 1.42),
    'boar-call-2': ('boar.ogg', 7.48, 1.25),
    'boar-charge': ('boar.ogg', 4.0, 3.2),
    'boar-attack-1': ('boar.ogg', 9.0, .85),
    'boar-attack-2': ('boar.ogg', 16.05, .94),
    'raven-call-1': ('raven.ogg', .1, 1.2),
    'raven-call-2': ('raven.ogg', 1.45, 1.15),
    'raven-charge': ('raven.ogg', 3.55, 1.92),
    'raven-attack-1': ('raven.ogg', 2.75, .7),
    'raven-attack-2': ('raven.ogg', 4.4, .8),
}
for name, (source, start, duration) in CLIPS.items():
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(duration),
        '-i', str(ROOT / 'sounds/originals' / source), '-vn', '-ac', '1',
        '-af', f'highpass=f=65,loudnorm=I=-18:TP=-2:LRA=7,afade=t=in:d=0.025,afade=t=out:st={duration-.09}:d=0.09',
        '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1',
        str(ROOT / 'sounds' / (name + '.mp3'))], check=True)
print(f'Packed {len(CLIPS)} animal clips.')
