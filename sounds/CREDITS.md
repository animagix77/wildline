# Recorded wildlife audio

The game uses genuine animal recordings for wolf, bear, boar, raven and porcupine calls, plus recorded beaver chewing. **Capybara still uses a synthesized placeholder**: no suitable licensed species recording has been sourced. No unrelated animal is relabeled as a capybara. Event names are gameplay uses, not claims about the behavior being recorded.

All excerpts are cut at natural speed/pitch, converted to mono 44.1 kHz MP3, high-pass filtered at 65 Hz, loudness-balanced (target −18 LUFS, −2 dB true peak), and faded at their edges. The wolf growl already contains the original author's sub-bass enhancement. Sources were retrieved on September 4, 2026. Author/source/license links are also included in the in-game field guide and portable HTML.

| Game files | Recording / author | License |
| --- | --- | --- |
| `wolf-howl-*.mp3`; `originals/wolf.ogg` | [Wolf howls](https://commons.wikimedia.org/wiki/File:Wolf_howls.ogg), U.S. Fish and Wildlife Service | U.S. federal government public domain |
| `wolf-growl.mp3`, `wolf-snarl-*.mp3`; `originals/wolf-growl.mp3` | [wolf-growl.wav](https://freesound.org/people/newagesoup/sounds/338674/), **newagesoup**; Freesound HQ MP3 version | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `bear-call-*.mp3`; `originals/bear.ogg` | [Bear growl.ogg](https://commons.wikimedia.org/wiki/File:Bear_growl.ogg), **Shizhao**, 2007; identified by source as a bear cub growl | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (chosen from the offered licenses) |
| `boar-*.mp3`; `originals/boar.ogg` | [Boar.Grwls(1).ogg](https://commons.wikimedia.org/wiki/File:Boar.Grwls(1).ogg), **GrWolf1129**, March 4, 2020 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); **all modified boar clips are distributed under this same license** |
| `raven-*.mp3`; `originals/raven.ogg` | [Common Raven Grand Teton National Park.ogg](https://commons.wikimedia.org/wiki/File:Common_Raven_Grand_Teton_National_Park.ogg), **National Park Service**, December 13, 2002 | U.S. federal government public domain |
| `porcupine-*.mp3`; `originals/porcupine.mp3` | [S27-31 Porcupine puffing grunting & rattling quills.wav](https://freesound.org/people/craigsmith/sounds/675452/), **craigsmith**, USC Cinema vintage effects preservation; Freesound HQ MP3 version | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `beaver-*.mp3`; `originals/beaver.mp3` | [Beaver chomping on a log (3.33m).m4a](https://freesound.org/people/Mobius_Play109/sounds/685527/), **Mobius_Play109**; Freesound HQ MP3 version | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

These credits do not imply endorsement by the recordists or government agencies. The licenses above apply to the specified sound assets, independently of the surrounding game code.

## Rebuilding and playback

Run `python3 tools/pack-animal-audio.py` with ffmpeg installed to regenerate clips from the retained source recordings. The script records each exact source offset and duration. `src/animal-samples.js` maps clips to deployment, selection, orders, charge, attack and idle events. `node build.mjs` embeds these clips as data URLs in `wildline.html`; the standalone build requires no network for wildlife audio.

Click **? → Listen to the wildlife** to audition any of the four principal gameplay cues. A four-voice mix budget, one short retiring tail, per-species cooldowns and global combat spacing prevent overlapping packs from overwhelming the mix. Direct selection/deployment cues take priority; combat and idle sounds honor distance, camera direction and fog visibility.
