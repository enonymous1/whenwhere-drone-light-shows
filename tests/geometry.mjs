// Unit tests for the pure geometry in geometry.js.
//
// The geometry functions (resample, resampleRuns, heartPair, thinUniform,
// wordPoints, skeletonize, finalePts, allocateCounts, separatePoints) are
// exposed on the page as
// window.WHENWHERE.geometry, so this
// test loads the page in headless Chrome over the DevTools Protocol and
// asserts on them there — the same harness as tests/smoke.mjs, no extra
// dependencies beyond Node >= 22 (built-in WebSocket client) and a
// Chrome/Chromium binary. The Chrome path is taken from CHROME_PATH, or
// from the usual install locations. In CI the workflow sets CHROME_PATH
// from the setup-chrome step's chrome-path output.
//
// What the assertions guard:
// - resampleRuns never interpolates across a break: points from two
//   segments separated by a gap stay out of the gap entirely.
// - The interlock: in the current layout the two hearts cross ONCE
//   (probed 2026-11-18 — the review guessed two, the code finds one).
//   The left heart carries the gap at that crossing (exactly one jump
//   over 25px between consecutive points) and the gap sits on the right
//   heart's outline (nearest right point to the gap's midpoint is a few
//   px away); the right heart runs continuous through it. The 25px
//   threshold separates a real gap from normal resample spacing (~15px
//   at 80 drones); at small counts (37) normal spacing exceeds it, so
//   the jump assertions only run at 80 and 200.
// - wordPoints returns exactly its target (clamped 50-100) for known
//   strings, including the clamp edges and empty input, split across
//   glyphs in proportion to their stroke lengths, with no two dots
//   closer than the minimum gap.
// - skeletonize thins a binary grid to its centerline (a block to its
//   center, a bar to its middle line) — wordPoints relies on it to put
//   the drones on the stroke, one drone wide.
// - finalePts returns exactly n points (it used to ignore n and always
//   output 240), and they stay inside the canvas.
//
// Usage:
//   node tests/geometry.mjs [path/to/index.html]
// Exit code is 0 on pass, 1 on any failure.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE = resolve(process.argv[2] || 'index.html');

// CHROME_PATH wins, then PATH (browser-actions/setup-chrome in CI puts
// a binary named `chrome` on PATH), then the usual install locations.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  (() => {
    try {
      return execSync('which google-chrome || which chromium || which chromium-browser || which chrome',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return undefined; }
  })(),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'),
].filter(Boolean);

