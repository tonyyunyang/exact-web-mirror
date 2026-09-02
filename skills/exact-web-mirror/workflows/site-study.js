// Study a captured mirror: how the page is built, told from the page's own files.
//
// Run it AFTER archive.mjs, over a collection directory. It never touches the network — the archive
// is the only source, which is the point: every claim can be checked against a file on disk.
//
//   Workflow({
//     scriptPath: "${CLAUDE_SKILL_DIR}/workflows/site-study.js",
//     args: { collection: "/abs/path/archives/example-com", url: "https://example.com/" }
//   })
//
// Six dimensions are studied in parallel; each one's findings are then re-checked against the files
// by a second agent that did not write them, and only then synthesized. 13 agents.
export const meta = {
  name: 'site-study',
  description: 'Study a captured web mirror across six dimensions, fact-check every claim against the archived files, then write STUDY.md',
  phases: [
    { title: 'Study', detail: 'one agent per dimension, reading only the archived files' },
    { title: 'Fact-check', detail: 'a second agent re-checks every claim against the same files' },
    { title: 'Synthesize', detail: 'assemble the verified sections into STUDY.md' },
  ],
};

const collection = (args && args.collection) || '';
if (!collection) throw new Error('site-study needs args.collection — the absolute path of an archives/<slug> directory.');
const url = (args && args.url) || '(see logs/record-meta.json)';
const notesDir = (args && args.notesDir) || `${collection}/study/notes`;
const reportFile = (args && args.reportFile) || `${collection}/study/STUDY.md`;

// Facts about the archive that every agent needs, so none of them rediscovers them the hard way.
const GROUND = `
THE ARCHIVE (your only source — do not fetch anything from the internet)
  collection      ${collection}
  captured page   ${url}
  webpage/        the site's own files, byte-for-byte as its server sent them. Same-origin paths sit
                  at their real paths; other domains are under webpage/__ext/<host>/. Files whose
                  names start with __ (and OPEN*/HOW-TO-OPEN*) are the mirror's own scaffolding, not
                  the site's — ignore them except __map.json / __types.json, which tell you which
                  original URL each file came from and what content type it was served as.
  archive/        desktop.har.zip + mobile.har.zip: the full network recording, including response
                  HEADERS. Read one with:
                    T=$(mktemp -d); unzip -q "${collection}/archive/desktop.har.zip" -d "$T"
                    node -e 'const h=require("$T/har.har"); ...'   # h.log.entries[].request/response
  logs/           record-*.json (what the live page did), verify-*.json + verify-meta.json (what the
                  offline copy did, and the measured fidelity)
  qa/             RENDERED EVIDENCE ALREADY EXISTS. frames-desktop/ and frames-mobile/ hold
                  side-by-side PNGs (left = live, right = local) at every scroll stop; bands-*/ do
                  the same for the full-page shot; live-*-hero-f0..f5.png are consecutive hero
                  frames 500ms apart. Read these images instead of trying to render the page.

DO NOT try to serve and browse the copy. This site is origin-locked: its own code checks which
domain served it and navigates back to the real one, so a plain local browse leaves the copy. The
qa/ images are the rendered ground truth you would have been trying to produce.

METHOD
  Work from the files with the shell: grep/rg, node -e, unzip, sed, wc, du, file. Read images from
  qa/ when a visual question comes up.
  Every claim must be checkable by someone else running one command. "Uses Tailwind" is worthless;
  "webpage/.../chunks/2ae1f_rgc4hkf.css line 1 contains .flex{display:flex} plus 4,900 other
  single-property utility classes" is a finding.
  You know things about this company and this framework from training. Those are not evidence and
  several of them are out of date. If it is not in these files, it does not go in your notes.
  Where the files disagree with what you expected, say so — that is the interesting part.
`;

