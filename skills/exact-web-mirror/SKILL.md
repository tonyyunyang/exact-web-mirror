---
name: exact-web-mirror
description: >-
  Capture a live web page and produce an exact, fully-offline local copy that opens in a normal
  browser — the site's own real HTML/CSS/JS/fonts/videos running, not a hand-rebuilt approximation.
  Use whenever the user wants to mirror, clone, snapshot, archive, or save a website for offline
  viewing, study, or preservation; download a page "with everything working"; or make a
  pixel-identical local copy of a site that "Save Page As" or wget mangles — i.e. modern JavaScript
  app / SPA sites with hashed script chunks, cross-origin CDN assets, runtime fetches, and streamed
  video. Produces a plain folder of files plus a one-command local server, and verifies fidelity
  against the live page with screenshots. Also covers the copyright, privacy, and re-hosting limits
  that come with holding an exact copy of someone else's page.
compatibility: >-
  macOS or Linux. Needs Node.js 18+, Google Chrome, and `unzip`. Run
  `node "${CLAUDE_SKILL_DIR}/scripts/setup.mjs"` once before first use to install dependencies.
metadata:
  version: 1.0.0
---

# Exact web mirror (record-and-replay)

Make a local copy of a web page that is **byte-for-byte the real site** — its own code and assets,
every animation and interaction running as on the live page — and that works **fully offline**.

This is record-and-replay web archiving (the technique behind pywb, Webrecorder, and browsertrix),
packaged as a small self-contained pipeline. It exists because the two obvious approaches both fail
on modern sites:

- **"Save Page As" / `wget` / httrack** grab the HTML and the assets *statically referenced* in it.
  Modern sites are JavaScript apps: the page is assembled at runtime by scripts that fetch more
  scripts, fonts, data, and video — often from other domains, with URLs computed on the fly. A
  static download is missing half its parts and falls apart.
- **Rebuilding the page by hand** produces an approximation, never an exact copy.

Record-and-replay instead records *every network response the real browser receives*, byte for byte,
then serves those exact bytes back locally. The site's own JavaScript runs unmodified; it just can't
tell that its "internet" is now a folder on disk.

## Before capturing — rights, privacy, and what to raise

Archiving a page is an ordinary thing to do, and most requests are exactly what they look like:
someone wants an offline copy to read, study, test against, or keep. Run those without ceremony —
don't interrogate the user about permission for a normal capture of a public page.

Use judgement in the cases where the *result* is the problem rather than the capture:

- **Re-publishing, re-hosting, or reusing as a template.** If the user wants to serve the copy to
  other people, deploy it, or start their own site from a captured one, say plainly that it is
  someone else's work — code, images, and especially fonts, whose licenses are usually bound to the
  original domain and don't travel. Offer to build something fresh instead.
- **Sign-in, checkout, or account pages.** A byte-exact copy of a login page, hosted publicly with a
  working form, is a phishing page. This pipeline produces dead endpoints on purpose. Don't help
  wire them up, and don't help host a copy under a domain that implies it's the original.
- **Anything behind an access control.** The pipeline visits a URL as an ordinary browser. It is not
  for reaching paywalled or logged-in material the user doesn't have access to.
- **Bulk capture.** This is a per-page tool. Looping it across a whole site turns it into a crawler
  that hits someone's server far harder than a visitor would.

Two things worth telling the user when you report a capture:

- `archive/*.har.zip` is a complete network recording — **headers and cookies included**. Anything
  captured while signed in carries session material. The exported `webpage/` folder holds only
  response bodies and a content-type map, so that's the safe folder to share.
- The copy is a faithful *view*, not a working site. See the limits section below.

## First run (once per machine)

```bash
node "${CLAUDE_SKILL_DIR}/scripts/setup.mjs"
```

Installs `playwright` + `sharp` next to the scripts and makes sure real Google Chrome is available.
`--check` reports without installing. Re-run it if a skill or plugin update wipes `node_modules`.

`${CLAUDE_SKILL_DIR}` is the absolute path to this skill's folder — always use it, because the
scripts live with the skill while the user's shell is in their own project.

## Capture a page — one command

```bash
node "${CLAUDE_SKILL_DIR}/scripts/archive.mjs" https://example.com/ --verify
```

**This is slow: budget 5–15 minutes for capture + verify.** Give the Bash call a timeout of at
least 900000 ms, or run it in the background — do not let it be killed at the default timeout and
reported as a failure.

Output goes to `./archives/<site-slug>/` **relative to the shell's working directory**, so it lands
in the user's current project unless you pass `--out <dir>`. Tell the user the actual path.

```
archives/example-com/
├── webpage/           ← the site's real files; double-click webpage/OPEN.command to view offline
│   ├── index.html, assets in their original paths, __ext/<host>/ for other domains
│   ├── __sw.js        ← ~15-line service worker that maps original URLs → local files
│   ├── __serve.mjs    ← the local server, copied in so this folder travels on its own
│   └── OPEN.command / OPEN.sh / HOW-TO-OPEN.txt
├── archive/           ← raw capture: desktop.har.zip, mobile.har.zip, media/ (full videos)
├── qa/                ← live-* vs local-* screenshots, bands-*/ side-by-side diff strips
└── logs/              ← request/console logs + verify verdict
```

Useful flags: `--out <dir>`, `--name <slug>`, `--port <N>`, `--headful` (show the browser — try this
if a site challenges the capture), `--verify`.

