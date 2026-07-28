// Capture a live page into HAR archives (desktop + mobile) with live screenshots as ground truth.
// Usage: node record.mjs <url> <collectionDir> [--headful] [--only desktop|mobile]
import { fileURLToPath } from 'node:url';
import { launchBrowser, recordContext, attachLoggers, newLog, interact, fullFetchMedia, saveJson, summarizeLog, sleep, layout } from './lib.mjs';

export async function record(url, dir, { headless = true, only = null } = {}) {
  const L = layout(dir);
  const browser = await launchBrowser({ headless });
  const meta = { url, capturedAt: new Date().toISOString() };
  try {
    for (const viewport of ['desktop', 'mobile']) {
      if (only && viewport !== only) continue;
      const mobile = viewport === 'mobile';
      const ctx = await recordContext(browser, { mobile, harFile: L.har(viewport) });
      const page = await ctx.newPage();
      const log = newLog();
      attachLoggers(page, log);
      console.log(`[record] ${viewport} → ${url}`);
      try { await page.goto(url, { waitUntil: 'load', timeout: 90000 }); }
      catch (e) { console.error(`[record] goto: ${String(e).slice(0, 160)}`); }
      meta[`${viewport}FinalUrl`] = page.url();
      await interact(page, { mobile, qaDir: L.qaDir, prefix: `live-${viewport}` });
      meta[`${viewport}Media`] = await fullFetchMedia(page);
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await sleep(1500);
      saveJson(`${L.logsDir}/record-${viewport}.json`, { summary: summarizeLog(log), log });
      console.log(`[record] ${viewport} ${JSON.stringify(summarizeLog(log))}`);
      await ctx.close(); // flushes HAR
    }
  } finally {
    await browser.close();
  }
  saveJson(`${L.logsDir}/record-meta.json`, meta);
  return meta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [url, dir] = args.filter((a) => !a.startsWith('--') && a !== 'desktop' && a !== 'mobile');
  if (!url || !dir || args.includes('--help')) { console.error('usage: node record.mjs <url> <collectionDir> [--headful] [--only desktop|mobile]'); process.exit(url && dir ? 0 : 1); }
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  await record(url, dir, { headless: !args.includes('--headful'), only });
}
