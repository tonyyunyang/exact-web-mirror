# Internals — how the pipeline works and the gotchas that make it exact

Read this before debugging a capture that didn't come out identical. Every hard problem in faithful
web archiving reduces to one of the issues below, each with a known cause and fix. They were paid for
in debugging; this doc is so you don't pay again.

## Table of contents
1. The core idea and data flow
2. Capture with real Chrome (not a MITM proxy)
3. Streamed video records as empty bodies (the 206 problem)
4. Never rewrite captured bytes (the RSC / hydration trap)
5. Serve-time URL mapping via a service worker
6. The service worker MUST re-wrap responses (module base URLs)
7. Why the worker is called `__sw.js`
8. CDN MIME types break strict cross-origin loading
9. Redirect flattening for the entry document
10. Verification methodology
11. Design choices and their rationale

---

## 1. The core idea and data flow

```
record.mjs        drive real Chrome through the live page, record every response → HAR zips
extract-media.mjs pull full video/audio bodies out of the HARs → archive/media/
export.mjs        unpack HARs → webpage/ (pristine files) + __sw.js + __map/__types/__meta + __serve.mjs
serve.mjs         static server: same-origin from the tree, cross-origin via /__u/ + Range
verify.mjs        replay offline (non-localhost blocked), screenshot, band-compare vs live
```

Supporting files: `lib.mjs` holds everything that needs Playwright (browser launch, the shared
interaction pass); `paths.mjs` holds the dependency-free bits (collection layout, HAR unzip, browser
opener). The split is deliberate — `export.mjs`, `serve.mjs`, `extract-media.mjs`, and `compare.mjs`
import only `paths.mjs`, so an existing capture can be re-exported and viewed on a machine with
nothing but Node installed. `setup.mjs` is the first-run installer/health check.

The archive is the source of truth; `webpage/` is a derived, regenerable view. Keep the HARs.

## 2. Capture with real Chrome (not a MITM proxy)

Classic archiving proxies (pywb `--proxy-record`, mitmproxy) sit as a man-in-the-middle and fetch
upstream themselves. Their TLS/HTTP fingerprint is not a browser's, so bot-defenses (Cloudflare, etc.)
challenge or block them — exactly the sites you most want to capture.

Driving **real Google Chrome** via Playwright `channel: 'chrome'` and recording with `recordHar`
(`mode: 'full'`, `content: 'attach'`) means the bytes are fetched by an actual browser with an actual
browser fingerprint. Capture is indistinguishable from a person visiting. This single choice removed
every Cloudflare challenge across the sites this pipeline was built on. Playwright's *bundled*
Chromium is not a substitute — `setup.mjs` checks specifically that the `chrome` channel launches.

Corollary: capture and replay use **environment-identical contexts** (same viewport, locale, timezone,
UA) so the site's feature-detection and responsive logic render the same on both sides. See
`ctxOpts()` in `lib.mjs`. The one deliberate asymmetry is `serviceWorkers: 'block'`, set during
capture so every request reaches the network layer where `recordHar` sees it, and *not* set during
replay, where the copy's own worker has to run. Don't "tidy" replay to reuse `ctxOpts()`.

## 3. Streamed video records as empty bodies (the 206 problem)

`<video>` elements fetch their source in byte ranges — the browser issues `Range` requests and gets
`206 Partial Content` responses. Playwright's `recordHar` stores these range responses with **empty
bodies**. So a naively exported page has a `<video>` whose source is a zero-byte 206, and it silently
fails to play.

This is not cosmetic when a site **gates its hero on video readiness**: one site kept its entire top
section (header included) hidden until the hero video could play, so the whole page looked blank
offline until this was fixed.

**Fix (two parts):**
- During capture, `fullFetchMedia()` runs an in-page `fetch(url, {mode:'no-cors'})` for every media
  URL after the page settles. A plain fetch (no Range header) pulls the **complete file** as a `200`,
  which records with a full body.
- `extract-media.mjs` copies those complete bodies to `archive/media/` with a manifest; `export.mjs`
  writes them into the tree and `serve.mjs` serves them with proper HTTP Range support so
  `<video>` scrubbing works.

If a hero is blank offline, check that `extract-media.mjs` ran and that `archive/media/manifest.json`
is non-empty.

## 4. Never rewrite captured bytes (the RSC / hydration trap)

The tempting shortcut is to rewrite absolute URLs inside the captured files (turn
`https://cdn.example/app.js` into `/app.js`). **Do not.** Two ways it breaks:

- **Length-prefixed streams.** React Server Components (Next.js `__next_f` payloads) and similar
  formats embed byte-length or offset prefixes. Changing any URL string changes byte lengths, the
  prefixes no longer match, and the stream fails to parse — the page renders blank or throws during
  hydration. Observed concretely: rewriting made one document 502 bytes shorter and it went blank.
- **Runtime-built URLs.** Sites construct asset URLs at runtime by concatenating a base and a chunk
  name. There is no literal string in the file to rewrite; static rewriting can't reach them.

So `export.mjs` writes **every file exactly as captured** and solves cross-origin references a
different way — at serve time (next section). The rule: *the bytes on disk are the bytes the server
sent.* This also keeps the copy honest and re-verifiable.

## 5. Serve-time URL mapping via a service worker

Because bytes are pristine, the page still asks for its original absolute URLs
(`https://cdn.example/font.woff2`). Two layers answer those locally:

- **Same-origin requests** (to `localhost`) are resolved by `serve.mjs` against `__map.json` (a map of
  `host+path[+query]` → local file) and the file tree.
