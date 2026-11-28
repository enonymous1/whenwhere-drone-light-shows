// Smoke test for the Formation Studio.
//
// Loads the built page in headless Chrome over the DevTools Protocol, clicks
// every formation, and asserts the drone counts, the FLEET-derived button
// labels, and that no JavaScript errors fired. This is the regression net
// for the studio: the geometry is pure functions of a target count, so a
// wrong count here means a shape regressed.
//
// No dependencies beyond Node >= 22 (built-in WebSocket client) and a
// Chrome/Chromium binary. The Chrome path is taken from CHROME_PATH, or
// from the usual install locations. In CI the workflow sets CHROME_PATH
// from the setup-chrome step's chrome-path output — that binary is the
// one the action itself verified with --version, so use it rather than
// whichever Chrome happens to be preinstalled on the runner.
//
// Usage:
//   node tests/smoke.mjs [path/to/index.html]
// Exit code is 0 on pass, 1 on any failure.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE = resolve(process.argv[2] || 'index.html');
const EXPECTED = { heart: 80, rings: 100, glass: 60, star: 120, finale: 180 };
const WORDS = { LOVE: 100, 'A B C': 75, 2027: 100 };
// 'E + J' is no longer one word: since v1.5.0 '+' splits a message into
// separate moments, so 'E + J' is two slides (E, then J) and the first
// shows 50 drones with a "(1 of 2)" caption. It is checked separately
// below, and 'A B C' keeps the space-gap count test (3 glyphs = 75).

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

