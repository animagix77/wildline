/* Regenerate src/splash-art.js from the key art.
   Usage:  sips -s format jpeg -s formatOptions 55 -Z 1500 <src.png> --out images/build/splash.jpg
           node tools/pack-splash.mjs                                                            */
import fs from 'node:fs';
const jpg = fs.readFileSync('images/build/splash.jpg');
fs.writeFileSync('src/splash-art.js',
  `/* Key art for the splash screen, inlined so the single-file build stays a single\n` +
  `   file. Regenerate with tools/pack-splash.mjs. */\n` +
  `export const SPLASH_ART = 'data:image/jpeg;base64,${jpg.toString('base64')}';\n`);
console.log(`src/splash-art.js  ${(fs.statSync('src/splash-art.js').size / 1024) | 0} KB`);
