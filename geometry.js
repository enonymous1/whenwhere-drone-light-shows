// @ts-check
/* WhenWhere drone light shows — formation geometry.
   The pure geometry behind the Formation Studio: the shapes, the word
   renderer, and the helpers, bound to a canvas of W x H by the
   createGeometry factory. No DOM reads except the offscreen canvases
   glyphSkeleton/wordPoints use to rasterise text. The drone page and
   the workbench both load this file; neither duplicates the math.
   Loaded before studio.js (see index.html); studio.js calls
   WhenWhereGeometry.create(W, H) once and aliases the functions it
   uses. The geometry tests and the Readability Lab read the bound
   instance back through window.WHENWHERE.geometry / .tuning. */

/** @typedef {import('./types').Point} Point */
/** @typedef {import('./types').Tuning} Tuning */
/** @typedef {import('./types').WordItem} WordItem */
/** @typedef {import('./types').Glyph} Glyph */
/** @typedef {import('./types').Drone} Drone */
/** @typedef {import('./types').Star} Star */
/** @typedef {import('./types').Inquiry} Inquiry */
/** @typedef {import('./types').ContentItem} ContentItem */
/** @typedef {import('./types').WhenWhereGeometry} WhenWhereGeometry */
/** @typedef {import('./types').WhenWhereGeometrySet} WhenWhereGeometrySet */
/** @typedef {import('./types').WhenWhereNS} WhenWhereNS */

/**
 * Creates the geometry bound to a canvas of W x H. The formation
 * functions place drones relative to W/H (hearts at W*.42, the finale
 * at W/2, H/2, words fit to W-40), so a different canvas size gets a
 * different instance — the drone page passes 900x732, the workbench
 * passes its own canvas. heartPair colours each point from the
 * palettes (left heart from palettes.heart, right from palettes.rings),
 * so the palettes travel in too. The returned object is the full set
 * the page needs: the formation functions for its SHAPES registry, the
 * word renderer, the pure helpers the tests exercise, and TUNING.
 * @param {number} W - canvas width in px.
 * @param {number} H - canvas height in px.
 * @param {WhenWhereConfig['PALETTES']} palettes - colours per formation (from config.js).
 * @returns {WhenWhereGeometrySet} the formation functions + tuning.
 */
