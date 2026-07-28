// One command: capture a live URL and produce a faithful, fully-offline local copy.
// Runs record → extract-media → export, then prints how to open and verify.
// Usage: node archive.mjs <url> [--out <dir>] [--name <slug>] [--port <N>] [--headful] [--verify]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record } from './record.mjs';
import { extractMedia } from './extract-media.mjs';
import { exportTree } from './export.mjs';
import { slugify, layout } from './paths.mjs';

const USAGE = `usage: node archive.mjs <url> [options]

  --out <dir>    where collections are written   (default: ./archives, relative to your shell's cwd)
  --name <slug>  collection folder name          (default: derived from the hostname)
  --port <N>     port the copy is served on      (default: 8890)
  --headful      show the browser during capture (useful when a site challenges the capture)
  --verify       after exporting, replay the copy offline and prove it matches the live page

A capture is someone else's work, and archive/*.har.zip records headers and cookies as well as the
page. See "Using this responsibly" in the README before republishing or sharing one.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) { console.error(USAGE); process.exit(1); }
const opt = (flag, def) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : def);
const outBase = path.resolve(opt('--out', path.join(process.cwd(), 'archives')));
const slug = opt('--name', slugify(url));
const dir = `${outBase}/${slug}`;
const port = +opt('--port', 8890);
const headless = !args.includes('--headful');

console.log(`\n▶ Archiving ${url}\n  collection: ${dir}\n`);
await record(url, dir, { headless });
extractMedia(dir);
const { webpageDir } = exportTree(dir, url, { port });
const L = layout(dir);

console.log(`\n✓ Done. The site's real files are in:\n  ${webpageDir}\n`);
console.log(`Open it (offline):\n  macOS: double-click ${path.join(webpageDir, 'OPEN.command')}\n  Linux: ${path.join(webpageDir, 'OPEN.sh')}\n  any:   node ${path.join(webpageDir, '__serve.mjs')} . ${port} --open\n`);
console.log(`Check fidelity vs the live page:\n  node ${path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify.mjs')} "${dir}"\n`);
console.log(`Raw capture (the master, keep it): ${L.archiveDir}\n`);

if (args.includes('--verify')) {
  const { verify } = await import('./verify.mjs');
  await verify(dir, { headless });
}
