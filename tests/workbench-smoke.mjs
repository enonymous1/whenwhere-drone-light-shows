// Smoke test for the Formation Workbench (workbench/index.html).
//
// Loads the workbench in headless Chrome over the DevTools Protocol,
// clicks every formation, and asserts the drone counts, the word tools,
// the palette picker, and the "Copy this design" summary — and that no
// JavaScript errors fired. This is the regression net for the
// workbench: it shares geometry.js with the drone page, so a wrong
// count here means the workbench's wiring regressed, not the math.
//
// Unlike tests/smoke.mjs, this test polls for window.WHENWHERE.geometry
// before doing anything (a readiness wait), so a slow Google Fonts
// stylesheet cannot make it read empty counts — the file:// flake the
// drone smoke test is known for.
//
// No dependencies beyond Node >= 22 (built-in WebSocket client) and a
// Chrome/Chromium binary. The Chrome path is taken from CHROME_PATH, or
// from the usual install locations. In CI the workflow sets CHROME_PATH
// from the setup-chrome step's chrome-path output.
//
// Usage:
//   node tests/workbench-smoke.mjs [path/to/workbench/index.html]
// Exit code is 0 on pass, 1 on any failure.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE = resolve(process.argv[2] || 'workbench/index.html');
const EXPECTED = { heart: 80, rings: 100, glass: 60, star: 200, finale: 240 };

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
      throw new Error(`Chrome exited (${child.exitCode}) before the DevTools endpoint came up:\n${stderrTail(stderr())}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error(`DevTools endpoint never came up at ${url}:\n${stderrTail(stderr())}`);
}

async function main() {
  const chrome = findChromeBinary();
  if (!chrome) {
    console.error('No Chrome/Chromium found. Set CHROME_PATH to your browser binary.');
    process.exit(1);
  }
  const profile = mkdtempSync(join(tmpdir(), 'ww-wb-smoke-'));
  // A random port per run: a fixed port lets a leftover Chrome from an
  // earlier run (or another job on the same runner) answer the DevTools
  // probe and hand the test a blank page.
  const port = Number(process.env.CDP_PORT) || 9300 + Math.floor(Math.random() * 500);
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
    await evaluate(`window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message)));`);
    // Readiness wait: the geometry export is set after workbench.js
    // runs its wiring, so its presence means the page is ready.
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`!!(window.WHENWHERE && window.WHENWHERE.geometry)`)) { ready = true; break; }
      await sleep(100);
    }
    if (!ready) failures.push('workbench never became ready (window.WHENWHERE.geometry missing after 10s)');
    const check = (label, cond) => {
      console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
      if (!cond) failures.push(label);
    };

    // The page is unlisted: noindex, and no link to it from here.
    check('noindex meta', await evaluate(`!!document.querySelector('meta[name="robots"][content="noindex"]')`));
    check('back link to the drone site', await evaluate(`!!document.querySelector('a[href="../index.html"]')`));
    // The five formations, with the FLEET counts.
    for (const [shape, count] of Object.entries(EXPECTED)) {
      const got = await evaluate(`(function () {
        document.querySelector('[data-shape="${shape}"]').click();
        return document.getElementById('droneCount').textContent;
      })()`);
      check(`formation ${shape}=${count}`, typeof got === 'string' && got.startsWith(count + ' drones'));
    }
    // Button labels come from FLEET.
    for (const [shape, count] of Object.entries(EXPECTED)) {
      const label = await evaluate(`document.querySelector('[data-fleet="${shape}"]').textContent`);
      check(`button label ${shape}=${count}`, label === String(count));
    }
    // Words are typed, not clicked: the word shape is activated once,
    // then each word is set + an 'input' event is dispatched, which is
    // how a real visitor changes the word (the 'input' listener redraws
    // while the shape is active). Clicking the word button per word
    // would not work — clicking the already-active word shape resets
    // to the default LOVE.
    await evaluate(`document.querySelector('[data-shape="word"]').click();`);
    // Words: LOVE is 100 drones; 'E + J' is two slides (50 + "(1 of 2)").
    const word = await evaluate(`(function () {
      var input = document.getElementById('customWord');
      input.value = 'LOVE';
      input.dispatchEvent(new Event('input'));
      return document.getElementById('droneCount').textContent + ' | ' + document.getElementById('shapeName').textContent;
    })()`);
    check('word LOVE=100', typeof word === 'string' && word.startsWith('100 drones'));
    const multi = await evaluate(`(function () {
      var input = document.getElementById('customWord');
      input.value = 'E + J';
      input.dispatchEvent(new Event('input'));
      return document.getElementById('droneCount').textContent + ' | ' + document.getElementById('shapeName').textContent;
    })()`);
    check("multi-slide 'E + J' = 50 + (1 of 2)", typeof multi === 'string' && multi.startsWith('50 drones') && multi.includes('(1 of 2)'));
    // The example pill fills the box and shows the first slide.
    const pill = await evaluate(`(function () {
      document.getElementById('exampleWordBtn').click();
      return document.getElementById('customWord').value + ' | ' + document.getElementById('droneCount').textContent;
    })()`);
    check('example pill fills happy + new year, 100 drones', typeof pill === 'string' && pill.startsWith('happy + new year | 100 drones'));
    // The font picker lists the 12 sampled faces; the default is Marcellus.
    const fonts = await evaluate(`(function () {
      var sel = document.getElementById('fontSelect');
      return sel.options.length + '|' + sel.options[sel.selectedIndex].textContent;
    })()`);
    check('font picker has 12 faces, default Marcellus', fonts === '12|Marcellus 700');
    // The palette picker: choosing one sets the override and re-renders.
    const palette = await evaluate(`(function () {
      var sel = document.getElementById('paletteSelect');
      sel.value = 'heart';
      sel.dispatchEvent(new Event('change'));
      return JSON.stringify(window.WHENWHERE.workbench.paletteOverride);
    })()`);
    check('palette picker sets the override', palette === JSON.stringify(['#ff7d9c', '#ff4d6d', '#ffb3c1', '#ffffff']));
    // "Copy this design" fills the summary panel.
    const summary = await evaluate(`(function () {
      document.getElementById('useDesignBtn').click();
      return document.getElementById('designSummary').textContent;
    })()`);
    check('design summary has formation + drones + palette', typeof summary === 'string'
      && summary.includes('Formation:') && summary.includes('Drones:') && summary.includes('Palette:'));
    // Skybrush export: the section exists, the stats line populates on
    // load, and the builder returns a show Skybrush's own validator
    // accepts (version 1, outdoor, one trajectory + one light program
    // per drone, no two drones sharing a position). Click back to the
    // hearts first so the counts below are the known 80.
    await evaluate(`document.querySelector('[data-shape="heart"]').click();`);
    const exportUi = await evaluate(`(function () {
      return JSON.stringify({
        btn: !!document.getElementById('exportSkycBtn'),
        spacing: !!document.getElementById('spacingRange'),
        altitude: !!document.getElementById('altitudeRange'),
        hold: !!document.getElementById('holdRange'),
        stats: document.getElementById('exportStats').textContent,
        note: document.getElementById('exportNote').textContent,
      });
    })()`);
    const exportUiObj = JSON.parse(exportUi);
    check('export UI present (button + 3 sliders + stats + note)', exportUiObj.btn && exportUiObj.spacing && exportUiObj.altitude && exportUiObj.hold);
    check('export stats populate on load (80 drones, 3m spacing)', typeof exportUiObj.stats === 'string'
      && exportUiObj.stats.startsWith('80 drones') && exportUiObj.stats.includes('typical spacing 3m'));
    check('export note says no takeoff / RTH / landing', typeof exportUiObj.note === 'string'
      && exportUiObj.note.includes('no takeoff') && exportUiObj.note.includes('no landing'));
    const show = await evaluate(`(function () {
      var wb = window.WHENWHERE.workbench;
      var show = WhenWhereSkyc.buildShow(
        { name: wb.currentName, points: wb.points },
        { spacing: 3, altitude: 40, holdSeconds: 30, separatePoints: window.WHENWHERE.geometry.separatePoints });
      var pts = show.show.swarm.drones.map(function (d) { return d.settings.trajectory.points[0][1].join(','); });
      return JSON.stringify({
        version: show.show.version,
        env: show.show.environment.type,
        drones: show.show.swarm.drones.length,
        trajVersion: show.show.swarm.drones[0].settings.trajectory.version,
        lightsVersion: show.show.swarm.drones[0].settings.lights.version,
        uniquePositions: new Set(pts).size,
        minSpacing: show.stats.minSpacing,
        medianSpacing: show.stats.medianSpacing,
      });
    })()`);
    const showObj = JSON.parse(show);
    check('exported show: version 1, outdoor, 80 drones', showObj.version === 1 && showObj.env === 'outdoor' && showObj.drones === 80);
    check('exported show: trajectory + lights version 1', showObj.trajVersion === 1 && showObj.lightsVersion === 1);
    check('exported show: no two drones share a position', showObj.uniquePositions === 80);
    check('exported show: min spacing >= 1.5m, median 3m', showObj.minSpacing >= 1.5 && showObj.medianSpacing === 3);
    // Moving the spacing slider re-derives the stats (narrower spacing
    // = narrower picture, same drone count).
    const narrower = await evaluate(`(function () {
      var range = document.getElementById('spacingRange');
      range.value = '2';
      range.dispatchEvent(new Event('input'));
      return document.getElementById('exportStats').textContent;
    })()`);
    check('spacing slider re-derives stats (2m, same 80 drones, narrower)', typeof narrower === 'string'
      && narrower.startsWith('80 drones') && narrower.includes('typical spacing 2m'));
    const errors = await evaluate(`window.__errors`);
    check('no JS errors', Array.isArray(errors) && errors.length === 0);
    if (Array.isArray(errors) && errors.length) console.log('JS errors:', errors);
  } catch (err) {
    failures.push(`harness error: ${err.message}`);
    console.error(err);
  } finally {
    child.kill('SIGKILL');
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
    // A leftover profile is not a test failure — warn, like the other
    // harnesses, and let the exit code carry the real verdict.
    try {
      if (existsSync(profile)) console.warn(`warning: could not remove temp profile ${profile}`);
    } catch { /* ignore */ }
  }
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nWorkbench smoke tests passed: 5 formations + words + multi-slide + example pill + font picker + palette picker + design summary + Skybrush export (UI + show structure + spacing slider) + no JS errors.');
}

main();
