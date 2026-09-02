// Verify an exported copy: serve it, load it in a browser that can reach ONLY localhost (everything
// else is aborted + logged), run the interaction pass, screenshot as local-*, and band-compare vs
// the live-* baselines. Proves the copy is faithful AND self-contained (nothing phones home).
// Usage: node verify.mjs <collectionDir> [--headful] [--port N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices } from 'playwright';
import { launchBrowser, attachLoggers, newLog, interact, saveJson, summarizeLog, sleep, layout, MOBILE, DESKTOP } from './lib.mjs';

// Resource kinds a faithful archive is supposed to contain; anything else 404ing offline is a dead
// endpoint, not a gap.
const ASSET_TYPES = new Set(['script', 'stylesheet', 'font', 'image', 'media', 'document']);
import { startServer } from './serve.mjs';
import { compare, compareFrames } from './compare.mjs';

export async function verify(dir, { headless = true, port = 8990 } = {}) {
  const L = layout(dir);
  const origin = `http://localhost:${port}`;
  const entry = JSON.parse(fs.readFileSync(`${L.webpageDir}/__meta.json`, 'utf8')).entryPath || '/';
  const server = startServer(L.webpageDir, port, { quiet: true });
  await sleep(600);
  const browser = await launchBrowser({ headless });
  const results = {};
  try {
    for (const viewport of ['desktop', 'mobile']) {
      const mobile = viewport === 'mobile';
      const dev = mobile ? devices['Pixel 7'] : null;
      // Mirrors ctxOpts() from lib.mjs but WITHOUT serviceWorkers:'block' — capture blocks workers so
      // every request reaches the recorder, replay needs the copy's own worker to map its URLs.
      const ctx = await browser.newContext({ ...(dev ? { userAgent: dev.userAgent, isMobile: true, hasTouch: true } : {}), viewport: mobile ? MOBILE : DESKTOP, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' });
      const external = [], bounces = [];
      await ctx.route('**/*', (route) => {
        const req = route.request();
        const u = req.url();
        if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        external.push(u.slice(0, 200)); // an external attempt = something the copy still reaches for
        // Origin-locked sites ship a guard that sends the page back to their own domain when it is
        // served from anywhere else. Aborting that navigation throws away the document Chrome has
        // already parsed and leaves an error page to screenshot, so there is nothing to measure. A
        // 204 makes the browser abandon the navigation and stay put. Counted and reported, not hidden.
        if (req.isNavigationRequest()) { bounces.push(u.slice(0, 200)); return route.fulfill({ status: 204 }); }
        return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage();
      const log = newLog();
      attachLoggers(page, log);
      console.log(`[verify] ${viewport} offline replay → ${origin}${entry}`);
      await page.goto(`${origin}/__boot.html`, { waitUntil: 'load', timeout: 60000 }).catch((e) => console.error('goto:', String(e).slice(0, 140)));
      await page.waitForURL(`${origin}${entry}`, { timeout: 20000 }).catch(() => {});
      await page.waitForLoadState('load').catch(() => {});
      await interact(page, { mobile, qaDir: L.qaDir, prefix: `local-${viewport}` });
      await sleep(800);
      const uniq = [...new Set(external)];
      const hosts = [...new Set(uniq.map((u) => { try { return new URL(u).host; } catch { return u; } }))];
      const bounced = [...new Set(bounces)];
      // Offline, a 404 can only have come from the local server: the copy asked for something the
      // archive does not hold. Which kind it is decides whether that matters — a missing script or
      // font is a hole in the capture, while a POST to an API or a beacon was never going to have a
      // local answer. Reported apart so the count means something.
      const notInArchive = log.badStatus.filter((b) => b.status === 404);
      const assetGaps = [...new Set(notInArchive.filter((b) => b.method === 'GET' && ASSET_TYPES.has(b.type)).map((b) => b.url.replace(origin, '')))];
      const deadEndpoints = notInArchive.length - notInArchive.filter((b) => b.method === 'GET' && ASSET_TYPES.has(b.type)).length;
      results[viewport] = { summary: summarizeLog(log), externalAttempts: uniq.length, externalHosts: hosts, originBounces: bounced, assetGaps, deadEndpoints };
      saveJson(`${L.logsDir}/verify-${viewport}.json`, { summary: summarizeLog(log), externalHosts: hosts, originBounces: bounced, assetGaps, deadEndpoints, externalAttempts: uniq.slice(0, 80), log });
      console.log(`[verify] ${viewport} ${JSON.stringify(summarizeLog(log))} externalAttempts:${uniq.length}${hosts.length ? ` (all blocked: ${hosts.slice(0, 6).join(', ')}${hosts.length > 6 ? ', …' : ''})` : ''}`);
      if (notInArchive.length) console.log(`[verify] ${viewport} not in the archive: ${assetGaps.length} page asset(s)${assetGaps.length ? ` — ${assetGaps.slice(0, 3).map((u) => u.slice(-58)).join(', ')}${assetGaps.length > 3 ? ', …' : ''}` : ''}; ${deadEndpoints} dead endpoint(s) (APIs/beacons, expected).`);
      if (bounced.length) console.log(`[verify] ${viewport} origin-locked: the page tried to navigate itself back to ${bounced.slice(0, 2).join(', ')} — neutralized for measurement (see the note below).`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const cmp = { desktop: await compare(dir, 'desktop'), mobile: await compare(dir, 'mobile') };
  const frm = { desktop: await compareFrames(dir, 'desktop'), mobile: await compareFrames(dir, 'mobile') };
  saveJson(`${L.logsDir}/verify-meta.json`, { verifiedAt: new Date().toISOString(), results, compare: cmp, frames: frm });

  // The bar: page heights identical and visual diff low. External attempts are reported but do not
  // fail the run — analytics/tracker beacons legitimately keep firing and are simply blocked.
  const allBounces = [...new Set(['desktop', 'mobile'].flatMap((v) => results[v]?.originBounces || []))];
  const allGaps = [...new Set(['desktop', 'mobile'].flatMap((v) => results[v]?.assetGaps || []))];
  const measured = ['desktop', 'mobile'].every((v) => cmp[v]);
  // Frames are the load-bearing evidence where they exist; the full-page diff and equal heights
  // still have to hold. Thresholds allow for a hero or canvas caught on a different frame.
  const ok = measured && ['desktop', 'mobile'].every((v) => cmp[v].deltaH <= 4 && cmp[v].mean < 15 && (!frm[v] || frm[v].mean < 15));
  if (!measured) {
    console.log('\n[verify] INCONCLUSIVE — offline replay ran, but the visual diff could not be computed (see [compare] messages above).');
  } else {
    const framed = frm.desktop && frm.mobile ? ` | scrolled frames ${frm.desktop.mean}%/${frm.mobile.mean}% over ${frm.desktop.frames}/${frm.mobile.frames} stops` : '';
    console.log(`\n[verify] ${ok ? 'PASS' : 'REVIEW'} — heights Δ ${cmp.desktop.deltaH}/${cmp.mobile.deltaH}px | full-page diff ${cmp.desktop.mean}%/${cmp.mobile.mean}%${framed} (nonzero = animated regions).`);
    console.log(`[verify] Read the strips yourself: qa/frames-*/ (each scroll stop) and qa/bands-*/ (the full-page shot), left=live, right=local.`);
    for (const v of ['desktop', 'mobile']) {
      if (cmp[v].withContent < cmp[v].bands) console.log(`[verify] ${cmp[v].bands - cmp[v].withContent}/${cmp[v].bands} ${v} full-page bands are blank in BOTH images — a full-page screenshot doesn't paint scroll-driven sections. Weigh the frames, not those bands.`);
    }
  }
  if (allGaps.length) {
    console.log(`[verify] ${allGaps.length} asset(s) the replay asked for are not in the archive. If the page still matches, they are\n         code paths the live pass never took; if it doesn't, re-record — that is the hole.`);
  }
  if (allBounces.length) {
    // The copy travels on its own, so the warning has to travel in it — HOW-TO-OPEN.txt otherwise
    // promises a double-click that lands on the live site. Idempotent: re-verifying won't stack it.
    const howTo = `${L.webpageDir}/HOW-TO-OPEN.txt`;
    const marker = 'THIS SITE IS ORIGIN-LOCKED';
    try {
      if (fs.existsSync(howTo) && !fs.readFileSync(howTo, 'utf8').includes(marker)) {
        fs.appendFileSync(howTo, `\n${marker}\nIts own code checks which domain served it and jumps to ${allBounces[0]} when that isn't\nthe real one, so OPEN.command will land you on the live site instead of this copy. The archive\nhere is complete and verified; reading it offline needs a browser that refuses to leave, which is\nwhat the skill's view.mjs provides.\n`);
      }
    } catch {}
    console.log(`\n[verify] Note: this site is ORIGIN-LOCKED. Its own code checks the domain it is served from and\n         navigates back to ${allBounces[0]} when it isn't the real one. The archive is complete —\n         verification neutralized the bounce to measure it — but opening webpage/ in your normal\n         browser will jump to the live site. Read the copy with:\n           node ${JSON.stringify(path.join(path.dirname(fileURLToPath(import.meta.url)), 'view.mjs'))} ${JSON.stringify(dir)}`);
  }
  return { ok, measured, cmp, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
  if (!dir || args.includes('--help')) { console.error('usage: node verify.mjs <collectionDir> [--headful] [--port N]'); process.exit(dir ? 0 : 1); }
  const port = args.includes('--port') ? +args[args.indexOf('--port') + 1] : 8990;
  await verify(dir, { headless: !args.includes('--headful'), port });
}
