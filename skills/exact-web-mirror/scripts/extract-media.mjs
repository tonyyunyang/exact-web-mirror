// Pull full media bodies out of the HAR zips onto disk (archive/media/ + manifest.json), because
// the exported tree otherwise holds empty-bodied 206 range entries for streamed video.
// Usage: node extract-media.mjs <collectionDir>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layout, unzipToTemp } from './paths.mjs';

const isMediaType = (t) => /^(video|audio)\//.test(t);
const urlLooksMedia = (u) => { try { const x = new URL(u); return /\.(mp4|webm|mov|m4v|mp3|ogg)([?#]|$)/i.test(u) || /video/i.test(x.pathname + x.search); } catch { return false; } };

export function extractMedia(dir) {
  const L = layout(dir);
  fs.mkdirSync(L.mediaDir, { recursive: true });
  const best = new Map();
  const incomplete = new Set();
  const scratch = [];
  for (const viewport of ['desktop', 'mobile']) {
    const zip = L.har(viewport);
    if (!fs.existsSync(zip)) continue;
    const tmp = unzipToTemp(zip, 'ewm-media-');
    scratch.push(tmp);
    const har = JSON.parse(fs.readFileSync(`${tmp}/har.har`, 'utf8'));
    for (const e of har.log.entries) {
      const url = e.request.url;
      const ctype = (e.response.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value || '').split(';')[0];
      if (!isMediaType(ctype) && !urlLooksMedia(url)) continue;
      const c = e.response.content;
      const cr = e.response.headers.find((h) => h.name.toLowerCase() === 'content-range')?.value;
      const fullRange = cr ? /^bytes 0-(\d+)\/(\d+)$/.exec(cr)?.slice(1).map(Number) : null;
      const isFull = e.response.status === 200 || (fullRange && fullRange[0] + 1 === fullRange[1]);
      const size = c.size > 0 ? c.size : 0;
      if (!isFull || !size || (!c._file && !c.text)) { incomplete.add(url); continue; }
      const cur = best.get(url);
      if (!cur || size > cur.size) best.set(url, { size, type: ctype || 'video/mp4', tmp, file: c._file, text: c.text, encoding: c.encoding });
    }
  }
  const manifest = [];
  let i = 0;
  for (const [url, m] of best) {
    const ext = (m.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
    const out = `m${String(i++).padStart(2, '0')}.${ext}`;
    if (m.file) fs.copyFileSync(`${m.tmp}/${m.file}`, `${L.mediaDir}/${out}`);
    else fs.writeFileSync(`${L.mediaDir}/${out}`, Buffer.from(m.text, m.encoding === 'base64' ? 'base64' : 'utf8'));
    manifest.push({ url, file: out, type: m.type, size: m.size });
    incomplete.delete(url);
  }
  fs.writeFileSync(`${L.mediaDir}/manifest.json`, JSON.stringify(manifest, null, 1));
  for (const t of scratch) fs.rmSync(t, { recursive: true, force: true });
  console.log(`[media] ${manifest.length} full media files (${(manifest.reduce((s, m) => s + m.size, 0) / 1e6).toFixed(1)}MB)`);
  if (incomplete.size) console.log(`[media] note: ${incomplete.size} media URL(s) had no full body in the HAR (streamed-only; usually still fine)`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || dir === '--help') { console.error('usage: node extract-media.mjs <collectionDir>'); process.exit(dir ? 0 : 1); }
  extractMedia(dir);
}
