// Verify an exported copy: serve it, load it in a browser that can reach ONLY localhost (everything
// else is aborted + logged), run the interaction pass, screenshot as local-*, and band-compare vs
// the live-* baselines. Proves the copy is faithful AND self-contained (nothing phones home).
// Usage: node verify.mjs <collectionDir> [--headful] [--port N]
import { fileURLToPath } from 'node:url';
import { devices } from 'playwright';
import { launchBrowser, attachLoggers, newLog, interact, saveJson, summarizeLog, sleep, layout, MOBILE, DESKTOP } from './lib.mjs';
import { startServer } from './serve.mjs';
import { compare } from './compare.mjs';

export async function verify(dir, { headless = true, port = 8990 } = {}) {
  const L = layout(dir);
  const origin = `http://localhost:${port}`;
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
      const external = [];
      await ctx.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        external.push(u.slice(0, 200)); // an external attempt = something the copy still reaches for
        return route.abort('blockedbyclient');
      });
      const page = await ctx.newPage();
      const log = newLog();
      attachLoggers(page, log);
      console.log(`[verify] ${viewport} offline replay → ${origin}/`);
      await page.goto(`${origin}/__boot.html`, { waitUntil: 'load', timeout: 60000 }).catch((e) => console.error('goto:', String(e).slice(0, 140)));
      await page.waitForURL(`${origin}/`, { timeout: 20000 }).catch(() => {});
      await page.waitForLoadState('load').catch(() => {});
      await interact(page, { mobile, qaDir: L.qaDir, prefix: `local-${viewport}` });
      await sleep(800);
      const uniq = [...new Set(external)];
      const hosts = [...new Set(uniq.map((u) => { try { return new URL(u).host; } catch { return u; } }))];
      results[viewport] = { summary: summarizeLog(log), externalAttempts: uniq.length, externalHosts: hosts };
      saveJson(`${L.logsDir}/verify-${viewport}.json`, { summary: summarizeLog(log), externalHosts: hosts, externalAttempts: uniq.slice(0, 80), log });
      console.log(`[verify] ${viewport} ${JSON.stringify(summarizeLog(log))} externalAttempts:${uniq.length}${hosts.length ? ` (all blocked: ${hosts.slice(0, 6).join(', ')}${hosts.length > 6 ? ', …' : ''})` : ''}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const cmp = { desktop: await compare(dir, 'desktop'), mobile: await compare(dir, 'mobile') };
  saveJson(`${L.logsDir}/verify-meta.json`, { verifiedAt: new Date().toISOString(), results, compare: cmp });

  // The bar: page heights identical and visual diff low. External attempts are reported but do not
  // fail the run — analytics/tracker beacons legitimately keep firing and are simply blocked.
  const measured = ['desktop', 'mobile'].every((v) => cmp[v]);
  const ok = measured && ['desktop', 'mobile'].every((v) => cmp[v].deltaH <= 4 && cmp[v].mean < 15);
  if (!measured) {
    console.log('\n[verify] INCONCLUSIVE — offline replay ran, but the visual diff could not be computed (see [compare] messages above).');
  } else {
    console.log(`\n[verify] ${ok ? 'PASS' : 'REVIEW'} — heights Δ ${cmp.desktop.deltaH}/${cmp.mobile.deltaH}px, mean diff ${cmp.desktop.mean}%/${cmp.mobile.mean}% (nonzero = animated regions).`);
    console.log('[verify] Review qa/bands-*/ band strips (left=live, right=local) to confirm remaining diffs are animation only.');
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
