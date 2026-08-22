/* =========================================================================
   WILDLINE single-file build.

   Emits `wildline.html`: one self-contained document with three.js, every
   game module, all CSS and all markup inlined. No network, no assets.

     node build.mjs

   Strategy
     · three.js ships as an ES module ending in one `export{a as B, ...}`.
       We drop that statement and rebuild it as `const THREE = { B: a, ... }`.
     · Each game module has its `import`/`export` syntax stripped and is
       concatenated in dependency order inside a single <script type=module>,
       so module scope still isolates everything from the page.
     · A collision guard fails the build if two modules declare the same
       top-level binding — the one real hazard of flattening modules.
   ========================================================================= */

import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));

/* Dependency order. Anything added here must come after what it imports.
   Only modules that are actually wired into the game belong here. */
const MODULES = [
  'src/config.js',
  'src/state.js',
  'src/utils.js',
  'src/maps.js',
  'src/campaign.js',
  'src/comms.js',
  'src/intro-art.js',
  'src/splash.js',
  'src/post.js',
  'src/weather.js',
  'src/water.js',
  'src/ui.js',
  'src/score.js',
  'src/audio.js',
  'src/music.js',
  'src/shaders.js',
  'src/meshes.js',
  'src/vfx.js',
  'src/combat.js',
  'src/entity.js',
  'src/fog.js',
  'src/verdant.js',
  'src/world.js',
  'src/ai.js',
  'src/camera.js',
  'src/perf.js',
  'src/screens.js',
  'src/input.js',
  'src/hud.js',
  'src/main.js',
];
for (const f of MODULES) if (!exists(f)) throw new Error(`missing module: ${f}`);

const STYLES = ['style.css', 'ui-extra.css'].filter(exists);

/* ---------------------------------------------------------------- three -- */
function inlineThree() {
  const src = read('vendor/three.module.min.js');
  const m = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(src);
  if (!m) throw new Error('three.js: could not find the trailing export statement');
  const body = src.slice(0, m.index);
  const pairs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(spec => {
    const parts = spec.split(/\s+as\s+/);
    const local = parts[0].trim();
    const exported = (parts[1] || parts[0]).trim();
    return `  ${JSON.stringify(exported)}: ${local}`;
  });
  // Minified three.js declares hundreds of one-letter bindings. Keep them inside a
  // closure or they collide with game module names (`G`, `M`, `box`, ...).
  return `const THREE = (() => {\n${body}\nreturn Object.freeze({\n${pairs.join(',\n')}\n});\n})();\n`;
}

/* --------------------------------------------------------------- modules -- */
const IMPORT_RE = /^[ \t]*import[ \t][^\n;]*?(?:;|\n)/gm;
const BARE_EXPORT_RE = /^[ \t]*export[ \t]*\{[^}]*\}[ \t]*;?[ \t]*$/gm;
const DECL_EXPORT_RE = /^([ \t]*)export[ \t]+(?=(?:const|let|var|function|class|async)\b)/gm;
/* Top-level declarations only — every module in this repo declares them at column 0.
   Handles comma lists (`let a, b;`) which a single-identifier regex would miss. */
const TOP_FN_RE = /^(?:export[ \t]+)?(?:async[ \t]+)?(?:function\*?|class)[ \t]+([A-Za-z_$][\w$]*)/gm;
const TOP_VAR_RE = /^(?:export[ \t]+)?(?:const|let|var)[ \t]+([^;=\n]+)/gm;

function stripModuleSyntax(src, file) {
  if (/^[ \t]*export[ \t]+default\b/m.test(src)) {
    throw new Error(`${file}: default exports are not supported by the flat build`);
  }
  let out = src.replace(IMPORT_RE, '');
  out = out.replace(BARE_EXPORT_RE, '');
  out = out.replace(DECL_EXPORT_RE, '$1');
  if (/^[ \t]*(?:import|export)\b/m.test(out)) {
    const bad = out.split('\n').filter(l => /^[ \t]*(?:import|export)\b/.test(l));
    throw new Error(`${file}: leftover module syntax:\n  ${bad.join('\n  ')}`);
  }
  return out;
}

