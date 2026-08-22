import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8181);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  /* Dev-only asset pipeline: the browser is the only webp encoder this machine
     has, so tools/pack-intro drives a page that draws each PNG to a canvas and
     POSTs the encoded result back here. Writes are jailed to images/build. */
  if (req.method === 'POST' && req.url.startsWith('/__save/')) {
    const name = req.url.slice('/__save/'.length);
    if (!/^[\w.-]+\.webp$/.test(name)) { res.writeHead(400).end('bad name'); return; }
    const dir = path.join(ROOT, 'images', 'build');
    fs.mkdirSync(dir, { recursive: true });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
      res.writeHead(200).end('ok');
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + p); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`wildline dev server → http://localhost:${PORT}`));
