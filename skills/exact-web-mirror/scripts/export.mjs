// Unpack HAR archives into a plain browsable file tree: <collectionDir>/webpage/
// Bytes are PRISTINE (never rewritten — rewriting corrupts length-prefixed streams like React RSC and
// misses runtime-built URLs). Cross-origin references resolve at runtime via a tiny service worker
// (webpage/__sw.js) that maps any original URL to the local archive through the server's /__u/ route.
// Usage: node export.mjs <collectionDir> [entryUrl] [--port N]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { layout, unzipToTemp } from './paths.mjs';

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

export function exportTree(dir, entryUrl, { port = 8890 } = {}) {
  const L = layout(dir);
  const meta = fs.existsSync(`${L.logsDir}/record-meta.json`) ? JSON.parse(fs.readFileSync(`${L.logsDir}/record-meta.json`, 'utf8')) : {};
  const startUrl = entryUrl || meta.url;
  if (!startUrl) throw new Error(`No entry URL. Pass one: node export.mjs ${dir} https://example.com/`);
  const finalUrl = new URL(meta.desktopFinalUrl || startUrl);
  const primaryHosts = new Set([finalUrl.host, finalUrl.host.replace(/^www\./, ''), 'www.' + finalUrl.host.replace(/^www\./, '')]);
  fs.rmSync(L.webpageDir, { recursive: true, force: true });
  fs.mkdirSync(L.webpageDir, { recursive: true });

  // --- collect best body per URL (desktop pass wins; larger body wins) ---
  const bodies = new Map();
  const scratch = [];
  for (const viewport of ['desktop', 'mobile']) {
    const zip = L.har(viewport);
    if (!fs.existsSync(zip)) continue;
    const tmp = unzipToTemp(zip, 'ewm-export-');
    scratch.push(tmp);
    const har = JSON.parse(fs.readFileSync(`${tmp}/har.har`, 'utf8'));
    for (const e of har.log.entries) {
      let u; try { u = new URL(e.request.url); } catch { continue; }
      if (e.request.method !== 'GET') continue;
      const c = e.response.content;
      const cr = e.response.headers.find((h) => h.name.toLowerCase() === 'content-range')?.value;
      const fullRange = cr ? /^bytes 0-(\d+)\/(\d+)$/.exec(cr)?.slice(1).map(Number) : null;
      if (!((e.response.status === 200 || (fullRange && fullRange[0] + 1 === fullRange[1])) && (c._file || c.text))) continue;
      const buf = c._file ? fs.readFileSync(`${tmp}/${c._file}`) : Buffer.from(c.text, c.encoding === 'base64' ? 'base64' : 'utf8');
      if (!buf.length) continue;
      const type = (e.response.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value || '').split(';')[0].trim();
      const key = u.host + u.pathname + u.search;
      const prev = bodies.get(key);
      if (prev && prev.buf.length >= buf.length) continue;
      bodies.set(key, { buf, type, host: u.host, pathname: u.pathname, search: u.search });
    }
  }
  if (!bodies.size) throw new Error(`No HAR archives found under ${L.archiveDir}/. Run record.mjs first.`);
  // full media bodies override
  if (fs.existsSync(`${L.mediaDir}/manifest.json`)) {
    for (const m of JSON.parse(fs.readFileSync(`${L.mediaDir}/manifest.json`, 'utf8'))) {
      const u = new URL(m.url);
      bodies.set(u.host + u.pathname + u.search, { buf: fs.readFileSync(`${L.mediaDir}/${m.file}`), type: m.type, host: u.host, pathname: u.pathname, search: u.search });
    }
  }
  // materialize the final document at the entry host root (redirect flattening)
  if (![...primaryHosts].some((h) => bodies.has(h + '/'))) {
    const fin = bodies.get(finalUrl.host + finalUrl.pathname + finalUrl.search);
    if (fin) bodies.set(finalUrl.host + '/', { ...fin, host: finalUrl.host, pathname: '/', search: '' });
  }

  const EXTTYPE = { css: 'text/css', js: 'application/javascript', mjs: 'application/javascript', html: 'text/html', json: 'application/json', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', wasm: 'application/wasm' };
  const GENERIC = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'text/plain']);
  const map = {}, types = {};
  let written = 0;
  for (const b of bodies.values()) {
    const base = primaryHosts.has(b.host) ? '' : `__ext/${b.host}`;
    let rel = path.posix.join(base, decodeURIComponent(b.pathname).replace(/^\//, ''));
    if (b.pathname.endsWith('/')) rel = path.posix.join(rel, 'index.html');
    else if (/html/.test(b.type) && !/\.[a-z0-9]{2,5}$/i.test(rel)) rel += '/index.html';
    if (b.search) rel = rel.replace(/(\.[a-z0-9]{2,8})?$/i, (ext) => `.q${hash(b.search)}${ext || ''}`);
    if (rel.length > 900 || rel.split('/').some((s) => s.length > 200)) rel = `__blobs/${hash(b.host + b.pathname + b.search)}`;
    try { fs.mkdirSync(path.dirname(path.join(L.webpageDir, rel)), { recursive: true }); fs.writeFileSync(path.join(L.webpageDir, rel), b.buf); }
    catch { rel = `__blobs/${hash(b.host + b.pathname + b.search)}`; fs.mkdirSync(path.join(L.webpageDir, '__blobs'), { recursive: true }); fs.writeFileSync(path.join(L.webpageDir, rel), b.buf); }
    const k = b.host + b.pathname + b.search;
    map[k] = rel;
    if (!(b.host + b.pathname in map) || !b.search) map[b.host + b.pathname] = rel;
    // CDNs sometimes serve css/js as octet-stream; cross-origin strict MIME then rejects them.
    const ext = (b.pathname.split('.').pop() || '').toLowerCase();
    types[rel] = GENERIC.has(b.type) && EXTTYPE[ext] ? EXTTYPE[ext] : b.type || EXTTYPE[ext] || 'application/octet-stream';
    written++;
  }

  // Everything below is generated scaffolding, all under reserved names (__* / OPEN* / HOW-TO-*) so it
  // can never overwrite a captured file. A site's own /sw.js is a real and common path — hence __sw.js.
  const GENERATED = ['__map.json', '__types.json', '__meta.json', '__sw.js', '__boot.html', '__serve.mjs', 'OPEN.command', 'OPEN.sh', 'HOW-TO-OPEN.txt'];
  const clashes = GENERATED.filter((g) => Object.values(map).includes(g));
  if (clashes.length) console.warn(`[export] warning: captured file(s) share a scaffolding name and were replaced: ${clashes.join(', ')}`);

  fs.writeFileSync(`${L.webpageDir}/__map.json`, JSON.stringify(map));
  fs.writeFileSync(`${L.webpageDir}/__types.json`, JSON.stringify(types));
  fs.writeFileSync(`${L.webpageDir}/__meta.json`, JSON.stringify({ primaryHost: finalUrl.host, primaryHosts: [...primaryHosts], source: startUrl, capturedAt: meta.capturedAt }));

  fs.writeFileSync(`${L.webpageDir}/__sw.js`, `// Maps the page's original cross-origin URLs to the local archive (server route /__u/).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin === self.location.origin) return;
  const headers = {}; const range = e.request.headers.get('range'); if (range) headers.range = range;
  // Re-wrap so response.url stays the requested URL: otherwise the browser applies redirect
  // semantics and relative module/style imports resolve against /__u/... and break.
  e.respondWith(fetch('/__u/' + encodeURIComponent(u.href), { headers })
    .then((r) => new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers })));
});
`);
  fs.writeFileSync(`${L.webpageDir}/__boot.html`, `<!doctype html><meta charset="utf-8"><title>Opening local copy…</title>
<body style="font:14px system-ui;display:grid;place-content:center;height:100vh;margin:0">
<p>Opening the offline copy of <b>${finalUrl.host}</b>…</p>
<script>
(async () => {
  if (!('serviceWorker' in navigator)) { document.body.textContent = 'This browser cannot run the copy (no service worker support).'; return; }
  await navigator.serviceWorker.register('/__sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  location.replace('/');
})();
</script>`);

  // A copy of the server travels with the archive, so webpage/ stays openable after the skill is
  // updated, moved, or handed to someone else who only has Node.
  fs.copyFileSync(path.join(SCRIPTS_DIR, 'serve.mjs'), `${L.webpageDir}/__serve.mjs`);

  fs.writeFileSync(`${L.webpageDir}/OPEN.command`, `#!/bin/zsh -l
# Double-click to view this offline copy. Closing this window stops the local server.
cd "\${0:A:h}" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is required to open this copy: https://nodejs.org"; read -r "?Press return to close…"; exit 1; }
exec node ./__serve.mjs . ${port} --open
`);
  fs.writeFileSync(`${L.webpageDir}/OPEN.sh`, `#!/usr/bin/env bash
# Run this to view the offline copy. Ctrl-C stops the local server.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is required to open this copy: https://nodejs.org"; exit 1; }
exec node ./__serve.mjs . ${port} --open
`);
  fs.chmodSync(`${L.webpageDir}/OPEN.command`, 0o755);
  fs.chmodSync(`${L.webpageDir}/OPEN.sh`, 0o755);

  fs.writeFileSync(`${L.webpageDir}/HOW-TO-OPEN.txt`, `Offline copy of ${finalUrl.host}
captured ${meta.capturedAt || '(unknown date)'} from ${startUrl}

TO VIEW IT
  macOS  — double-click OPEN.command
  Linux  — run ./OPEN.sh
  any OS — node __serve.mjs . ${port} --open      (requires Node.js 18+)

Then browse to http://localhost:${port}/ . Nothing is installed and nothing leaves your machine.

WHY A LOCAL SERVER INSTEAD OF DOUBLE-CLICKING index.html
Browsers refuse to run service workers and ES modules from a bare file:// page. That is a browser
security rule, not a limitation of this copy. The server is a single Node script (__serve.mjs) that
listens on 127.0.0.1 only and stops when you close the window.

WHAT IS IN HERE
Everything except the __* scaffolding is the site's own file, byte-for-byte as its server sent it.
Other domains' assets are under __ext/<host>/. Nothing was rewritten: __map.json maps the page's
original URLs onto these files, and __sw.js (a ~15-line service worker) applies that map at request
time, so the site's own JavaScript runs unmodified.

LIMITS
This is a faithful view, not a working backend. Forms, logins, search and chat post to dead
endpoints; analytics beacons 404; links to pages that were not captured 404 as well.
`);

  for (const t of scratch) fs.rmSync(t, { recursive: true, force: true });
  console.log(`[export] ${written} pristine files → ${L.webpageDir}/ (port ${port})`);
  return { webpageDir: L.webpageDir, port, files: written };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--') && !/^https?:/.test(a));
  const url = args.find((a) => /^https?:/.test(a));
  const port = args.includes('--port') ? +args[args.indexOf('--port') + 1] : 8890;
  if (!dir || args.includes('--help')) { console.error('usage: node export.mjs <collectionDir> [entryUrl] [--port N]'); process.exit(dir ? 0 : 1); }
  exportTree(dir, url, { port });
}
