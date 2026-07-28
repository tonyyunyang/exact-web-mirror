// TRAP 02, part one — the only module the document names.
// The chunk it needs is addressed by joining a base to a hashed file name at run time, so the
// chunk's URL exists nowhere in the HTML or in this file as a single literal string. A downloader
// that scans markup for links cannot reach it; only running the page produces the address.
const BASE = new URL('.', import.meta.url);
const PART = ['checks', '9d1e07', 'mjs'];

const chunkUrl = new URL(PART.join('.'), BASE).href;

import(/* webpackIgnore: true */ chunkUrl)
  .then((mod) => mod.run())
  .catch((err) => {
    // If the chunk never arrives the lights stay dim, which is the honest outcome — say so loudly
    // rather than leaving the page looking merely unfinished.
    console.error('[hard-page] chunk failed to load:', err);
    const line = document.getElementById('verdict-line');
    if (line) line.textContent = 'Incomplete capture — the module chunk never arrived.';
    document.getElementById('verdict')?.classList.add('is-partial');
    document.querySelectorAll('.trap').forEach((t) => {
      t.classList.add('is-in', 'is-dead');
      const s = t.querySelector('.trap-state');
      if (s) s.textContent = 'no chunk';
    });
  });