var WhenWhereGeometry = (function () {
  function createGeometry(W, H, palettes) {
    /* ---- Even drone placement (2026-11-12): the old raster + stride
       thinning picked dots in row-major order, so one side of a shape
       could end up denser than the other and dots wobbled off the
       outline. Outline shapes are now placed evenly along their true
       contour by arc length; words are drawn one character at a time
       as single-line skeletons - each glyph is rastered, thinned to
       its stroke centerline, and the drones sit on that line one
       wide, so identical glyphs get identical dots. Hearts interlock
       on a diagonal with
       a deep overlap: every crossing along one heart's outline is
       found and the under-heart alternates at each crossing, and the
       gaps are real - resampleRuns() never interpolates dots across
       a break. */
    /**
     * One cubic Bezier segment, sampled at n points.
     * @param {Point} p0 - start point.
     * @param {Point} p1 - first control point.
     * @param {Point} p2 - second control point.
     * @param {Point} p3 - end point.
     * @param {number} n - how many points to return.
     * @returns {Point[]} n points along the curve.
     */
    function cubic(p0, p1, p2, p3, n) {
      var pts = [];
      for (var i = 0; i <= n; i++) {
        var t = i / n, u = 1 - t;
        pts.push({ x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
                   y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y });
      }
      return pts;
    }
    /** Resample a contour to exactly n points, evenly spaced by arc length.
        @param {Point[]} pts - points along the contour.
        @param {number} n - how many points to return.
        @returns {Point[]} n points, or [] when the contour has no length or n <= 0. */
    function resample(pts, n) {
      var L = [0];
      for (var i = 1; i < pts.length; i++) L.push(L[i-1] + Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y));
      var total = L[L.length-1];
      if (!total || n <= 0) return [];
      var out = [], j = 0;
      for (var k = 0; k < n; k++) {
        var d = total * k / n;
        while (j < L.length-2 && L[j+1] < d) j++;
        var seg = (L[j+1]-L[j]) || 1, f = (d-L[j])/seg;
        out.push({ x: pts[j].x + (pts[j+1].x-pts[j].x)*f, y: pts[j].y + (pts[j+1].y-pts[j].y)*f });
      }
      return out;
    }
    /**
     * Points around a circle (squashed vertically when squash < 1).
     * @param {number} cx - centre x.
     * @param {number} cy - centre y.
     * @param {number} r - radius.
     * @param {number} n - how many points to return.
     * @param {number} [squash] - vertical squash factor (1 = a true circle).
     * @returns {Point[]} n points around the circle, starting at the top.
     */
    function circlePts(cx, cy, r, n, squash) {
      var pts = [];
      for (var i = 0; i < n; i++) { var a = i/n*Math.PI*2 - Math.PI/2; pts.push({ x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r*(squash||1) }); }
      return pts;
    }
    /**
     * A dense heart outline (the raw contour heartPair thins down).
     * @param {number} cx - centre x.
     * @param {number} cy - centre y.
     * @param {number} s - size (half-width).
     * @returns {Point[]} the heart contour, densely sampled.
     */
    function heartDense(cx, cy, s) {
      var tip = { x: cx, y: cy + s * .85 };
      var dense = cubic(tip, {x:cx-s*1.5,y:cy-s*.1}, {x:cx-s*.75,y:cy-s*1.15}, {x:cx,y:cy-s*.35}, 48);
      dense = dense.concat(cubic({x:cx,y:cy-s*.35}, {x:cx+s*.75,y:cy-s*1.15}, {x:cx+s*1.5,y:cy-s*.1}, tip, 48).slice(1));
      return dense;
    }
    /**
     * Length of one run (polyline) in px.
     * @param {Point[]} r - the run.
     * @returns {number} the arc length.
     */
    function runLen(r) { var L = 0; for (var i = 1; i < r.length; i++) L += Math.hypot(r[i].x-r[i-1].x, r[i].y-r[i-1].y); return L; }
    /** Resample without interpolating across a break: split the contour into runs, share dots by run length.
        @param {Point[]} pts - contour points; a jump over 25px between consecutive points starts a new run.
        @param {number} n - total points wanted across all runs.
        @returns {Point[]} n points, none interpolated across a break; falls back to resample() when there are no runs. */
    function resampleRuns(pts, n) {
      var runs = [[]];
      for (var i = 0; i < pts.length; i++) {
        if (i && Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y) > 25) runs.push([]);
        runs[runs.length-1].push(pts[i]);
      }
      runs = runs.filter(function (r) { return r.length > 1; });
      if (!runs.length) return resample(pts, n);
      var lens = runs.map(runLen), total = lens.reduce(function (a, b) { return a+b; }, 0);
      if (!total) return resample(pts, n);
      var shares = lens.map(function (L) { return Math.max(1, Math.floor(n*L/total)); });
      var sum = shares.reduce(function (a, b) { return a+b; }, 0);
      var order = lens.map(function (L, i) { return i; }).sort(function (a, b) { return lens[b]-lens[a]; });
      var k = 0, guard = 0;
      while (sum < n && guard++ < 100) { shares[order[k % order.length]]++; sum++; k++; }
      while (sum > n && guard++ < 100) { var idx = order[k % order.length]; if (shares[idx] > 1) { shares[idx]--; sum--; } k++; }
      var out = [];
      runs.forEach(function (r, i) { out = out.concat(resample(r, shares[i])); });
      return out;
    }
    /** Two interlocking hearts, tilted toward each other on a diagonal.
        @param {number} n - total drones across both hearts.
        @returns {Point[]} n points (left heart + right heart); the under-heart alternates at each crossing, and the crossings are real gaps, not interpolated dots. */
    function heartPair(n) {
      var s = 100;
      function tilt(dense, cx, cy, a) { var co = Math.cos(a), si = Math.sin(a); return dense.map(function (p) { var dx = p.x-cx, dy = p.y-cy; return { x: cx+dx*co-dy*si, y: cy+dx*si+dy*co }; }); }
      // diagonal, leaning into each other: left heart up-left, right heart down-right
      var cA = { x: W*.42, y: H*.45 }, cB = { x: W*.58, y: H*.55 };
      var dA = tilt(heartDense(cA.x, cA.y, s), cA.x, cA.y, .18);
      var dB = tilt(heartDense(cB.x, cB.y, s), cB.x, cB.y, -.18);
      function nearest(p, arr) { var m = Infinity; for (var i = 0; i < arr.length; i++) { var d = (p.x-arr[i].x)*(p.x-arr[i].x) + (p.y-arr[i].y)*(p.y-arr[i].y); if (d < m) m = d; } return Math.sqrt(m); }
      function centroid(list) { if (!list.length) return null; var sx = 0, sy = 0; list.forEach(function (p) { sx += p.x; sy += p.y; }); return { x: sx/list.length, y: sy/list.length }; }
      // crossings, in order along dA: consecutive dA points near dB form one cluster
      var candIdx = [];
      dA.forEach(function (p, i) { if (nearest(p, dB) < 12) candIdx.push(i); });
      var clusters = [];
      candIdx.forEach(function (i) { var last = clusters[clusters.length-1]; if (last && i - last[last.length-1] <= 8) last.push(i); else clusters.push([i]); });
      var crossings = clusters.map(function (idxs) { return centroid(idxs.map(function (i) { return dA[i]; })); }).filter(Boolean);
      // merge crossings closer than 40px (one crossing split by sparse candidates, or wrapping the tip)
      for (var m = 0; m < crossings.length - 1; m++) {
        if (Math.hypot(crossings[m+1].x-crossings[m].x, crossings[m+1].y-crossings[m].y) < 40) {
          crossings[m] = { x: (crossings[m].x+crossings[m+1].x)/2, y: (crossings[m].y+crossings[m+1].y)/2 };
          crossings.splice(m+1, 1); m--;
        }
      }
      function gap(dense, centers, r) { return dense.filter(function (p) { return centers.every(function (c) { var d = (p.x-c.x)*(p.x-c.x) + (p.y-c.y)*(p.y-c.y); return d > r*r; }); }); }
      var h = Math.floor(n/2);
      // alternate the under-heart at each crossing, in order along dA
      var gapsA = [], gapsB = [];
      crossings.forEach(function (c, k) { if (k % 2 === 0) gapsA.push(c); else gapsB.push(c); });
      var left = resampleRuns(gap(dA, gapsA, 30), h), right = resampleRuns(gap(dB, gapsB, 30), n-h);
      left.forEach(function (p, i) { p.c = palettes.heart[i % palettes.heart.length]; });
      right.forEach(function (p, i) { p.c = palettes.rings[i % palettes.rings.length]; });
      return left.concat(right);
    }
    /**
     * The champagne-glass formation (bowl + stem + base).
     * @param {number} n - total drones.
     * @returns {Point[]} n points.
     */
    function glassPts(n) {
      var P = function (x, y) { return { x: W*x, y: H*y }; };
      var dense = [P(.40,.10), P(.60,.10)];
      dense = dense.concat(cubic(P(.60,.10), P(.60,.34), P(.55,.44), P(.52,.47), 32).slice(1));
      dense = dense.concat([P(.52,.78), P(.60,.78), P(.60,.86), P(.40,.86), P(.40,.78), P(.48,.78), P(.48,.47)]);
      dense = dense.concat(cubic(P(.48,.47), P(.45,.44), P(.40,.34), P(.40,.10), 32).slice(1));
      return resample(dense, n);
    }
    /**
     * The starburst formation (12-point star).
     * @param {number} n - total drones.
     * @returns {Point[]} n points.
     */
    function starPts(n) {
      var cx = W/2, cy = H/2, verts = [];
      for (var k = 0; k < 12; k++) {
        var a = k*Math.PI/6 - Math.PI/2;
        verts.push({ x: cx+Math.cos(a)*165, y: cy+Math.sin(a)*165*.82 });
        var a2 = a + Math.PI/12;
        verts.push({ x: cx+Math.cos(a2)*95, y: cy+Math.sin(a2)*95*.82 });
      }
      verts.push(verts[0]);
      return resample(verts, n);
    }
    /**
     * The wedding-rings formation (two interlocked rings + gem).
     * @param {number} n - total drones.
     * @returns {Point[]} n points.
     */
    function ringsPts(n) {
      var per = Math.floor((n - 12) / 2);
      var pts = circlePts(W*.42, H*.52, 105, per).concat(circlePts(W*.58, H*.52, 105, n - 12 - per));
      var gx = W*.58, gy = H*.52 - 105 - 30;
      var gem = [{x:gx,y:gy-30},{x:gx+26,y:gy},{x:gx,y:gy+30},{x:gx-26,y:gy},{x:gx,y:gy-30}];
      return pts.concat(resample(gem, 12));
    }
    /**
     * The grand-finale formation (outer ring, mid ring, core, rays).
     * @param {number} n - total drones.
     * @returns {Point[]} n points, split across outer/mid/core/rays in the 240-drone proportions.
     */
    function finalePts(n) {
      var cx = W/2, cy = H/2;
      // Split n across the four parts in the same proportions as the
      // 240-drone original (95 + 65 + 8 + 72); the remainder goes to
      // the rays so the total is exactly n.
      var outer = Math.round(n * 95 / 240), mid = Math.round(n * 65 / 240), core = Math.round(n * 8 / 240);
      var rays = n - outer - mid - core;
      var pts = circlePts(cx, cy, 175, outer).concat(circlePts(cx, cy, 118, mid));
      pts = pts.concat(circlePts(cx, cy, 15, core));
      var perRay = Math.floor(rays / 12), extra = rays - perRay * 12;
      for (var k = 0; k < 12; k++) {
        var a = k*Math.PI/6 - Math.PI/2;
        var count = perRay + (k < extra ? 1 : 0);
        for (var j = 0; j < count; j++) {
          var r = 95 + j*22;
          pts.push({ x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r });
        }
      }
      return pts;
    }

    /**
     * Thins a point cloud to exactly target points, spread evenly:
     * one point per grid cell, then farthest-point top-up.
     * @param {Point[]} pts - the input points (not mutated).
     * @param {number} target - how many points to return.
     * @returns {Point[]} exactly target points, a subset of the input.
     */
    function thinUniform(pts, target) {
      if (pts.length <= target) return pts.slice();
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, i, p;
      for (i = 0; i < pts.length; i++) { p = pts[i]; if (p.x<minX) minX=p.x; if (p.x>maxX) maxX=p.x; if (p.y<minY) minY=p.y; if (p.y>maxY) maxY=p.y; }
      var w = Math.max(1, maxX-minX+1), h = Math.max(1, maxY-minY+1);
      var cols = Math.max(1, Math.round(Math.sqrt(target*w/h)));
      var rows = Math.max(1, Math.round(target/cols));
      var cw = w/cols, ch = h/rows, cells = {};
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        var cx = Math.min(cols-1, Math.floor((p.x-minX)/cw));
        var cy = Math.min(rows-1, Math.floor((p.y-minY)/ch));
        var k = cy*cols+cx, ccx = minX+(cx+.5)*cw, ccy = minY+(cy+.5)*ch;
        var d = (p.x-ccx)*(p.x-ccx)+(p.y-ccy)*(p.y-ccy);
        if (!cells[k] || d < cells[k].d) cells[k] = { p: p, d: d };
      }
      var out = [];
      for (var key in cells) out.push(cells[key].p);
      while (out.length < target) {
        var best = null, bestD = -1;
        for (i = 0; i < pts.length; i++) {
          p = pts[i];
          if (out.indexOf(p) >= 0) continue;
          var m = Infinity;
          for (var j = 0; j < out.length; j++) {
            var dd = (p.x-out[j].x)*(p.x-out[j].x)+(p.y-out[j].y)*(p.y-out[j].y);
            if (dd < m) m = dd;
          }
          if (m > bestD) { bestD = m; best = p; }
        }
        if (!best) break;
        out.push(best);
      }
      return out.slice(0, target);
    }
    // Thins a binary grid to its 1px-wide skeleton (Zhang-Suen
    // thinning). The grid is an array of rows of 0/1 and is modified
    // in place. wordPoints thins each glyph's raster to its stroke
    // centerline, so the drones trace the letter one drone wide
    // instead of filling the stroke - a bright light stands on its
    // own and needs no 3-4 drones lumped together for bold text.
    /**
     * Thins a binary grid to its 1px-wide skeleton (Zhang-Suen
     * thinning). The grid is an array of rows of 0/1 and is modified
     * in place; wordPoints thins each glyph's raster to its stroke
     * centerline, so the drones trace the letter one drone wide.
     * @param {number[][]} grid - rows of 0/1, mutated in place.
     * @returns {number[][]} the same grid, thinned to a 1px centerline.
     */
    function skeletonize(grid) {
      var rows = grid.length, cols = grid[0].length;
      function neighbors(r, c) {
        return [grid[r - 1][c], grid[r - 1][c + 1], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c], grid[r + 1][c - 1], grid[r][c - 1], grid[r - 1][c - 1]];
      }
      function transitions(n) {
        var count = 0;
        for (var i = 0; i < 8; i++) if (n[i] === 0 && n[(i + 1) % 8] === 1) count++;
        return count;
      }
      var changed = true;
      while (changed) {
        changed = false;
        for (var step = 0; step < 2; step++) {
          var toDelete = [];
          for (var r = 1; r < rows - 1; r++) {
            for (var c = 1; c < cols - 1; c++) {
              if (!grid[r][c]) continue;
              var n = neighbors(r, c);
              var b = n.reduce(function (a, v) { return a + v; }, 0);
              if (b < 2 || b > 6) continue;
              if (transitions(n) !== 1) continue;
              if (step === 0) { if (n[0] * n[2] * n[4] !== 0) continue; if (n[2] * n[4] * n[6] !== 0) continue; }
              else { if (n[0] * n[2] * n[6] !== 0) continue; if (n[0] * n[4] * n[6] !== 0) continue; }
              toDelete.push([r, c]);
            }
          }
          if (toDelete.length) { changed = true; toDelete.forEach(function (q) { grid[q[0]][q[1]] = 0; }); }
        }
      }
      return grid;
    }
    // Tunable word-pipeline settings. wordPoints reads these live,
    // and they are exposed as window.WHENWHERE.tuning for the
    // readability lab (tools/readability-lab.html) — the lab changes
    // them without reloading and the page re-renders. Defaults are
    // the shipped values; nothing else reads them.
    /** @type {Tuning} */
    var TUNING = {
      font: 'Marcellus, Georgia, serif', weight: 700,
      size: 190, sizeMin: 60, maxW: W - 40,
      perGlyph: 25, targetMin: 50, targetMax: 100,
      // Dots closer than minGap merge into one smear: 2.5x the 4.2px
      // drone radius used in draw(). separatePoints enforces it.
      minGap: 10.5,
      // Raster sampling step, in px: the glyph is sampled into a
      // binary grid every sampleStep px, then thinned to its stroke
      // centerline. Smaller step = finer skeleton and straighter
      // diagonals, at ~4x the grid per halving (2px costs ~2ms more
      // per keystroke than the original 4px).
      sampleStep: 2,
      // Raster alpha threshold: a grid cell is ink when the glyph
      // pixel's alpha is above this (0-255).
      threshold: 110
    };
    // Splits a dot budget across glyphs in proportion to their stroke
    // lengths (skeleton pixel counts), so a wide letter gets more
    // drones than a narrow one and the density stays even across the
    // word. Returns shares that sum exactly to total: a glyph with
    // any stroke gets at least 1 dot (it never silently vanishes),
    // a glyph with no stroke gets 0, and the leftover from rounding
    // goes to the largest remainders.
    /**
     * Splits a dot budget across glyphs in proportion to their stroke
     * lengths. Every glyph with any stroke gets at least 1; the
     * leftover goes to the largest remainders.
     * @param {number[]} lengths - stroke length per glyph.
     * @param {number} total - the dot budget.
     * @returns {number[]} one count per glyph, summing exactly to total.
     */
    function allocateCounts(lengths, total) {
      var sum = 0, i;
      for (i = 0; i < lengths.length; i++) sum += lengths[i];
      if (sum <= 0 || total <= 0) return lengths.map(function () { return 0; });
      var shares = lengths.map(function (L) {
        return L > 0 ? Math.max(1, Math.floor(total * L / sum)) : 0;
      });
      var have = shares.reduce(function (a, b) { return a + b; }, 0);
      var order = lengths.map(function (L, idx) { return idx; }).sort(function (a, b) {
        var ra = total * lengths[a] / sum - Math.floor(total * lengths[a] / sum);
        var rb = total * lengths[b] / sum - Math.floor(total * lengths[b] / sum);
        return rb - ra;
      });
      var k = 0;
      while (have < total) { shares[order[k % order.length]]++; have++; k++; }
      // The min-1 rule can overshoot a small budget — take back from
      // the largest shares, never below 1. (For real inputs the
      // budget is 50-100 across at most 9 glyphs, so there is always
      // room; the loop still terminates if every share is already 1.)
      var big = lengths.map(function (L, idx) { return idx; }).sort(function (a, b) { return shares[b] - shares[a]; });
      while (have > total) {
        var took = false;
        for (var j = 0; j < big.length; j++) {
          if (shares[big[j]] > 1) { shares[big[j]]--; have--; took = true; if (have <= total) break; }
        }
        if (!took) break;
      }
      return shares;
    }
    // Pushes apart dots closer than minDist so they never overlap.
    // Pairwise repulsion, repeated until a pass moves nothing (a
    // push can shove a dot toward a third one, so one pass is not
    // enough in a dense cluster); dots on a straight stroke stay on
    // it, since the push runs along their connecting vector.
    // Mutates the array in place (like skeletonize mutates its grid)
    // and returns it.
    /**
     * Pushes points apart (pairwise repulsion, up to 20 passes) so no
     * two are closer than minDist. Mutates in place.
     * @param {Point[]} pts - the points, mutated in place.
     * @param {number} minDist - the minimum gap in px.
     * @returns {Point[]} the same points, separated.
     */
    function separatePoints(pts, minDist) {
      for (var pass = 0; pass < 20; pass++) {
        var moved = false;
        for (var i = 0; i < pts.length; i++) {
          for (var j = i + 1; j < pts.length; j++) {
            var dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
            var d2 = dx * dx + dy * dy;
            if (d2 >= minDist * minDist || d2 === 0) continue;
            var d = Math.sqrt(d2), push = (minDist - d) / 2;
            var ux = dx / d, uy = dy / d;
            pts[i].x -= ux * push; pts[i].y -= uy * push;
            pts[j].x += ux * push; pts[j].y += uy * push;
            moved = true;
          }
        }
        if (!moved) break;
      }
      return pts;
    }
    // One character at a time, each rastered on a tight canvas just big
    // enough for the glyph (not the full 900x732 stage): wordPoints runs
    // on every keystroke, and a full-stage canvas per character was ~2MB
    // of allocation per keystroke for a 4-letter word. The glyph is drawn
    // centered, so points translate back by the same offset.
    // Rasterize + skeletonize one glyph at the given size; returns
    // { cp, tw, th } in the glyph's own canvas coords. wordPoints
    // calls this per glyph; the readability lab calls it directly to
    // render any letter at any count.
    /**
     * Rasterises one glyph and thins it to its stroke centerline.
     * @param {string} ch - the character (one glyph).
     * @param {number} size - the type size in px.
     * @returns {Glyph} the skeleton points plus the glyph's width/height.
     */
    function glyphSkeleton(ch, size) {
      var mc2 = document.createElement('canvas').getContext('2d');
      mc2.font = TUNING.weight + ' ' + size + 'px ' + TUNING.font;
      var tw = Math.ceil(mc2.measureText(ch).width) + 16, th = Math.ceil(size * 1.5);
      var off = document.createElement('canvas'); off.width = tw; off.height = th;
      var o = off.getContext('2d');
      o.font = TUNING.weight + ' ' + size + 'px ' + TUNING.font;
      o.textAlign = 'center'; o.textBaseline = 'middle';
      o.fillStyle = '#fff';
      o.fillText(ch, tw / 2, th / 2 + 6);
      var img = null;
      try { img = o.getImageData(0, 0, tw, th).data; } catch (e) { img = null; }
      var cp = [];
      if (img) {
        // Binary grid at the sampling step, with a zero border
        // (the glyph is centered with padding, so the outer ring is
        // empty and the thinning has a border to stop at).
        var step = TUNING.sampleStep;
        var gw = Math.floor((tw - step) / step) + 1, gh = Math.floor((th - step) / step) + 1;
        var grid = [];
        for (var gy = 0; gy < gh + 2; gy++) grid.push(new Array(gw + 2).fill(0));
        for (var y = step; y < th; y += step) for (var xx = step; xx < tw; xx += step) {
          if (img[(Math.floor(y) * tw + Math.floor(xx)) * 4 + 3] > TUNING.threshold) grid[Math.floor((y - step) / step) + 1][Math.floor((xx - step) / step) + 1] = 1;
        }
        skeletonize(grid);
        for (var sy = 1; sy < gh + 1; sy++) for (var sx = 1; sx < gw + 1; sx++) {
          if (grid[sy][sx]) cp.push({ x: (sx - 1) * step + step, y: (sy - 1) * step + step });
        }
      }
      return { cp: cp, tw: tw, th: th };
    }
    /** Points for a word, rastered one character at a time on tight per-glyph canvases and thinned to the stroke centerline.
        @param {string} text - the word to draw; spaces are kept as gaps (they take no drones).
        @returns {Point[]} exactly target points (clamped 50-100), split across glyphs in proportion to their stroke lengths, with dots kept at least the minimum gap apart; each glyph is thinned to its skeleton, so the drones trace the letter one drone wide; the type is the largest bold size that fits the 900px stage (190px down to a 60px floor); [] for empty or whitespace-only text. */
    function wordPoints(text) {
      var chars = text.replace(/\s/g, '').split('');
      if (!chars.length) return [];
      var target = Math.max(TUNING.targetMin, Math.min(TUNING.targetMax, chars.length * TUNING.perGlyph));
      var mc = document.createElement('canvas').getContext('2d');
      // Layout items: one per character of the original text, so a
      // space keeps its place as a gap instead of vanishing (it takes
      // no drones). Measure at 190px, then shrink the type until the
      // whole phrase fits the stage — short words stay big, long words
      // shrink instead of running off the edges.
      var MAXW = TUNING.maxW;
      var size = TUNING.size;
      /** @type {WordItem[]} */
      var items = [];
      var gap = 0;
      var totalW = 0;
      function measure() {
        mc.font = TUNING.weight + ' ' + size + 'px ' + TUNING.font;
        gap = size * .18;
        var spaceW = mc.measureText(' ').width;
        items = text.split('').map(function (c) {
          return /\s/.test(c) ? { space: true, w: spaceW } : { c: c, w: mc.measureText(c).width };
        });
        totalW = items.reduce(function (a, it) { return a + it.w; }, 0) + gap * (items.length - 1);
      }
      measure();
      while (totalW > MAXW && size > TUNING.sizeMin) {
        size = Math.max(TUNING.sizeMin, Math.floor(size * MAXW / totalW));
        measure();
      }
      var x = W / 2 - totalW / 2;
      // Pass 1: rasterize + skeletonize every glyph, keeping its
      // stroke length (the skeleton pixel count) for the split.
      var glyphs = [];
      items.forEach(function (it) {
        if (it.space) { x += it.w + gap; return; }
        var gl = glyphSkeleton(it.c, size);
        glyphs.push({ cp: gl.cp, cx: x + it.w / 2, tw: gl.tw, th: gl.th });
        x += it.w + gap;
      });
      // Pass 2: split the budget in proportion to stroke length,
      // then thin + separate each glyph to its share.
      var shares = allocateCounts(glyphs.map(function (gl) { return gl.cp.length; }), target);
      var pts = [];
      glyphs.forEach(function (gl, idx) {
        var thinned = separatePoints(thinUniform(gl.cp, shares[idx]), TUNING.minGap);
        thinned.forEach(function (p) { pts.push({ x: p.x - gl.tw / 2 + gl.cx, y: p.y - gl.th / 2 + H / 2 }); });
      });
      return pts;
    }

    // Multi-slide words: '+' splits the box into separate moments
    // ("happy + new year" -> Happy, then New Year). Without '+',
    // whole words are packed into slides of at most
    // MAX_SLIDE_GLYPHS non-space glyphs - the most that still
    // reads at the 100-drone budget (HAPPY NEW is 8). A single
    // word longer than the cap is its own slide. At most
    // MAX_SLIDES slides; extras are dropped.
    var MAX_SLIDE_GLYPHS = 8;
    var MAX_SLIDES = 6;
    /**
     * Splits a word message into slides of at most 8 non-space glyphs.
     * '+' is an explicit separator; without it, whole words pack into
     * slides; a single long word is its own slide; at most 6 slides.
     * @param {string} text - the visitor's message.
     * @returns {string[]} the slides, in order ([] for blank text).
     */
    function splitSlides(text) {
      var slides = [];
      function pack(words) {
        var cur = '', curGlyphs = 0;
        words.forEach(function (w) {
          var g = w.replace(/\s/g, '').length;
          if (!g) return;
          if (curGlyphs > 0 && curGlyphs + g > MAX_SLIDE_GLYPHS) {
            slides.push(cur);
            cur = w; curGlyphs = g;
          } else {
            cur = cur ? cur + ' ' + w : w;
            curGlyphs += g;
          }
        });
        if (cur) slides.push(cur);
      }
      String(text || '').split('+').forEach(function (part) {
        var words = part.trim().split(/\s+/).filter(Boolean);
        if (words.length) pack(words);
      });
      return slides.slice(0, MAX_SLIDES);
    }
    return {
      heartPair: heartPair, ringsPts: ringsPts, glassPts: glassPts,
      starPts: starPts, finalePts: finalePts, wordPoints: wordPoints,
      resample: resample, resampleRuns: resampleRuns,
      thinUniform: thinUniform, skeletonize: skeletonize,
      allocateCounts: allocateCounts, separatePoints: separatePoints,
      glyphSkeleton: glyphSkeleton, splitSlides: splitSlides,
      tuning: TUNING
    };
  }
  return { create: createGeometry };
})();
