// @ts-check
// Skybrush export for the Formation Workbench.
//
// Builds a .skyc file (Skybrush Compiled Format) for the formation
// currently on the workbench canvas: a takeoff from a ground grid, the
// held shape, and a landing back to the grid.
//
// What the format is (read from Skybrush's own docs and code, 2026-11-27):
// - A .skyc file is a ZIP archive containing a single `show.json` at its
//   root. (Proved by the fixture in skybrush-io/skybrush.js,
//   packages/show-format/test/fixtures/test-show.skyc, and by that
//   package's loader, which opens the file with JSZip and dereferences
//   `zip:show.json`.)
// - `show.json` has `version` (integer, must be 1 — the validator in
//   skybrush.js packages/show-format/src/validation.ts rejects anything
//   else), `environment` ({ type: "outdoor" }), and `swarm.drones[]`.
//   Each drone needs `settings.trajectory` ({ version: 1, points }) and
//   may carry `settings.lights` ({ version: 1, data: base64 ledctrl
//   bytecode }) and `settings.home`.
// - A trajectory point is [time, [x, y, z], controlPoints] — time in
//   seconds relative to takeoffTime, coordinates in meters, controlPoints
//   the intermediate Bezier points (empty for straight lines and for the
//   first keypoint). Coordinates are flat-Earth, right-handed, x-y-z =
//   front-left-up, in meters
//   (docs.skybrush.io/public/skybrush-file-formats/skyc/coordinates.html).
// - Light programs are ledctrl bytecode: SET_COLOR is opcode 0x04
//   (R, G, B, then a wait in frames as a varuint, 50 frames/second),
//   END is 0x00 (current colour held indefinitely). Colours are LINEAR
//   RGB, not sRGB, one byte per channel
//   (docs.skybrush.io/public/skybrush-file-formats/skyb/light_program_block.html).
//   The varuint is unsigned LEB128: 7 bits per byte, LSB first, MSB set
//   when another byte follows (the .skyb overview's example: 513 =
//   0x81 0x04).
// - Show segment ids are lowercase: 'takeoff' | 'show' | 'landing'
//   (skybrush.js packages/show-format/src/types.ts, ShowSegmentId).
//   `meta.segments` maps each to [start, end) in seconds.
//
// Why there is a takeoff and a landing (not just the held shape):
// - Skybrush Live 2.9.0+ validates a show on load: it measures the
//   minimum distance between the FIRST points of the trajectories
//   ("takeoff positions") and between the LAST points ("landing
//   positions"), and errors when any pair is too close. The check is
//   on the trajectory's first/last points, not on `home`, and it
//   measures separation in the ground plane — a vertical-plane
//   formation collapses to a line there (the hearts' closest 2D pair
//   is 0.016m, 34 pairs under the 0.4m outdoor threshold), so a
//   hold-only trajectory can never pass it. The trajectory therefore
//   starts and ends on a ground takeoff grid, and `home` is the
//   drone's grid slot. The real Studio fixture shows the same shape:
//   home on the ground (z=0), first trajectory point just above home.
// - The takeoff and landing here are straight lines (30s each) from
//   the grid to the formation and back. That is a minimal, flyable
//   show, not a layered takeoff: run Skybrush Live's show adaptation
//   for the layered takeoff on a real flight. The drones are dark
//   during takeoff and landing and lit only for the held shape.
//
// The mapping is canvas 2D -> a vertical plane in the sky: the canvas
// is viewed from the front, so canvas x (left->right) maps to Skybrush
// -y (the audience's right is -y, since +y is left), canvas y
// (top->bottom) maps to Skybrush -z (up is +z), and the formation sits
// at x = 0. Centred on the show altitude:
//   skyX = 0
//   skyY = (W/2 - px) * scale
//   skyZ = altitude + (H/2 - py) * scale
// The plane faces the audience, who stand at -x looking towards +x.
//
// The scale (meters per canvas pixel) is derived from the drone spacing,
// not set directly: scale = spacing / medianNN, where medianNN is the
// median nearest-neighbour distance between the formation's points in
// canvas pixels. The median (not the minimum) is the robust choice — the
// shapes have near-duplicates (the rings have two drones at the exact
// same point, min 0px; the finale has a pair 1px apart), so a
// minimum-derived scale would be infinite or absurd. The duplicates are
// fixed instead: the points are run through geometry's separatePoints
// with a minimum gap of medianNN/2 before mapping, so no two drones in
// the export are closer than half the nominal spacing. The resulting
// show width (W * scale) and the actual minimum spacing are reported
// back, so the user can see how big the picture is and how close the
// closest pair ends up.
//
// The takeoff grid has its own spacing, independent of the formation
// spacing, so the ground crew can keep the takeoff zone tight without
// shrinking the picture in the air. It is safely spaced in 2D by
// construction — the grid spacing is the minimum ground-plane
// separation, and the UI floors it at 0.5m, clear of Live's 0.4m
// outdoor threshold. The grid is centred under the formation at
// (0, 0, 0). Each formation drone is paired to a grid slot
// by sorting both by y (then by the other axis) and pairing in order,
// so nearby formation drones take off from nearby grid slots and the
// straight-line takeoff paths cross as little as possible.
//
// This module is pure (no DOM, no window) except for the ZIP writer,
// which only needs Uint8Array. It is loaded as a classic script after
// geometry.js; the caller passes geometry's separatePoints in.
/** @type {import('../types').WhenWhereSkycModule} */
var WhenWhereSkyc = (function () {
  'use strict';

  /** Canvas width/height the formations are drawn in (from workbench.js). */
  var CANVAS_W = 900;
  var CANVAS_H = 732;

  /**
   * Takeoff and landing durations, in seconds. Straight lines from the
   * ground grid to the formation and back; 30s is comfortable for the
   * ~40m climb at the default altitude and still sane at 100m. These
   * are fixed (not a UI setting) — Skybrush Live's show adaptation is
   * the place to refine them into a layered takeoff for a real flight.
   */
  var TAKEOFF_SECONDS = 30;
  var LANDING_SECONDS = 30;

  /**
   * One sRGB channel (0-255) -> linear-light 0-255, rounded. The .skyc
   * light programs store colours in linear RGB, while the palette hex
   * values are sRGB (CSS colours), so this conversion is what makes the
   * exported colours match the workbench.
   * @param {number} v - sRGB channel, 0-255.
   * @returns {number} linear channel, 0-255.
   */
  function srgbToLinearByte(v) {
    var s = v / 255;
    var lin = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    return Math.max(0, Math.min(255, Math.round(lin * 255)));
  }

  /**
   * '#rrggbb' -> [r, g, b] (0-255, sRGB).
   * @param {string} hex
   * @returns {number[]}
   */
  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  /**
   * Unsigned LEB128 varuint: 7 bits per byte, least significant group
   * first, the high bit set on every byte except the last.
   * @param {number} n - non-negative integer.
   * @returns {number[]} the encoded bytes.
   */
  function encodeVaruint(n) {
    var out = [];
    do {
      var b = n & 0x7f;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);
    return out;
  }

  /**
   * A constant-colour light program: SET_COLOR (0x04) with the colour in
   * linear RGB, waiting the hold time in frames (50 fps), then END
   * (0x00), which holds the colour indefinitely.
   * @param {number[]} rgb - [r, g, b] in sRGB 0-255.
   * @param {number} holdSeconds
   * @returns {Uint8Array}
   */
  function encodeLightProgram(rgb, holdSeconds) {
    return encodeLightProgramSegments([{ rgb: rgb, seconds: holdSeconds }]);
  }

  /**
   * A light program of several colour segments in sequence: one
   * SET_COLOR (0x04, linear RGB) + wait per segment, then END (0x00).
   * Used for the takeoff/hold/landing shape: dark during takeoff and
   * landing, the formation colour only while the shape is held.
   * @param {{ rgb: number[], seconds: number }[]} segments - each
   *   segment's sRGB colour and how long it is held, in seconds.
   * @returns {Uint8Array}
   */
  function encodeLightProgramSegments(segments) {
    var bytes = [];
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      var frames = Math.max(1, Math.round(seg.seconds * 50));
      bytes.push(0x04);
      bytes.push(srgbToLinearByte(seg.rgb[0]));
      bytes.push(srgbToLinearByte(seg.rgb[1]));
      bytes.push(srgbToLinearByte(seg.rgb[2]));
      var wait = encodeVaruint(frames);
      for (var i = 0; i < wait.length; i++) bytes.push(wait[i]);
    }
    bytes.push(0x00);
    return new Uint8Array(bytes);
  }

  /**
   * A regular takeoff grid on the ground (z=0), centred at (0, 0),
   * `spacing` apart — so the grid is safely spaced in 2D by
   * construction (Skybrush Live checks the first/last trajectory
   * points' ground-plane separation against a 0.4m outdoor threshold;
   * the UI floors the spacing at 0.5m). Near-square:
   * cols = ceil(sqrt(n)), rows = ceil(n/cols).
   * @param {number} count - number of grid slots.
   * @param {number} spacing - grid spacing in meters.
   * @returns {number[][]} [x, y, 0] slots, row-major (y, then x).
   */
  function takeoffGrid(count, spacing) {
    var cols = Math.ceil(Math.sqrt(count));
    var rows = Math.ceil(count / cols);
    var slots = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (slots.length >= count) break;
        slots.push([
          round3((c - (cols - 1) / 2) * spacing),
          round3((r - (rows - 1) / 2) * spacing),
          0,
        ]);
      }
    }
    return slots;
  }

  /**
   * Base64-encode a byte array (the .skyc lights.data field).
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  function base64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // CRC-32 (IEEE, the one ZIP uses), table-driven. The table is built
  // once on first use.
  var crcTable = null;
  /**
   * @param {Uint8Array} bytes
   * @returns {number} unsigned 32-bit CRC.
   */
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * A minimal ZIP writer: stored entries only (no compression). A .skyc
   * is a ZIP, and the browser has no built-in ZIP writer, so this is
   * the smallest correct one — local file header + data per file, then
   * the central directory, then the end-of-central-directory record.
   * Verified against Python's zipfile (see tests/skyc.mjs).
   * @param {{ name: string, data: Uint8Array }[]} files
   * @returns {Uint8Array<ArrayBuffer>} the whole archive.
   */
  function buildZip(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
    function u32(v) {
      return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
    }
    for (var f = 0; f < files.length; f++) {
      var file = files[f];
      var nameBytes = new TextEncoder().encode(file.name);
      var crc = crc32(file.data);
      var header = [0x50, 0x4b, 0x03, 0x04]
        .concat(u16(20)) // version needed to extract
        .concat(u16(0x0800)) // flags: UTF-8 filenames
        .concat(u16(0)) // method: stored
        .concat(u16(0), u16(0x21)) // time, date (1980-01-01)
        .concat(u32(crc))
        .concat(u32(file.data.length), u32(file.data.length))
        .concat(u16(nameBytes.length), u16(0));
      parts.push(new Uint8Array(header));
      parts.push(nameBytes);
      parts.push(file.data);
      var dir = [0x50, 0x4b, 0x01, 0x02]
        .concat(u16(20), u16(20)) // version made by, version needed
        .concat(u16(0x0800), u16(0))
        .concat(u16(0), u16(0x21))
        .concat(u32(crc))
        .concat(u32(file.data.length), u32(file.data.length))
        .concat(u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0))
        .concat(u32(0)) // external attributes
        .concat(u32(offset));
      central.push(new Uint8Array(dir));
      central.push(nameBytes);
      offset += header.length + nameBytes.length + file.data.length;
    }
    var centralOffset = offset;
    var centralSize = 0;
    for (var c = 0; c < central.length; c++) centralSize += central[c].length;
    var end = [0x50, 0x4b, 0x05, 0x06]
      .concat(u16(0), u16(0))
      .concat(u16(files.length), u16(files.length))
      .concat(u32(centralSize), u32(centralOffset), u16(0));
    var all = parts.concat(central, [new Uint8Array(end)]);
    var total = 0;
    for (var a = 0; a < all.length; a++) total += all[a].length;
    var out = new Uint8Array(total);
    var at = 0;
    for (var b = 0; b < all.length; b++) {
      out.set(all[b], at);
      at += all[b].length;
    }
    return out;
  }

  /**
   * Nearest-neighbour distances of a point set, in canvas pixels.
   * @param {{ x: number, y: number }[]} pts
   * @returns {{ min: number, median: number }} min and median NN distance.
   */
  function nearestNeighbourStats(pts) {
    var ds = [];
    for (var i = 0; i < pts.length; i++) {
      var best = Infinity;
      for (var j = 0; j < pts.length; j++) {
        if (i === j) continue;
        var dx = pts[i].x - pts[j].x;
        var dy = pts[i].y - pts[j].y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) best = d;
      }
      ds.push(best);
    }
    ds.sort(function (a, b) { return a - b; });
    return { min: ds[0], median: ds[Math.floor(ds.length / 2)] };
  }

  /**
   * Round to 3 decimals (millimetre precision in meters) — keeps the
   * file small and readable without losing anything a drone can use.
   * @param {number} v
   * @returns {number}
   */
  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  /**
   * The altitude ceiling in force, in metres: the rules file's
   * effective ceiling when rules.js loaded, else the FAA Part 107
   * ceiling (120m). The typeof guard keeps this working when the
   * exporter is used standalone (tests, Readability Lab) without
   * rules.js on the page.
   */
  function rulesMaxAltitude() {
    if (typeof window !== 'undefined' && window.WHENWHERE_RULES_EFFECTIVE) {
      return window.WHENWHERE_RULES_EFFECTIVE.maxAltitudeMeters;
    }
    return 120;
  }

  /**
   * Round to 1 decimal — for the human-facing heights and grid
   * footprint, where 0.1m is plenty (and it matches what Skybrush
   * Live shows for max AHL).
   * @param {number} v
   * @returns {number}
   */
  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * Build the show.json for one formation: a takeoff from a ground grid,
   * the held shape, and a landing back to the grid.
   *
   * @param {{ name: string, points: { x: number, y: number, c?: string }[] }} design
   *   The formation: its name and its canvas points (c = the drone's
   *   hex colour, as drawn; defaults to white when absent).
   * @param {{ spacing: number, takeoffSpacing?: number, altitude: number, holdSeconds: number,
   *   title?: string, separatePoints: (pts: { x: number, y: number, c?: string }[], minDist: number) => { x: number, y: number, c?: string }[] }} options
   *   spacing = the nominal drone spacing in meters (the median
   *   nearest-neighbour distance maps to this); takeoffSpacing = the
   *   ground grid spacing in meters, independent of the formation
   *   spacing (falls back to spacing when absent); altitude = the show
   *   altitude in meters (the formation is centred on it); holdSeconds
   *   = how long the shape is held; separatePoints = geometry's
   *   min-gap enforcement, used to push near-duplicate points apart.
   * @returns {{ show: object, stats: { scale: number, width: number, height: number, minSpacing: number, medianSpacing: number, drones: number, totalSeconds: number, gridCols: number, gridRows: number, minHeight: number, maxHeight: number, gridSpacing: number, gridWidth: number, gridDepth: number } }}
   */
  function buildShow(design, options) {
    var pts = design.points.map(function (p) {
      return { x: p.x, y: p.y, c: p.c || '#ffffff' };
    });
    var stats = nearestNeighbourStats(pts);
    var scale = options.spacing / stats.median;
    // Enforce a minimum gap of half the nominal spacing, in canvas px,
    // so near-duplicates (the rings' 0px pair, the finale's 1px pair)
    // cannot ship as two drones at one point. separatePoints mutates
    // its input, so it runs on the copy above, never the live formation.
    var minGapPx = stats.median / 2;
    options.separatePoints(pts, minGapPx);
    var after = nearestNeighbourStats(pts);
    var W = CANVAS_W;
    var H = CANVAS_H;
    // Formation positions in the sky (the vertical plane).
    var formation = pts.map(function (p) {
      return [
        0,
        round3((W / 2 - p.x) * scale),
        round3(options.altitude + (H / 2 - p.y) * scale),
      ];
    });
    // The actual lowest and highest drone heights (above home level),
    // from the mapped formation — what Skybrush Live reports as the
    // height range, not the design canvas height.
    var heights = formation.map(function (p) { return p[2]; });
    var minHeight = round1(Math.min.apply(null, heights));
    var maxHeight = round1(Math.max.apply(null, heights));
    // Takeoff grid on the ground, its own spacing (independent of the
    // formation). Falls back to the formation spacing when the caller
    // does not pass one.
    var takeoffSpacing = options.takeoffSpacing == null ? options.spacing : options.takeoffSpacing;
    var grid = takeoffGrid(pts.length, takeoffSpacing);
    var gridCols = Math.ceil(Math.sqrt(pts.length));
    var gridRows = Math.ceil(pts.length / gridCols);
    var gridWidth = round1((gridCols - 1) * takeoffSpacing);
    var gridDepth = round1((gridRows - 1) * takeoffSpacing);
    // Pair each formation drone to a grid slot: sort both by y, then
    // by the other axis, and pair in order, so nearby formation drones
    // take off from nearby grid slots and the straight-line takeoff
    // paths cross as little as possible. `slotOf[i]` is the grid slot
    // for formation drone i.
    var formOrder = formation.map(function (_p, i) { return i; }).sort(function (a, b) {
      return (formation[a][1] - formation[b][1]) || (formation[a][2] - formation[b][2]);
    });
    var gridOrder = grid.map(function (_s, i) { return i; }).sort(function (a, b) {
      return (grid[a][1] - grid[b][1]) || (grid[a][0] - grid[b][0]);
    });
    var slotOf = [];
    for (var k = 0; k < formOrder.length; k++) slotOf[formOrder[k]] = grid[gridOrder[k]];
    var takeoff = TAKEOFF_SECONDS;
    var land = LANDING_SECONDS;
    var total = takeoff + options.holdSeconds + land;
    var drones = pts.map(function (p, i) {
      var pos = formation[i];
      var slot = slotOf[i];
      var rgb = hexToRgb(p.c);
      // Dark during takeoff and landing, the formation colour only
      // while the shape is held.
      var lights = encodeLightProgramSegments([
        { rgb: [0, 0, 0], seconds: takeoff },
        { rgb: rgb, seconds: options.holdSeconds },
        { rgb: [0, 0, 0], seconds: land },
      ]);
      var name = 'drone-' + String(i + 1).padStart(String(pts.length).length, '0');
      return {
        settings: {
          name: name,
          trajectory: {
            version: 1,
            takeoffTime: 0,
            landingTime: total,
            points: [
              [0, slot, []],
              [takeoff, pos, []],
              [takeoff + options.holdSeconds, pos, []],
              [total, slot, []],
            ],
          },
          lights: { version: 1, data: base64(lights) },
          home: slot,
        },
      };
    });
    var show = {
      version: 1,
      environment: { type: 'outdoor' },
      meta: {
        title: options.title || ('When&Where — ' + design.name),
        segments: {
          takeoff: [0, takeoff],
          show: [takeoff, takeoff + options.holdSeconds],
          landing: [takeoff + options.holdSeconds, total],
        },
      },
      settings: {
        validation: {
          minDistance: round3((stats.median / 2) * scale),
          // Altitude ceiling in force (rules.js: FAA Part 107, or a
          // venue override). No drone may fly above this.
          maxAltitude: rulesMaxAltitude(),
          // Below the lowest formation drone the drones are on the
          // ground grid or climbing straight up — do not check
          // proximity there, or the tight ground grid would read as
          // a violation of minDistance.
          minNavAltitude: minHeight,
        },
      },
      swarm: { drones: drones },
    };
    return {
      show: show,
      stats: {
        scale: round3(scale),
        width: round3(W * scale),
        height: round3(H * scale),
        minSpacing: round3(after.min * scale),
        medianSpacing: round3(after.median * scale),
        drones: pts.length,
        totalSeconds: total,
        gridCols: gridCols,
        gridRows: gridRows,
        minHeight: minHeight,
        maxHeight: maxHeight,
        gridSpacing: takeoffSpacing,
        gridWidth: gridWidth,
        gridDepth: gridDepth,
      },
    };
  }

  /**
   * Build the .skyc file (a ZIP holding show.json) for one formation:
   * takeoff from a ground grid, the held shape, and a landing back to
   * the grid, ready to download.
   * @param {{ name: string, points: { x: number, y: number, c?: string }[] }} design
   * @param {{ spacing: number, takeoffSpacing?: number, altitude: number, holdSeconds: number,
   *   title?: string, separatePoints: (pts: { x: number, y: number, c?: string }[], minDist: number) => { x: number, y: number, c?: string }[] }} options
   * @returns {{ bytes: Uint8Array<ArrayBuffer>, filename: string, stats: { scale: number, width: number, height: number, minSpacing: number, medianSpacing: number, drones: number, totalSeconds: number, gridCols: number, gridRows: number, minHeight: number, maxHeight: number, gridSpacing: number, gridWidth: number, gridDepth: number } }}
   */
  function exportSkyc(design, options) {
    var built = buildShow(design, options);
    var json = JSON.stringify(built.show, null, 2);
    var bytes = buildZip([
      { name: 'show.json', data: new TextEncoder().encode(json) },
    ]);
    var slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { bytes: bytes, filename: 'whenwhere-' + slug + '.skyc', stats: built.stats };
  }

  /**
   * Build the per-drone CSV exchange files for one formation, zipped:
   * one CSV per drone, Time_msec,x_m,y_m,z_m,R,G,B, sampled every
   * second from takeoff to landing. The trajectory is piecewise
   * linear, so a 1s sample captures it exactly, and the light program
   * only changes at whole-second segment boundaries. Colours are the
   * sRGB values as drawn (black during takeoff/landing, the formation
   * colour while held) — the linear-RGB conversion is only for the
   * .skyc ledctrl bytecode, not for exchange files.
   * @param {{ name: string, points: { x: number, y: number, c?: string }[] }} design
   * @param {{ spacing: number, takeoffSpacing?: number, altitude: number, holdSeconds: number,
   *   title?: string, separatePoints: (pts: { x: number, y: number, c?: string }[], minDist: number) => { x: number, y: number, c?: string }[] }} options
   * @returns {{ bytes: Uint8Array<ArrayBuffer>, filename: string, stats: { scale: number, width: number, height: number, minSpacing: number, medianSpacing: number, drones: number, totalSeconds: number, gridCols: number, gridRows: number, minHeight: number, maxHeight: number, gridSpacing: number, gridWidth: number, gridDepth: number } }}
   */
  function exportCsv(design, options) {
    var built = buildShow(design, options);
    var total = built.stats.totalSeconds;
    var holdStart = TAKEOFF_SECONDS;
    var holdEnd = TAKEOFF_SECONDS + options.holdSeconds;
    var files = built.show.swarm.drones.map(function (drone, i) {
      var traj = drone.settings.trajectory.points;
      var rgb = hexToRgb((design.points[i] && design.points[i].c) || '#ffffff');
      var lines = ['Time_msec,x_m,y_m,z_m,R,G,B'];
      for (var t = 0; t <= total; t++) {
        var pos = sampleTrajectory(traj, t);
        var color = (t >= holdStart && t < holdEnd) ? rgb : [0, 0, 0];
        lines.push((t * 1000) + ',' + round3(pos[0]) + ',' + round3(pos[1]) + ',' + round3(pos[2]) + ',' + color[0] + ',' + color[1] + ',' + color[2]);
      }
      return { name: drone.settings.name + '.csv', data: new TextEncoder().encode(lines.join('\n') + '\n') };
    });
    var bytes = buildZip(files);
    var slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { bytes: bytes, filename: 'whenwhere-' + slug + '-csv.zip', stats: built.stats };
  }

  /**
   * Linearly interpolate a trajectory's waypoints ([time, [x, y, z],
   * controlPoints]) at time t (seconds). The show's trajectories are
   * straight lines between waypoints, so this is exact.
   * @param {[number, number[], number[]][]} points - the trajectory points.
   * @param {number} t - time in seconds.
   * @returns {number[]} the [x, y, z] position at t.
   */
  function sampleTrajectory(points, t) {
    for (var k = 0; k < points.length - 1; k++) {
      var t0 = points[k][0];
      var t1 = points[k + 1][0];
      if (t <= t1) {
        var a = points[k][1];
        var b = points[k + 1][1];
        var f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    return points[points.length - 1][1];
  }

  /**
   * Build the Google Earth (.kmz) file for one formation: a ZIP holding
   * doc.kml, one LineString Placemark per drone (takeoff slot, up to
   * the formation, back to the slot), anchored to the venue's GPS
   * position. Altitudes are relativeToGround, so no home elevation is
   * needed. The local frame is Skybrush's front-left-up, and the
   * orientation is the X axis (front) vs North, clockwise positive —
   * the same convention as the .skyc. A flat-Earth conversion is used
   * (111,320 m per degree of latitude); for a show the size of a field
   * the error is centimetres.
   * @param {{ name: string, points: { x: number, y: number, c?: string }[] }} design
   * @param {{ spacing: number, takeoffSpacing?: number, altitude: number, holdSeconds: number,
   *   title?: string, separatePoints: (pts: { x: number, y: number, c?: string }[], minDist: number) => { x: number, y: number, c?: string }[] }} options
   * @param {{ latitude: number, longitude: number, orientationDegrees?: number }} venue
   *   The venue's home position (decimal degrees) and the show's
   *   orientation (degrees, X axis vs North, clockwise; 0 = front
   *   faces North).
   * @returns {{ bytes: Uint8Array<ArrayBuffer>, filename: string, stats: { scale: number, width: number, height: number, minSpacing: number, medianSpacing: number, drones: number, totalSeconds: number, gridCols: number, gridRows: number, minHeight: number, maxHeight: number, gridSpacing: number, gridWidth: number, gridDepth: number } }}
   */
  function exportKmz(design, options, venue) {
    var lat0 = venue && venue.latitude;
    var lon0 = venue && venue.longitude;
    if (typeof lat0 !== 'number' || !isFinite(lat0) || lat0 < -90 || lat0 > 90) {
      throw new Error('exportKmz: venue.latitude must be a number between -90 and 90');
    }
    if (typeof lon0 !== 'number' || !isFinite(lon0) || lon0 < -180 || lon0 > 180) {
      throw new Error('exportKmz: venue.longitude must be a number between -180 and 180');
    }
    var theta = (((venue.orientationDegrees || 0)) * Math.PI) / 180;
    var built = buildShow(design, options);
    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    lines.push('  <Document>');
    lines.push('    <name>' + xmlEscape('When&Where — ' + design.name) + '</name>');
    lines.push('    <description>' + xmlEscape('Drone light show flight paths — ' + built.stats.drones + ' drones, ' + built.stats.totalSeconds + 's total. Altitudes are metres above ground.') + '</description>');
    built.show.swarm.drones.forEach(function (drone, i) {
      var rgb = hexToRgb((design.points[i] && design.points[i].c) || '#ffffff');
      var name = drone.settings.name;
      lines.push('    <Style id="' + name + '"><LineStyle><color>' + hexToKmlColor(rgb) + '</color><width>2</width></LineStyle></Style>');
    });
    built.show.swarm.drones.forEach(function (drone) {
      var traj = drone.settings.trajectory.points;
      var coords = [];
      var last = null;
      traj.forEach(function (pt) {
        var p = pt[1];
        if (last && last[0] === p[0] && last[1] === p[1] && last[2] === p[2]) return;
        last = p;
        var ll = localToLonLat(p, lat0, lon0, theta);
        coords.push(ll[0].toFixed(6) + ',' + ll[1].toFixed(6) + ',' + ll[2].toFixed(3));
      });
      lines.push('    <Placemark>');
      lines.push('      <name>' + xmlEscape(drone.settings.name) + '</name>');
      lines.push('      <styleUrl>#' + drone.settings.name + '</styleUrl>');
      lines.push('      <LineString>');
      lines.push('        <altitudeMode>relativeToGround</altitudeMode>');
      lines.push('        <coordinates>' + coords.join(' ') + '</coordinates>');
      lines.push('      </LineString>');
      lines.push('    </Placemark>');
    });
    lines.push('  </Document>');
    lines.push('</kml>');
    var bytes = buildZip([
      { name: 'doc.kml', data: new TextEncoder().encode(lines.join('\n') + '\n') },
    ]);
    var slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { bytes: bytes, filename: 'whenwhere-' + slug + '.kmz', stats: built.stats };
  }

  /**
   * Convert a local Skybrush point [x (front), y (left), z (up)] in
   * metres to [longitude, latitude, altitude], given the venue's home
   * position and the show's orientation (X axis vs North, clockwise).
   * @param {number[]} p - the local [x, y, z] in metres.
   * @param {number} lat0 - home latitude, decimal degrees.
   * @param {number} lon0 - home longitude, decimal degrees.
   * @param {number} theta - orientation in radians.
   * @returns {number[]} [longitude, latitude, altitude].
   */
  function localToLonLat(p, lat0, lon0, theta) {
    var east = p[0] * Math.sin(theta) - p[1] * Math.cos(theta);
    var north = p[0] * Math.cos(theta) + p[1] * Math.sin(theta);
    var lat = lat0 + north / 111320;
    var lon = lon0 + east / (111320 * Math.cos((lat0 * Math.PI) / 180));
    return [lon, lat, p[2]];
  }

  /**
   * A hex colour (#RRGGBB, sRGB) as a KML colour (AABBGGRR, opaque).
   * @param {number[]} rgb - the [R, G, B] 0-255 values.
   * @returns {string} the KML colour string.
   */
  function hexToKmlColor(rgb) {
    function h(v) { return ('0' + v.toString(16)).slice(-2); }
    return 'ff' + h(rgb[2]) + h(rgb[1]) + h(rgb[0]);
  }

  /**
   * Escape text for an XML element.
   * @param {string} s - the text.
   * @returns {string} the escaped text.
   */
  function xmlEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    srgbToLinearByte: srgbToLinearByte,
    hexToRgb: hexToRgb,
    encodeVaruint: encodeVaruint,
    encodeLightProgram: encodeLightProgram,
    encodeLightProgramSegments: encodeLightProgramSegments,
    takeoffGrid: takeoffGrid,
    base64: base64,
    crc32: crc32,
    buildZip: buildZip,
    nearestNeighbourStats: nearestNeighbourStats,
    buildShow: buildShow,
    exportSkyc: exportSkyc,
    sampleTrajectory: sampleTrajectory,
    exportCsv: exportCsv,
    exportKmz: exportKmz,
    localToLonLat: localToLonLat,
  };
})();
