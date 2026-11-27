// @ts-check
// Skybrush export for the Formation Workbench.
//
// Builds a .skyc file (Skybrush Compiled Format) for the formation
// currently on the workbench canvas: one static held shape.
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
//
// What this export is — and is not:
// - It exports the formation as the net show content: every drone holds
//   its formation position (a vertical plane facing the audience) for
//   the hold time. Two keypoints per drone, same position, t=0 and
//   t=holdSeconds, so the shape is held for the whole show.
// - It has NO takeoff, NO return-to-home, NO landing. A complete flyable
//   show needs those phases, which Skybrush Live's show adaptation adds
//   around the net show, or which the sequencer (Phase 3 part 2) will
//   generate. The `meta.segments` field says so: only the "Show" segment
//   is annotated, [0, holdSeconds].
// - The mapping is canvas 2D -> a vertical plane in the sky: the canvas
//   is viewed from the front, so canvas x (left->right) maps to Skybrush
//   -y (the audience's right is -y, since +y is left), canvas y
//   (top->bottom) maps to Skybrush -z (up is +z), and the formation sits
//   at x = 0. Centred on the show altitude:
//     skyX = 0
//     skyY = (W/2 - px) * scale
//     skyZ = altitude + (H/2 - py) * scale
//   The plane faces the audience, who stand at -x looking towards +x.
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
    var frames = Math.max(1, Math.round(holdSeconds * 50));
    var bytes = [0x04];
    bytes.push(srgbToLinearByte(rgb[0]));
    bytes.push(srgbToLinearByte(rgb[1]));
    bytes.push(srgbToLinearByte(rgb[2]));
    var wait = encodeVaruint(frames);
    for (var i = 0; i < wait.length; i++) bytes.push(wait[i]);
    bytes.push(0x00);
    return new Uint8Array(bytes);
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
   * Build the show.json for one held formation.
   *
   * @param {{ name: string, points: { x: number, y: number, c?: string }[] }} design
   *   The formation: its name and its canvas points (c = the drone's
   *   hex colour, as drawn; defaults to white when absent).
   * @param {{ spacing: number, altitude: number, holdSeconds: number,
   *   title?: string, separatePoints: (pts: { x: number, y: number, c?: string }[], minDist: number) => { x: number, y: number, c?: string }[] }} options
   *   spacing = the nominal drone spacing in meters (the median
   *   nearest-neighbour distance maps to this); altitude = the show
   *   altitude in meters (the formation is centred on it); holdSeconds =
   *   how long the shape is held; separatePoints = geometry's
   *   min-gap enforcement, used to push near-duplicate points apart.
   * @returns {{ show: object, stats: { scale: number, width: number, height: number, minSpacing: number, medianSpacing: number, drones: number } }}
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
    var drones = pts.map(function (p, i) {
      var skyY = round3((W / 2 - p.x) * scale);
      var skyZ = round3(options.altitude + (H / 2 - p.y) * scale);
      var pos = [0, skyY, skyZ];
      var rgb = hexToRgb(p.c);
      var lights = encodeLightProgram(rgb, options.holdSeconds);
      var name = 'drone-' + String(i + 1).padStart(String(pts.length).length, '0');
      return {
        settings: {
          name: name,
          trajectory: {
            version: 1,
            takeoffTime: 0,
            points: [
              [0, pos, []],
              [options.holdSeconds, pos, []],
            ],
          },
          lights: { version: 1, data: base64(lights) },
          home: pos,
        },
      };
    });
    var show = {
      version: 1,
      environment: { type: 'outdoor' },
      meta: {
        title: options.title || ('When&Where — ' + design.name + ' (static)'),
        segments: { Show: [0, options.holdSeconds] },
      },
      settings: {
        validation: { minDistance: round3((stats.median / 2) * scale) },
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
      },
    };
  }

  /**
   * Build the .skyc file (a ZIP holding show.json) for one held
   * formation, ready to download.
   * @param {{ name: string, points: { x: number, y: number, c?: string }[] }} design
   * @param {{ spacing: number, altitude: number, holdSeconds: number,
   *   title?: string, separatePoints: (pts: { x: number, y: number, c?: string }[], minDist: number) => { x: number, y: number, c?: string }[] }} options
   * @returns {{ bytes: Uint8Array<ArrayBuffer>, filename: string, stats: { scale: number, width: number, height: number, minSpacing: number, medianSpacing: number, drones: number } }}
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
    base64: base64,
    crc32: crc32,
    buildZip: buildZip,
    nearestNeighbourStats: nearestNeighbourStats,
    buildShow: buildShow,
    exportSkyc: exportSkyc,
  };
})();
