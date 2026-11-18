// Unit tests for the pure geometry in studio.js.
//
// The geometry functions (resample, resampleRuns, heartPair, thinUniform,
// wordPoints) are exposed on the page as window.WHENWHERE.geometry, so this
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
// - wordPoints returns exactly its target (25 per character, clamped
//   50-100) for known strings, including the clamp edges and empty input.
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
  const inCanvas = (pts) => pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 520);

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
  check('heartPair(80): all points inside the 900x520 canvas', inCanvas(hp80), hp80.length + ' points');
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

  // wordPoints: exactly the target (25 per character, clamped 50-100).
  const words = { TEST: 100, LOVE: 100, 2027: 100, 'E + J': 75 };
  for (const [word, target] of Object.entries(words)) {
    const got = g.wordPoints(word).length;
    check('wordPoints(' + JSON.stringify(word) + ') returns ' + target, got === target, got);
  }
  check("wordPoints('A') hits the lower clamp (50)", g.wordPoints('A').length === 50, g.wordPoints('A').length);
  check("wordPoints('WEDDINGS') hits the upper clamp (100)", g.wordPoints('WEDDINGS').length === 100, g.wordPoints('WEDDINGS').length);
  check('wordPoints of empty / whitespace-only text is empty',
    g.wordPoints('').length === 0 && g.wordPoints('   ').length === 0, "'' -> " + g.wordPoints('').length + ", '   ' -> " + g.wordPoints('   ').length);
  check("wordPoints('TEST') points inside the 900x520 canvas", inCanvas(g.wordPoints('TEST')), 'all inside');

  // Spaces are gaps, not vanished: 'MARRY ME' has the same 100 drones as
  // 'MARRYME' (a space takes no drones), and the gap between the Y and M
  // clusters is a word space wider than a plain letter gap. Points come
  // back grouped by glyph (extra dots go to the first glyphs), so with
  // 7 glyphs Y is points 58..71 and M is 72..85. A long word shrinks to
  // fit instead of running off the stage.
  const marryMe = g.wordPoints('MARRY ME'), marryMeNoSpace = g.wordPoints('MARRYME');
  check("wordPoints('MARRY ME') still returns 100 (a space takes no drones)", marryMe.length === 100, marryMe.length);
  const boundaryGap = (pts) => {
    const y = pts.slice(58, 72), m = pts.slice(72, 86);
    return Math.min(...m.map((p) => p.x)) - Math.max(...y.map((p) => p.x));
  };
  const gapSpaced = boundaryGap(marryMe), gapPlain = boundaryGap(marryMeNoSpace);
  check("wordPoints('MARRY ME') leaves a word-sized gap between Y and M",
    gapSpaced > 80 && gapSpaced - gapPlain > 30,
    Math.round(gapSpaced * 10) / 10 + 'px vs ' + Math.round(gapPlain * 10) / 10 + 'px without the space');
  const congrats = g.wordPoints('CONGRATULATIONS');
  check("wordPoints('CONGRATULATIONS') returns 100", congrats.length === 100, congrats.length);
  check("wordPoints('CONGRATULATIONS') stays inside the canvas", inCanvas(congrats), 'all inside');

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
    rmSync(profile, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error('GEOMETRY TESTS FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`Geometry tests passed: ${count} assertions + no JS errors.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