async function main() {
  const chrome = findChromeBinary();
  if (!chrome) {
    console.error('No Chrome/Chromium found. Set CHROME_PATH to your browser binary.');
    process.exit(1);
  }
  const profile = mkdtempSync(join(tmpdir(), 'ww-smoke-'));
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
    // Wait for the studio to initialise before clicking: the shape
    // handlers are only attached once studio.js runs, and the
    // compliance line's buildShow on the initial formation makes
    // that a little slower than it was. window.WHENWHERE.geometry is
    // set at the end of studio.js, after the handlers are attached.
    for (let i = 0; i < 100; i++) {
      const ready = await evaluate(`!!(window.WHENWHERE && window.WHENWHERE.geometry)`);
      if (ready) break;
      await sleep(100);
    }
    // Collect page errors from the start.
    await evaluate(`window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message)));`);
    await evaluate(`document.querySelector('[data-shape="heart"]').click();`);
    await sleep(300);

    for (const [shape, count] of Object.entries(EXPECTED)) {
      const got = await evaluate(`(function () {
        document.querySelector('[data-shape="${shape}"]').click();
        return document.getElementById('droneCount').textContent;
      })()`);
      if (!got.startsWith(`${count} drones`)) {
        failures.push(`${shape}: expected "${count} drones", got "${got}"`);
      }
    }
    // Compliance line (rules.js): the hearts at the reference scale
    // (3m spacing, 40m centre altitude) top out at 64.9m with a
    // 2.024m closest pair — inside the 120m FAA ceiling.
    const rules = await evaluate(`(function () {
      document.querySelector('[data-shape="heart"]').click();
      return document.getElementById('skyRules').textContent;
    })()`);
    if (!rules.includes('highest drone 64.9m') || !rules.includes('closest pair 2.024m') || !rules.includes('Inside the 120m FAA ceiling')) {
      failures.push(`compliance line: expected "highest drone 64.9m" + "closest pair 2.024m" + "Inside the 120m FAA ceiling", got "${rules}"`);
    }
    // Words are typed, not clicked: the word shape is activated once,
    // then each word is set + an 'input' event is dispatched, which is
    // how a real visitor changes the word (the 'input' listener redraws
    // while the shape is active). Clicking the word button per word
    // would not work — since v1.5.2, clicking the already-active word
    // shape resets to the default LOVE.
    await evaluate(`document.querySelector('[data-shape="word"]').click();`);
    for (const [word, count] of Object.entries(WORDS)) {
      const got = await evaluate(`(function () {
        var input = document.getElementById('customWord');
        input.value = ${JSON.stringify(word)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return document.getElementById('droneCount').textContent;
      })()`);
      if (!got.startsWith(`${count} drones`)) {
        failures.push(`word ${word}: expected "${count} drones", got "${got}"`);
      }
    }
    // Multi-slide words (v1.5.0): 'E + J' is two moments. The first
    // slide is E (50 drones) and the caption says which moment is up.
    const multi = await evaluate(`(function () {
      var input = document.getElementById('customWord');
      input.value = 'E + J';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById('droneCount').textContent + ' | '
        + document.getElementById('shapeName').textContent;
    })()`);
    if (!multi.startsWith('50 drones') || !multi.includes('(1 of 2)')) {
      failures.push(`word E + J (multi-slide): expected "50 drones" + "(1 of 2)", got "${multi}"`);
    }
    // The example pill (v1.5.2): fills the box with a multi-slide
    // message and draws it. First slide is HAPPY (100 drones, 1 of 2).
    const pill = await evaluate(`(function () {
      document.getElementById('exampleWordBtn').click();
      return document.getElementById('customWord').value + ' | '
        + document.getElementById('droneCount').textContent + ' | '
        + document.getElementById('shapeName').textContent;
    })()`);
    if (!pill.startsWith('happy + new year | 100 drones') || !pill.includes('(1 of 2)')) {
      failures.push(`example pill: expected "happy + new year | 100 drones" + "(1 of 2)", got "${pill}"`);
    }
    // The reset button (v1.5.2): puts the default back.
    const reset = await evaluate(`(function () {
      document.getElementById('customWord').value = 'SOMETHING ELSE';
      document.getElementById('wordResetBtn').click();
      return document.getElementById('customWord').value + ' | '
        + document.getElementById('droneCount').textContent;
    })()`);
    if (!reset.startsWith('LOVE | 100 drones')) {
      failures.push(`reset button: expected "LOVE | 100 drones", got "${reset}"`);
    }
    // Re-clicking the already-active word shape (v1.5.2): resets to LOVE.
    const reclick = await evaluate(`(function () {
      var input = document.getElementById('customWord');
      input.value = 'EMMA';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-shape="word"]').click();
      return document.getElementById('customWord').value + ' | '
        + document.getElementById('droneCount').textContent;
    })()`);
    if (!reclick.startsWith('LOVE | 100 drones')) {
      failures.push(`word button re-click: expected "LOVE | 100 drones", got "${reclick}"`);
    }
    // Button labels are derived from FLEET at load; they must match it too.
    const labels = await evaluate(`Array.from(document.querySelectorAll('[data-fleet]'))
      .map((el) => el.getAttribute('data-fleet') + '=' + el.textContent).join(',')`);
    for (const [shape, count] of Object.entries(EXPECTED)) {
      if (!labels.includes(`${shape}=${count}`)) {
        failures.push(`button label for ${shape}: expected ${count} in "${labels}"`);
      }
    }
    // The "View in 3D" button saves the formation on screen for the
    // preview page (window.open is stubbed so no tab opens). The word
    // flow ran just before this, so set the hearts back first — the
    // button must save whatever formation is showing.
    const view3d = await evaluate(`(function () {
      var opened = null;
      window.open = function (url) { opened = url; return null; };
      document.querySelector('[data-shape="heart"]').click();
      document.getElementById('view3dBtn').click();
      var parsed = null;
      try { parsed = JSON.parse(localStorage.getItem('wwPreview3D')); } catch (e) { /* not JSON */ }
      return JSON.stringify({ btn: !!document.getElementById('view3dBtn'), opened: opened, name: parsed && parsed.design && parsed.design.name, points: parsed && parsed.design && parsed.design.points && parsed.design.points.length, shape: parsed && parsed.design && parsed.design.shape, spacing: parsed && parsed.options && parsed.options.spacing, altitude: parsed && parsed.options && parsed.options.altitude });
    })()`);
    const view3dObj = JSON.parse(view3d);
    if (!(view3dObj.btn === true && view3dObj.opened === 'preview-3d.html' && view3dObj.name === 'Interlocking hearts' && view3dObj.points === 80 && view3dObj.shape === 'heart' && view3dObj.spacing === 3 && view3dObj.altitude === 40)) {
      failures.push(`View in 3D button: expected it to save the hearts (80 pts, shape heart, 3m, 40m) and open preview-3d.html, got ${view3d}`);
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
    console.error('SMOKE TEST FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('Smoke test passed: 5 formations + 3 words + multi-slide + example pill + reset + re-click + button labels + no JS errors.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