Open a copy any time: double-click `webpage/OPEN.command` (macOS), run `webpage/OPEN.sh` (Linux), or
`node <collection>/webpage/__serve.mjs . 8890 --open`.

## Why a local server (and not a bare file:// double-click)

These are JavaScript-app sites, and browsers refuse to run service workers and ES modules from a
bare `file://` page — a browser security rule, not a limitation of the copy. `OPEN.command` starts a
tiny localhost server for the duration and opens the page; closing the window stops it. Nothing is
installed and nothing leaves the machine. The captured files themselves are 100% unmodified.

## The pipeline (what each step does, if you run them individually)

Run these instead of `archive.mjs` when you want control over a single stage. `<dir>` is the
collection directory, e.g. `archives/example-com`. Prefix each with `${CLAUDE_SKILL_DIR}/scripts/`.

| Step | Command | Purpose |
|---|---|---|
| 1. Record | `node record.mjs <url> <dir>` | Drive real Chrome through the page (scroll to bottom, hover nav, open menus, play video) at desktop + mobile sizes, recording every response byte-for-byte into HAR zips. Also saves `live-*` screenshots as ground truth. |
| 2. Extract media | `node extract-media.mjs <dir>` | Pull complete video/audio bodies out of the HARs (streamed video records as empty-bodied range chunks — this is the one thing the archive can't serve as-is). |
| 3. Export | `node export.mjs <dir> <url>` | Unpack the HARs into `webpage/` as **pristine, unmodified files**, and emit the service worker + server metadata that make cross-origin URLs resolve locally. |
| 4. Serve | `node serve.mjs <dir>/webpage [port] --open` | Static server with the service-worker URL mapper and HTTP Range support (for video). |
| 5. Verify | `node verify.mjs <dir>` | Reload the copy with **all non-localhost traffic blocked**, rerun the interaction pass, screenshot as `local-*`, and band-compare against `live-*`. Prints PASS when page heights match and diffs are animation-only. |

Steps 1–3 are what `archive.mjs` runs; 5 is what `--verify` adds. Only steps 1 and 5 need Chrome;
export and serve run on plain Node, so an existing capture can be re-exported or viewed anywhere.

## What "exact" means here — and the honest limits

Verification (step 5) passes when, versus the live page: **full-page heights match to the pixel**
(desktop 1440w and mobile 390w) and band-by-band pixel diffs are ~0% except where the page is
genuinely animating (a video or canvas caught mid-frame). Hero animations, scroll effects, nav
dropdowns, tabs, and carousels run because it is the site's real code.

Expected, by-design gaps — surface these to the user rather than hiding them:

- **Analytics/tracker/ads beacons** still fire and get local 404s or blocked attempts (they have no
  local endpoint). Cosmetic; visible in DevTools; nothing actually phones home — that's the point.
  `verify` prints the count and the hosts so you can confirm they're beacons, not page assets.
- **Forms, logins, search, chat** submit to dead endpoints. The copy is a faithful *view*, not a
  working backend.
- **Scope is the captured page(s).** Links to other pages 404 locally unless you also archive them
  (run `archive.mjs` on those URLs too). Capture is A/B- and geo-specific to what the live site
  served at capture time.
- **Consent banners** reappear (their "remember" POST is dead offline) — the same thing a fresh
  visitor sees.

Report fidelity from the evidence, not from assertion: the `qa/bands-*/` strips (left = live,
right = local), the `[verify] PASS/REVIEW` line, and `logs/verify-meta.json`. State expected gaps
plainly.

## Fonts (optional)

Every font the page renders with is already captured (it's why the copy is pixel-identical),
including proprietary brand faces, sitting under `webpage/`. If the user wants a font inventory
("what typeface is used where"), load each part's computed `fontFamily`/`fontWeight` from the served
copy and list the `.woff2`/`.ttf` files on disk — do not re-download from foundries. Report what the
capture already contains, and note license class (open OFL/Apache vs proprietary) honestly.

## Gotchas and internals

If a capture doesn't come out identical, the failure is almost always one of a handful of specific
issues (blank hero from streamed video, unstyled page from CDN MIME types, broken module imports
from service-worker redirect semantics, a corrupted React RSC stream from rewriting bytes). Each has
a known cause and fix. **Read `references/internals.md` before debugging a bad capture** — it will
save you from re-deriving them.

## Troubleshooting quick table

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot find package 'playwright'` | Dependencies not installed, or an update wiped them | `node "${CLAUDE_SKILL_DIR}/scripts/setup.mjs"` |
| Command killed after ~5 minutes | Bash timeout too short for a real capture | Re-run with a ≥900000 ms timeout or in the background |
| Hero/section blank, but present live | Streamed video recorded as empty 206 | Ensure `extract-media.mjs` ran; the page may gate its hero on video readiness (see internals) |
| Page loads but unstyled | CDN served CSS as `application/octet-stream`; strict MIME rejects it | Already handled by extension-based MIME inference in `export.mjs`/`serve.mjs` |
| `Failed to resolve module specifier` in console | Service worker changed `response.url` → module base URL broke | `__sw.js` re-wraps responses in `new Response()`; confirm it wasn't edited (see internals) |
| Blank page, JS error about lengths/hydration | Something rewrote captured bytes | Never modify captured bytes; export keeps them pristine and maps URLs at serve time |
| Capture challenged / blocked | Not using real Chrome | Confirm setup reports Chrome launchable; try `--headful` |
| `Port 8890 is already in use` | Another copy is open | Pass `--port <N>`, or close the other server window |
