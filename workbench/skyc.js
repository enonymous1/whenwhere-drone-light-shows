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
          // FAA Part 107 ceiling (US): no drone may fly above 120m AGL.
          maxAltitude: 120,
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
  };
})();
