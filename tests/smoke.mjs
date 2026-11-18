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
const EXPECTED = { heart: 80, rings: 100, glass: 60, star: 200, finale: 240 };
const WORDS = { LOVE: 100, 'E + J': 75, 2027: 100 };

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
    for (const [word, count] of Object.entries(WORDS)) {
      const got = await evaluate(`(function () {
        document.getElementById('customWord').value = ${JSON.stringify(word)};
        document.querySelector('[data-shape="word"]').click();
        return document.getElementById('droneCount').textContent;
      })()`);
      if (!got.startsWith(`${count} drones`)) {
        failures.push(`word ${word}: expected "${count} drones", got "${got}"`);
      }
    }
    // Button labels are derived from FLEET at load; they must match it too.
    const labels = await evaluate(`Array.from(document.querySelectorAll('[data-fleet]'))
      .map((el) => el.getAttribute('data-fleet') + '=' + el.textContent).join(',')`);
    for (const [shape, count] of Object.entries(EXPECTED)) {
      if (!labels.includes(`${shape}=${count}`)) {
        failures.push(`button label for ${shape}: expected ${count} in "${labels}"`);
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
    console.error('SMOKE TEST FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('Smoke test passed: 5 formations + 3 words + button labels + no JS errors.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
