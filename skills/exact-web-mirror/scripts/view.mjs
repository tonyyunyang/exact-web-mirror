// Read an exported copy in real Chrome with the network genuinely unavailable: every request that
// isn't localhost is neutralized before it leaves the machine. Same conditions verify.mjs measures
// under, minus the screenshots — an offline reading room for the archive.
//
// It exists for origin-locked sites. Some sites ship a guard that checks which domain served the
// page and navigates back to their own when it isn't theirs; in an ordinary browser that jump wins
// and you land on the live site instead of your copy. Here the navigation is answered with a 204,
// so the browser abandons it and the copy stays on screen. Nothing in the archive is modified —
// the site's code runs exactly as captured — and this only holds inside a browser this script
// drives. It is not a way to publish a copy: serving one to other people is still someone else's
// site under your domain (see "Using this responsibly" in the README).
//
// Usage: node view.mjs <collectionDir|webpageDir> [--port N] [--mobile]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devices } from 'playwright';
import { launchBrowser, sleep, layout, MOBILE, DESKTOP } from './lib.mjs';
import { startServer } from './serve.mjs';

export async function view(dir, { port = 8890, mobile = false } = {}) {
  const webpageDir = fs.existsSync(`${layout(dir).webpageDir}/__map.json`) ? layout(dir).webpageDir
    : fs.existsSync(`${dir}/__map.json`) ? dir
    : (() => { throw new Error(`${dir} is not an archived collection (no webpage/__map.json). Point this at an archives/<slug> folder.`); })();
  const origin = `http://localhost:${port}`;
  const entry = JSON.parse(fs.readFileSync(`${webpageDir}/__meta.json`, 'utf8')).entryPath || '/';
  const server = startServer(webpageDir, port, { quiet: true });
  await sleep(400);
  const browser = await launchBrowser({ headless: false });
  const dev = mobile ? devices['Pixel 7'] : null;
  const ctx = await browser.newContext({ ...(dev ? { userAgent: dev.userAgent, isMobile: true, hasTouch: true } : {}), viewport: mobile ? MOBILE : DESKTOP, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });
  const blocked = new Set();
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    blocked.add(u.slice(0, 120));
    // 204 = "nothing to navigate to", so the browser stays on the copy instead of leaving it.
    return req.isNavigationRequest() ? route.fulfill({ status: 204 }) : route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  console.log(`Opening the offline copy — nothing but ${origin} can be reached.\nClose the browser window to stop.\n`);
  await page.goto(`${origin}/__boot.html`, { waitUntil: 'load', timeout: 60000 }).catch((e) => console.error(String(e).slice(0, 160)));
  await page.waitForURL(`${origin}${entry}`, { timeout: 20000 }).catch(() => {});
  await new Promise((resolve) => { browser.on('disconnected', resolve); page.on('close', resolve); });
  await browser.close().catch(() => {});
  server.close();
  if (blocked.size) console.log(`\n${blocked.size} outside request(s) were blocked while you read — the copy never left this machine.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
  if (!dir || args.includes('--help')) { console.error('usage: node view.mjs <collectionDir|webpageDir> [--port N] [--mobile]'); process.exit(dir ? 0 : 1); }
  const port = args.includes('--port') ? +args[args.indexOf('--port') + 1] : 8890;
  await view(dir, { port, mobile: args.includes('--mobile') });
}
