// Browser-driving helpers (require Playwright). Capture and replay run in environment-identical
// contexts so the site's JS renders the same on both sides and the screenshots line up.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export { slugify, layout, saveJson, unzipToTemp } from './paths.mjs';

export const DESKTOP = { width: 1440, height: 900 };
export const MOBILE = { width: 390, height: 844 };

const LAUNCH_ARGS = [
  '--disable-background-networking', '--disable-component-update', '--no-default-browser-check',
  '--no-first-run', '--disable-sync', '--disable-domain-reliability', '--metrics-recording-only', '--disable-quic',
];

// Real Chrome (channel 'chrome') — a genuine browser TLS/JA3 fingerprint, so bot-defenses (Cloudflare
// etc.) treat capture like an ordinary visit. A python/MITM proxy would get challenged; this doesn't.
export async function launchBrowser({ headless = true } = {}) {
  try {
    return await chromium.launch({ channel: 'chrome', headless, args: LAUNCH_ARGS });
  } catch (e) {
    if (/channel|executable|not found|Chrome/i.test(String(e))) {
      throw new Error(`Could not launch Google Chrome. Install it, or run:\n  npx playwright install chrome\n\nOriginal error: ${String(e).slice(0, 200)}`);
    }
    throw e;
  }
}

export function ctxOpts(mobile) {
  const dev = mobile ? devices['Pixel 7'] : null;
  return {
    ...(dev ? { userAgent: dev.userAgent, isMobile: true, hasTouch: true } : {}),
    viewport: mobile ? MOBILE : DESKTOP,
    deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light',
    reducedMotion: 'no-preference', ignoreHTTPSErrors: true,
    serviceWorkers: 'block', // every request must hit the network layer so recordHar sees it
  };
}

export async function recordContext(browser, { mobile, harFile }) {
  fs.mkdirSync(path.dirname(harFile), { recursive: true });
  // mode:'full' + content:'attach' stores every response body byte-for-byte in the HAR zip.
  return browser.newContext({ ...ctxOpts(mobile), recordHar: { path: harFile, mode: 'full', content: 'attach' } });
}

export const newLog = () => ({ requests: [], failed: [], badStatus: [], console: [], pageErrors: [] });

export function attachLoggers(page, log) {
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push({ type: m.type(), text: m.text().slice(0, 500) }); });
  page.on('pageerror', (e) => log.pageErrors.push(String(e).slice(0, 500)));
  page.on('request', (r) => log.requests.push({ url: r.url().slice(0, 300), type: r.resourceType() }));
  page.on('requestfailed', (r) => log.failed.push({ url: r.url().slice(0, 300), type: r.resourceType(), err: r.failure()?.errorText }));
  page.on('response', (r) => { if (r.status() >= 400) log.badStatus.push({ url: r.url().slice(0, 300), status: r.status(), type: r.request().resourceType(), method: r.request().method() }); });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function summarizeLog(log) {
  return {
    requests: log.requests.length,
    failed: log.failed.filter((f) => f.err !== 'net::ERR_ABORTED').length,
    badStatus: log.badStatus.length,
    consoleErrors: log.console.filter((c) => c.type === 'error').length,
    pageErrors: log.pageErrors.length,
  };
}

export async function autoScroll(page, { step = 300, interval = 130, capMs = 90000 } = {}) {
  await Promise.race([
    page.evaluate(async ({ step, interval }) => new Promise((resolve) => {
      let last = -1, stall = 0;
      const tick = () => {
        window.scrollBy(0, step);
        const y = window.scrollY;
        const max = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
        if (y >= max - 2) return resolve();
        if (y === last && ++stall > 10) return resolve();
        if (y !== last) stall = 0;
        last = y;
        setTimeout(tick, interval);
      };
      tick();
    }), { step, interval }),
    sleep(capMs),
  ]).catch(() => {});
}

