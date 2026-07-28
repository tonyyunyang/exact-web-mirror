// TRAP 02, part two — the hash-named chunk. Nothing links here directly.
// This module runs the five checks and writes the page's own verdict, which is what makes a copy
// of this page self-grading: open any copy and the same checks re-run against whatever survived.

const CDN = new URL('.', import.meta.url).href;

const setState = (key, live, label) => {
  const el = document.querySelector(`.trap[data-trap="${key}"]`);
  if (!el) return;
  el.classList.toggle('is-live', live);
  el.classList.toggle('is-dead', !live);
  const s = el.querySelector('.trap-state');
  if (s) s.textContent = label;
};

// TRAP 01 — the cross-origin stylesheet sets --cdn-ok. If the file never arrived, so does nothing.
const cssLoaded = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--cdn-ok').trim() === '1';

// TRAP 03 — a real video body, not a pile of range fragments, will reach readyState >= 2.
function watchVideo() {
  const v = document.getElementById('loop');
  if (!v) return Promise.resolve(false);
  const ok = () => v.readyState >= 2;
  if (ok()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (val) => resolve(val);
    v.addEventListener('loadeddata', () => done(true), { once: true });
    v.addEventListener('error', () => done(false), { once: true });
    setTimeout(() => done(ok()), 6000);
  });
}

// TRAP 04 — the address is assembled here and set on the element; it is in no markup anywhere.
function loadPlate() {
  const img = document.getElementById('plate');
  if (!img) return Promise.resolve(false);
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(true), { once: true });
    img.addEventListener('error', () => resolve(false), { once: true });
    img.src = CDN + ['plate', 'svg'].join('.');
    setTimeout(() => resolve(img.complete && img.naturalWidth > 0), 6000);
  });
}

// TRAP 05 — the hero trace has to still be drawing, not sitting on a captured still.
const canvasRunning = () => typeof window.__traceRunning === 'function' && window.__traceRunning();

function reveal() {
  const items = [...document.querySelectorAll('.trap')];
  if (!('IntersectionObserver' in window)) return items.forEach((t) => t.classList.add('is-in'));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      // stagger by position so a section arrives as a group rather than all at once
      const i = items.indexOf(e.target);
      setTimeout(() => e.target.classList.add('is-in'), (i % 3) * 90);
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
  items.forEach((t) => io.observe(t));
}

function verdict(live) {
  const box = document.getElementById('verdict');
  const line = document.getElementById('verdict-line');
  const readout = document.getElementById('readout');
  const count = document.getElementById('live-count');
  if (count) count.textContent = String(live);
  readout?.classList.toggle('is-complete', live === 5);
  box?.classList.toggle('is-complete', live === 5);
  box?.classList.toggle('is-partial', live < 5);
  if (!line) return;
  line.textContent = live === 5
    ? 'All five survived. This copy is complete.'
    : `${5 - live} of 5 did not survive. This copy is incomplete.`;
}

export async function run() {
  reveal();
  setState('module', true, 'live');            // this code executing is the proof
  setState('css', cssLoaded(), cssLoaded() ? 'live' : 'missing');
  setState('canvas', canvasRunning(), canvasRunning() ? 'live' : 'stopped');

  const stamp = document.getElementById('stamp');
  if (stamp) stamp.textContent = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';

  const [video, plate] = await Promise.all([watchVideo(), loadPlate()]);
  setState('video', video, video ? 'live' : 'no body');
  setState('runtime', plate, plate ? 'live' : 'unresolved');

  const live = [cssLoaded(), true, video, plate, canvasRunning()].filter(Boolean).length;
  verdict(live);

  const v = document.getElementById('loop');
  if (video && v) v.play().catch(() => {});
}