const DIMENSIONS = [
  {
    key: 'stack',
    title: 'Framework, build and delivery',
    brief: `What is this application, mechanically? Identify the framework and its version from
evidence in the files (build manifests, chunk names, runtime globals, embedded version strings,
response headers in the HAR). Work out the routing and rendering model — server-rendered markup vs
client hydration, whether a React Server Components payload is embedded in the document and how it
is framed, what streams in later. Map the chunk graph: how many JS chunks, how they are named and
loaded, what the module runtime looks like, whether the bundler left fingerprints. Read the HAR
response headers for the delivery story: caching, compression, protocol, CDN/edge hints, security
headers, cookies set. Note anything that reveals build tooling, a design-system package, feature
flags, experiments or A/B assignment.`,
  },
  {
    key: 'design-system',
    title: 'Design tokens and CSS architecture',
    brief: `How is the visual language encoded? Find the CSS custom properties and reconstruct the
actual token sets — colour ramps, spacing scale, radii, shadows, z-index layers, breakpoints — with
their real values, and say which are referenced most. Determine the CSS strategy from the files:
utility classes, CSS modules, hashed class names, inline critical CSS, cascade layers, container
queries. Handle light/dark: where the theme switch lives and which tokens it swaps. Count and
measure: how many stylesheets, how large, how much is inlined in the document. Quote real selectors
and values, not the concepts.`,
  },
  {
    key: 'typography',
    title: 'Typefaces and text rendering',
    brief: `Inventory every font file in the archive (paths, sizes, formats) and identify each face
from its internal name table — 'strings' / node over the bytes will show the family and subfamily.
Say which are variable fonts and what axes they carry. Work out the loading strategy from the
document: preloads, @font-face blocks, font-display, fallback stacks, size-adjust metrics. Then map
faces to roles: which family and weight the headline, body, UI and any monospace/pixel text use, and
find the type scale in the CSS. Note the licence class honestly (open OFL/Apache vs proprietary
brand face) and where a proprietary face rules out reuse.`,
  },
  {
    key: 'motion',
    title: 'Motion, graphics and media',
    brief: `How does this page move? Find and explain the hero: read the code behind it and say
whether it is canvas, WebGL (look for shader source — attribute/uniform/varying/gl_FragColor), SVG,
CSS animation, or a video, and describe the actual technique. Compare live-*-hero-f0..f5.png to
prove what is animating and how fast. Inventory the rest: CSS keyframes and transitions, scroll-
driven effects (IntersectionObserver, scroll-timeline, sticky pinning), view transitions, marquees,
animation libraries present in the bundle, prefers-reduced-motion handling. Cover media too: video
and audio files in archive/media/ and their formats/sizes. Where a technique is interesting, quote
the code and name the file.`,
  },
  {
    key: 'structure',
    title: 'Page architecture, content and accessibility',
    brief: `Read the served document and walk the page top to bottom: every section in order, what
it says, what it is for, and what markup builds it. Extract the real headline, subhead and CTA copy
verbatim (short quotes) and describe the pattern of the argument the page makes. Map the navigation
model, including the dropdown contents, and the footer's information architecture. Then audit
semantics and accessibility from the markup: landmarks, heading order, alt text coverage, aria usage,
form labels, focus handling, lang, skip links, and anything that looks like a real problem. Use the
qa/frames-* images to tie each section to how it renders. Say how many sections there are and how
long the page is.`,
  },
  {
    key: 'weight',
    title: 'Asset inventory and performance shape',
    brief: `Measure the page as bytes. Total the archive by content type (from __types.json and the
files on disk), and list the twenty largest assets with sizes. Compare what the document asks for up
front against what arrives later. Count requests and hosts from logs/record-desktop.json, and
separate first-party from third-party, naming the third parties and what each is for. Cover image
strategy: formats (avif/webp/svg), responsive srcset, lazy loading, whether an image CDN with
transform parameters is in use. Note compression and cache headers from the HAR, preload/prefetch
hints in the document, and the size of the JS the browser has to execute. Give real numbers with
units, and say what the numbers imply about how this page was engineered.`,
  },
];