- **Cross-origin requests** are caught by `webpage/__sw.js`, a tiny service worker registered by
  `__boot.html`. It rewrites any cross-origin URL to `/__u/<encoded original URL>` and lets the server
  look it up in the same map. This is why you open `__boot.html` first — it installs the worker, then
  redirects to `/`.

`__map.json` stores both a query-exact key and a query-less alias, so cache-busted asset URLs still
resolve if the exact query wasn't seen.

## 6. The service worker MUST re-wrap responses (module base URLs)

The subtle one. A service worker that does `e.respondWith(fetch('/__u/...'))` returns a response whose
`.url` is the `/__u/...` URL, not the originally requested URL. The browser then treats it as a
**redirect** and resolves that resource's own relative imports against `/__u/...` — so an ES module's
`import './chunk.js'` resolves to `/__u/chunk.js` and 404s. Whole islands / dynamic-import trees fail
with `Failed to resolve module specifier`.

**Fix:** the worker re-wraps the body in a fresh `Response` so `.url` stays empty and normal base-URL
resolution applies:

```js
fetch('/__u/' + encodeURIComponent(u.href), { headers })
  .then((r) => new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers }));
```

If modules 404 only for cross-origin hosts, this re-wrap is missing or was edited out.

## 7. Why the worker is called `__sw.js`

`/sw.js` is the single most common service-worker path on the real web (Workbox and most PWA build
tools emit exactly that). Writing our worker to `webpage/sw.js` would silently overwrite the captured
site's own worker whenever the site has one — a fidelity bug that only shows up on PWA sites.

Every file the pipeline generates therefore uses a reserved name that no real site path collides
with: `__map.json`, `__types.json`, `__meta.json`, `__sw.js`, `__boot.html`, `__serve.mjs`, plus the
human-facing `OPEN.command` / `OPEN.sh` / `HOW-TO-OPEN.txt`. `export.mjs` warns if a captured path
ever matches one anyway. Archives exported before this rename still work — `serve.mjs` falls through
to the file tree, so their `sw.js` is still served and registered.

## 8. CDN MIME types break strict cross-origin loading

Some CDNs serve `.css` and `.js` as `application/octet-stream` or `text/plain`. Browsers enforce
**strict MIME checking** for stylesheets (`<link rel=stylesheet>`) and module scripts, especially
cross-origin: a stylesheet served as octet-stream is fetched `200 OK` but silently **not applied**, so
the page loads unstyled while the network panel looks clean.

**Fix:** when the recorded content-type is generic (`octet-stream`/`text-plain`/empty), both
`export.mjs` (stored `__types.json`) and `serve.mjs` infer the correct type from the file extension
(`.css` → `text/css`, `.js` → `application/javascript`, fonts, etc.). If a copy renders as unstyled
HTML, this is the first thing to check.

## 9. Redirect flattening for the entry document

`https://site.com/` often 30x-redirects (to `www.`, a locale path, etc.). The final document may be
recorded under the redirected URL, not `site.com/`. `export.mjs` materializes the final document at the
entry host root as well, so opening `/` serves the real landing document without needing the redirect
chain live.

## 10. Verification methodology

Fidelity is proven, not asserted:

- **Ground truth:** `record.mjs` screenshots the *live* page (`live-*`) during capture.
- **Offline replay:** `verify.mjs` serves the copy and loads it with **all non-localhost requests
  aborted and logged**. It reruns the same interaction pass and screenshots `local-*`.
- **Band compare:** `compare.mjs` pads both full-page screenshots to equal height and computes a
  pixel-difference percentage in 900px horizontal bands, emitting side-by-side strips
  (`qa/bands-*/`, left = live, right = local). Full-page images are too tall to read at a glance;
  the bands are.
- **Verdict:** identical page heights (Δ ≤ a few px) and low mean diff (nonzero only where the page
  animates). Review the band strips to confirm remaining diffs are animation frames, not
  layout/asset differences.
- **External attempts** are counted and their hosts printed, but do **not** fail the run. A page with
  analytics keeps firing beacons offline; every one is blocked, which is the point. What matters is
  *what* is in the list: tracker and ads hosts are expected, a CDN that serves page assets is a real
  gap in the capture. Judge the hosts, not the count.
- **Animation liveness:** the six `hero-f0..f5` frames (500ms apart) prove the hero actually moves
  offline rather than sitting on a frozen frame — compare frame-to-frame pixel deltas.

## 11. Design choices and their rationale

- **HAR over WARC/WACZ.** Playwright emits HAR natively and it round-trips through a real browser
  cleanly. WARC (pywb/browsertrix) is a fine alternative but reintroduces the MITM fingerprint problem
  at capture time.
- **Two viewports.** Desktop (1440×900) and mobile (390×844, Pixel-7 UA) are captured and cross-loaded
  so either window size finds its assets; responsive sites differ enough that one pass isn't faithful.
- **Interaction pass shared** between capture and verify (`interact()` in `lib.mjs`) so both sides
  exercise identical code paths and the screenshots line up for comparison.
- **`archive/` kept as master.** `webpage/` is regenerable from the HARs; never hand-edit it — re-run
  `export.mjs`.
- **The server travels with the copy.** `export.mjs` copies `serve.mjs` into each archive as
  `webpage/__serve.mjs`, which is why `serve.mjs` imports only Node builtins. A `webpage/` folder can
  be zipped and handed to someone who has Node and nothing else, and it will still open. Never add an
  npm import to `serve.mjs`.
- **`unzip` is a real dependency.** HARs are recorded as zips and the pipeline shells out to `unzip`
  to read them. A hand-rolled zip reader was considered and rejected: the whole guarantee rests on
  captured bytes being untouched, and that is the worst possible place to introduce a subtle bug.