// Videos stream as 206 range chunks whose bodies record empty in HARs. An in-page no-cors fetch
// pulls the complete file through the page's network stack so a full 200 body lands in the HAR.
export async function fullFetchMedia(page) {
  const urls = await page.evaluate(() => {
    document.querySelectorAll('video').forEach((v) => { try { v.muted = true; v.play().catch(() => {}); } catch {} });
    const urls = new Set();
    document.querySelectorAll('video, audio').forEach((v) => {
      if (v.currentSrc) urls.add(v.currentSrc);
      if (v.src) urls.add(v.src);
      v.querySelectorAll('source').forEach((s) => s.src && urls.add(s.src));
    });
    return [...urls].filter((u) => u.startsWith('http'));
  }).catch(() => []);
  for (const u of urls) {
    await page.evaluate(async (u) => { try { const r = await fetch(u, { mode: 'no-cors', cache: 'reload' }); try { await r.blob(); } catch {} } catch {} }, u).catch(() => {});
  }
  return urls;
}

// One interaction pass, shared by capture and verify so both exercise the same code paths and the
// screenshots line up. Triggers lazy-loading, scroll reveals, nav menus, and takes hero-motion frames.
export async function interact(page, { mobile, qaDir, prefix }) {
  fs.mkdirSync(qaDir, { recursive: true });
  const shot = (name, opts = {}) => page.screenshot({ path: `${qaDir}/${prefix}-${name}.png`, animations: 'allow', ...opts }).catch(() => {});
  await sleep(3000);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  for (let i = 0; i < 6; i++) { await shot(`hero-f${i}`); await sleep(500); } // hero animation frames

  if (!mobile) {
    const items = await page.evaluate(() => {
      const seen = [];
      document.querySelectorAll('header a, header button, nav a, nav button, [role="menubar"] a, [role="menubar"] button').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.top >= 0 && b.top < 130 && b.width > 0 && b.height > 0) seen.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      });
      const uniq = [];
      for (const s of seen) if (!uniq.some((u) => Math.abs(u.x - s.x) < 4 && Math.abs(u.y - s.y) < 4)) uniq.push(s);
      return uniq.slice(0, 12);
    }).catch(() => []);
    for (let i = 0; i < items.length; i++) { await page.mouse.move(items[i].x, items[i].y).catch(() => {}); await sleep(650); if (i < 3) await shot(`nav-${i}`); }
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.move(10, 400).catch(() => {});
  } else {
    for (const sel of ['header button[aria-label*="menu" i]', 'button[aria-label*="menu" i]', 'header [class*="burger" i]', 'header [class*="hamburger" i]', '[data-mobile-menu-trigger]']) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 2000 }).catch(() => {}); await sleep(900); await shot('menu-open'); await page.keyboard.press('Escape').catch(() => {}); await sleep(400); break; }
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  }

  await autoScroll(page);
  await sleep(2500);
  for (const sel of ['[role="tab"]', 'button[aria-label*="next" i]', '[class*="swiper-button-next"]']) {
    for (const el of (await page.locator(sel).all().catch(() => [])).slice(0, 5)) {
      if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 1500 }).catch(() => {}); await sleep(450); }
    }
  }
  // Step a real viewport down the page and shoot each stop. A full-page screenshot re-renders the
  // document at its entire height, and scroll-driven sections (reveal-on-scroll, pinned blocks,
  // anything keyed to the viewport) routinely never paint in one — on pages like that most of the
  // image comes back blank, and a 0% diff over blank pixels proves nothing. These frames are what a
  // visitor actually sees, so they are what the comparison leans on.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(1000);
  const steps = await page.evaluate(() => Math.min(24, Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) / window.innerHeight))).catch(() => 1);
  for (let i = 0; i < steps; i++) {
    await page.evaluate((i) => window.scrollTo(0, i * window.innerHeight), i).catch(() => {});
    await sleep(900);
    await shot(`scroll-${String(i).padStart(2, '0')}`);
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(1200);
  await shot('full', { fullPage: true });
}