const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'headline', 'notesFile', 'claims'],
  properties: {
    key: { type: 'string' },
    headline: { type: 'string', description: 'One sentence: the single most important thing you found.' },
    notesFile: { type: 'string', description: 'Absolute path of the markdown notes file you wrote.' },
    claims: {
      type: 'array',
      description: 'The load-bearing claims in your notes, each with evidence someone else can re-run.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidence'],
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'File path plus the exact string, number, or command that shows it.' },
        },
      },
    },
    surprises: { type: 'array', items: { type: 'string' }, description: 'Things that contradicted what you expected.' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
};

const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'checked', 'wrong', 'verdict'],
  properties: {
    key: { type: 'string' },
    checked: { type: 'integer', description: 'How many claims you re-ran the evidence for.' },
    wrong: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'problem', 'correction'],
        properties: { claim: { type: 'string' }, problem: { type: 'string' }, correction: { type: 'string' } },
      },
    },
    verdict: { type: 'string', enum: ['clean', 'corrected', 'unreliable'] },
    note: { type: 'string' },
  },
};

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reportFile', 'summary', 'sections'],
  properties: {
    reportFile: { type: 'string' },
    summary: { type: 'string', description: '3-6 sentences a reader gets before opening the file.' },
    sections: { type: 'integer' },
    words: { type: 'integer' },
  },
};

const studyPrompt = (d) => `You are studying an offline archive of a real web page and writing the
${d.title} section of a technical study of it.

${GROUND}

YOUR DIMENSION — ${d.title}
${d.brief}

Investigate as deeply as the files allow, then write your section to:
  ${notesDir}/${d.key}.md
Start it with an H2 titled "${d.title}". Write for an engineer who wants to understand how this page
was built well enough to reason about it — prose with concrete detail, code and value quotes where
they earn their place, tables where a list of numbers is genuinely a table. Cite the file path for
anything specific. No filler, no summary of what you are about to say, no bullet list of adjectives.
Length follows the evidence: if the archive supports 1500 words of real findings, write them.

Then return the structured result. Put every load-bearing claim in \`claims\` with evidence another
agent can re-run — it will be checked, and a claim that does not survive costs more than a claim you
never made.`;

const checkPrompt = (d, section) => `You are fact-checking one section of a technical study. Another
agent wrote ${notesDir}/${d.key}.md from an offline web archive. You did not write it and you have no
stake in it being right.

${GROUND}

Its claims, with the evidence given for each:
${section.claims.map((c, i) => `${i + 1}. CLAIM: ${c.claim}\n   EVIDENCE: ${c.evidence}`).join('\n')}

For every claim: re-run the evidence against the files yourself. A claim fails if the evidence does
not show what it says, if the file or string is not there, if a number is wrong, or if it is a fact
about the framework or company that the archive does not actually demonstrate. Check the notes file
for further claims that were not listed — those get checked too. Be specific about what is wrong;
"could be clearer" is not a finding.

Then rewrite ${notesDir}/${d.key}.md with the corrections applied: fix what is wrong, cut what cannot
be supported, keep everything that holds and keep it in the same voice. Do not pad it and do not add
a changelog. Leave the file ready to publish as a section of the study.

Return the structured result: how many claims you re-checked, which ones were wrong and what the
truth is, and a verdict — "clean" if it all held, "corrected" if you fixed things, "unreliable" if
the section's core was not supported by the archive.`;

