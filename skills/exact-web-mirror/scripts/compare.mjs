// Visual comparison between the live capture and the offline replay, in two forms:
//   compare()       full-page screenshots, band by band (bands, because a 6000px image is
//                   unreadable at a glance and a single number hides where the difference is)
//   compareFrames() the scrolled-viewport pass, frame by frame
// Frames carry the weight: a full-page screenshot re-renders the document at its whole height, and
// scroll-driven sections often never paint in one, so large parts of it can be blank on both sides.
// A diff over blank pixels is not evidence — so both functions also measure how much of the live
// image carries content, and report it next to the diff.
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

const STEP = 3;      // sample every 3rd pixel in both axes — 9× faster, same verdict
const NOTICEABLE = 30; // summed RGB distance a human would see

// diff  = live vs local: the fidelity number.
// ink   = live vs the region's own background: does anything render here at all, so a 0% diff over
//         blank pixels can be told apart from a 0% diff over a rendered section.
function measure(ra, rb, y0, h, width) {
  const at = (r, x, y) => (y * r.info.width + x) * r.info.channels;
  // The background is the colour that dominates the region — not the corner pixel, which in a
  // scrolled frame is the sticky header. A dark header over a light page would make every body
  // pixel read as content and the blank-region check would never fire. Colours are quantised to
  // 4 bits per channel so gradients and near-identical shades collapse to one bucket.
  const counts = new Map();
  for (let y = y0; y < y0 + h; y += STEP) for (let x = 0; x < width; x += STEP) {
    const p = at(ra, x, y);
    const k = ((ra.data[p] >> 4) << 8) | ((ra.data[p + 1] >> 4) << 4) | (ra.data[p + 2] >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let key = 0, best = -1;
  for (const [k, c] of counts) if (c > best) { best = c; key = k; }
  const bg = [(((key >> 8) & 15) << 4) + 8, (((key >> 4) & 15) << 4) + 8, ((key & 15) << 4) + 8];
  let diff = 0, ink = 0, n = 0;
  for (let y = y0; y < y0 + h; y += STEP) for (let x = 0; x < width; x += STEP) {
    const pa = at(ra, x, y), pb = at(rb, x, y);
    if (Math.abs(ra.data[pa] - rb.data[pb]) + Math.abs(ra.data[pa + 1] - rb.data[pb + 1]) + Math.abs(ra.data[pa + 2] - rb.data[pb + 2]) > NOTICEABLE) diff++;
    if (Math.abs(ra.data[pa] - bg[0]) + Math.abs(ra.data[pa + 1] - bg[1]) + Math.abs(ra.data[pa + 2] - bg[2]) > NOTICEABLE) ink++;
    n++;
  }
  return { diffPct: +((100 * diff) / n).toFixed(2), inkPct: +((100 * ink) / n).toFixed(1) };
}

async function sideBySide(sharp, left, right, width, height, file) {
  const crop = async (src) => sharp(src.raw, { raw: src.info }).extract({ left: 0, top: src.top, width, height }).png().toBuffer();
  await sharp({ create: { width: width * 2 + 8, height, channels: 3, background: { r: 40, g: 40, b: 40 } } })
    .composite([{ input: await crop(left), left: 0, top: 0 }, { input: await crop(right), left: width + 8, top: 0 }])
    .png({ compressionLevel: 8 }).toFile(file);
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
  // Pad the shorter image to a common height so bands line up; magenta makes a height gap obvious.
  const pad = async (src, meta) => sharp(await sharp(src).png().toBuffer()).extend({ bottom: Math.max(0, height - meta.height), background: { r: 255, g: 0, b: 255 } }).raw().toBuffer({ resolveWithObject: true });
  const [ra, rb] = [await pad(a, ma), await pad(b, mb)];
  const outDir = `${L.qaDir}/bands-${viewport}`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  const bands = Math.ceil(height / BAND);
  for (let i = 0; i < bands; i++) {
    const y0 = i * BAND, h = Math.min(BAND, height - y0);
    report.push({ band: i, y: y0, ...measure(ra, rb, y0, h, width) });
    await sideBySide(sharp, { raw: ra.data, info: ra.info, top: y0 }, { raw: rb.data, info: rb.info, top: y0 }, width, h, `${outDir}/band-${String(i).padStart(2, '0')}.png`);
  }
  const mean = report.reduce((s, r) => s + r.diffPct, 0) / report.length;
  const withContent = report.filter((r) => r.inkPct >= 0.5).length;
  const worst = [...report].sort((x, y) => y.diffPct - x.diffPct).slice(0, 5);
  console.log(`[compare] ${viewport} full page: live ${ma.width}x${ma.height} | local ${mb.width}x${mb.height} | Δheight ${Math.abs(ma.height - mb.height)}px | mean diff ${mean.toFixed(2)}% | ${withContent}/${bands} bands carry content`);
  console.log(`[compare] worst bands: ${JSON.stringify(worst)} → ${outDir}/ (left=live, right=local)`);
  return { viewport, liveH: ma.height, localH: mb.height, deltaH: Math.abs(ma.height - mb.height), mean: +mean.toFixed(2), bands, withContent, worst };
}

export async function compareFrames(dir, viewport = 'desktop') {
  const L = layout(dir);
  if (!fs.existsSync(L.qaDir)) return null;
  const prefix = `live-${viewport}-scroll-`;
  const ids = fs.readdirSync(L.qaDir).filter((f) => f.startsWith(prefix) && f.endsWith('.png')).map((f) => f.slice(prefix.length, -4)).sort();
  const pairs = ids.filter((n) => fs.existsSync(`${L.qaDir}/local-${viewport}-scroll-${n}.png`));
  if (!pairs.length) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  const outDir = `${L.qaDir}/frames-${viewport}`;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const n of pairs) {
    const a = `${L.qaDir}/${prefix}${n}.png`, b = `${L.qaDir}/local-${viewport}-scroll-${n}.png`;
    const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
    const width = Math.min(ra.info.width, rb.info.width), height = Math.min(ra.info.height, rb.info.height);
    report.push({ frame: n, ...measure(ra, rb, 0, height, width) });
    await sideBySide(sharp, { raw: ra.data, info: ra.info, top: 0 }, { raw: rb.data, info: rb.info, top: 0 }, width, height, `${outDir}/frame-${n}.png`);
  }
  const mean = report.reduce((s, r) => s + r.diffPct, 0) / report.length;
  const withContent = report.filter((r) => r.inkPct >= 0.5).length;
  const worst = [...report].sort((x, y) => y.diffPct - x.diffPct).slice(0, 3);
  console.log(`[compare] ${viewport} scrolled frames: ${report.length} compared | mean diff ${mean.toFixed(2)}% | ${withContent}/${report.length} carry content`);
  console.log(`[compare] worst frames: ${JSON.stringify(worst)} → ${outDir}/ (left=live, right=local)`);
  return { viewport, frames: report.length, mean: +mean.toFixed(2), withContent, worst, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2], vp = process.argv[3] || 'desktop';
  if (!dir || dir === '--help') { console.error('usage: node compare.mjs <collectionDir> <desktop|mobile>'); process.exit(dir ? 0 : 1); }
  await compare(dir, vp);
  await compareFrames(dir, vp);
}
