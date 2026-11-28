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

  var titleEl = document.getElementById('previewTitle');
  var statsEl = document.getElementById('previewStats');
  titleEl.textContent = '3D Preview — ' + loaded.design.name;
  statsEl.textContent = stats.drones + ' drones · ' + stats.width + 'm wide · ' + stats.minHeight + '–' + stats.maxHeight + 'm above ground · ' + fmtTime(total) + ' total'
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
  var halfFovTan = Math.tan((camera.fov * Math.PI / 180) / 2);
  var aspect = container.clientWidth / container.clientHeight;
  var fitRadius = Math.max(bboxH / (2 * halfFovTan), bboxW / (2 * halfFovTan * aspect)) * 1.2;
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

  // Drag to orbit, wheel to zoom, two-finger pinch to zoom.
  var canvas = renderer.domElement;
  var pointers = new Map();
  var lastPinch = 0;
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    goal = null;
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
      orbit.theta -= (e.clientX - prev.x) * 0.005;
      // The low end (1.85) is below the picture's centre, so the view
      // can be dragged down to the ground — the camera is clamped to
      // eye height in applyOrbit, so it looks up instead of sinking.
      orbit.phi = Math.max(0.08, Math.min(1.85, orbit.phi - (e.clientY - prev.y) * 0.005));
    } else if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinch > 0 && d > 0) orbit.radius = Math.max(25, Math.min(900, orbit.radius * (lastPinch / d)));
      lastPinch = d;
    }
  });
  function endPointer(e) { pointers.delete(e.pointerId); lastPinch = 0; }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    goal = null;
    orbit.radius = Math.max(25, Math.min(900, orbit.radius * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  // ---- Timeline: play / pause / scrub, looping. ----
  var timeRange = document.getElementById('timeRange');
  var timeLabel = document.getElementById('timeLabel');
  var playBtn = document.getElementById('playBtn');
  var dimToggle = document.getElementById('dimToggle');
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
    if (goal) {
      orbit.theta += (goal.theta - orbit.theta) * 0.12;
      orbit.phi += (goal.phi - orbit.phi) * 0.12;
      orbit.radius += (goal.radius - orbit.radius) * 0.12;
      if (Math.abs(goal.theta - orbit.theta) < 0.001 && Math.abs(goal.phi - orbit.phi) < 0.001 && Math.abs(goal.radius - orbit.radius) < 0.5) goal = null;
    }
    updateDrones(t);
    applyOrbit();
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
    setTime: function (v) { t = v; timeRange.value = String(v); updateTimeLabel(); },
    setPlaying: setPlaying,
    sampleDrone: sampleDrone,
  };
}

main();