const synthPrompt = (studied) => `Assemble the final study of an archived web page from the verified
section notes.

${GROUND}

Sections, already written and fact-checked, in ${notesDir}/:
${studied.map((r) => `- ${r.key}.md — ${r.headline} [fact-check: ${r.check ? r.check.verdict : 'not run'}${r.check && r.check.wrong.length ? `, ${r.check.wrong.length} claim(s) corrected` : ''}]`).join('\n')}

Write ${reportFile}. Structure:

1. A title and a short opening that states what was captured, from where, and when — read
   logs/record-meta.json for the URL and timestamp.
2. "How faithful is this copy" — the fidelity evidence, reported exactly as measured, from
   logs/verify-meta.json. It has both \`frames\` (the scrolled viewport stops) and \`compare\` (the
   full-page screenshot, in bands). These are NOT equivalent and you must not blur them:
     - the frames are the real evidence — every scroll stop rendered and was compared;
     - the full-page bands are weak evidence wherever \`withContent\` is less than \`bands\`, because
       those bands are blank in BOTH images: a full-page screenshot does not paint scroll-driven
       sections. Say how many were blank.
   Report the height match, both diff numbers, and what the residual diff is (check the worst frame
   in qa/frames-mobile/ or qa/frames-desktop/ yourself and describe what differs).
   Then disclose, plainly, three things:
     - the copy is origin-locked (see \`results.*.originBounces\`): the site's own code navigates back
       to its real domain when served from anywhere else, and the PASS depends on the verifier
       answering that navigation with a 204 so the page stays put. This copy does not open cleanly by
       double-clicking it in an ordinary browser.
     - \`results.*.assetGaps\`: assets the replay asked for that are not in the archive. Name them,
       and note the unresolved possibility that they are a replay-only code path — the 204 above is
       itself a replay-only condition and could be what leads the app to request them.
     - \`results.*.deadEndpoints\`: API and beacon endpoints that 404 offline, which is by design.
3. The six studied sections, in the order listed above, each carried over from its notes file. You
   may tighten prose and fix seams between sections; do not re-summarize them into bullets and do not
   drop detail.
4. "What this page is doing, in one read" — your own synthesis: the three or four decisions that
   most define how this page is built, and what a reader should take away. This is the only part
   where you may draw conclusions the sections do not state, and it must follow from them.

Rules: everything traceable to a file in the archive; no claims from your own knowledge of the
company or framework; no praise; keep the register plain and technical. Where a fact-check came back
"unreliable", say so in that section rather than quietly using it.

Then return the structured result.`;

log(`Studying ${url}`);
log(`Archive: ${collection}`);

phase('Study');
const studied = await pipeline(
  DIMENSIONS,
  (d) => agent(studyPrompt(d), { label: `study:${d.key}`, phase: 'Study', schema: SECTION_SCHEMA }),
  (section, d) => {
    if (!section) { log(`${d.key}: study agent returned nothing — dropped`); return null; }
    return agent(checkPrompt(d, section), { label: `check:${d.key}`, phase: 'Fact-check', schema: CHECK_SCHEMA })
      .then((check) => ({ key: d.key, title: d.title, headline: section.headline, claims: section.claims.length, surprises: section.surprises || [], check }));
  },
);

const sections = studied.filter(Boolean);
const corrected = sections.reduce((n, s) => n + (s.check ? s.check.wrong.length : 0), 0);
log(`${sections.length}/${DIMENSIONS.length} sections written; ${corrected} claim(s) corrected by fact-check`);
if (sections.length < DIMENSIONS.length) log(`dropped: ${DIMENSIONS.filter((d) => !sections.some((s) => s.key === d.key)).map((d) => d.key).join(', ')}`);

phase('Synthesize');
const report = await agent(synthPrompt(sections), { label: 'synthesize', phase: 'Synthesize', schema: REPORT_SCHEMA });

return {
  report,
  sections: sections.map((s) => ({ key: s.key, headline: s.headline, claims: s.claims, verdict: s.check ? s.check.verdict : null, corrections: s.check ? s.check.wrong.length : null })),
  surprises: sections.flatMap((s) => s.surprises),
  unreliable: sections.filter((s) => s.check && s.check.verdict === 'unreliable').map((s) => s.key),
};
