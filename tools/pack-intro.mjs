/* Regenerate src/intro-art.js from the encoded parallax layers.
   The layers are encoded by the browser (the only webp encoder on this
   machine): serve the repo, open images/intro screen parallax/encode.html,
   and it writes images/build/*.webp back through the dev server. Then:
       node tools/pack-intro.mjs                                          */
import fs from 'node:fs';

const LAYERS = [
  ['INTRO_SKY',  'images/build/04_sky.webp'],
  ['INTRO_BG',   'images/build/03_background.webp'],
  ['INTRO_MID',  'images/build/02_middle.webp'],
  ['INTRO_FG',   'images/build/01_foreground.webp'],
  ['INTRO_TITLE','images/build/title.webp'],
];

let out = `/* Parallax intro layers, inlined so the single-file build stays a single file.
   Regenerate with tools/pack-intro.mjs (see that file for the encode step). */\n`;
let total = 0;
for (const [name, file] of LAYERS) {
  const buf = fs.readFileSync(file);
  total += buf.length;
  out += `export const ${name} = 'data:image/webp;base64,${buf.toString('base64')}';\n`;
}
fs.writeFileSync('src/intro-art.js', out);
console.log(`src/intro-art.js  ${(fs.statSync('src/intro-art.js').size / 1024) | 0} KB (from ${(total / 1024) | 0} KB webp)`);
