# 🧪 The Hard Page — the demo fixture

A small page built for one purpose: **to be hard to copy.** Everything on it is original to this
repository, so you can capture it, break it, and republish the results without touching anyone
else's work.

Five things this page needs come from somewhere a naive downloader won't follow. Then the page
**grades its own capture** — it re-runs all five checks on whatever copy you open, so a broken copy
says so out loud instead of quietly looking fine.

| # | Trap | What it defeats |
|---|---|---|
| 01 | Stylesheet on a second origin | Downloaders that only walk the page's own host |
| 02 | ES module that builds its chunk's address at run time | Anything that scans markup for links — the URL is in no file |
| 03 | Video fetched in byte ranges | Recorders that store partial responses and end up with fragments |
| 04 | Image whose address is assembled by script after load | Static analysis of any kind; you have to run the page |
| 05 | Canvas animation drawn frame by frame | Screenshots, and any copy that keeps the pixels but loses the code |

## ▶️ Run it

```bash
node serve-demo.mjs --open
```

Two servers start, and the two ports are what make this a fair test rather than a simulation:

- `http://localhost:7801` — the page
- `http://localhost:7802` — the "CDN" (stylesheet, modules, video, image)

Different ports are different origins, so the cross-origin path is genuinely exercised.

## 🪞 Capture it

With the demo still running, in a second terminal:

```bash
node ../skills/exact-web-mirror/scripts/archive.mjs http://localhost:7801/ --name hard-page --verify
```

Then **stop the demo servers** — that's the whole point — and open the copy:

```bash
open archives/hard-page/webpage/OPEN.command      # macOS
./archives/hard-page/webpage/OPEN.sh              # Linux
```

The copy should read **5 / 5 live** with the origins dead.

## ⚔️ Compare it against wget

```bash
mkdir wget-copy && cd wget-copy
wget -p -k -E -H -e robots=off http://localhost:7801/
```

Those are the most generous flags there are: fetch page requisites, convert links, span hosts,
ignore robots. wget does well — it gets the HTML, the stylesheet, the entry module, and the video.
It cannot get the two files that only exist once the page is running, and without those the page
reports an incomplete capture.

![wget versus exact-web-mirror](media/wget-vs-mirror.png)

## 📁 What's here

```
site/index.html              the page (traps 01–05 are commented inline)
cdn/style.css                trap 01 — and every rule that makes the page look designed
cdn/panel.4f2a9c.mjs         trap 02 — builds its chunk's address from parts
cdn/checks.9d1e07.mjs        trap 02 — the chunk nothing links to; runs the five checks
cdn/loop.mp4                 trap 03 — generated with ffmpeg, big enough to be range-requested
cdn/plate.svg                trap 04 — loaded from an address assembled at run time
serve-demo.mjs               the two-origin server
media/                       the recordings used in the top-level README
```

Nothing here is a real product, and the fixture is deliberately small enough to read in one sitting.
