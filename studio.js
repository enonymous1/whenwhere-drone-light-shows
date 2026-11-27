// @ts-check
/* WhenWhere drone light shows — page JavaScript (Formation Studio, inquiry form,
   package shortcuts, mobile nav). Extracted from index.html 2026-11-18: the page
   carries no inline executable scripts, so script-src 'self' holds. */
      /* ============ Config ============ */
      // The launch settings live in config.js, loaded before this file:
      // endpoint, fleet counts, palettes, cooldown, earliest date. This
      // file holds the machinery and has no defaults for them — if
      // config.js is missing, fail loudly instead of rendering with
      // stale numbers.
      /** @type {WhenWhereConfig} */
      var CFG = window.WHENWHERE_CONFIG;
      if (!CFG) throw new Error('WHENWHERE_CONFIG is missing — config.js did not load');

      /* ============ Types ============
         The geometry pipeline is points in, points out; the form is
         strings in, an inquiry object out. The types live in
         types.d.ts — these lines only bring the names into this file
         so the @param/@returns below can use them. Point.c is set only
         by heartPair (the two hearts get different colours); everywhere
         else the palette supplies the colour. */
      /** @typedef {import('./types').Point} Point */
      /** @typedef {import('./types').Tuning} Tuning */
      /** @typedef {import('./types').WordItem} WordItem */
      /** @typedef {import('./types').Glyph} Glyph */
      /** @typedef {import('./types').Drone} Drone */
      /** @typedef {import('./types').Star} Star */
      /** @typedef {import('./types').Inquiry} Inquiry */
      /** @typedef {import('./types').ContentItem} ContentItem */
      /** @typedef {import('./types').WhenWhereGeometry} WhenWhereGeometry */
      /** @typedef {import('./types').WhenWhereNS} WhenWhereNS */
      /** @type {WhenWhereNS} */
      var WHENWHERE;
      /* ============ Formation Studio ============ */
      (function () {
        var canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('sky'));
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        var W = canvas.width, H = canvas.height;
        var nameEl = document.getElementById('shapeName');
        var countEl = document.getElementById('droneCount');
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // background stars
        var stars = [];
        for (var i = 0; i < 90; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + .3, p: Math.random() * Math.PI * 2 });

        var COLORS = CFG.COLORS;
        var FLEET = CFG.FLEET;
        var PALETTES = CFG.PALETTES;

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
          left.forEach(function (p, i) { p.c = PALETTES.heart[i % PALETTES.heart.length]; });
          right.forEach(function (p, i) { p.c = PALETTES.rings[i % PALETTES.rings.length]; });
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
        var SHAPES = {
          heart: { name: 'Interlocking hearts', points: heartPair },
          rings: { name: 'Wedding rings', points: ringsPts },
          glass: { name: 'Wine glass', points: glassPts },
          star: { name: 'Starburst', points: starPts },
          finale: { name: 'Grand finale', points: finalePts }
        };
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

        var drones = [], startTime = 0, currentName = '';
        // Drone reuse: drones that already exist morph from their current position; new ones rise from below the canvas.
        /**
         * Shows a formation: the drones morph from their current position
         * (new ones rise from below the canvas). A point's own colour
         * (p.c, set by heartPair) wins; otherwise the palette cycles.
         * @param {Point[]} pts - the target positions.
         * @param {string} name - the caption (e.g. 'Two hearts').
         * @param {string[]} [palette] - colours to cycle; CFG.COLORS when omitted.
         */
        function setFormation(pts, name, palette) {
          currentName = name;
          nameEl.textContent = name;
          countEl.textContent = pts.length + ' drones — ' + (pts.length > 100 ? 'a larger show; extra lead time to secure additional units' : 'fits our 100-drone opening fleet');
          drones = pts.map(function (p, idx) {
            var old = drones[idx];
            return {
              sx: old ? old.x : Math.random() * W, sy: old ? old.y : H + 30 + Math.random() * 120,
              x: old ? old.x : Math.random() * W, y: old ? old.y : H + 30,
              tx: p.x, ty: p.y, d: Math.random() * .55, c: p.c || (palette || COLORS)[idx % (palette || COLORS).length], ph: Math.random() * Math.PI * 2
            };
          });
          startTime = performance.now();
          if (reduced) { drones.forEach(function (d) { d.x = d.tx; d.y = d.ty; }); draw(performance.now()); }
        }
        /**
         * Cubic ease-out for the morph.
         * @param {number} t - progress 0-1.
         * @returns {number} eased progress 0-1.
         */
        function ease(t) { return 1 - Math.pow(1 - t, 3); }
        /**
         * One frame: background stars, then every drone at its eased
         * position, bobbing and twinkling. Runs on requestAnimationFrame
         * via queueDraw() (paused off-screen / under reduced motion).
         * @param {number} now - the animation timestamp in ms.
         */
        function draw(now) {
          ctx.fillStyle = '#03040d'; ctx.fillRect(0, 0, W, H);
          var t = (now - startTime) / 1000;
          stars.forEach(function (s) {
            ctx.globalAlpha = .35 + .3 * Math.sin(t * 1.4 + s.p);
            ctx.fillStyle = '#cdd8ff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
          });
          ctx.globalAlpha = 1;
          drones.forEach(function (d) {
            var lt = reduced ? 1 : Math.min(1, Math.max(0, (t - d.d) / 1.5));
            var e = ease(lt);
            d.x = d.sx + (d.tx - d.sx) * e;
            d.y = d.sy + (d.ty - d.sy) * e + Math.sin(t * 1.8 + d.ph) * (lt >= 1 ? 1.6 : 0);
            if (currentName === 'Starburst') { var pulse = 1 + .03 * Math.sin(t * 2.2); d.x = W / 2 + (d.x - W / 2) * pulse; d.y = H / 2 + (d.y - H / 2) * pulse; }
            if (currentName === 'Grand finale') { var rot = t * .15, co = Math.cos(rot), si = Math.sin(rot), dx = d.x - W/2, dy = d.y - H/2; d.x = W/2 + dx*co - dy*si; d.y = H/2 + dx*si + dy*co; }
            var tw = .75 + .25 * Math.sin(t * 3 + d.ph);
            ctx.globalAlpha = tw;
            ctx.fillStyle = d.c;
            ctx.shadowColor = d.c; ctx.shadowBlur = 12;
            ctx.beginPath(); ctx.arc(d.x, d.y, 4.2, 0, Math.PI * 2); ctx.fill();
          });
          ctx.globalAlpha = 1; ctx.shadowBlur = 0;
          queueDraw();
        }
        // Pause when the canvas scrolls out of view: rAF already stops
        // when the tab is hidden, but it keeps drawing while the user
        // is down at the form. The observer restarts the loop when the
        // sky comes back into view; drawQueued keeps the restart from
        // starting a second loop while one is already running.
        var skyVisible = true, drawQueued = false;
        /**
         * Schedules the next frame, unless one is already queued, the
         * page prefers reduced motion, or the sky is scrolled out of view.
         */
        function queueDraw() {
          if (drawQueued || reduced || !skyVisible) return;
          drawQueued = true;
          requestAnimationFrame(function (ts) { drawQueued = false; draw(ts); });
        }
        if ('IntersectionObserver' in window) {
          new IntersectionObserver(function (entries) {
            skyVisible = entries[0].isIntersecting;
            if (skyVisible) queueDraw();
          }).observe(canvas);
        }
        queueDraw();
        setFormation(SHAPES.heart.points(FLEET.heart), SHAPES.heart.name, PALETTES.heart);
        // Fleet counts on the buttons come from FLEET, not from hardcoded
        // HTML, so the button labels can never drift from the real counts.
        document.querySelectorAll('[data-fleet]').forEach(function (el) {
          var n = FLEET[el.getAttribute('data-fleet')];
          if (typeof n === 'number') el.textContent = String(n);
        });

        var wordInput = /** @type {HTMLInputElement} */ (document.getElementById('customWord'));
        // Multi-slide words: '+' splits the box into separate moments
        // ("happy + new year" -> Happy, then New Year). Without '+',
        // whole words are packed into slides of at most
        // MAX_SLIDE_GLYPHS non-space glyphs - the most that still
        // reads at the 100-drone budget (HAPPY NEW is 8). A single
        // word longer than the cap is its own slide. At most
        // MAX_SLIDES slides; extras are dropped.
        var MAX_SLIDE_GLYPHS = 8;
        var MAX_SLIDES = 6;
        var SLIDE_MS = 4000;
        var wordSlides = [];
        var wordSlideIdx = 0;
        var wordTimer = 0;
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
        /** Stops the multi-slide word cycle (switching shapes calls this). */
        function stopWordCycle() {
          if (wordTimer) { clearInterval(wordTimer); wordTimer = 0; }
          wordSlides = [];
          wordSlideIdx = 0;
        }
        /**
         * Shows one slide of the word cycle.
         * @param {number} i - the slide index (0-based).
         */
        function showWordSlide(i) {
          var slide = wordSlides[i];
          var name = '“' + slide + '” — your words in the sky';
          if (wordSlides.length > 1) name += ' (' + (i + 1) + ' of ' + wordSlides.length + ')';
          setFormation(wordPoints(slide), name, PALETTES.word);
        }
        // One place that turns the word box into a formation: the
        // shape button, the input listener, and the fonts-ready
        // re-render all call this, so the label can never drift
        // between them. Returns false when there is no word to draw
        // (blank box) instead of drawing anything. With more than
        // one slide, the fleet cycles through them (SLIDE_MS apart,
        // looping) - the re-assembly between slides is the show.
        /**
         * Draws the visitor's word (uppercased), splitting it into slides
         * when it needs more than one, and cycling them every ~4s.
         * @param {string} fallback - the word to draw when the input is blank.
         * @returns {boolean} false when there is nothing to draw, else true.
         */
        function drawWord(fallback) {
          var w = (wordInput.value || fallback).toUpperCase();
          stopWordCycle();
          if (!w.trim()) return false;
          wordSlides = splitSlides(w);
          if (!wordSlides.length) return false;
          showWordSlide(0);
          if (wordSlides.length > 1) {
            wordTimer = setInterval(function () {
              wordSlideIdx = (wordSlideIdx + 1) % wordSlides.length;
              showWordSlide(wordSlideIdx);
            }, SLIDE_MS);
          }
          return true;
        }
        document.querySelectorAll('.shape-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var wasActive = btn.classList.contains('active');
            document.querySelectorAll('.shape-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var key = btn.getAttribute('data-shape');
            if (key === 'word') {
              // Clicking the already-active word shape resets to the default.
              if (wasActive) wordInput.value = 'LOVE';
              drawWord('LOVE');
            } else {
              stopWordCycle();
              setFormation(SHAPES[key].points(FLEET[key]), SHAPES[key].name, PALETTES[key]);
            }
          });
        });
        // Clicking (or tabbing) into the word box means the visitor
        // wants to see their words — activate the word shape the
        // same way clicking its button would. The guard keeps an
        // already-active word shape from re-drawing when the box
        // is clicked into to edit.
        wordInput.addEventListener('focus', function () {
          var btn = document.getElementById('wordBtn');
          if (!btn.classList.contains('active')) btn.click();
        });
        wordInput.addEventListener('input', function () {
          var btn = document.getElementById('wordBtn');
          if (btn.classList.contains('active') && !drawWord(' ')) setFormation([], 'Your words in the sky');
        });
        // The example pill fills the box with a multi-slide message and
        // draws it — the quickest way to see the '+' split work, with
        // no typing. The reset button puts the default back. Both live
        // outside the content-tagged hint, so the Sheet loader cannot
        // wipe them. Neither focuses the box: focusing would pop the
        // mobile keyboard over the sky the visitor wants to see.
        document.getElementById('exampleWordBtn').addEventListener('click', function () {
          wordInput.value = 'happy + new year';
          var btn = document.getElementById('wordBtn');
          if (!btn.classList.contains('active')) btn.click();
          else drawWord(' ');
        });
        document.getElementById('wordResetBtn').addEventListener('click', function () {
          wordInput.value = 'LOVE';
          var btn = document.getElementById('wordBtn');
          if (!btn.classList.contains('active')) btn.click();
          else drawWord(' ');
        });
        // If the word tool is used before Marcellus finishes loading,
        // the glyphs rasterize in the Georgia fallback and the dots
        // stay put even after the font arrives — re-render once when
        // the fonts are ready, if the word shape is still active.
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () {
            var btn = document.getElementById('wordBtn');
            if (btn && btn.classList.contains('active')) drawWord(' ');
          });
        }
        document.getElementById('useDesignBtn').addEventListener('click', function () {
          if (!currentName) return;
          var dream = /** @type {HTMLTextAreaElement} */ (document.getElementById('inDream'));
          // For words, record the whole message (all slides), not just
          // whichever slide is showing - otherwise the team only gets
          // half a proposal.
          var design = currentName;
          var wordBtn = document.getElementById('wordBtn');
          if (wordBtn && wordBtn.classList.contains('active') && wordSlides.length) {
            design = wordSlides.length > 1
              ? '“' + wordSlides.join('” then “') + '” — your words in the sky (' + wordSlides.length + ' moments)'
              : '“' + wordSlides[0] + '” — your words in the sky';
          }
          var line = 'Design we liked in the Formation Studio: ' + design + '. ';
          if (dream.value.indexOf(line) === -1) dream.value = (dream.value ? dream.value.replace(/\s+$/, ' ') : '') + line;
          document.getElementById('inquire').scrollIntoView({ behavior: 'smooth' });
          dream.focus();
        });
        // Exposed for tests: the pure geometry, without the DOM.
        window.WHENWHERE = window.WHENWHERE || /** @type {WhenWhereNS} */ ({});
        window.WHENWHERE.geometry = { resample: resample, resampleRuns: resampleRuns, heartPair: heartPair, thinUniform: thinUniform, wordPoints: wordPoints, skeletonize: skeletonize, finalePts: finalePts, allocateCounts: allocateCounts, separatePoints: separatePoints, glyphSkeleton: glyphSkeleton, splitSlides: splitSlides };
        window.WHENWHERE.tuning = TUNING;
      })();

      /* ============ Package shortcuts ============ */
      document.querySelectorAll('[data-interest]').forEach(function (link) {
        link.addEventListener('click', function () {
          var label = link.getAttribute('data-interest');
          var dream = /** @type {HTMLTextAreaElement} */ (document.getElementById('inDream'));
          if (dream && !dream.value) dream.value = 'Interested in: ' + label + '. ';
          var radios = document.querySelectorAll('input[name="pkg"]');
          radios.forEach(function (/** @type {HTMLInputElement} */ r) {
            if (label.indexOf(r.value) === 0 || (r.value === 'The Moment' && label.indexOf('Moment') > -1) || (r.value === 'Show + Party' && label.indexOf('Show + Party') > -1) || (r.value === 'The Signature Show' && label.indexOf('Signature') > -1)) r.checked = true;
          });
        });
      });

      /* ============ Inquiry form ============ */
      /* Two modes, chosen by CFG.INQUIRY_ENDPOINT (config.js):
         configured (endpoint set) - submit POSTs the 12 fields to the Apps Script web app, which
         appends a row to the private Sheet and sends the notification email; the page shows a short
         thank-you. Demo mode (endpoint blank) - no network call; the inquiry text is built in the
         result panel for copy/download instead. A localStorage cooldown (config INQUIRY_KEY)
         plus an in-flight guard stop double submits. */
      (function () {
        var form = /** @type {HTMLFormElement} */ (document.getElementById('inquiryForm'));
        var dateInput = /** @type {HTMLInputElement} */ (document.getElementById('inDate'));
        var flexBox = /** @type {HTMLInputElement} */ (document.getElementById('inFlexDate'));
        var note = document.getElementById('formNote');
        var endpoint = (CFG.INQUIRY_ENDPOINT || '').trim();
        var configured = !!endpoint;
        var COOLDOWN_MS = CFG.COOLDOWN_MS;
        var inFlight = false;
        var submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
        function setNote() {
          if (note) note.textContent = configured
            ? 'Submitting sends your inquiry to WhenWhere. We only use your details to reply about your event.'
            : 'Demo mode: no inquiry endpoint is connected yet, so submitting builds your inquiry below to copy or download. See README.md to connect the inquiry form.';
        }
        setNote();

        // Founding season starts in 2027, and shows still need 14 days' lead time.
        var minDate = new Date(); minDate.setDate(minDate.getDate() + CFG.DATE_MIN_DAYS_AHEAD);
        var seasonStart = new Date(CFG.DATE_MIN_FLOOR + 'T00:00:00');
        if (seasonStart > minDate) minDate = seasonStart;
        dateInput.min = minDate.getFullYear() + '-' + String(minDate.getMonth() + 1).padStart(2, '0') + '-' + String(minDate.getDate()).padStart(2, '0');

        flexBox.addEventListener('change', function () {
          dateInput.disabled = flexBox.checked;
          if (flexBox.checked) document.getElementById('f-date').classList.remove('invalid');
        });

        /* 30-day warning: a drone show needs permits, airspace and
           fleet prep, so a date under 30 days out shows a gold
           heads-up — but only if the date is valid (it passes the
           14-day floor above); warning on a date the form already
           rejects would promise a submission that can't go through.
           It never blocks submission, and it hides when the date is
           flexible (no date, no warning). UTC date-only math, so a
           date 29 days out reads 29 at any hour of the day. */
        var dateWrap = document.getElementById('f-date');
        /**
         * Whole days from today to an ISO date (UTC date-only math, so a
         * date 29 days out reads 29 at any hour).
         * @param {string} iso - an ISO date (YYYY-MM-DD).
         * @returns {number} the days until the date (negative when past).
         */
        function daysUntil(iso) {
          var p = iso.split('-');
          var picked = Date.UTC(+p[0], +p[1] - 1, +p[2]);
          var n = new Date();
          var today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
          return Math.round((picked - today) / 86400000);
        }
        /**
         * Shows the 30-day heads-up when the chosen date is a valid date
         * under 30 days out (and the date is not flexible). Never blocks.
         */
        function checkSoon() {
          var v = dateInput.value;
          if (!v || flexBox.checked) { dateWrap.classList.remove('warn'); return; }
          var d = daysUntil(v);
          dateWrap.classList.toggle('warn', d >= 0 && d < 30 && v >= dateInput.min);
        }
        dateInput.addEventListener('change', checkSoon);
        dateInput.addEventListener('input', checkSoon);
        flexBox.addEventListener('change', checkSoon);
        checkSoon();

        /**
         * The trimmed value of a form field.
         * @param {string} id - the field's element id.
         * @returns {string} the trimmed value.
         */
        function val(id) { return /** @type {HTMLInputElement} */ (document.getElementById(id)).value.trim(); }
        /**
         * Marks a field invalid (or clears it) and reports whether it is valid.
         * @param {string} fieldId - the wrapping .field element's id.
         * @param {boolean} bad - true when the field fails validation.
         * @returns {boolean} true when the field is valid.
         */
        function mark(fieldId, bad) { document.getElementById(fieldId).classList.toggle('invalid', bad); return !bad; }

        /**
         * Shows the result panel: a thank-you on a confirmed send, the
         * copy/download fallback otherwise.
         * @param {string} first - the visitor's first name.
         * @param {string} lines - the plain-text inquiry (for copy/download).
         * @param {boolean} sent - true when the send was confirmed.
         * @param {boolean} sendFailed - true when the send itself failed.
         */
        function showResult(first, lines, sent, sendFailed) {
          document.getElementById('resultText').textContent = lines;
          document.getElementById('resultHeading').textContent = sent
            ? 'Thank you, ' + first + ' \u2726'
            : 'Your inquiry is ready, ' + first + ' \u2726';
          document.getElementById('resultDesc').textContent = sent
            ? "Your inquiry is in — we'll come back with availability and honest guidance on what your budget can do, usually within two working days."
            : sendFailed
              ? "We couldn't send it automatically — please copy it below and send it to us through the main site, and we'll take it from there."
              : 'Copy it into an email or message to WhenWhere, or download it to send later. The sooner it reaches us, the sooner your date is on the founding-season list.';
          document.getElementById('resultActions').style.display = sent ? 'none' : 'flex';
          document.getElementById('resultText').style.display = sent ? 'none' : '';
          var panel = document.getElementById('resultPanel');
          panel.classList.add('show');
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        /**
         * Validates the inquiry form (name, email format, type, date
         * unless flexible) and marks the bad fields.
         * @returns {boolean} true when the form is valid.
         */
        function validateForm() {
          var ok = true;
          ok = mark('f-name', !val('inName')) && ok;
          var email = val('inEmail');
          ok = mark('f-email', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) && ok;
          ok = mark('f-type', !val('inType')) && ok;
          var flex = flexBox.checked;
          var dateBad = !flex && (!val('inDate') || val('inDate') < dateInput.min);
          ok = mark('f-date', dateBad) && ok;
          if (!ok) { var bad = /** @type {HTMLElement} */ (document.querySelector('.field.invalid input, .field.invalid select')); if (bad) bad.focus(); }
          return ok;
        }
        /**
         * Reads the form into the inquiry object: first name, plain-text
         * lines for copy/download, and the params posted to Apps Script.
         * @returns {Inquiry} the inquiry.
         */
        function collectInquiry() {
          var email = val('inEmail');
          var flex = flexBox.checked;
          var pkg = (/** @type {HTMLInputElement} */ (form.querySelector('input[name="pkg"]:checked')) || {}).value || 'Not specified yet';
          var stage = (/** @type {HTMLInputElement} */ (form.querySelector('input[name="stage"]:checked')) || {}).value || 'Not specified yet';
          var surprise = /** @type {HTMLInputElement} */ (document.getElementById('inSurprise')).checked ? 'Yes' : 'No';
          var dateStr = flex ? 'Flexible / not sure yet'
            : new Date(val('inDate') + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          var first = val('inName').split(' ')[0];
          var lines = [
            'DRONE LIGHT SHOW INQUIRY — WhenWhere.biz',
            '----------------------------------------',
            'Name: ' + val('inName'),
            'Email: ' + email,
            val('inPhone') ? 'Phone: ' + val('inPhone') : null,
            'Event type: ' + val('inType'),
            'Event date: ' + dateStr,
            val('inVenue') ? 'Venue / town: ' + val('inVenue') : null,
            val('inGuests') ? 'Expected guests: ' + val('inGuests') : null,
            val('inBudget') ? 'Rough budget: ' + val('inBudget') : null,
            'Package of interest: ' + pkg,
            'Planning stage: ' + stage,
            'Surprise: ' + surprise,
            val('inDream') ? 'In the sky, we would love to see: ' + val('inDream') : null
          ].filter(Boolean).join('\n');
          var params = new URLSearchParams();
          params.set('name', val('inName')); params.set('email', email);
          params.set('phone', val('inPhone')); params.set('type', val('inType'));
          params.set('date', dateStr); params.set('venue', val('inVenue'));
          params.set('guests', val('inGuests')); params.set('budget', val('inBudget'));
          params.set('pkg', pkg); params.set('dream', val('inDream'));
          params.set('stage', stage); params.set('surprise', surprise);
          return { first: first, lines: lines, params: params };
        }
        /**
         * Posts the inquiry to the Apps Script endpoint (live mode) or
         * shows the copy/download fallback (demo mode / send failure).
         * @param {Inquiry} inquiry - the inquiry from collectInquiry().
         */
        function sendInquiry(inquiry) {
          /* Live mode: POST to the Apps Script endpoint, which appends a row
             to the private Sheet and emails a notification. Replies come
             from our personal email. */
          inFlight = true;
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }
          fetch(endpoint, { method: 'POST', body: inquiry.params })
            .then(function (res) { return res.text(); })
            .then(function (text) {
              // Apps Script always answers HTTP 200, even when doPost
              // rejects the submission — so the body is the verdict, not
              // the status. The new endpoint returns JSON {"ok": ...};
              // the pre-JSON endpoint answers plain 'ok', which still
              // counts as success until it is redeployed.
              var data = null;
              try { data = JSON.parse(text); } catch (e) { data = null; }
              if (data) { if (data.ok !== true) throw new Error('send failed'); }
              else if (text.trim() !== 'ok') throw new Error('send failed');
              try { localStorage.setItem(CFG.INQUIRY_KEY, String(Date.now())); } catch (e) {}
              showResult(inquiry.first, inquiry.lines, true, false);
            })
            .catch(function () { showResult(inquiry.first, inquiry.lines, false, true); })
            .finally(function () {
              inFlight = false;
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send my inquiry'; }
            });
        }
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (inFlight) return; /* double-click / double-Enter while sending */
          setNote();
          if (!validateForm()) return;
          var inquiry = collectInquiry();
          if (!configured) { showResult(inquiry.first, inquiry.lines, false, false); return; }

          /* Spam guard (browser side): one send per browser per 5 minutes.
             The server enforces the same window, so this is just the
             friendly version — no second POST at all. */
          var lastSent = 0;
          try { lastSent = +localStorage.getItem(CFG.INQUIRY_KEY) || 0; } catch (e) { lastSent = 0; }
          if (Date.now() - lastSent < COOLDOWN_MS) {
            if (note) note.textContent = "Your inquiry is already in. It was sent a few minutes ago — we've got it, and we'll reply from our personal email, usually within two working days.";
            if (note) note.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
          }
          sendInquiry(inquiry);
        });

        document.getElementById('copyBtn').addEventListener('click', function () {
          var text = document.getElementById('resultText').textContent;
          var msg = document.getElementById('copiedMsg');
          function done() { msg.textContent = 'Copied \u2713'; setTimeout(function () { msg.textContent = ''; }, 3000); }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { fallback(); });
          } else fallback();
          function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { msg.textContent = 'Select the text above and copy it manually.'; }
            document.body.removeChild(ta);
          }
        });

        document.getElementById('dlBtn').addEventListener('click', function () {
          var text = document.getElementById('resultText').textContent;
          var blob = new Blob([text], { type: 'text/plain' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'whenwhere-drone-show-inquiry.txt';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
        });
      })();

      (function () {
        /* Mobile nav: hamburger toggle. */
        var btn = document.querySelector('.nav-toggle');
        var links = document.getElementById('navLinks');
        if (!btn || !links) return;
        function setOpen(open) {
          links.classList.toggle('open', open);
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        btn.addEventListener('click', function () { setOpen(!links.classList.contains('open')); });
        links.addEventListener('click', function (ev) { if (/** @type {HTMLElement} */ (ev.target).closest('a')) setOpen(false); });
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') setOpen(false); });
        window.addEventListener('resize', function () { if (window.innerWidth > 620) setOpen(false); });
      })();

      /* ============ Site content (Sheets-backed) ============
         Editable text and images live in a Google Sheet (CFG.CONTENT_CSV_URL,
         published to web as CSV, columns: key | text | image | alt) or, as a
         fallback, in content.json beside this page. Elements tagged with
         data-content="key" get their text replaced; <img> tags with
         data-content-img="key" get src/alt replaced. The hardcoded HTML is
         the fallback — if neither source loads, the page is unchanged.
         HTML_KEYS are the few values that keep markup (hero headline, etc.)
         and are set with innerHTML; everything else uses textContent.
         Blank cells are ignored, so a half-filled Sheet never wipes text. */
      (function () {
        var HTML_KEYS = { 'hero-headline': true, 'form-label-phone': true, 'form-contact': true };
        /**
         * Parses the content Sheet's CSV (RFC 4180: quoted fields, embedded
         * commas, "" escapes, newlines, CRLF, BOM strip).
         * @param {string} text - the raw CSV.
         * @returns {string[][]} the rows (header first).
         */
        function parseCSV(text) {
          var rows = [], row = [], field = '', inQ = false;
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          for (var i = 0; i < text.length; i++) {
            var c = text[i], n = text[i + 1];
            if (inQ) {
              if (c === '"' && n === '"') { field += '"'; i++; }
              else if (c === '"') inQ = false;
              else field += c;
            } else if (c === '"') inQ = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
              if (c === '\r' && n === '\n') i++;
              row.push(field); field = '';
              if (row.length > 1 || row[0] !== '') rows.push(row);
              row = [];
            } else field += c;
          }
          row.push(field);
          if (row.length > 1 || row[0] !== '') rows.push(row);
          return rows;
        }
        /**
         * Turns CSV rows into the content map (key -> {text, image, alt}),
         * skipping the header and blank keys.
         * @param {string[][]} rows - the parsed CSV rows.
         * @returns {Object.<string, ContentItem>} the content map.
         */
        function mapFromRows(rows) {
          /** @type {Object.<string, ContentItem>} */
          var map = {};
          rows.forEach(function (r, idx) {
            if (idx === 0) return; /* header: key,text,image,alt */
            var key = (r[0] || '').trim();
            if (!key) return;
            map[key] = {
              text: (r[1] || '').trim(),
              image: (r[2] || '').trim(),
              alt: (r[3] || '').trim()
            };
          });
          return map;
        }
        /**
         * Applies the content map to the page: text via textContent
         * (innerHTML for HTML_KEYS), images via src/alt. Blank values are
         * ignored, so a half-filled Sheet never wipes text.
         * @param {Object.<string, ContentItem>} map - the content map.
         */
        function applyContent(map) {
          if (!map) return;
          var els = document.querySelectorAll('[data-content]');
          for (var i = 0; i < els.length; i++) {
            var el = els[i], k = el.getAttribute('data-content'), item = map[k];
            if (!item || !item.text) continue;
            if (HTML_KEYS[k]) el.innerHTML = item.text;
            else el.textContent = item.text;
          }
          var imgs = document.querySelectorAll('[data-content-img]');
          for (var j = 0; j < imgs.length; j++) {
            var im = imgs[j], it = map[im.getAttribute('data-content-img')];
            if (!it) continue;
            if (it.image) im.setAttribute('src', it.image);
            if (it.alt) im.setAttribute('alt', it.alt);
          }
        }
        function loadJSON() {
          return fetch('content.json', { cache: 'no-store' }).then(function (res) {
            if (!res.ok) throw new Error('content.json missing');
            return res.json();
          });
        }
        function run() {
          var url = (CFG.CONTENT_CSV_URL || '').trim();
          if (url) {
            fetch(url, { cache: 'no-store' }).then(function (res) {
              if (!res.ok) throw new Error('content CSV failed');
              return res.text();
            }).then(function (text) { applyContent(mapFromRows(parseCSV(text))); })
            .catch(function () { loadJSON().then(applyContent).catch(function () {}); });
          } else {
            loadJSON().then(applyContent).catch(function () {});
          }
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
        else run();
      })();

      /* Hero starfield — the Formation Studio's twinkling background,
         adapted for the hero. Same sky (#03040d) and the same pale-blue
         stars (#cdd8ff) that twinkle at .35 + .3*sin(t*1.4 + phase).
         Draws once and stays still under prefers-reduced-motion, and
         pauses while the hero is scrolled out of view. */
      (function () {
        var canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('heroStars'));
        var hero = canvas && canvas.closest('.hero');
        if (!canvas || !hero) return;
        var ctx = canvas.getContext('2d');
        var stars = [];
        var raf = 0;
        var start = performance.now();
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        function build() {
          var w = hero.clientWidth, h = hero.clientHeight;
          if (!w || !h) return;
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          stars = [];
          var n = Math.max(60, Math.round(w * h / 5200));
          for (var i = 0; i < n; i++) {
            stars.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + .3, p: Math.random() * Math.PI * 2 });
          }
        }
        function paint(now) {
          var w = hero.clientWidth, h = hero.clientHeight;
          var t = (now - start) / 1000;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = '#03040d';
          ctx.fillRect(0, 0, w, h);
          for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            ctx.globalAlpha = .35 + .3 * Math.sin(t * 1.4 + s.p);
            ctx.fillStyle = '#cdd8ff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        function frame(now) {
          paint(now);
          raf = requestAnimationFrame(frame);
        }
        function startLoop() {
          if (reduced) { paint(start); return; }
          if (!raf) raf = requestAnimationFrame(frame);
        }
        function stopLoop() {
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
        }
        var resizeTimer = 0;
        window.addEventListener('resize', function () {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function () { build(); if (reduced) paint(start); }, 200);
        });
        if ('IntersectionObserver' in window) {
          new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting) startLoop(); else stopLoop();
          }).observe(hero);
        } else {
          startLoop();
        }
        build();
        if (reduced) paint(start);
      })();
