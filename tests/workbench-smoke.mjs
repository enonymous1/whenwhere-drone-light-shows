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
    '--window-size=1440,900',
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
    // Word-only controls hide on shapes and show on words. On load
    // the hearts are active, so the Word style and Timing sections are
    // hidden (the word input itself stays visible — it is the switch).
    const hiddenOnShape = await evaluate(`(function () {
      return JSON.stringify({
        wordStyle: document.getElementById('wordStyleBlock').hidden,
        timing: document.getElementById('timingBlock').hidden,
        wordInputVisible: !!document.getElementById('customWord'),
      });
    })()`);
    const hiddenOnShapeObj = JSON.parse(hiddenOnShape);
    check('word style + timing hidden on a shape (hearts)', hiddenOnShapeObj.wordStyle === true && hiddenOnShapeObj.timing === true);
    check('word input stays visible on a shape', hiddenOnShapeObj.wordInputVisible === true);
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
    // Switching to words reveals the word-only controls.
    const shownOnWord = await evaluate(`(function () {
      return JSON.stringify({
        wordStyle: document.getElementById('wordStyleBlock').hidden,
        timing: document.getElementById('timingBlock').hidden,
      });
    })()`);
    const shownOnWordObj = JSON.parse(shownOnWord);
    check('word style + timing shown on words', shownOnWordObj.wordStyle === false && shownOnWordObj.timing === false);
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
    // Skybrush export: the section lives in the right column under the
    // preview (not in the left controls), the stats line populates on
    // load, and the builder returns a show Skybrush's own validator
    // accepts — a takeoff from a ground grid, the held shape, and a
    // landing back to the grid (version 1, outdoor, 4 trajectory
    // points per drone, lowercase segments, lights dark during
    // takeoff/landing). Click back to the hearts first so the counts
    // below are the known 80.
    await evaluate(`document.querySelector('[data-shape="heart"]').click();`);
    // Back on a shape, the word-only controls hide again.
    const hiddenAgain = await evaluate(`(function () {
      return JSON.stringify({
        wordStyle: document.getElementById('wordStyleBlock').hidden,
        timing: document.getElementById('timingBlock').hidden,
      });
    })()`);
    const hiddenAgainObj = JSON.parse(hiddenAgain);
    check('word style + timing hide again on a shape', hiddenAgainObj.wordStyle === true && hiddenAgainObj.timing === true);
    // The export sits in the right column under the preview; the left
    // controls column holds the design inputs only.
    const layout = await evaluate(`(function () {
      var side = document.querySelector('.wb-side');
      var controls = document.querySelector('.wb-controls');
      var stage = document.querySelector('.wb-stage');
      return JSON.stringify({
        exportInSide: !!(side && side.querySelector('#exportSkycBtn')),
        exportNotInControls: !(controls && controls.querySelector('#exportSkycBtn')),
        stageInSide: !!(side && side.contains(stage)),
        stageNotSticky: stage ? getComputedStyle(stage).position !== 'sticky' : false,
      });
    })()`);
    const layoutObj = JSON.parse(layout);
    check('export is in the right column under the preview', layoutObj.exportInSide === true && layoutObj.exportNotInControls === true);
    check('stage is in the right column and scrolls normally (not sticky — the sticky stage covered the export settings)', layoutObj.stageInSide === true && layoutObj.stageNotSticky === true);
    const exportUi = await evaluate(`(function () {
      return JSON.stringify({
        btn: !!document.getElementById('exportSkycBtn'),
        csvBtn: !!document.getElementById('exportCsvBtn'),
        kmzBtn: !!document.getElementById('exportKmzBtn'),
        venueLat: !!document.getElementById('venueLat'),
        venueLon: !!document.getElementById('venueLon'),
        venueOrient: !!document.getElementById('venueOrient'),
        spacing: !!document.getElementById('spacingRange'),
        takeoffSpacing: !!document.getElementById('takeoffSpacingRange'),
        altitude: !!document.getElementById('altitudeRange'),
        hold: !!document.getElementById('holdRange'),
        stats: document.getElementById('exportStats').textContent,
        note: document.getElementById('exportNote').textContent,
      });
    })()`);
    const exportUiObj = JSON.parse(exportUi);
    check('export UI present (3 buttons + 4 sliders + venue fields + stats + note)', exportUiObj.btn && exportUiObj.csvBtn && exportUiObj.kmzBtn && exportUiObj.venueLat && exportUiObj.venueLon && exportUiObj.venueOrient && exportUiObj.spacing && exportUiObj.takeoffSpacing && exportUiObj.altitude && exportUiObj.hold);
    check('export stats populate on load (80 drones, 3m spacing, 90s total, height range, grid)', typeof exportUiObj.stats === 'string'
      && exportUiObj.stats.startsWith('80 drones') && exportUiObj.stats.includes('typical spacing 3m') && exportUiObj.stats.includes('90s total')
      && exportUiObj.stats.includes('above ground') && exportUiObj.stats.includes('takeoff grid'));
    check('export note describes the ground-grid takeoff + landing', typeof exportUiObj.note === 'string'
      && exportUiObj.note.replace(/\s+/g, ' ').includes('ground grid')
      && exportUiObj.note.replace(/\s+/g, ' ').includes('30s each')
      && exportUiObj.note.replace(/\s+/g, ' ').includes('show adaptation'));
    const show = await evaluate(`(function () {
      var wb = window.WHENWHERE.workbench;
      var show = WhenWhereSkyc.buildShow(
        { name: wb.currentName, points: wb.points },
        { spacing: 3, takeoffSpacing: 1, altitude: 40, holdSeconds: 30, separatePoints: window.WHENWHERE.geometry.separatePoints });
      var drones = show.show.swarm.drones;
      function min2D(pts) {
        var m = Infinity;
        for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
          var dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
          m = Math.min(m, Math.sqrt(dx * dx + dy * dy));
        }
        return m;
      }
      var first = drones.map(function (d) { return d.settings.trajectory.points[0][1]; });
      var form = drones.map(function (d) { return d.settings.trajectory.points[1][1]; });
      return JSON.stringify({
        version: show.show.version,
        env: show.show.environment.type,
        drones: drones.length,
        trajVersion: drones[0].settings.trajectory.version,
        lightsVersion: drones[0].settings.lights.version,
        title: show.show.meta.title,
        segmentKeys: Object.keys(show.show.meta.segments).sort(),
        takeoffSeg: show.show.meta.segments.takeoff,
        showSeg: show.show.meta.segments.show,
        landingSeg: show.show.meta.segments.landing,
        totalSeconds: show.stats.totalSeconds,
        gridCols: show.stats.gridCols,
        gridRows: show.stats.gridRows,
        pointsPerDrone: drones[0].settings.trajectory.points.length,
        pointTimes: drones[0].settings.trajectory.points.map(function (p) { return p[0]; }),
        takeoffTime: drones[0].settings.trajectory.takeoffTime,
        landingTime: drones[0].settings.trajectory.landingTime,
        uniqueFormation: new Set(form.map(function (p) { return p.join(','); })).size,
        minTakeoff2D: min2D(first),
        homeIsFirst: drones.every(function (d) { return JSON.stringify(d.settings.home) === JSON.stringify(d.settings.trajectory.points[0][1]); }),
        firstIsLast: drones.every(function (d) { return JSON.stringify(d.settings.trajectory.points[0][1]) === JSON.stringify(d.settings.trajectory.points[3][1]); }),
        firstOnGround: first.every(function (p) { return p[2] === 0; }),
        minSpacing: show.stats.minSpacing,
        medianSpacing: show.stats.medianSpacing,
        gridSpacing: show.stats.gridSpacing,
        gridWidth: show.stats.gridWidth,
        gridDepth: show.stats.gridDepth,
        minHeight: show.stats.minHeight,
        maxHeight: show.stats.maxHeight,
        validationMaxAltitude: show.show.settings.validation.maxAltitude,
        validationMinNavAltitude: show.show.settings.validation.minNavAltitude,
        validationMinDistance: show.show.settings.validation.minDistance,
      });
    })()`);
    const showObj = JSON.parse(show);
    check('exported show: version 1, outdoor, 80 drones', showObj.version === 1 && showObj.env === 'outdoor' && showObj.drones === 80);
    check('exported show: trajectory + lights version 1', showObj.trajVersion === 1 && showObj.lightsVersion === 1);
    check('exported show: title has no (static)', typeof showObj.title === 'string' && !showObj.title.includes('(static)'));
    check('exported show: segments are lowercase takeoff/show/landing [0,30] [30,60] [60,90]',
      JSON.stringify(showObj.segmentKeys) === '["landing","show","takeoff"]'
      && JSON.stringify(showObj.takeoffSeg) === '[0,30]' && JSON.stringify(showObj.showSeg) === '[30,60]' && JSON.stringify(showObj.landingSeg) === '[60,90]');
    check('exported show: 90s total, 9x9 takeoff grid', showObj.totalSeconds === 90 && showObj.gridCols === 9 && showObj.gridRows === 9);
    check('exported show: 4 trajectory points at 0/30/60/90, takeoffTime 0, landingTime 90',
      showObj.pointsPerDrone === 4 && JSON.stringify(showObj.pointTimes) === '[0,30,60,90]'
      && showObj.takeoffTime === 0 && showObj.landingTime === 90);
    check('exported show: no two drones share a formation position', showObj.uniqueFormation === 80);
    check('exported show: takeoff grid min 2D distance is 1m (the split takeoff spacing, >= 0.4m Live outdoor threshold)', Math.abs(showObj.minTakeoff2D - 1) < 0.001);
    check('exported show: tight 1m takeoff grid, 8x8m footprint, formation spacing still 3m', showObj.gridSpacing === 1 && showObj.gridWidth === 8 && showObj.gridDepth === 8 && showObj.medianSpacing === 3);
    check('exported show: validation declares 120m ceiling, minNavAltitude = lowest drone (12.5m), minDistance = half spacing (1.5m)',
      showObj.validationMaxAltitude === 120 && showObj.validationMinNavAltitude === 12.5 && showObj.validationMinDistance === 1.5);
    check('exported show: height range 12.5-64.9m above ground (matches Live max AHL)', Math.abs(showObj.minHeight - 12.5) < 0.1 && Math.abs(showObj.maxHeight - 64.9) < 0.1);
    check('exported show: home is the ground takeoff slot, first point is the last', showObj.homeIsFirst === true && showObj.firstIsLast === true && showObj.firstOnGround === true);
    check('exported show: min spacing >= 1.5m, median 3m', showObj.minSpacing >= 1.5 && showObj.medianSpacing === 3);
    // CSV export: one file per drone, 1s samples, lights off until in
    // position. The zip is stored (no compression), so the test parses
    // the local file headers directly.
    const csv = await evaluate(`(function () {
      var wb = window.WHENWHERE.workbench;
      var out = window.WhenWhereSkyc.exportCsv({ name: wb.currentName, points: wb.points },
        { spacing: 3, takeoffSpacing: 3, altitude: 40, holdSeconds: 30, separatePoints: window.WHENWHERE.geometry.separatePoints });
      var files = parseStoredZip(out.bytes);
      var names = Object.keys(files).sort();
      var first = files[names[0]] || '';
      var rows = first.split('\\n').filter(function (l) { return l.length; });
      return JSON.stringify({ filename: out.filename, count: names.length, firstName: names[0] || '', header: rows[0] || '', rowCount: rows.length - 1, row0: rows[1] || '', row30: rows[31] || '', row90: rows[91] || '' });
      function parseStoredZip(bytes) {
        var out = {};
        var i = 0;
        while (i + 30 <= bytes.length) {
          if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) break;
          var nameLen = bytes[i + 26] | (bytes[i + 27] << 8);
          var extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
          var size = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
          var nameStart = i + 30;
          var dataStart = nameStart + nameLen + extraLen;
          var name = '';
          for (var n = 0; n < nameLen; n++) name += String.fromCharCode(bytes[nameStart + n]);
          var data = '';
          for (var d = 0; d < size; d++) data += String.fromCharCode(bytes[dataStart + d]);
          out[name] = data;
          i = dataStart + size;
        }
        return out;
      }
    })()`);
    const csvObj = JSON.parse(csv);
    check('CSV export: filename is a -csv.zip, 80 files (one per drone), first is drone-01.csv', csvObj.filename.endsWith('-csv.zip') && csvObj.count === 80 && csvObj.firstName === 'drone-01.csv');
    check('CSV export: header is Time_msec,x_m,y_m,z_m,R,G,B and 91 rows (0-90s)', csvObj.header === 'Time_msec,x_m,y_m,z_m,R,G,B' && csvObj.rowCount === 91);
    check('CSV export: t=0 is on the ground (z=0) with lights off (0,0,0)', csvObj.row0.startsWith('0,') && csvObj.row0.split(',')[3] === '0' && csvObj.row0.endsWith(',0,0,0'));
    check('CSV export: t=30s is in the air with lights on (not 0,0,0)', (function () { var p = csvObj.row30.split(','); return p[0] === '30000' && Number(p[3]) > 0 && !(p[4] === '0' && p[5] === '0' && p[6] === '0'); })());
    check('CSV export: t=90s is back on the ground with lights off', csvObj.row90.startsWith('90000,') && csvObj.row90.split(',')[3] === '0' && csvObj.row90.endsWith(',0,0,0'));
    // Google Earth export: one LineString per drone, anchored to the
    // venue, altitudes relative to ground.
    const kmz = await evaluate(`(function () {
      var wb = window.WHENWHERE.workbench;
      var out = window.WhenWhereSkyc.exportKmz({ name: wb.currentName, points: wb.points },
        { spacing: 3, takeoffSpacing: 3, altitude: 40, holdSeconds: 30, separatePoints: window.WHENWHERE.geometry.separatePoints },
        { latitude: 38.0, longitude: -77.0, orientationDegrees: 0 });
      var files = parseStoredZip(out.bytes);
      var kml = files['doc.kml'] || '';
      var placemarks = (kml.match(/<Placemark>/g) || []).length;
      var firstCoords = (kml.match(/<coordinates>([^<]+)<\\/coordinates>/) || [])[1] || '';
      var first = firstCoords.split(' ')[0].split(',');
      var second = firstCoords.split(' ')[1].split(',');
      return JSON.stringify({ filename: out.filename, count: Object.keys(files).length, placemarks: placemarks, firstLon: Number(first[0]), firstLat: Number(first[1]), firstAlt: Number(first[2]), secondAlt: Number(second[2]), hasKml: kml.indexOf('</kml>') !== -1 });
      function parseStoredZip(bytes) {
        var out = {};
        var i = 0;
        while (i + 30 <= bytes.length) {
          if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) break;
          var nameLen = bytes[i + 26] | (bytes[i + 27] << 8);
          var extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
          var size = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
          var nameStart = i + 30;
          var dataStart = nameStart + nameLen + extraLen;
          var name = '';
          for (var n = 0; n < nameLen; n++) name += String.fromCharCode(bytes[nameStart + n]);
          var data = '';
          for (var d = 0; d < size; d++) data += String.fromCharCode(bytes[dataStart + d]);
          out[name] = data;
          i = dataStart + size;
        }
        return out;
      }
    })()`);
    const kmzObj = JSON.parse(kmz);
    check('KMZ export: filename is a .kmz holding doc.kml, 80 Placemarks', kmzObj.filename.endsWith('.kmz') && kmzObj.count === 1 && kmzObj.placemarks === 80 && kmzObj.hasKml === true);
    check('KMZ export: first path starts at the venue (lon -77, lat 38, alt 0)', Math.abs(kmzObj.firstLon - (-77)) < 0.001 && Math.abs(kmzObj.firstLat - 38) < 0.001 && kmzObj.firstAlt === 0);
    check('KMZ export: second point is the formation, in the air', kmzObj.secondAlt > 10);
    const kmzErr = await evaluate(`(function () {
      var wb = window.WHENWHERE.workbench;
      try {
        window.WhenWhereSkyc.exportKmz({ name: wb.currentName, points: wb.points },
          { spacing: 3, takeoffSpacing: 3, altitude: 40, holdSeconds: 30, separatePoints: window.WHENWHERE.geometry.separatePoints },
          { latitude: NaN, longitude: -77.0 });
        return 'no error';
      } catch (e) { return String(e.message); }
    })()`);
    check('KMZ export: throws a clear error without a valid venue', typeof kmzErr === 'string' && kmzErr.indexOf('venue.latitude') !== -1);
    // The Google Earth button is disabled until the venue is set, and
    // the venue is saved in this browser.
    const kmzBtn = await evaluate(`(function () {
      var btn = document.getElementById('exportKmzBtn');
      var before = btn.disabled;
      document.getElementById('venueLat').value = '38.0';
      document.getElementById('venueLat').dispatchEvent(new Event('input'));
      document.getElementById('venueLon').value = '-77.0';
      document.getElementById('venueLon').dispatchEvent(new Event('input'));
      var after = btn.disabled;
      var saved = localStorage.getItem('wwWorkbenchVenue');
      return JSON.stringify({ before: before, after: after, saved: saved });
    })()`);
    const kmzBtnObj = JSON.parse(kmzBtn);
    check('Google Earth button is disabled until the venue latitude/longitude are set', kmzBtnObj.before === true && kmzBtnObj.after === false);
    check('venue is saved in localStorage', typeof kmzBtnObj.saved === 'string' && kmzBtnObj.saved.indexOf('38') !== -1 && kmzBtnObj.saved.indexOf('-77') !== -1);
    // The 3D preview button saves the formation on screen for the
    // preview page (window.open is stubbed so no tab opens).
    const previewBtn = await evaluate(`(function () {
      var opened = null;
      window.open = function (url) { opened = url; return null; };
      document.getElementById('preview3dBtn').click();
      var saved = localStorage.getItem('wwPreview3D');
      var parsed = null;
      try { parsed = JSON.parse(saved); } catch (e) { /* not JSON */ }
      return JSON.stringify({ btn: !!document.getElementById('preview3dBtn'), opened: opened, name: parsed && parsed.design && parsed.design.name, points: parsed && parsed.design && parsed.design.points && parsed.design.points.length, spacing: parsed && parsed.options && parsed.options.spacing, altitude: parsed && parsed.options && parsed.options.altitude });
    })()`);
    const previewBtnObj = JSON.parse(previewBtn);
    check('3D preview button saves the formation + export settings for the preview page', previewBtnObj.btn === true && previewBtnObj.opened === '../preview-3d.html' && previewBtnObj.name === 'Interlocking hearts' && previewBtnObj.points === 80 && previewBtnObj.spacing === 3 && previewBtnObj.altitude === 40);
    // The venue map: "Find on map" (no address) opens the modal on
    // the Spotsylvania default, and "Use this location" writes the
    // latitude/longitude into the venue fields and enables the
    // Google Earth export. No address is typed, so no geocoding
    // (network) is needed for this check. The KMZ check above leaves
    // the venue at (38, -77), so clear the fields first — otherwise
    // the map opens on that venue instead of the default. The waits
    // use the harness's sleep — the evaluate helper cannot await a
    // Promise (CDP returns the Promise object, not its value).
    await evaluate(`(function () {
      document.getElementById('venueLat').value = '';
      document.getElementById('venueLon').value = '';
      localStorage.removeItem('wwWorkbenchVenue');
      document.getElementById('venueAddress').value = '';
      document.getElementById('venueMapBtn').click();
      return 'ok';
    })()`);
    await sleep(1200);
    const venueMapOpen = await evaluate(`JSON.stringify({
      open: !document.getElementById('venueModal').hidden,
      leaflet: typeof L !== 'undefined' && document.querySelectorAll('#venueMap .leaflet-pane').length > 0,
      coords: document.getElementById('venueMapCoords').textContent,
    })`);
    const venueMapOpenObj = JSON.parse(venueMapOpen);
    await evaluate(`document.getElementById('venueMapUse').click(); 'ok'`);
    await sleep(300);
    const venueMapUsed = await evaluate(`JSON.stringify({
      lat: document.getElementById('venueLat').value,
      lon: document.getElementById('venueLon').value,
      kmzDisabled: document.getElementById('exportKmzBtn').disabled,
      modalHidden: document.getElementById('venueModal').hidden,
    })`);
    const venueMapUsedObj = JSON.parse(venueMapUsed);
    check('venue map opens, Leaflet loads, and Use this location fills the venue + enables Google Earth', venueMapOpenObj.open === true && venueMapOpenObj.leaflet === true && venueMapOpenObj.coords.indexOf('38.201900') !== -1 && venueMapUsedObj.lat === '38.201900' && venueMapUsedObj.lon === '-77.584600' && venueMapUsedObj.kmzDisabled === false && venueMapUsedObj.modalHidden === true);
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
    // Moving the takeoff spacing slider re-derives the grid footprint
    // in the stats line but leaves the formation (typical spacing 3m,
    // after the spacing slider above set it to 2m — reset first) alone.
    // Reset the formation spacing to 3m, then tighten the ground grid.
    const tighter = await evaluate(`(function () {
      var s = document.getElementById('spacingRange');
      s.value = '3';
      s.dispatchEvent(new Event('input'));
      var t = document.getElementById('takeoffSpacingRange');
      t.value = '1';
      t.dispatchEvent(new Event('input'));
      return document.getElementById('exportStats').textContent;
    })()`);
    check('takeoff spacing slider shrinks the grid footprint only (1m grid, 8x8m, formation still 3m)', typeof tighter === 'string'
      && tighter.includes('8m × 8m takeoff grid') && tighter.includes('typical spacing 3m'));
    // Raising the altitude and widening the spacing pushes the top of
    // the picture above the 120m ceiling — the stats line must say so.
    const overCeiling = await evaluate(`(function () {
      var s = document.getElementById('spacingRange');
      s.value = '5';
      s.dispatchEvent(new Event('input'));
      var a = document.getElementById('altitudeRange');
      a.value = '100';
      a.dispatchEvent(new Event('input'));
      var text = document.getElementById('exportStats').textContent;
      s.value = '3'; s.dispatchEvent(new Event('input'));
      a.value = '40'; a.dispatchEvent(new Event('input'));
      return text;
    })()`);
    check('stats line warns when the highest drone exceeds the 120m ceiling (5m spacing, 100m altitude)', typeof overCeiling === 'string'
      && overCeiling.includes('above the 120m ceiling'));
    // Tightening the formation spacing below the rules floor warns:
    // at 1m spacing the closest pair is ~0.675m, under the 1.5m minimum.
    const tight = await evaluate(`(function () {
      var s = document.getElementById('spacingRange');
      s.value = '1';
      s.dispatchEvent(new Event('input'));
      var text = document.getElementById('exportStats').textContent;
      s.value = '3'; s.dispatchEvent(new Event('input'));
      return text;
    })()`);
    check('stats line warns when the closest pair is below the 1.5m minimum (1m spacing)', typeof tight === 'string'
      && tight.includes('below the 1.5m minimum'));
    // The Takeoff spacing slider floor follows the rules file.
    const takeoffMin = await evaluate(`document.getElementById('takeoffSpacingRange').min`);
    check('takeoff spacing slider floor follows the rules (min 0.5m)', takeoffMin === '0.5');
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
  console.log('\nWorkbench smoke tests passed: 5 formations + word-only controls hide/show + words + multi-slide + example pill + font picker + palette picker + design summary + Skybrush export (right-column layout + UI + takeoff/landing show structure + spacing slider) + no JS errors.');
}

main();