function findChromeBinary() {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for Chrome's DevTools endpoint, failing fast with a diagnosis if
// Chrome dies first. A bare timeout hides the cause (a missing library,
// a bad flag, no display) — the exit code and stderr tail name it.
function stderrTail(stderr) {
  const lines = stderr.trim().split('\n');
  return lines.slice(-20).join('\n') || '(no stderr captured)';
}

async function waitForEndpoint(url, child, stderr, tries = 150) {
  for (let i = 0; i < tries; i++) {
    if (child.exitCode !== null) {
      throw new Error(
        `Chrome exited before the DevTools endpoint came up ` +
        `(code ${child.exitCode}${child.signalCode ? `, signal ${child.signalCode}` : ''}).\n` +
        `Chrome stderr (last lines):\n${stderrTail(stderr())}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(
    `DevTools endpoint never came up: ${url}\n` +
    `Chrome stderr (last lines):\n${stderrTail(stderr())}`);
}

// The assertions, run in the page. Returns an array of
// { name, ok, detail }: one entry per assertion, so a failure names
// exactly what broke. Pure functions of the geometry — no DOM reads
// beyond window.WHENWHERE.geometry.
const ASSERTIONS = `(() => {
  const g = window.WHENWHERE.geometry;
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: String(detail) });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const jumpsOver = (pts, px) => {
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i], pts[i - 1]);
      if (d > px) out.push({ i, dist: Math.round(d * 10) / 10 });
    }
    return out;
  };
  const inCanvas = (pts) => pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 732);

  // resample: exactly n points, evenly spaced by arc length.
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  check('resample returns exactly n', g.resample(line, 10).length === 10, g.resample(line, 10).length);
  check('resample of an empty contour is empty', g.resample([], 10).length === 0, g.resample([], 10).length);
  check('resample with n = 0 is empty', g.resample(line, 0).length === 0, g.resample(line, 0).length);

  // resampleRuns: never interpolates across a break. Two segments with a
  // 100px gap between them (x 100..200): no returned point may lie in it.
  const seg = [];
  for (let x = 0; x <= 100; x += 10) seg.push({ x, y: 0 });
  for (let x = 200; x <= 300; x += 10) seg.push({ x, y: 0 });
  const rr = g.resampleRuns(seg, 20);
  check('resampleRuns returns exactly n', rr.length === 20, rr.length);
  check('resampleRuns puts no point inside the gap', rr.filter((p) => p.x > 100 && p.x < 200).length === 0,
    rr.filter((p) => p.x > 100 && p.x < 200).map((p) => p.x).join(',') || 'none in gap');
  check('resampleRuns falls back to resample on a single run',
    g.resampleRuns([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], 7).length === 7, 'single run');

  // heartPair: exact counts at the shipped size and either side of it.
  check('heartPair(80) returns exactly 80', g.heartPair(80).length === 80, g.heartPair(80).length);
  check('heartPair(37) returns exactly 37', g.heartPair(37).length === 37, g.heartPair(37).length);
  check('heartPair(200) returns exactly 200', g.heartPair(200).length === 200, g.heartPair(200).length);

  // The interlock, at the shipped size: one crossing, carried as a gap
  // in the left heart only. The right heart runs continuous through it.
  const hp80 = g.heartPair(80);
  const left80 = hp80.slice(0, 40), right80 = hp80.slice(40);
  const leftJumps = jumpsOver(left80, 25), rightJumps = jumpsOver(right80, 25);
  check('heartPair(80): left heart has exactly one gap', leftJumps.length === 1, JSON.stringify(leftJumps));
  check('heartPair(80): right heart has no gap', rightJumps.length === 0, JSON.stringify(rightJumps));
  if (leftJumps.length === 1) {
    const a = left80[leftJumps[0].i - 1], b = left80[leftJumps[0].i];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nearest = Math.min(...right80.map((p) => dist(p, mid)));
    check('heartPair(80): the left gap sits on the right heart', nearest < 30, Math.round(nearest * 10) / 10 + 'px');
  } else {
    check('heartPair(80): the left gap sits on the right heart', false, 'no single gap to measure from');
  }
  check('heartPair(80): all points inside the 900x732 canvas', inCanvas(hp80), hp80.length + ' points');
  // Same single-gap pattern at 200 drones, so it is not a coincidence of 80.
  const hp200 = g.heartPair(200);
  check('heartPair(200): one gap in the left heart, none in the right',
    jumpsOver(hp200.slice(0, 100), 25).length === 1 && jumpsOver(hp200.slice(100), 25).length === 0,
    'left ' + JSON.stringify(jumpsOver(hp200.slice(0, 100), 25)) + ' right ' + JSON.stringify(jumpsOver(hp200.slice(100), 25)));

  // thinUniform: exactly the target, drawn from the input, no duplicates;
  // a short input comes back whole.
  const grid = [];
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) grid.push({ x: x * 10, y: y * 10 });
  const thinned = g.thinUniform(grid, 50);
  check('thinUniform returns exactly the target', thinned.length === 50, thinned.length);
  check('thinUniform returns points from the input', thinned.every((p) => grid.indexOf(p) >= 0), 'all from input');
  check('thinUniform returns no duplicates', new Set(thinned.map((p) => p.x + ',' + p.y)).size === thinned.length, thinned.length + ' unique');
  check('thinUniform returns a short input whole', g.thinUniform([{ x: 1, y: 1 }, { x: 2, y: 2 }], 100).length === 2, '2 points in, 2 out');

  // wordPoints: exactly the target (clamped 50-100).
  const words = { TEST: 100, LOVE: 100, 2027: 100, 'E + J': 75 };
  for (const [word, target] of Object.entries(words)) {
    const got = g.wordPoints(word).length;
    check('wordPoints(' + JSON.stringify(word) + ') returns ' + target, got === target, got);
  }
  check("wordPoints('A') hits the lower clamp (50)", g.wordPoints('A').length === 50, g.wordPoints('A').length);
  check("wordPoints('WEDDINGS') hits the upper clamp (100)", g.wordPoints('WEDDINGS').length === 100, g.wordPoints('WEDDINGS').length);
  check('wordPoints of empty / whitespace-only text is empty',
    g.wordPoints('').length === 0 && g.wordPoints('   ').length === 0, "'' -> " + g.wordPoints('').length + ", '   ' -> " + g.wordPoints('   ').length);
  check("wordPoints('TEST') points inside the 900x732 canvas", inCanvas(g.wordPoints('TEST')), 'all inside');

  // Spaces are gaps, not vanished: 'MARRY ME' has the same 100 drones as
  // 'MARRYME' (a space takes no drones), and the gap between the Y and M
  // clusters is a word space wider than a plain letter gap. The gap is
  // found as the largest jump in sorted x, not by glyph indices — the
  // split is proportional now, so glyph boundaries move. Thresholds
  // from probed values in both fonts (Marcellus 106.3 vs 60.7px, the
  // fallback serif 83.5 vs 55.2px). A long word shrinks to fit instead
  // of running off the stage.
  const marryMe = g.wordPoints('MARRY ME'), marryMeNoSpace = g.wordPoints('MARRYME');
  check("wordPoints('MARRY ME') still returns 100 (a space takes no drones)", marryMe.length === 100, marryMe.length);
  const largestGap = (pts) => {
    const xs = pts.map((p) => p.x).sort((a, b) => a - b);
    let g = 0;
    for (let i = 1; i < xs.length; i++) g = Math.max(g, xs[i] - xs[i - 1]);
    return g;
  };
  const gapSpaced = largestGap(marryMe), gapPlain = largestGap(marryMeNoSpace);
  check("wordPoints('MARRY ME') leaves a word-sized gap between Y and M",
    gapSpaced > 75 && gapSpaced - gapPlain > 20,
    Math.round(gapSpaced * 10) / 10 + 'px vs ' + Math.round(gapPlain * 10) / 10 + 'px without the space');
  const congrats = g.wordPoints('CONGRATULATIONS');
  check("wordPoints('CONGRATULATIONS') returns 100", congrats.length === 100, congrats.length);
  check("wordPoints('CONGRATULATIONS') stays inside the canvas", inCanvas(congrats), 'all inside');

  // allocateCounts: the budget splits in proportion to stroke length
  // and sums exactly to the target. A glyph with any stroke keeps at
  // least 1 dot; a glyph with no stroke gets 0.
  check('allocateCounts splits a budget in proportion to stroke length',
    JSON.stringify(g.allocateCounts([44, 104, 60, 68], 100)) === JSON.stringify([16, 38, 22, 24]),
    JSON.stringify(g.allocateCounts([44, 104, 60, 68], 100)));
  check('allocateCounts sums exactly to the target',
    g.allocateCounts([10, 20, 30], 60).reduce((a, b) => a + b, 0) === 60, 'sum');
  check('allocateCounts keeps at least 1 dot for a tiny glyph',
    JSON.stringify(g.allocateCounts([100, 1], 50)) === JSON.stringify([49, 1]),
    JSON.stringify(g.allocateCounts([100, 1], 50)));
  check('allocateCounts gives 0 dots to a glyph with no stroke',
    JSON.stringify(g.allocateCounts([10, 0, 10], 40)) === JSON.stringify([20, 0, 20]),
    JSON.stringify(g.allocateCounts([10, 0, 10], 40)));

  // separatePoints: a close pair is pushed to the minimum gap, along
  // their connecting vector (dots on a straight stroke stay on it),
  // and an already-separated set is left alone.
  const closePair = g.separatePoints([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 100, y: 0 }], 10);
  check('separatePoints pushes a close pair to the minimum gap',
    Math.abs(Math.hypot(closePair[1].x - closePair[0].x, closePair[1].y - closePair[0].y) - 10) < 1e-9,
    Math.round(Math.hypot(closePair[1].x - closePair[0].x, closePair[1].y - closePair[0].y) * 100) / 100 + 'px');
  check('separatePoints keeps dots on a straight stroke',
    closePair[0].y === 0 && closePair[1].y === 0, 'y ' + closePair[0].y + ', ' + closePair[1].y);
  check('separatePoints leaves an already-separated set alone',
    JSON.stringify(g.separatePoints([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }], 10)) ===
    JSON.stringify([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }]), 'unchanged');

  // End to end: the thin I gets fewer drones than the long W (the old
  // equal split gave them 25 each), and no two LOVE dots sit closer
  // than the minimum gap (the old code's closest pair was 8px). The
  // IW split is found the same way as the word gap — largest jump in
  // sorted x — and holds in both fonts (Marcellus 10 vs 40, the
  // fallback serif 16 vs 34).
  const iw = g.wordPoints('IW');
  const iwXs = iw.map((p) => p.x).sort((a, b) => a - b);
  let iwGap = 0, iwAt = -1;
  for (let i = 1; i < iwXs.length; i++) { if (iwXs[i] - iwXs[i - 1] > iwGap) { iwGap = iwXs[i] - iwXs[i - 1]; iwAt = i; } }
  check("wordPoints('IW') gives the long W more drones than the thin I",
    iwAt > 0 && iwGap > 30 && (iw.length - iwAt) - iwAt >= 15,
    'I ' + iwAt + ' vs W ' + (iw.length - iwAt) + ', gap ' + Math.round(iwGap * 10) / 10 + 'px');
  const love = g.wordPoints('LOVE');
  let loveMin = Infinity;
  for (let i = 0; i < love.length; i++) for (let j = i + 1; j < love.length; j++) {
    loveMin = Math.min(loveMin, dist(love[i], love[j]));
  }
  check("wordPoints('LOVE') keeps every pair of dots at least 10px apart",
    loveMin >= 10, Math.round(loveMin * 100) / 100 + 'px');

  // splitSlides: '+' marks an explicit break; without one, whole words
  // are packed into slides of at most 8 non-space glyphs (HAPPY NEW
  // is the proof that 8 reads at the 100-drone budget). A single long
  // word is its own slide; at most 6 slides.
  check("splitSlides splits on '+' into separate moments",
    JSON.stringify(g.splitSlides('HAPPY + NEW YEAR')) === JSON.stringify(['HAPPY', 'NEW YEAR']),
    JSON.stringify(g.splitSlides('HAPPY + NEW YEAR')));
  check("splitSlides honours four '+' breaks",
    JSON.stringify(g.splitSlides('WILL + YOU + MARRY + ME')) === JSON.stringify(['WILL', 'YOU', 'MARRY', 'ME']),
    JSON.stringify(g.splitSlides('WILL + YOU + MARRY + ME')));
  check("splitSlides packs whole words to 8 glyphs without '+'",
    JSON.stringify(g.splitSlides('HAPPY NEW YEAR')) === JSON.stringify(['HAPPY NEW', 'YEAR']),
    JSON.stringify(g.splitSlides('HAPPY NEW YEAR')));
  check("splitSlides keeps a single short word on one slide",
    JSON.stringify(g.splitSlides('LOVE')) === JSON.stringify(['LOVE']),
    JSON.stringify(g.splitSlides('LOVE')));
  check("splitSlides keeps a single long word on its own slide",
    JSON.stringify(g.splitSlides('CONGRATULATIONS')) === JSON.stringify(['CONGRATULATIONS']),
    JSON.stringify(g.splitSlides('CONGRATULATIONS')));
  check("splitSlides drops empty parts and a trailing '+'",
    JSON.stringify(g.splitSlides('HAPPY +')) === JSON.stringify(['HAPPY']) && JSON.stringify(g.splitSlides('')) === JSON.stringify([]),
    JSON.stringify(g.splitSlides('HAPPY +')));
  check('splitSlides caps at 6 slides',
    g.splitSlides('A + B + C + D + E + F + G + H').length === 6,
    g.splitSlides('A + B + C + D + E + F + G + H').length + ' slides');

  // skeletonize: Zhang-Suen thinning — a solid block collapses to its
  // center, a bar to its middle line. wordPoints relies on this to put
  // the drones on the stroke centerline, one wide.
  const countOnes = (grid) => grid.flat().reduce((a, v) => a + v, 0);
  const block5 = Array.from({ length: 7 }, (_, r) => Array.from({ length: 7 }, (_, c) => (r >= 1 && r <= 5 && c >= 1 && c <= 5 ? 1 : 0)));
  const skel5 = g.skeletonize(block5);
  check('skeletonize thins a 5x5 block to its single center pixel', countOnes(skel5) === 1 && skel5[3][3] === 1, countOnes(skel5) + ' pixels left');
  const bar = Array.from({ length: 5 }, (_, r) => Array.from({ length: 11 }, (_, c) => (r >= 1 && r <= 3 && c >= 1 && c <= 9 ? 1 : 0)));
  const skelBar = g.skeletonize(bar);
  // Zhang-Suen also eats a pixel or two off each end while it peels the
  // rows (probed 2026-11-18: a 3x9 bar leaves a 6-pixel middle line, not
  // 9), so the assertion is the line's place and shape, not its length.
  const midCols = skelBar[2].map((v, c) => (v ? c : -1)).filter((c) => c >= 0);
  check('skeletonize thins a 3x9 bar to a line in its middle row',
    countOnes(skelBar) === 6 && midCols.length === 6 && midCols[5] - midCols[0] === 5 &&
    skelBar.every((row, r) => r === 2 || row.every((v) => v === 0)),
    countOnes(skelBar) + ' pixels left, row 2 cols ' + midCols.join(','));
  const block3 = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r >= 1 && r <= 3 && c >= 1 && c <= 3 ? 1 : 0)));
  const skel3 = g.skeletonize(block3);
  check('skeletonize thins a 3x3 block to its center pixel', countOnes(skel3) === 1 && skel3[2][2] === 1, countOnes(skel3) + ' pixels left');

  // finalePts: the count is exactly n, and the points stay inside the
  // 900x732 canvas at both the shipped count and a smaller one.
  const fin240 = g.finalePts(240);
  check('finalePts(240) returns 240 points', fin240.length === 240, fin240.length);
  const fin120 = g.finalePts(120);
  check('finalePts(120) returns 120 points', fin120.length === 120, fin120.length);
  check('finalePts points stay inside the canvas', inCanvas(fin240) && inCanvas(fin120), 'all inside');

  return results;
})()`;

async function main() {
  const chrome = findChromeBinary();
  if (!chrome) {
    console.error('No Chrome/Chromium found. Set CHROME_PATH to your browser binary.');
    process.exit(1);
  }
  const profile = mkdtempSync(join(tmpdir(), 'ww-geometry-'));
  // A random port per run: a fixed port lets a leftover Chrome from an
  // earlier run (or another job on the same runner) answer the DevTools
  // probe and hand the test a blank page.
  const port = Number(process.env.CDP_PORT) || 9300 + Math.floor(Math.random() * 500);
  // --headless is the current flag (old headless is gone; --headless=new
  // is an alias that some builds no longer accept). --disable-dev-shm-usage
  // is standard CI hardening: /dev/shm is small in containers.
  const child = spawn(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--force-prefers-reduced-motion', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderrText = '';
  child.stderr.on('data', (d) => {
    stderrText += d;
    if (stderrText.length > 8000) stderrText = stderrText.slice(-8000);
  });

  const failures = [];
  let count = 0;
  try {
    await waitForEndpoint(`http://127.0.0.1:${port}/json/version`, child, () => stderrText);
    // Open the page as a new target.
    const target = await (await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(PAGE).href)}`,
      { method: 'PUT' },
    )).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    // Collect page errors from the start.
    await evaluate(`window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message)));`);
    // studio.js runs after the page's fonts stylesheet resolves; wait for
    // the geometry export rather than assuming a fixed delay.
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      ready = await evaluate(`!!(window.WHENWHERE && window.WHENWHERE.geometry)`);
      if (!ready) await sleep(500);
    }
    if (!ready) {
      failures.push('geometry never appeared (window.WHENWHERE.geometry is missing — studio.js did not run)');
    } else {
      const results = await evaluate(ASSERTIONS);
      count = results.length;
      for (const r of results) {
        if (!r.ok) failures.push(`${r.name}: ${r.detail}`);
      }
    }
    const errors = await evaluate('window.__errors');
    if (errors.length) failures.push(`page JS errors: ${errors.join(' | ')}`);
    ws.close();
  } finally {
    child.kill('SIGKILL');
    // Wait for the browser to actually exit before removing its
    // profile: SIGKILL is async, and a profile dir still being written
    // to makes the recursive remove fail with ENOTEMPTY — the run went
    // red in CI on teardown before it could report pass/fail
    // (2026-11-20). The 5s cap is a backstop; SIGKILL normally lands
    // in well under a second.
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(resolve, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    try {
      // maxRetries covers the stragglers (a child process flushing a
      // file a beat after the main process dies).
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (e) {
      // A leftover temp profile is harmless (/tmp is cleaned by the
      // OS); it must not fail a run whose assertions passed, and it
      // must not hide the verdict by throwing out of the finally.
      console.error(`warning: could not remove temp profile ${profile}: ${e.message}`);
    }
  }

  if (failures.length) {
    console.error('GEOMETRY TESTS FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`Geometry tests passed: ${count} assertions + no JS errors.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
