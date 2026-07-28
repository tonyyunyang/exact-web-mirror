// Band-by-band pixel diff between the live and local full-page screenshots.
// Full-page images are too tall to read at a glance; horizontal bands are.
// Usage: node compare.mjs <collectionDir> <desktop|mobile>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layout } from './paths.mjs';

// sharp is an optional dependency (native binaries fail to build on some platforms). Imported lazily
// so record/export/serve keep working — only the visual diff needs it.
async function loadSharp() {
  try { return (await import('sharp')).default; }
  catch { console.error('[compare] skipped: the `sharp` package is not installed. Install it in this scripts/ folder (`npm install sharp`) to get visual diffs.'); return null; }
}

export async function compare(dir, viewport = 'desktop') {
  const L = layout(dir);
  const a = `${L.qaDir}/live-${viewport}-full.png`, b = `${L.qaDir}/local-${viewport}-full.png`;
  if (!fs.existsSync(a) || !fs.existsSync(b)) { console.error(`[compare] missing screenshots for ${viewport} (need live-*-full.png and local-*-full.png in qa/)`); return null; }
  const sharp = await loadSharp();
  if (!sharp) return null;
  const BAND = 900;
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
  const width = Math.min(ma.width, mb.width), height = Math.max(ma.height, mb.height);
  const pad = async (src, meta) => sharp(await sharp(src).png().toBuffer()).extend({ bottom: Math.max(0, height - meta.height), background: { r: 255, g: 0, b: 255 } }).raw().toBuffer({ resolveWithObject: true });
  const [ra, rb] = [await pad(a, ma), await pad(b, mb)];
  const outDir = `${L.qaDir}/bands-${viewport}`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  const bands = Math.ceil(height / BAND);
  for (let i = 0; i < bands; i++) {
    const y0 = i * BAND, h = Math.min(BAND, height - y0);
    let diff = 0, n = 0;
    for (let y = y0; y < y0 + h; y += 3) for (let x = 0; x < width; x += 3) {
      const pa = (y * ra.info.width + x) * ra.info.channels, pb = (y * rb.info.width + x) * rb.info.channels;
      if (Math.abs(ra.data[pa] - rb.data[pb]) + Math.abs(ra.data[pa + 1] - rb.data[pb + 1]) + Math.abs(ra.data[pa + 2] - rb.data[pb + 2]) > 30) diff++;
      n++;
    }
    report.push({ band: i, y: y0, diffPct: +((100 * diff) / n).toFixed(2) });
    const crop = async (src) => sharp(src.data, { raw: src.info }).extract({ left: 0, top: y0, width, height: h }).png().toBuffer();
    await sharp({ create: { width: width * 2 + 8, height: h, channels: 3, background: { r: 40, g: 40, b: 40 } } })
      .composite([{ input: await crop(ra), left: 0, top: 0 }, { input: await crop(rb), left: width + 8, top: 0 }])
      .png({ compressionLevel: 8 }).toFile(`${outDir}/band-${String(i).padStart(2, '0')}.png`);
  }
  const mean = report.reduce((s, r) => s + r.diffPct, 0) / report.length;
  const worst = [...report].sort((x, y) => y.diffPct - x.diffPct).slice(0, 5);
  console.log(`[compare] ${viewport}: live ${ma.width}x${ma.height} | local ${mb.width}x${mb.height} | Δheight ${Math.abs(ma.height - mb.height)}px | mean diff ${mean.toFixed(2)}%`);
  console.log(`[compare] worst bands: ${JSON.stringify(worst)} → ${outDir}/ (left=live, right=local)`);
  return { viewport, liveH: ma.height, localH: mb.height, deltaH: Math.abs(ma.height - mb.height), mean: +mean.toFixed(2), worst };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2], vp = process.argv[3] || 'desktop';
  if (!dir || dir === '--help') { console.error('usage: node compare.mjs <collectionDir> <desktop|mobile>'); process.exit(dir ? 0 : 1); }
  await compare(dir, vp);
}
