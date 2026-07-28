// First-run setup and health check. `node setup.mjs` installs what's missing; `--check` only reports.
// Run this once after installing the skill, and again if a skill/plugin update wiped node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');
const line = (ok, label, fix) => { console.log(`  ${ok ? '✓' : '✗'} ${label}`); if (!ok && fix) console.log(`      → ${fix}`); return ok; };
const has = (cmd) => (process.env.PATH || '').split(path.delimiter)
  .some((d) => { try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; } catch { return false; } });
const canImport = async (m) => { try { await import(m); return true; } catch { return false; } };

console.log(`\nexact-web-mirror — checking ${HERE}\n`);
let ok = true;

ok = line(+process.versions.node.split('.')[0] >= 18, `Node.js ${process.versions.node} (need 18+)`, 'Install Node 18 or newer: https://nodejs.org') && ok;

let writable = true;
try { fs.accessSync(HERE, fs.constants.W_OK); } catch { writable = false; }
ok = line(writable, 'scripts folder is writable (needed for npm install)',
  `Fix permissions on ${HERE}. If this is a plugin install, the plugin cache may be read-only — clone the repo and run ./install.sh to install it as a personal skill instead.`) && ok;

ok = line(has('unzip'), '`unzip` is available (used to read HAR archives)', 'macOS ships it. Debian/Ubuntu: sudo apt install unzip') && ok;

// Dependencies live next to the scripts because ESM ignores NODE_PATH — they cannot be shared from
// elsewhere. A plugin update replaces the plugin folder, so re-run this script after one.
const deps = fs.existsSync(path.join(HERE, 'node_modules'));
if (!deps && !checkOnly) {
  console.log('\n  Installing dependencies (playwright, sharp) — this takes a few minutes…\n');
  try { execFileSync('npm', ['install'], { cwd: HERE, stdio: 'inherit' }); }
  catch { console.error('\n  npm install failed. Run it yourself:\n    cd ' + JSON.stringify(HERE) + ' && npm install\n'); }
  console.log('');
}

const hasPlaywright = await canImport('playwright');
ok = line(hasPlaywright, 'playwright installed (drives the capture browser)', `cd ${JSON.stringify(HERE)} && npm install`) && ok;
line(await canImport('sharp'), 'sharp installed (optional — visual diffs in verify)', `cd ${JSON.stringify(HERE)} && npm install sharp`);

let chrome = false;
if (hasPlaywright) {
  const { chromium } = await import('playwright');
  try { const b = await chromium.launch({ channel: 'chrome', headless: true }); await b.close(); chrome = true; }
  catch {
    if (!checkOnly) {
      console.log('\n  Google Chrome not launchable — installing it via Playwright…\n');
      try { execFileSync('npx', ['playwright', 'install', 'chrome'], { cwd: HERE, stdio: 'inherit' }); } catch {}
      try { const b = await chromium.launch({ channel: 'chrome', headless: true }); await b.close(); chrome = true; } catch {}
      console.log('');
    }
  }
  // Capture uses real Google Chrome on purpose: a genuine browser fingerprint, so bot-defenses treat
  // it as an ordinary visit. Playwright's bundled Chromium is not a substitute.
  ok = line(chrome, 'Google Chrome launchable (capture needs real Chrome, not bundled Chromium)', `cd ${JSON.stringify(HERE)} && npx playwright install chrome`) && ok;
}

console.log(ok
  ? `\nReady. Capture a page with:\n  node ${JSON.stringify(path.join(HERE, 'archive.mjs'))} <url> --verify\n`
  : `\nNot ready yet — fix the ✗ items above${checkOnly ? ', or run this without --check to install them' : ''}.\n`);
process.exit(ok ? 0 : 1);
