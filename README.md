# exact-web-mirror

Capture a live web page and get back an **exact, fully-offline local copy** — the site's own real
HTML, CSS, JavaScript, fonts, images, and video, running in a normal browser from a folder on your
disk. Every animation is the original site's code executing, not a re-implementation.

It works on modern JavaScript-app sites (SPAs, hashed chunks, cross-origin CDN assets, runtime
fetches, streamed video) where **"Save Page As", `wget`, and httrack fall apart**, because it doesn't
try to guess what a page needs. It records every network response a real browser receives, byte for
byte, and serves those exact bytes back locally. The site's own JavaScript runs unmodified; it just
can't tell that its "internet" is now a folder on disk.

This is packaged as a **Claude Code skill** — ask Claude to mirror a page and it runs the pipeline
and reports the evidence — and the same scripts run standalone from the command line.

MIT licensed. Before you point it at a site that isn't yours, read
[Using this responsibly](#using-this-responsibly) — an exact copy of someone else's page comes with a
few things worth knowing.

---

## What it can do

- **Byte-exact copies.** Captured files are written to disk exactly as the server sent them. Nothing
  is rewritten, minified, or "fixed" — that's what keeps hydration streams and runtime-built asset
  URLs intact.
- **Runs fully offline.** No network access at view time. Verification actively blocks every request
  that isn't localhost and confirms the page still renders.
- **Survives modern sites.** Cross-origin CDN assets, hashed script chunks, ES modules, service
  workers, web fonts, `<video>` with byte-range streaming, responsive/mobile variants.
- **Real animations.** Hero effects, scroll reveals, nav dropdowns, tabs, and carousels work, because
  the copy is running the site's real code.
- **Proves its own fidelity.** Replays the copy offline, screenshots it, and diffs it band-by-band
  against screenshots of the live page taken during capture. You get a PASS/REVIEW verdict plus
  side-by-side image strips to check yourself.
- **Portable output.** A finished copy is a plain folder with a double-click opener and a copy of the
  server inside it. Zip it, move it, hand it to someone who has Node and nothing else.

### What it deliberately does not do

A copy is a faithful **view**, not a working site. Forms, logins, search, and chat post to dead
endpoints. Analytics beacons get blocked or 404. Links to pages you didn't capture 404 too — capture
those URLs as well if you need them. The dead endpoints are deliberate: the output is a read-only
archive, and it's meant to stay one.

---

## Requirements

- **macOS or Linux**
- **Node.js 18+**
- **Google Chrome** (real Chrome, not Chromium — capture uses a genuine browser fingerprint so
  bot-defenses treat it as an ordinary visit; `setup.mjs` can install it for you)
- **`unzip`** on your PATH (ships with macOS; `sudo apt install unzip` on Debian/Ubuntu)

Roughly 400 MB of npm dependencies (Playwright + sharp) are installed on first run.

---

## Install

Pick one of the three routes. All three end up running the same scripts.

### 1. As a Claude Code plugin (recommended)

From inside Claude Code:

```
/plugin marketplace add <url-or-path-to-this-repo>
/plugin install exact-web-mirror@exact-web-mirror
```

The marketplace source can be a git URL (`https://…/exact-web-mirror.git`, SSH, GitHub `owner/repo`
shorthand) or a local path to a clone. Restart Claude Code or run `/reload-plugins`.

Then do the one-time dependency install. The simplest way is to **ask Claude to run the
exact-web-mirror setup** — it knows where the skill was installed. From a terminal, let the shell
find it (the install path contains a version directory, so it isn't stable enough to hardcode):

```bash
node "$(find ~/.claude/plugins/cache -path '*exact-web-mirror/scripts/setup.mjs' | head -1)"
```

Note that installing a plugin *update* replaces its folder and discards the installed dependencies —
re-run setup if capture suddenly reports a missing `playwright`. If you'd rather dependencies
survive updates, use the personal-skill route below instead.

### 2. As a personal skill (no plugin system)

```bash
git clone <this-repo> ~/src/exact-web-mirror
~/src/exact-web-mirror/install.sh
```

`install.sh` symlinks `skills/exact-web-mirror` into `~/.claude/skills/` (so `git pull` updates the
installed skill) and runs the dependency setup. Use `--copy` to copy instead of symlink, `--project`
to install into the current repo's `.claude/skills/` instead, and `--uninstall` to remove it.

### 3. Standalone, no Claude Code at all

```bash
git clone <this-repo> exact-web-mirror
cd exact-web-mirror/skills/exact-web-mirror/scripts
npm install && npx playwright install chrome
```

> Claude Code installs skills as directories, not as archives — there is no `.skill` bundle to
> install here. (A zipped skill folder is the upload format for claude.ai, a different surface.)

---

## Use

### With Claude Code

Just ask, in your own words — the skill triggers on requests like these:

- "Make an offline copy of https://example.com that still works"
- "Mirror this landing page so I can study how the animation is built"
- "Snapshot this page before they redesign it"

Claude runs the pipeline, then reports where the copy landed and how it verified. Capture takes
**5–15 minutes** for a real page; that is normal.

### From the command line

```bash
S=skills/exact-web-mirror/scripts     # or ~/.claude/skills/exact-web-mirror/scripts

node "$S/setup.mjs"                                   # once per machine
node "$S/archive.mjs" https://example.com/ --verify    # capture + prove fidelity
```

Options: `--out <dir>` (default `./archives`), `--name <slug>`, `--port <N>`, `--headful` (watch the
browser work — useful if a site challenges the capture), `--verify`.

Open a finished copy any time — double-click `webpage/OPEN.command` on macOS, run `webpage/OPEN.sh`
on Linux, or `node <copy>/webpage/__serve.mjs . 8890 --open` anywhere.

### What you get

```
archives/example-com/
├── webpage/     the site's real files, byte-pristine, plus a double-click opener and __serve.mjs
├── archive/     the raw capture: desktop.har.zip, mobile.har.zip, media/ — this is the master
├── qa/          live-* vs local-* screenshots and bands-*/ side-by-side diff strips
└── logs/        request/console logs and the verification verdict
```

`webpage/` is regenerable from `archive/` at any time — keep the HARs, and never hand-edit the
exported tree.

### Why it needs a local server

Browsers refuse to run service workers and ES modules from a bare `file://` page. That's a browser
security rule, not a limitation of the copy. The opener starts a Node server bound to `127.0.0.1`,
opens the page, and stops when you close the window. Nothing is installed and nothing leaves the
machine.

---

## Running the stages individually

`archive.mjs` is `record` → `extract-media` → `export`; `--verify` adds the last stage.

| Stage | Command | What it does |
|---|---|---|
| Record | `node record.mjs <url> <dir>` | Drives real Chrome through the page at desktop and mobile sizes, recording every response into HAR zips, and screenshots the live page as ground truth |
| Extract media | `node extract-media.mjs <dir>` | Pulls complete video/audio bodies out of the HARs (streamed video otherwise records as empty range chunks) |
| Export | `node export.mjs <dir> <url>` | Unpacks the HARs into `webpage/` as pristine files, plus the service worker and map that make original URLs resolve locally |
| Serve | `node serve.mjs <dir>/webpage [port] --open` | Static server with the URL mapper and HTTP Range support |
| Verify | `node verify.mjs <dir>` | Replays the copy with all non-localhost traffic blocked, screenshots it, and band-compares against the live baseline |

Only `record` and `verify` need Chrome. `export` and `serve` run on plain Node, so an existing
capture can be re-exported or viewed on a machine with no dependencies installed.

---

## How it works, in one paragraph

Real Google Chrome (via Playwright) is driven through the live page while every network response is
recorded byte-for-byte into a HAR archive. Those bytes are unpacked into a plain file tree **without
modification** — rewriting URLs inside them would corrupt length-prefixed streams like React Server
Components and would miss URLs the site builds at runtime anyway. Instead, a tiny service worker
(`__sw.js`) maps the page's original absolute URLs onto the local files at request time, so the
site's own JavaScript runs unmodified. Verification then reloads the copy with all non-localhost
traffic blocked and diffs it against the live screenshots, band by band.

The full design notes and the hard-won gotchas — streamed video recording as empty 206s, why you must
never rewrite captured bytes, service-worker redirect semantics breaking module imports, CDN MIME
quirks — are in
[`skills/exact-web-mirror/references/internals.md`](skills/exact-web-mirror/references/internals.md).
Read it before debugging a capture that didn't come out identical.

---

## Repository layout

```
.claude-plugin/
  plugin.json          Claude Code plugin manifest
  marketplace.json     makes this repo installable as a one-plugin marketplace
skills/exact-web-mirror/
  SKILL.md             what Claude reads: when to use this and how
  references/
    internals.md       design notes and the debugging gotchas
  scripts/             the pipeline (see the stage table above)
install.sh             symlink or copy the skill into ~/.claude/skills/
```

---

## Using this responsibly

Archiving web pages is ordinary and long-established — it's what the Internet Archive, pywb,
Webrecorder, and browsertrix do, and what every browser's "Save Page As" attempts and does badly.
The tool is not the sensitive part. What you point it at, and what you do with the result, is where
the care goes. Five minutes of reading, once.

**The copy is someone else's work.** A captured page brings their code, images, video, and fonts with
it — and commercial webfont licenses in particular are usually tied to a specific domain and do not
travel with a copy. Keeping a local copy to read offline, study how something is built, test against,
or preserve is a normal use. Republishing it, serving it to other people, or lifting its assets into a
site you're building is a different thing entirely, and "byte-exact" makes that hard to argue about.

**Only capture what you could already open.** The pipeline drives an ordinary browser to an ordinary
URL. It doesn't break anything open and shouldn't be made to. Don't reach for material behind a
paywall or a login you don't have, and don't use it to step around an access control — that's the
line where copying a web page stops being a copyright question and becomes a computer-misuse one.

**Check the site's terms.** Plenty of sites restrict automated access or copying in their terms of
service. That's between you and them, but it's worth two minutes before you capture.

**Your archive holds more than the page.** `archive/*.har.zip` is a complete network recording:
every request and response, **headers and cookies included**. Capture anything while signed in and
your session material is in there. The exported `webpage/` folder holds only response bodies and a
content-type map, so that's the one to hand around — think before sharing raw HARs.

**Don't stand a copy up as the real thing.** A pixel-exact offline copy of a sign-in page becomes a
phishing page the moment someone hosts it publicly and wires the form to a collector. This pipeline
produces dead endpoints on purpose. Leave them dead, don't serve a copy from a domain that implies
it's the original, and don't use it to impersonate a person or an organization.

**Keep the volume sane.** This is a per-page tool that loads a page a handful of times, the way a
visitor would. It isn't a crawler and shouldn't be turned into one by looping it over a whole site.

None of this is legal advice, and the answers genuinely differ by country and by purpose — personal
study, research, journalism, and commercial use are not treated the same way. If a particular
capture matters, ask someone who can advise you properly.

---

## License

[MIT](LICENSE) — do what you like with the tool, including commercially, with attribution and no
warranty.

That covers **this software only**. It grants you nothing over any website you copy with it: the
rights in captured content stay with whoever owned them, which is what the section above is about.