/* `import { a as b }` is a runtime landmine here: the flat build drops the
   import statement, so `b` is never defined and the parse check still passes.
   Fail the build rather than ship a ReferenceError. */
function aliasGuard() {
  const bad = [];
  for (const f of MODULES) {
    if (!exists(f)) continue;
    for (const m of read(f).matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const part of m[1].split(',')) {
        const a = part.match(/(\S+)\s+as\s+(\S+)/);
        if (a) bad.push(`  ${f}: "${a[1]} as ${a[2]}" -- use ${a[1]} directly`);
      }
    }
  }
  if (bad.length) throw new Error('aliased imports do not survive the flat build:\n' + bad.join('\n'));
}

function collisionGuard(sources) {
  const owner = new Map();
  const clashes = [];
  for (const { file, src } of sources) {
    const names = new Set();
    let m;
    TOP_FN_RE.lastIndex = 0;
    while ((m = TOP_FN_RE.exec(src))) names.add(m[1]);
    TOP_VAR_RE.lastIndex = 0;
    while ((m = TOP_VAR_RE.exec(src))) {
      for (const part of m[1].split(',')) {
        const id = /^[ \t]*([A-Za-z_$][\w$]*)/.exec(part);
        if (id) names.add(id[1]);
      }
    }
    for (const n of names) {
      if (owner.has(n)) clashes.push(`${n}  (${owner.get(n)} vs ${file})`);
      else owner.set(n, file);
    }
  }
  if (clashes.length) {
    throw new Error(
      'top-level name collisions would break the flat build:\n  ' + clashes.join('\n  ') +
      '\nRename one side in the source module.'
    );
  }
  return owner.size;
}

/* ------------------------------------------------------------------ html -- */
function buildHtml(css, js) {
  const raw = read('index.html');
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(raw);
  if (!bodyMatch) throw new Error('index.html: no <body> found');
  let body = bodyMatch[1];
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, '').trim();

  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(raw);
  const title = titleMatch ? titleMatch[1].trim() : 'WILDLINE';

  // A literal </script> inside the JS payload would close the tag early.
  const safeJs = js.replace(/<\/script/gi, '<\\/script');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script type="module">
${safeJs}
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ main -- */
const sources = MODULES.map(file => ({ file, src: stripModuleSyntax(read(file), file) }));
aliasGuard();
const bindings = collisionGuard(sources);

/* The regex guard below is a fast, friendly first pass, but regexes cannot reliably
   parse declarator lists. This runs the real parser over the flattened payload, which
   catches every duplicate binding and every syntax slip the flatten step could cause. */
function parseCheck(payload) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wildline-')), 'bundle.mjs');
  fs.writeFileSync(tmp, payload);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).split('\n')
      .filter(l => l.trim() && !/^\s+at /.test(l)).slice(0, 6).join('\n');
    throw new Error(`flattened bundle does not parse:\n${msg}`);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

const js = [
  '/* ---- three.js r169 (MIT) — vendored and flattened ---- */',
  inlineThree(),
  ...sources.map(({ file, src }) =>
    `\n/* =================== ${file} =================== */\n${src.trim()}\n`),
].join('\n');

parseCheck(js);

const css = STYLES.map(f => `/* ---- ${f} ---- */\n${read(f)}`).join('\n\n');
const html = buildHtml(css, js);

fs.writeFileSync(path.join(ROOT, 'wildline.html'), html);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`wildline.html  ${kb(html.length)}`);
console.log(`  three.js     inlined`);
console.log(`  modules      ${MODULES.length} (${bindings} top-level bindings, no collisions)`);
console.log(`  stylesheets  ${STYLES.join(', ')}`);
