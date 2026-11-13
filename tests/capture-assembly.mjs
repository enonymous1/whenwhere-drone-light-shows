// Capture the Formation Studio assembly as an animated GIF.
//
// The studio animation is driven by requestAnimationFrame, so headless
// Chrome's --virtual-time-budget cannot fast-forward it to a settled frame.
// This script drives the real browser over the DevTools Protocol, waits in
// real time, and screenshots the stage at intervals while the fleet
// assembles. Frames are written to /tmp/ww-gif/frames/ as PNGs; stitch them
// with Pillow (see the command in the README) or any GIF tool.
//
// No dependencies beyond Node >= 22 (built-in WebSocket client) and a
// Chrome/Chromium binary (CHROME_PATH, or the usual install locations).
//
// Usage:
//   node tests/capture-assembly.mjs [shape] [out-dir]
//   shape defaults to "heart"; out-dir defaults to /tmp/ww-gif/frames
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHAPE = process.argv[2] || 'heart';
const OUT_DIR = resolve(process.argv[3] || '/tmp/ww-gif/frames');
const PAGE = resolve('index.html');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  join(process.env.HOME || '', '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'),
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForJson(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`DevTools endpoint never came up: ${url}`);
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) {
    console.error('No Chrome/Chromium found. Set CHROME_PATH to your browser binary.');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'ww-gif-'));
  // A random port per run (see tests/smoke.mjs): a fixed port lets a
  // leftover Chrome answer the DevTools probe and hand back a blank page.
  const port = Number(process.env.CDP_PORT) || 9300 + Math.floor(Math.random() * 500);
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1280,7400', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
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
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
    // The studio canvas sits at roughly (430, 2700)-(1210, 3260) in a
    // 1280x7400 window; capture just that region each frame.
    const clip = { x: 430, y: 2700, width: 780, height: 560, scale: 1 };
    await evaluate(`document.querySelector('[data-shape="${SHAPE}"]').click();`);
    // Assembly takes ~2s (1.5s ease + up to 0.55s stagger); capture a frame
    // every 200ms, plus a settled frame at the end.
    for (let i = 0; i <= 14; i++) {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip });
      const data = Buffer.from(shot.result.data, 'base64');
      writeFileSync(join(OUT_DIR, `frame-${String(i).padStart(2, '0')}.png`), data);
      await sleep(i === 14 ? 0 : 200);
    }
    console.log(`Wrote 15 frames to ${OUT_DIR}`);
    ws.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
