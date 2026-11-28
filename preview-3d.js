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
//
// The drone count slider (shown when the loaded design is one of the
// five built-in shapes) rebuilds the show at that count, live: the
// formation is regenerated from its shape function, the takeoff grid,
// measurements, safety buffer and camera fit all follow, and a
// warning appears when the bottom drones drop below ground — the
// count at which a shape stops fitting is exactly what the slider
// is for. Words have no slider: a word's count comes from its text.
import * as THREE from './vendor/three/three.module.min.js';

var PREVIEW_KEY = 'wwPreview3D';
// How bright a drone is while its show lights are off (takeoff /
// landing), so the climb can still be followed. 0 = fly dark, as
// the real show does.
var DIM = 0.12;
// The count slider's bounds: below the smallest fleet design (60
// drones) and above the old 240-drone finale, so a shape can be seen
// both sparse and blown up. Every fleet count is a multiple of 10.
var COUNT_MIN = 40;
var COUNT_MAX = 240;
var COUNT_STEP = 10;
// The shapes the count slider can rebuild, by their saved key.
var SHAPE_KEYS = ['heart', 'rings', 'glass', 'star', 'finale'];

function loadDesign(GEO) {
  var saved = null;
  try {
    var raw = localStorage.getItem(PREVIEW_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { /* corrupt saved data — fall back to the demo */ }
  if (saved && saved.design && Array.isArray(saved.design.points) && saved.design.points.length
      && saved.options && typeof saved.options.spacing === 'number') {
    // The shape key, when the sender knew it — the count slider needs
    // it to rebuild the formation. Words and old saves have none.
    var shape = (saved.design.shape && SHAPE_KEYS.indexOf(saved.design.shape) !== -1)
      ? saved.design.shape : null;
    return {
      design: saved.design,
      options: {
        spacing: saved.options.spacing,
        takeoffSpacing: saved.options.takeoffSpacing,
        altitude: saved.options.altitude,
        holdSeconds: saved.options.holdSeconds,
        separatePoints: GEO.separatePoints,
      },
      shape: shape,
      fromSaved: true,
    };
  }
  return {
    design: { name: 'Interlocking hearts', points: GEO.heartPair(WHENWHERE_CONFIG.FLEET.heart) },
    options: { spacing: 3, takeoffSpacing: 3, altitude: 40, holdSeconds: 30, separatePoints: GEO.separatePoints },
    shape: 'heart',
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
  var GEO = WhenWhereGeometry.create(900, 732, WHENWHERE_CONFIG.PALETTES);
  var loaded = loadDesign(GEO);
  var SHAPE_FNS = {
    heart: GEO.heartPair, rings: GEO.ringsPts, glass: GEO.glassPts,
    star: GEO.starPts, finale: GEO.finalePts,
  };
  var shape = loaded.shape;
  function round1(v) { return Math.round(v * 10) / 10; }

  // ---- Show state: rebuilt by buildShowState whenever the count changes. ----
  var show, stats, total, holdStart, holdEnd, drones, n;
  var trajs, colours;
  var minBX, maxBX, minBY, maxBY, bboxW, bboxH;
  var bufferRadius, fitRadius;
  var positions, colors, droneGeo;
  var measureLabels = [];
  var currentDesign = loaded.design;

  var titleEl = document.getElementById('previewTitle');
  var statsEl = document.getElementById('previewStats');
  titleEl.textContent = '3D Preview — ' + loaded.design.name;

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
  var halfFovTan = Math.tan((camera.fov * Math.PI / 180) / 2);
  var aspect = container.clientWidth / container.clientHeight;

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
  // The geometry is swapped by buildShowState whenever the count
  // changes (a different count means different-sized arrays); the
  // Points object itself stays in the scene.
  var droneMat = new THREE.PointsMaterial({
    size: 4.2,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  var dronePoints = new THREE.Points(new THREE.BufferGeometry(), droneMat);
  dronePoints.frustumCulled = false;
  scene.add(dronePoints);

  // ---- Measurements: dashed dimension lines + labels. ----
  // Width across the top, height down the left, the centre altitude
  // from the ground, and the takeoff grid's footprint on the ground
  // — so the show's size on the ground (where it starts) and in the
  // sky (where it grows to) can both be read off the picture. Each
  // line is a colour of its own, and the labels are HTML (crisp
  // text) projected from the same anchors every frame.
  var MMARGIN = 10; // how far the dimension lines sit off the picture
  var SIGHT_LEN = 300, SIGHT_STEP = 50;
  var BUFFER_SEG = 96;
  // Safety-buffer rate: the formation's half-width plus the
  // altitude-scaled buffer — FAA waiver structures widen the
  // restricted / free-fall area by at least 10 m for every 100 ft
  // of show altitude. The rules file owns the rate; fall back to
  // 10/30.48 if it didn't load.
  var bufferRate = (typeof WHENWHERE_RULES_EFFECTIVE !== 'undefined' && WHENWHERE_RULES_EFFECTIVE.bufferMetersPerAltitudeMeters) || (10 / 30.48);
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
  function clearGroup(group) {
    for (var i = group.children.length - 1; i >= 0; i--) {
      var child = group.children[i];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }
  var measureLabelsEl = document.getElementById('measureLabels');
  function makeLabel(cls, text) {
    var d = document.createElement('div');
    d.className = 'measure-label ' + cls;
    d.textContent = text;
    measureLabelsEl.appendChild(d);
    return d;
  }
  // The camera's distance label: it follows the white stem below the
  // camera, and its text is the camera's ground distance from the
  // takeoff grid's centre, updated every frame. Created once — the
  // measurement labels are rebuilt on every count change, this one
  // is not.
  var camLabelEl = makeLabel('white', '');
  function clearLabels() {
    var kids = measureLabelsEl.children;
    for (var i = kids.length - 1; i >= 0; i--) {
      if (kids[i] !== camLabelEl) measureLabelsEl.removeChild(kids[i]);
    }
    measureLabels = [];
  }
  // Camera marker: a white stem on the ground directly below the
  // camera, so where the viewer is standing can be read off the
  // sightline. Its label (updated every frame) gives the camera's
  // distance from the takeoff grid.
  var camMarker = new THREE.Group();
  camMarker.add(dashedLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 8, 0)], 0xffffff));
  var camDot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  camDot.position.set(0, 8, 0);
  camMarker.add(camDot);
  scene.add(camMarker);
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
  function updateCamMarker() {
    var cx = camera.position.x, cz = camera.position.z;
    camMarker.position.set(cx, 0, cz);
    camMarker.visible = measureOn;
    var dist = Math.round(Math.hypot(cx, cz));
    camLabelEl.textContent = 'Camera · ' + dist + ' m from the takeoff grid';
    var w = container.clientWidth, h = container.clientHeight;
    var v = new THREE.Vector3(cx, 9, cz).project(camera);
    camLabelEl.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
    camLabelEl.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px';
    camLabelEl.style.display = (measureOn && v.z < 1) ? '' : 'none';
  }

  // ---- Camera: orbit around the formation centre. ----
  // The formation is centred on the show altitude, so the target is
  // the middle of the picture, not the ground.
  var target = new THREE.Vector3(0, loaded.options.altitude, 0);
  var orbit = { theta: 0, phi: 1.55, radius: 100 };
  var goal = null;

  // ---- Count slider: the palette the regenerated points cycle. ----
  // The workbench colours each dot when the formation is set (the
  // palette in force, override included), so the saved points carry
  // the colours. Fresh points from a shape function carry none
  // (except heartPair, which colours its own), so the slider
  // re-applies the loaded design's colours in first-appearance
  // order — the palette, as saved. Fixed at load, so it cannot drift
  // as the count is dragged back and forth.
  var countPalette = null;
  if (shape && shape !== 'heart') {
    countPalette = [];
    loaded.design.points.forEach(function (p) {
      var c = (p && p.c) || '#ffffff';
      if (countPalette.indexOf(c) === -1) countPalette.push(c);
    });
    if (!countPalette.length) countPalette = ['#ffffff'];
  }
  function colourPoints(pts) {
    if (!countPalette) return; // hearts colour themselves
    pts.forEach(function (p, i) { p.c = countPalette[i % countPalette.length]; });
  }
  var countRow = document.getElementById('countRow');
  var countRange = document.getElementById('countRange');
  var countValue = document.getElementById('countValue');
  var countWarning = document.getElementById('countWarning');
  function updateCountWarning() {
    if (stats && stats.minHeight < 0) {
      countWarning.textContent = '⚠ The bottom drones sit below ground at this count — lower the count, or raise the centre altitude back in the workbench.';
      countWarning.hidden = false;
    } else {
      countWarning.hidden = true;
    }
  }

  // ---- buildShowState: (re)build everything the show defines. ----
  // Called once at load and again whenever the count slider changes.
  // The show is built with the same WhenWhereSkyc.buildShow the .skyc
  // export uses, so the 3D picture is the same show that flies. The
  // timeline's time and playing state are untouched — only the show
  // changes, so the flight keeps its place.
  function buildShowState(design) {
    currentDesign = design;
    var built = WhenWhereSkyc.buildShow(design, loaded.options);
    show = built.show;
    stats = built.stats;
    total = stats.totalSeconds;
    holdStart = 30;
    holdEnd = 30 + loaded.options.holdSeconds;
    drones = show.swarm.drones;
    n = drones.length;

    // Per-drone trajectory waypoints and formation colour (sRGB 0-255).
    trajs = drones.map(function (d) { return d.settings.trajectory.points; });
    colours = design.points.map(function (p) {
      return WhenWhereSkyc.hexToRgb((p && p.c) || '#ffffff');
    });

    // The formation's actual bounding box, from the trajectory points
    // at the hold (Skybrush [x, y, z] -> Three.js [-y, z, x]). This is
    // the picture as it flies — NOT the design canvas (stats.width /
    // stats.height), which is the full area the design could occupy.
    // The hearts, for instance, are 70.2m wide on a 205.9m canvas.
    minBX = Infinity; maxBX = -Infinity; minBY = Infinity; maxBY = -Infinity;
    for (var b = 0; b < n; b++) {
      var fp = trajs[b][1][1]; // Skybrush [x (front), y (left), z (up)] at the hold
      var bx = -fp[1];
      var by = fp[2];
      if (bx < minBX) minBX = bx;
      if (bx > maxBX) maxBX = bx;
      if (by < minBY) minBY = by;
      if (by > maxBY) maxBY = by;
    }
    bboxW = Math.max(maxBX - minBX, 1);
    bboxH = Math.max(maxBY - minBY, 1);

    statsEl.textContent = stats.drones + ' drones · ' + round1(bboxW) + 'm wide · ' + round1(bboxH) + 'm tall · ' + stats.minHeight + '–' + stats.maxHeight + 'm above ground · ' + fmtTime(total) + ' total'
      + (loaded.fromSaved ? '' : ' · demo formation — open it from the workbench or the studio to preview your design');

    // Fresh drone arrays for this count, on a new geometry.
    positions = new Float32Array(n * 3);
    colors = new Float32Array(n * 3);
    var newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    newGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (droneGeo) droneGeo.dispose();
    droneGeo = newGeo;
    dronePoints.geometry = droneGeo;

    // Fit the formation plus the measurement lines around it (and the
    // ground below, so the takeoff grid is in frame), so the dimensions
    // are visible when the measurements are on. The vertical span runs
    // from the ground to the top dimension line; the width also covers
    // the buffer circle.
    var altTop = loaded.options.altitude;
    bufferRadius = bboxW / 2 + stats.maxHeight * bufferRate;
    var fitH = (maxBY + MMARGIN) - 0;
    var fitW = Math.max(bboxW + 2 * MMARGIN, 2 * bufferRadius);
    fitRadius = Math.max(fitH / (2 * halfFovTan), fitW / (2 * halfFovTan * aspect)) * 1.15;

    // Measurements, rebuilt for this count: width across the top of
    // the picture (gold), height down the left (cyan), the centre
    // altitude from the ground (green), the takeoff grid's footprint
    // on the ground (white/grey), the sightline out towards the
    // audience with a mark every 50 m (orange), and the safety-buffer
    // circle — the clear ground around the show (red).
    clearGroup(measureGroup);
    var centreY = (minBY + maxBY) / 2;
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
    // Sightline: a straight line out from the takeoff grid towards the
    // audience (and past them), so the viewing distance can be read
    // off. Orange, dashed, with a tick and a label every 50 m,
    // measured from the takeoff grid's centre. The audience stands at
    // +z, so the line runs that way.
    var sightColor = 0xff9f43;
    if (gw > 0 && gd > 0) {
      measureGroup.add(dashedLine([new THREE.Vector3(0, gy, gd), new THREE.Vector3(0, gy, SIGHT_LEN)], sightColor));
      for (var sd = SIGHT_STEP; sd <= SIGHT_LEN; sd += SIGHT_STEP) {
        measureGroup.add(tick(0, gy, sd, true, sightColor));
      }
    }
    // Safety buffer: the clear ground around the show that must stay
    // free of uninvolved people and obstacles. A red dashed circle on
    // the ground, centred on the takeoff grid — the formation's
    // half-width plus the altitude-scaled buffer (see bufferRadius).
    // It runs through the sightline, so the viewing distance and the
    // keep-clear zone can be read together.
    var bufferPts = [];
    for (var bi = 0; bi <= BUFFER_SEG; bi++) {
      var ba = (bi / BUFFER_SEG) * Math.PI * 2;
      bufferPts.push(new THREE.Vector3(Math.cos(ba) * bufferRadius, gy, Math.sin(ba) * bufferRadius));
    }
    measureGroup.add(dashedLine(bufferPts, 0xff5a5a));

    // Labels, rebuilt for this count (the camera label is not one of
    // these — it is created once and survives the rebuild).
    clearLabels();
    measureLabels = [
      { el: makeLabel('gold', round1(bboxW) + ' m wide'), anchor: new THREE.Vector3((minBX + maxBX) / 2, widthY, 0) },
      { el: makeLabel('cyan', round1(bboxH) + ' m tall'), anchor: new THREE.Vector3(heightX, centreY, 0) },
      { el: makeLabel('green', altTop + ' m centre · ' + round1(minBY) + '–' + round1(maxBY) + ' m above ground'), anchor: new THREE.Vector3(altX, altTop / 2, 0) },
    ];
    if (gw > 0 && gd > 0) {
      measureLabels.push({ el: makeLabel('grey', 'Takeoff grid ' + stats.gridWidth + ' m × ' + stats.gridDepth + ' m'), anchor: new THREE.Vector3(0, gy, -gd) });
      for (var sd2 = SIGHT_STEP; sd2 <= SIGHT_LEN; sd2 += SIGHT_STEP) {
        measureLabels.push({ el: makeLabel('orange', sd2 + ' m'), anchor: new THREE.Vector3(0, gy, sd2) });
      }
    }
    measureLabels.push({ el: makeLabel('red', 'Safety buffer — keep clear · ' + Math.round(bufferRadius) + ' m radius'), anchor: new THREE.Vector3(-bufferRadius, gy, 0) });

    // Re-fit the camera on the new show, centred on the picture: a
    // count change is a new show, so the view starts from the
    // audience fit again (any pan or zoom is reset with it).
    target.set(0, loaded.options.altitude, 0);
    orbit.radius = fitRadius;
    goal = null;
    updateCountWarning();
  }

  // First build: the show as loaded (or the hearts demo).
  buildShowState(loaded.design);

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
    updateCamMarker();
    renderer.render(scene, camera);
  }
  updateTimeLabel();
  applyOrbit();
  renderer.setAnimationLoop(frame);

  // ---- Drone count slider: rebuild the show at a new count. ----
  // Only for the five built-in shapes — words have no shape key, so
  // the row stays hidden for them (and for old saves). The readout
  // updates at once while dragging; the rebuild is debounced so the
  // drag stays smooth. The timeline keeps its time and playing state.
  function setCount(count) {
    if (!shape || !SHAPE_FNS[shape]) return;
    count = Math.max(COUNT_MIN, Math.min(COUNT_MAX, count));
    count = Math.round(count / COUNT_STEP) * COUNT_STEP;
    countRange.value = String(count);
    countValue.textContent = String(count);
    var pts = SHAPE_FNS[shape](count);
    colourPoints(pts);
    buildShowState({ name: loaded.design.name, points: pts });
  }
  if (shape && SHAPE_FNS[shape]) {
    countRow.hidden = false;
    countRange.value = String(stats.drones);
    countValue.textContent = String(stats.drones);
    var rebuildTimer = null;
    countRange.addEventListener('input', function () {
      var count = Number(countRange.value);
      countValue.textContent = String(count);
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(function () { setCount(count); }, 150);
    });
  }

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
    get cameraDistance() { return Math.round(Math.hypot(camera.position.x, camera.position.z)); },
    get cameraLabel() { return camLabelEl.textContent; },
    get bufferRadius() { return Math.round(bufferRadius); },
    get shape() { return shape; },
    get countWarning() { return countWarning.hidden ? '' : countWarning.textContent; },
    setTime: function (v) { t = v; timeRange.value = String(v); updateTimeLabel(); },
    setPlaying: setPlaying,
    setCount: setCount,
    sampleDrone: sampleDrone,
    panBy: panBy,
    zoomBy: zoomBy,
    resetView: resetView,
    setMeasurements: setMeasurements,
  };
}

main();
