// Static server for an exported webpage/ folder. Same-origin paths resolve against the primary
// host's archive entries / file tree; the copy's service worker forwards every cross-origin URL
// here as /__u/<encoded original URL>. Serves HTTP Range requests so <video> scrubbing works.
//
// Deliberately self-contained (node: builtins only, no npm packages) — export.mjs copies this file
// into every archive as webpage/__serve.mjs so a copy stays openable on a machine that has nothing
// but Node installed.
//
// Usage: node serve.mjs [webpageDir] [port] [--open]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function startServer(dirArg, port = 8890, { open = false, quiet = false } = {}) {
  const dir = path.resolve(dirArg);
  for (const f of ['__map.json', '__types.json', '__meta.json']) {
    if (!fs.existsSync(path.join(dir, f))) throw new Error(`${dir} is not an exported copy (missing ${f}). Point this at a webpage/ folder.`);
  }
  const map = JSON.parse(fs.readFileSync(path.join(dir, '__map.json'), 'utf8'));
  const types = JSON.parse(fs.readFileSync(path.join(dir, '__types.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '__meta.json'), 'utf8'));
  const EXT = { html: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wasm: 'application/wasm', txt: 'text/plain', xml: 'application/xml', pdf: 'application/pdf' };
  const GENERIC = new Set(['application/octet-stream', 'binary/octet-stream', 'text/plain', '']);
  const lookup = (a, b) => map[a] || map[b] || null;

  function resolveLocal(pathname, search) {
    const rel = decodeURIComponent(pathname).replace(/^\//, '');
    for (const h of meta.primaryHosts) { const hit = lookup(h + pathname + search, h + pathname); if (hit) return hit; }
    for (const c of [rel || 'index.html', rel.replace(/\/$/, '') + '/index.html', rel + '/index.html', rel + '.html']) {
      const abs = path.join(dir, c);
      if (inside(abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
    }
    return null;
  }
  const inside = (abs) => abs === dir || abs.startsWith(dir + path.sep);

  function send(res, req, rel, extra = {}) {
    const abs = path.join(dir, rel);
    if (!inside(abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404, { 'content-type': 'text/plain', ...extra }); return res.end('not in archive'); }
    const buf = fs.readFileSync(abs);
    const recorded = types[rel], extType = EXT[rel.split('.').pop()?.toLowerCase()];
    const ctype = recorded && !GENERIC.has(recorded) ? recorded : extType || recorded || 'application/octet-stream';
    const base = { 'content-type': ctype, 'accept-ranges': 'bytes', 'cache-control': 'no-store', ...extra };
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = +range[1], end = range[2] ? Math.min(+range[2], buf.length - 1) : buf.length - 1;
      res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': end - start + 1 });
      return res.end(buf.subarray(start, end + 1));
    }
    res.writeHead(200, { ...base, 'content-length': buf.length });
    res.end(buf);
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${port}`);
    if (u.pathname.startsWith('/__u/')) {
      let orig; try { orig = new URL(decodeURIComponent(u.pathname.slice(5))); } catch { res.writeHead(400); return res.end(); }
      const rel = lookup(orig.host + orig.pathname + orig.search, orig.host + orig.pathname);
      if (!rel) { res.writeHead(404, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); return res.end('not in archive'); }
      return send(res, req, rel, { 'access-control-allow-origin': '*' });
    }
    if (u.pathname === '/__sw.js' || u.pathname === '/__boot.html') return send(res, req, u.pathname.slice(1), u.pathname === '/__sw.js' ? { 'service-worker-allowed': '/' } : {});
    const rel = resolveLocal(u.pathname, u.search);
    if (!rel) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not in archive'); }
    send(res, req, rel);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.error(`Port ${port} is already in use — another copy is probably open. Pick another: node __serve.mjs . ${port + 1} --open`); process.exit(1); }
    throw e;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/__boot.html`;
    if (!quiet) console.log(`Serving the offline copy of ${meta.primaryHost} → ${url}`);
    if (open) openInBrowser(url);
  });
  return server;
}

function openInBrowser(url) {
  try { execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }); }
  catch { console.log(`Open this in your browser: ${url}`); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.includes('--help') || a.includes('-h')) {
    console.log('usage: node serve.mjs [webpageDir] [port] [--open]\n\n  webpageDir  exported copy to serve (default: this script\'s own folder)\n  port        default 8890\n  --open      open the copy in your default browser');
    process.exit(0);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = a.find((x) => !x.startsWith('-') && !/^\d+$/.test(x)) || here;
  const port = +(a.find((x) => /^\d+$/.test(x)) || 8890);
  try { startServer(dir, port, { open: a.includes('--open') }); }
  catch (e) { console.error(String(e.message || e)); process.exit(1); }
  console.log('(Ctrl-C or close this window to stop)');
}
