// Dependency-free helpers: on-disk layout of a collection, plus the two OS shell-outs the pipeline
// needs. Kept separate from lib.mjs so export/extract-media/compare run without Playwright installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Standard on-disk layout of one archived collection.
export const slugify = (url) => new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

export const layout = (dir) => ({
  root: dir, archiveDir: `${dir}/archive`, mediaDir: `${dir}/archive/media`,
  webpageDir: `${dir}/webpage`, qaDir: `${dir}/qa`, logsDir: `${dir}/logs`,
  har: (vp) => `${dir}/archive/${vp}.har.zip`,
});

export function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}

// HARs are recorded as zips (Playwright's `recordHar` with a .zip path). Response bodies live as
// separate members inside, so reading one means unpacking it to a scratch dir first.
export function unzipToTemp(zipFile, prefix = 'ewm-') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    execFileSync('unzip', ['-o', '-q', zipFile, '-d', tmp]);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error("`unzip` not found on PATH. Install it (macOS ships it; Debian/Ubuntu: `sudo apt install unzip`) and re-run.");
    throw e;
  }
  return tmp;
}
