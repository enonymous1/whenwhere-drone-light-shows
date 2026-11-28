// 3D preview of a When&Where drone light show.
//
// Reads the show from localStorage (key `wwPreview3D`, written by the
// workbench / studio "Preview in 3D" button as { design, options }),
// and falls back to the interlocking hearts demo when nothing was
// saved. The show is built with the same WhenWhereSkyc.buildShow the
// .skyc export uses, so the 3D picture is the same show that flies.
//
// The drones are one THREE.Points cloud with a radial-gradient glow
// texture and additive blending — a drone show is, from the ground,
// glowing points in a dark sky, and a soft orb per drone is the
// closest simple render of that. Their show lights are off during
// takeoff and landing, so they are shown dim (a stand-in so the
// motion can be followed) unless the "dim" box is unchecked, in which
// case they fly dark, as they really do, and light up when the
// picture forms.
//
// Coordinates: Skybrush is front-left-up (x = front, y = left,
// z = up). Three.js is y-up, so a Skybrush point maps to
// (-y, z, x): the formation is a vertical plane at z = 0, the
// audience stands at +z, and the picture reads left-to-right the
// same way as the 2D canvas.
import * as THREE from './vendor/three/three.module.min.js';

var PREVIEW_KEY = 'wwPreview3D';
// How bright a drone is while its show lights are off (takeoff /
// landing), so the climb can still be followed. 0 = fly dark, as
// the real show does.
var DIM = 0.12;

