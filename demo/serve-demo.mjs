// Serves the demo fixture as TWO origins, because that is what makes it a fair test:
//   :7801  the page          (site/)
//   :7802  the "CDN"         (cdn/)  — stylesheet, ES modules, video, image
// Different ports are different origins, so the cross-origin path is genuinely exercised rather
// than simulated. Node builtins only.
//
// Usage: node serve-demo.mjs [--open]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE_PORT = 7801;
export const CDN_PORT = 7802;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function makeServer(root, { cors }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const abs = path.join(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    const buf = fs.readFileSync(abs);
    const head = {
      'content-type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      ...(cors ? { 'access-control-allow-origin': '*' } : {}),
    };
    // Range support is the point of TRAP 03: the browser asks for slices of the video, and a
    // recorder that stores only what came back gets fragments instead of a file.
    const m = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    if (m) {
      const start = +m[1];
      const end = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': end - start + 1 });
      return res.end(buf.subarray(start, end + 1));
    }
    res.writeHead(200, { ...head, 'content-length': buf.length });
    res.end(buf);
  });
}

export function startDemo() {
  const site = makeServer(path.join(HERE, 'site'), { cors: false });
  const cdn = makeServer(path.join(HERE, 'cdn'), { cors: true });
  const listen = (srv, port, label) => new Promise((resolve, reject) => {
    srv.once('error', (e) => reject(e.code === 'EADDRINUSE'
      ? new Error(`Port ${port} is already in use — stop whatever is on it and retry (${label}).`) : e));
    srv.listen(port, '127.0.0.1', resolve);
  });
  return Promise.all([listen(site, SITE_PORT, 'site'), listen(cdn, CDN_PORT, 'cdn')])
    .then(() => ({ site, cdn, url: `http://localhost:${SITE_PORT}/`, stop: () => { site.close(); cdn.close(); } }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startDemo().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
  console.log(`The Hard Page is running:\n  page → ${url}\n  cdn  → http://localhost:${CDN_PORT}/\n`);
  console.log('Capture it with:\n  node ../skills/exact-web-mirror/scripts/archive.mjs ' + url + ' --verify\n');
  console.log('(Ctrl-C to stop)');
  if (process.argv.includes('--open')) {
    try { execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }); } catch {}
  }
}