function loadDesign() {
  var saved = null;
  try {
    var raw = localStorage.getItem(PREVIEW_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { /* corrupt saved data — fall back to the demo */ }
  var GEO = WhenWhereGeometry.create(900, 732, WHENWHERE_CONFIG.PALETTES);
  if (saved && saved.design && Array.isArray(saved.design.points) && saved.design.points.length
      && saved.options && typeof saved.options.spacing === 'number') {
    return {
      design: saved.design,
      options: {
        spacing: saved.options.spacing,
        takeoffSpacing: saved.options.takeoffSpacing,
        altitude: saved.options.altitude,
        holdSeconds: saved.options.holdSeconds,
        separatePoints: GEO.separatePoints,
      },
      fromSaved: true,
    };
  }
  return {
    design: { name: 'Interlocking hearts', points: GEO.heartPair(WHENWHERE_CONFIG.FLEET.heart) },
    options: { spacing: 3, takeoffSpacing: 3, altitude: 40, holdSeconds: 30, separatePoints: GEO.separatePoints },
    fromSaved: false,
  };
}

function fmtTime(s) {
  var m = Math.floor(s / 60);
  var sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// A soft round glow, drawn once on a canvas: white in the centre,
// fading to transparent at the edge. Used as the map for the drone
// points, so each drone reads as a glowing orb.
function makeGlowTexture() {
  var c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  var ctx = c.getContext('2d');
  var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  var tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function main() {
  var loaded = loadDesign();
  var built = WhenWhereSkyc.buildShow(loaded.design, loaded.options);
  var show = built.show;
  var stats = built.stats;
  var total = stats.totalSeconds;
  var holdStart = 30;
  var holdEnd = 30 + loaded.options.holdSeconds;
  var drones = show.swarm.drones;
  var n = drones.length;

  // Per-drone trajectory waypoints and formation colour (sRGB 0-255).
  var trajs = drones.map(function (d) { return d.settings.trajectory.points; });
  var colours = loaded.design.points.map(function (p) {
    return WhenWhereSkyc.hexToRgb((p && p.c) || '#ffffff');
  });

  // The formation's actual bounding box, from the trajectory points
  // at the hold (Skybrush [x, y, z] -> Three.js [-y, z, x]). This is
  // the picture as it flies — NOT the design canvas (stats.width /
  // stats.height), which is the full area the design could occupy.
  // The hearts, for instance, are 70.2m wide on a 205.9m canvas.
  var minBX = Infinity, maxBX = -Infinity, minBY = Infinity, maxBY = -Infinity;
  for (var b = 0; b < n; b++) {
    var fp = trajs[b][1][1]; // Skybrush [x (front), y (left), z (up)] at the hold
    var bx = -fp[1];
    var by = fp[2];
    if (bx < minBX) minBX = bx;
    if (bx > maxBX) maxBX = bx;
    if (by < minBY) minBY = by;
    if (by > maxBY) maxBY = by;
  }
  var bboxW = Math.max(maxBX - minBX, 1);
  var bboxH = Math.max(maxBY - minBY, 1);
  function round1(v) { return Math.round(v * 10) / 10; }

  var titleEl = document.getElementById('previewTitle');
  var statsEl = document.getElementById('previewStats');
  titleEl.textContent = '3D Preview — ' + loaded.design.name;
  statsEl.textContent = stats.drones + ' drones · ' + round1(bboxW) + 'm wide · ' + round1(bboxH) + 'm tall · ' + stats.minHeight + '–' + stats.maxHeight + 'm above ground · ' + fmtTime(total) + ' total'
    + (loaded.fromSaved ? '' : ' · demo formation — open it from the workbench or the studio to preview your design');

  var container = document.getElementById('scene');
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  var loading = document.getElementById('sceneLoading');
  if (loading) loading.remove();

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070f);

  var camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 5000);

  // ---- Night sky: stars on a large sphere, upper hemisphere only. ----
  var starCount = 1200;
  var starPos = new Float32Array(starCount * 3);
  for (var s = 0; s < starCount; s++) {
    var u = Math.random() * Math.PI * 2;
    var v = Math.random() * Math.PI * 0.48; // up to just below the horizon
    var r = 1400 + Math.random() * 400;
    starPos[s * 3] = r * Math.sin(v) * Math.cos(u);
    starPos[s * 3 + 1] = r * Math.cos(v);
    starPos[s * 3 + 2] = r * Math.sin(v) * Math.sin(u);
  }
  var starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  var stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  scene.add(stars);

  // ---- Ground: a dark plane and a faint grid for scale. ----
  var ground = new THREE.Mesh(
    new THREE.CircleGeometry(700, 48),
    new THREE.MeshBasicMaterial({ color: 0x0a0e1a })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  var grid = new THREE.GridHelper(400, 20, 0x2a3558, 0x16203a);
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  // ---- Drones: one Points cloud, positions + colours per frame. ----
  var positions = new Float32Array(n * 3);
  var colors = new Float32Array(n * 3);
  var droneGeo = new THREE.BufferGeometry();
  droneGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  droneGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  var droneMat = new THREE.PointsMaterial({
    size: 4.2,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  var dronePoints = new THREE.Points(droneGeo, droneMat);
  dronePoints.frustumCulled = false;
  scene.add(dronePoints);

  // ---- Camera: orbit around the formation centre. ----
  // The formation is centred on the show altitude, so the target is
  // the middle of the picture, not the ground. The distance fits the
  // formation's actual bounding box (from the trajectory points at
  // the hold), not the design canvas — the hearts span far less than
  // the full canvas, and fitting the canvas leaves them small.
  var target = new THREE.Vector3(0, loaded.options.altitude, 0);
  var halfFovTan = Math.tan((camera.fov * Math.PI / 180) / 2);
  var aspect = container.clientWidth / container.clientHeight;
  var MMARGIN = 10; // how far the dimension lines sit off the picture
  // Fit the formation plus the measurement lines around it (and the
  // ground below, so the takeoff grid is in frame), so the dimensions
  // are visible when the measurements are on. The vertical span runs
  // from the ground to the top dimension line.
  var fitH = (maxBY + MMARGIN) - 0;
  var fitW = bboxW + 2 * MMARGIN;
  var fitRadius = Math.max(fitH / (2 * halfFovTan), fitW / (2 * halfFovTan * aspect)) * 1.15;

  // ---- Measurements: dashed dimension lines + labels. ----
  // Width across the top, height down the left, the centre altitude
  // from the ground, and the takeoff grid's footprint on the ground
  // — so the show's size on the ground (where it starts) and in the
  // sky (where it grows to) can both be read off the picture. Each
  // line is a colour of its own, and the labels are HTML (crisp
  // text) projected from the same anchors every frame.
  var measureGroup = new THREE.Group();
  scene.add(measureGroup);
  function dashedLine(points, color) {
    var g = new THREE.BufferGeometry().setFromPoints(points);
    var m = new THREE.LineDashedMaterial({ color: color, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.9 });
    var l = new THREE.Line(g, m);
    l.computeLineDistances();
    return l;
  }
  function tick(cx, cy, cz, horizontal, color) {
    var h = 2.5;
    var pts = horizontal
      ? [new THREE.Vector3(cx - h, cy, cz), new THREE.Vector3(cx + h, cy, cz)]
      : [new THREE.Vector3(cx, cy - h, cz), new THREE.Vector3(cx, cy + h, cz)];
    return dashedLine(pts, color);
  }
  var centreY = (minBY + maxBY) / 2;
  var altTop = loaded.options.altitude;
  // Width: across the top of the picture, gold.
  var widthY = maxBY + MMARGIN;
  measureGroup.add(dashedLine([new THREE.Vector3(minBX, widthY, 0), new THREE.Vector3(maxBX, widthY, 0)], 0xffc94d));
  measureGroup.add(tick(minBX, widthY, 0, false, 0xffc94d));
  measureGroup.add(tick(maxBX, widthY, 0, false, 0xffc94d));
  // Height: down the left side, cyan.
  var heightX = minBX - MMARGIN;
  measureGroup.add(dashedLine([new THREE.Vector3(heightX, minBY, 0), new THREE.Vector3(heightX, maxBY, 0)], 0x8fd8ff));
  measureGroup.add(tick(heightX, minBY, 0, true, 0x8fd8ff));
  measureGroup.add(tick(heightX, maxBY, 0, true, 0x8fd8ff));
  // Centre altitude: ground to the picture's centre, green, at the right.
  var altX = maxBX + MMARGIN;
  measureGroup.add(dashedLine([new THREE.Vector3(altX, 0, 0), new THREE.Vector3(altX, altTop, 0)], 0x7dffcb));
  measureGroup.add(tick(altX, 0, 0, true, 0x7dffcb));
  measureGroup.add(tick(altX, altTop, 0, true, 0x7dffcb));
  // Takeoff grid: the footprint on the ground, white/grey.
  var gw = (stats.gridWidth || 0) / 2, gd = (stats.gridDepth || 0) / 2;
  var gy = 0.15; // just above the ground, so it is not z-fighting
  if (gw > 0 && gd > 0) {
    measureGroup.add(dashedLine([
      new THREE.Vector3(-gw, gy, -gd), new THREE.Vector3(gw, gy, -gd),
      new THREE.Vector3(gw, gy, gd), new THREE.Vector3(-gw, gy, gd),
      new THREE.Vector3(-gw, gy, -gd),
    ], 0xd5d9ea));
  }
  var measureLabelsEl = document.getElementById('measureLabels');
  function makeLabel(cls, text) {
    var d = document.createElement('div');
    d.className = 'measure-label ' + cls;
    d.textContent = text;
    measureLabelsEl.appendChild(d);
    return d;
  }
  var measureLabels = [
    { el: makeLabel('gold', round1(bboxW) + ' m wide'), anchor: new THREE.Vector3((minBX + maxBX) / 2, widthY, 0) },
    { el: makeLabel('cyan', round1(bboxH) + ' m tall'), anchor: new THREE.Vector3(heightX, centreY, 0) },
    { el: makeLabel('green', altTop + ' m centre · ' + round1(minBY) + '–' + round1(maxBY) + ' m above ground'), anchor: new THREE.Vector3(altX, altTop / 2, 0) },
  ];
  if (gw > 0 && gd > 0) {
    measureLabels.push({ el: makeLabel('grey', 'Takeoff grid ' + stats.gridWidth + ' m × ' + stats.gridDepth + ' m'), anchor: new THREE.Vector3(0, gy, -gd) });
  }
  var measureOn = true;
  function setMeasurements(on) {
    measureOn = on;
    measureGroup.visible = on;
    measureLabelsEl.style.display = on ? '' : 'none';
  }
  function updateMeasureLabels() {
    if (!measureOn) return;
    var w = container.clientWidth, h = container.clientHeight;
    var v = new THREE.Vector3();
    measureLabels.forEach(function (item) {
      v.copy(item.anchor).project(camera);
      var visible = v.z < 1; // in front of the camera
      item.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
      item.el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px';
      item.el.style.display = visible ? '' : 'none';
    });
  }
  var orbit = { theta: 0, phi: 1.55, radius: fitRadius };
  var goal = null;
  function applyOrbit() {
    var sp = Math.sin(orbit.phi);
    camera.position.set(
      target.x + orbit.radius * sp * Math.sin(orbit.theta),
      target.y + orbit.radius * Math.cos(orbit.phi),
      target.z + orbit.radius * sp * Math.cos(orbit.theta)
    );
    // Never let the camera sink under the ground: at a low angle and
    // a long radius the orbit math would put it below y = 0, so
    // clamp it to eye height and let it look up at the picture.
    if (camera.position.y < 2) camera.position.y = 2;
    camera.lookAt(target);
  }
  function setView(name) {
    if (name === 'top') goal = { theta: 0, phi: 0.18, radius: fitRadius * 1.25 };
    else if (name === 'side') goal = { theta: Math.PI / 2, phi: 1.55, radius: fitRadius };
    else goal = { theta: 0, phi: 1.55, radius: fitRadius };
    document.querySelectorAll('.views button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === name ? 'true' : 'false');
    });
  }
  document.querySelectorAll('.views button').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });

  // ---- Manual view control: pan, zoom, reset. ----
  // How many metres one screen pixel is at the target's distance,
  // so a drag or a button press moves the picture by the same amount
  // on screen whatever the zoom.
  function metersPerPixel() {
    return (2 * orbit.radius * Math.tan((camera.fov * Math.PI / 180) / 2)) / container.clientHeight;
  }
  // Move the picture on screen by (dx, dy) pixels: positive dx moves
  // it right, positive dy moves it down — the drag convention, so
  // the content follows the pointer (and the on-screen arrows and
  // the arrow keys move it the way they point).
  function panBy(dxPx, dyPx) {
    var mpp = metersPerPixel();
    var forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    var worldUp = new THREE.Vector3(0, 1, 0);
    var right = new THREE.Vector3().crossVectors(forward, worldUp);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    var up = new THREE.Vector3().crossVectors(right, forward).normalize();
    target.addScaledVector(right, -dxPx * mpp);
    target.addScaledVector(up, dyPx * mpp);
  }
  function zoomBy(factor) {
    orbit.radius = Math.max(25, Math.min(900, orbit.radius * factor));
  }
  // Back to the audience view, centred on the picture.
  function resetView() {
    target.set(0, loaded.options.altitude, 0);
    goal = { theta: 0, phi: 1.55, radius: fitRadius };
    document.querySelectorAll('.views button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === 'audience' ? 'true' : 'false');
    });
  }

  // Drag to orbit, wheel to zoom, two-finger pinch to zoom.
  // Right-drag (or Shift-drag) moves the view instead of orbiting.
  var canvas = renderer.domElement;
  var pointers = new Map();
  var lastPinch = 0;
  var dragMode = 'orbit';
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    goal = null;
    dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      lastPinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    var prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      if (dragMode === 'pan') {
        panBy(e.clientX - prev.x, e.clientY - prev.y);
      } else {
        orbit.theta -= (e.clientX - prev.x) * 0.005;
        orbit.phi = Math.max(0.08, Math.min(1.85, orbit.phi - (e.clientY - prev.y) * 0.005));
      }
    } else if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinch > 0 && d > 0) orbit.radius = Math.max(25, Math.min(900, orbit.radius * (lastPinch / d)));
      lastPinch = d;
    }
  });
  function endPointer(e) { pointers.delete(e.pointerId); lastPinch = 0; dragMode = 'orbit'; }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  // No context menu on right-drag: the right button pans instead.
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    goal = null;
    orbit.radius = Math.max(25, Math.min(900, orbit.radius * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  // On-screen controls (the pad at the bottom right of the sky).
  // A press moves one step at once, so a tap moves a visible amount;
  // holding keeps moving (the flags are read every frame). Without
  // the step, a tap only applied a few frames of the per-second rate
  // and looked like nothing happened.
  //
  // The arrows move the CAMERA, so the picture shifts the opposite
  // way — up raises the camera, so the picture moves down; right
  // moves the camera right, so the picture moves left. That is the
  // way a camera (and a map) behaves, and the way the arrows read.
  var held = { zoomIn: false, zoomOut: false, up: false, down: false, left: false, right: false };
  function stepHeld(key) {
    if (key === 'zoomIn') zoomBy(0.85);
    else if (key === 'zoomOut') zoomBy(1.18);
    else {
      var step = container.clientHeight * 0.08; // 8% of the view
      if (key === 'up') panBy(0, step);
      else if (key === 'down') panBy(0, -step);
      else if (key === 'left') panBy(step, 0);
      else if (key === 'right') panBy(-step, 0);
    }
  }
  function bindHold(el, key) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); held[key] = true; stepHeld(key); });
  }
  bindHold(document.getElementById('zoomInBtn'), 'zoomIn');
  bindHold(document.getElementById('zoomOutBtn'), 'zoomOut');
  document.querySelectorAll('[data-pan]').forEach(function (b) {
    bindHold(b, b.getAttribute('data-pan'));
  });
  // Any release anywhere stops every held button (so a drag off a
  // button cannot leave the view drifting).
  window.addEventListener('pointerup', function () { for (var k in held) held[k] = false; });
  window.addEventListener('pointercancel', function () { for (var k in held) held[k] = false; });
  document.getElementById('resetViewBtn').addEventListener('click', resetView);

  // Keyboard: arrows move the view, + / - zoom, 0 resets, Space
  // plays/pauses. Ignored while typing in a field (so the arrows
  // still scrub the timeline when it has focus), and Space is
  // ignored on a button (so it does not both click it and pause).
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    var step = container.clientHeight * 0.08; // 8% of the view per press
    var handled = true;
    if (e.key === 'ArrowUp') panBy(0, step);
    else if (e.key === 'ArrowDown') panBy(0, -step);
    else if (e.key === 'ArrowLeft') panBy(step, 0);
    else if (e.key === 'ArrowRight') panBy(-step, 0);
    else if (e.key === '+' || e.key === '=') zoomBy(0.85);
    else if (e.key === '-' || e.key === '_') zoomBy(1.18);
    else if (e.key === '0') resetView();
    else if (e.key === ' ' && tag !== 'BUTTON') setPlaying(!playing);
    else handled = false;
    if (handled) e.preventDefault();
  });

  // ---- Timeline: play / pause / scrub, looping. ----
  var timeRange = document.getElementById('timeRange');
  var timeLabel = document.getElementById('timeLabel');
  var playBtn = document.getElementById('playBtn');
  var dimToggle = document.getElementById('dimToggle');
  var measureToggle = document.getElementById('measureToggle');
  measureToggle.addEventListener('change', function () { setMeasurements(measureToggle.checked); });
  setMeasurements(measureToggle.checked);
  var t = 0;
  var playing = true;
  var scrubbing = false;
  timeRange.max = String(total);
  timeRange.value = '0';
  function setPlaying(p) {
    playing = p;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  }
  playBtn.addEventListener('click', function () { setPlaying(!playing); });
  timeRange.addEventListener('input', function () { t = Number(timeRange.value); updateTimeLabel(); });
  timeRange.addEventListener('pointerdown', function () { scrubbing = true; });
  window.addEventListener('pointerup', function () { scrubbing = false; });
  function updateTimeLabel() {
    timeLabel.textContent = fmtTime(t) + ' / ' + fmtTime(total);
  }

  // Skybrush [x (front), y (left), z (up)] -> Three.js (-y, z, x).
  function sampleDrone(i, time) {
    var p = WhenWhereSkyc.sampleTrajectory(trajs[i], time);
    return [-p[1], p[2], p[0]];
  }
  function updateDrones(time) {
    var dim = dimToggle.checked ? DIM : 0;
    var inHold = time >= holdStart && time < holdEnd;
    for (var i = 0; i < n; i++) {
      var p = sampleDrone(i, time);
      positions[i * 3] = p[0];
      positions[i * 3 + 1] = p[1];
      positions[i * 3 + 2] = p[2];
      var c = colours[i];
      if (inHold) {
        colors[i * 3] = c[0] / 255;
        colors[i * 3 + 1] = c[1] / 255;
        colors[i * 3 + 2] = c[2] / 255;
      } else {
        colors[i * 3] = dim;
        colors[i * 3 + 1] = dim * 0.92;
        colors[i * 3 + 2] = dim * 0.85;
      }
    }
    droneGeo.attributes.position.needsUpdate = true;
    droneGeo.attributes.color.needsUpdate = true;
  }

  function resize() {
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  var last = performance.now();
  function frame(now) {
    var dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
    last = now;
    if (playing && !scrubbing) {
      t += dt;
      if (t >= total) t = 0;
      timeRange.value = String(t);
      updateTimeLabel();
    }
    // Held on-screen buttons: zoom and pan keep moving while held.
    if (held.zoomIn) zoomBy(Math.exp(-0.5 * dt));
    if (held.zoomOut) zoomBy(Math.exp(0.5 * dt));
    var panRate = container.clientHeight * 0.4; // px per second
    if (held.up) panBy(0, panRate * dt);
    if (held.down) panBy(0, -panRate * dt);
    if (held.left) panBy(panRate * dt, 0);
    if (held.right) panBy(-panRate * dt, 0);
    if (goal) {
      orbit.theta += (goal.theta - orbit.theta) * 0.12;
      orbit.phi += (goal.phi - orbit.phi) * 0.12;
      orbit.radius += (goal.radius - orbit.radius) * 0.12;
      if (Math.abs(goal.theta - orbit.theta) < 0.001 && Math.abs(goal.phi - orbit.phi) < 0.001 && Math.abs(goal.radius - orbit.radius) < 0.5) goal = null;
    }
    updateDrones(t);
    applyOrbit();
    updateMeasureLabels();
    renderer.render(scene, camera);
  }
  updateTimeLabel();
  applyOrbit();
  renderer.setAnimationLoop(frame);

  // Exposed for tests: the show, the current time, and the camera.
  window.WHENWHERE = window.WHENWHERE || {};
  window.WHENWHERE.preview3d = {
    get time() { return t; },
    get playing() { return playing; },
    get drones() { return n; },
    get totalSeconds() { return total; },
    get target() { return [target.x, target.y, target.z]; },
    get radius() { return orbit.radius; },
    get measurements() { return measureOn; },
    get measureLabels() { return measureLabels.map(function (item) { return item.el.textContent; }); },
    setTime: function (v) { t = v; timeRange.value = String(v); updateTimeLabel(); },
    setPlaying: setPlaying,
    sampleDrone: sampleDrone,
    panBy: panBy,
    zoomBy: zoomBy,
    resetView: resetView,
    setMeasurements: setMeasurements,
  };
}

main();
