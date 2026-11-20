/* WhenWhere drone light shows — page JavaScript (Formation Studio, inquiry form,
   package shortcuts, mobile nav). Extracted from index.html 2026-11-18: the page
   carries no inline executable scripts, so script-src 'self' holds. */
      /* ============ Config ============ */
      // The launch settings live in config.js, loaded before this file:
      // endpoint, fleet counts, palettes, cooldown, earliest date. This
      // file holds the machinery and has no defaults for them — if
      // config.js is missing, fail loudly instead of rendering with
      // stale numbers.
      var CFG = window.WHENWHERE_CONFIG;
      if (!CFG) throw new Error('WHENWHERE_CONFIG is missing — config.js did not load');
      /* ============ Formation Studio ============ */
      (function () {
        var canvas = document.getElementById('sky');
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
            @param {Array<{x: number, y: number}>} pts - points along the contour.
            @param {number} n - how many points to return.
            @returns {Array<{x: number, y: number}>} n points, or [] when the contour has no length or n <= 0. */
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
        function circlePts(cx, cy, r, n, squash) {
          var pts = [];
          for (var i = 0; i < n; i++) { var a = i/n*Math.PI*2 - Math.PI/2; pts.push({ x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r*(squash||1) }); }
          return pts;
        }
        function heartDense(cx, cy, s) {
          var tip = { x: cx, y: cy + s * .85 };
          var dense = cubic(tip, {x:cx-s*1.5,y:cy-s*.1}, {x:cx-s*.75,y:cy-s*1.15}, {x:cx,y:cy-s*.35}, 48);
          dense = dense.concat(cubic({x:cx,y:cy-s*.35}, {x:cx+s*.75,y:cy-s*1.15}, {x:cx+s*1.5,y:cy-s*.1}, tip, 48).slice(1));
          return dense;
        }
        function runLen(r) { var L = 0; for (var i = 1; i < r.length; i++) L += Math.hypot(r[i].x-r[i-1].x, r[i].y-r[i-1].y); return L; }
        /** Resample without interpolating across a break: split the contour into runs, share dots by run length.
            @param {Array<{x: number, y: number}>} pts - contour points; a jump over 25px between consecutive points starts a new run.
            @param {number} n - total points wanted across all runs.
            @returns {Array<{x: number, y: number}>} n points, none interpolated across a break; falls back to resample() when there are no runs. */
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
            @returns {Array<{x: number, y: number}>} n points (left heart + right heart); the under-heart alternates at each crossing, and the crossings are real gaps, not interpolated dots. */
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
        function glassPts(n) {
          var P = function (x, y) { return { x: W*x, y: H*y }; };
          var dense = [P(.40,.10), P(.60,.10)];
          dense = dense.concat(cubic(P(.60,.10), P(.60,.34), P(.55,.44), P(.52,.47), 32).slice(1));
          dense = dense.concat([P(.52,.78), P(.60,.78), P(.60,.86), P(.40,.86), P(.40,.78), P(.48,.78), P(.48,.47)]);
          dense = dense.concat(cubic(P(.48,.47), P(.45,.44), P(.40,.34), P(.40,.10), 32).slice(1));
          return resample(dense, n);
        }
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
        function ringsPts(n) {
          var per = Math.floor((n - 12) / 2);
          var pts = circlePts(W*.42, H*.52, 105, per).concat(circlePts(W*.58, H*.52, 105, n - 12 - per));
          var gx = W*.58, gy = H*.52 - 105 - 30;
          var gem = [{x:gx,y:gy-30},{x:gx+26,y:gy},{x:gx,y:gy+30},{x:gx-26,y:gy},{x:gx,y:gy-30}];
          return pts.concat(resample(gem, 12));
        }
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
          for (var k in cells) out.push(cells[k].p);
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
        // Dots closer than this merge into one smear: 2.5x the 4.2px
        // drone radius used in draw(). separatePoints enforces it.
        var MIN_DOT_GAP = 10.5;
        // Raster sampling step for wordPoints, in px: the glyph is
        // sampled into a binary grid every SAMPLE_STEP px, then thinned
        // to its stroke centerline. Smaller step = finer skeleton and
        // straighter diagonals, at ~4x the grid per halving (2px costs
        // ~2ms more per keystroke than the original 4px).
        var SAMPLE_STEP = 2;
        // Splits a dot budget across glyphs in proportion to their stroke
        // lengths (skeleton pixel counts), so a wide letter gets more
        // drones than a narrow one and the density stays even across the
        // word. Returns shares that sum exactly to total: a glyph with
        // any stroke gets at least 1 dot (it never silently vanishes),
        // a glyph with no stroke gets 0, and the leftover from rounding
        // goes to the largest remainders.
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
        // enough for the glyph (not the full 900x520 stage): wordPoints runs
        // on every keystroke, and a full-stage canvas per character was ~2MB
        // of allocation per keystroke for a 4-letter word. The glyph is drawn
        // centered, so points translate back by the same offset.
        /** Points for a word, rastered one character at a time on tight per-glyph canvases and thinned to the stroke centerline.
            @param {string} text - the word to draw; spaces are kept as gaps (they take no drones).
            @returns {Array<{x: number, y: number}>} exactly target points (clamped 50-100), split across glyphs in proportion to their stroke lengths, with dots kept at least the minimum gap apart; each glyph is thinned to its skeleton, so the drones trace the letter one drone wide; the type is the largest bold size that fits the 900px stage (190px down to a 60px floor); [] for empty or whitespace-only text. */
        function wordPoints(text) {
          var chars = text.replace(/\s/g, '').split('');
          if (!chars.length) return [];
          var target = Math.max(50, Math.min(100, chars.length * 25));
          var mc = document.createElement('canvas').getContext('2d');
          // Layout items: one per character of the original text, so a
          // space keeps its place as a gap instead of vanishing (it takes
          // no drones). Measure at 190px, then shrink the type until the
          // whole phrase fits the stage — short words stay big, long words
          // shrink instead of running off the edges.
          var MAXW = W - 40;
          var size = 190;
          var items, gap, totalW;
          function measure() {
            mc.font = '700 ' + size + 'px Marcellus, Georgia, serif';
            gap = size * .18;
            var spaceW = mc.measureText(' ').width;
            items = text.split('').map(function (c) {
              return /\s/.test(c) ? { space: true, w: spaceW } : { c: c, w: mc.measureText(c).width };
            });
            totalW = items.reduce(function (a, it) { return a + it.w; }, 0) + gap * (items.length - 1);
          }
          measure();
          while (totalW > MAXW && size > 60) {
            size = Math.max(60, Math.floor(size * MAXW / totalW));
            measure();
          }
          var x = W / 2 - totalW / 2;
          // Pass 1: rasterize + skeletonize every glyph, keeping its
          // stroke length (the skeleton pixel count) for the split.
          var glyphs = [];
          items.forEach(function (it) {
            if (it.space) { x += it.w + gap; return; }
            var tw = Math.ceil(it.w) + 16, th = Math.ceil(size * 1.5);
            var off = document.createElement('canvas'); off.width = tw; off.height = th;
            var o = off.getContext('2d');
            o.font = '700 ' + size + 'px Marcellus, Georgia, serif';
            o.textAlign = 'center'; o.textBaseline = 'middle';
            o.fillStyle = '#fff';
            o.fillText(it.c, tw / 2, th / 2 + 6);
            var img = null;
            try { img = o.getImageData(0, 0, tw, th).data; } catch (e) { img = null; }
            var cp = [];
            if (img) {
              // Binary grid at the sampling step, with a zero border
              // (the glyph is centered with padding, so the outer ring is
              // empty and the thinning has a border to stop at).
              var gw = Math.floor((tw - SAMPLE_STEP) / SAMPLE_STEP) + 1, gh = Math.floor((th - SAMPLE_STEP) / SAMPLE_STEP) + 1;
              var grid = [];
              for (var gy = 0; gy < gh + 2; gy++) grid.push(new Array(gw + 2).fill(0));
              for (var y = SAMPLE_STEP; y < th; y += SAMPLE_STEP) for (var xx = SAMPLE_STEP; xx < tw; xx += SAMPLE_STEP) {
                if (img[(Math.floor(y) * tw + Math.floor(xx)) * 4 + 3] > 110) grid[Math.floor((y - SAMPLE_STEP) / SAMPLE_STEP) + 1][Math.floor((xx - SAMPLE_STEP) / SAMPLE_STEP) + 1] = 1;
              }
              skeletonize(grid);
              for (var sy = 1; sy < gh + 1; sy++) for (var sx = 1; sx < gw + 1; sx++) {
                if (grid[sy][sx]) cp.push({ x: (sx - 1) * SAMPLE_STEP + SAMPLE_STEP, y: (sy - 1) * SAMPLE_STEP + SAMPLE_STEP });
              }
            }
            glyphs.push({ cp: cp, cx: x + it.w / 2, tw: tw, th: th });
            x += it.w + gap;
          });
          // Pass 2: split the budget in proportion to stroke length,
          // then thin + separate each glyph to its share.
          var shares = allocateCounts(glyphs.map(function (gl) { return gl.cp.length; }), target);
          var pts = [];
          glyphs.forEach(function (gl, idx) {
            var thinned = separatePoints(thinUniform(gl.cp, shares[idx]), MIN_DOT_GAP);
            thinned.forEach(function (p) { pts.push({ x: p.x - gl.tw / 2 + gl.cx, y: p.y - gl.th / 2 + H / 2 }); });
          });
          return pts;
        }

        var drones = [], startTime = 0, currentName = '';
        // Drone reuse: drones that already exist morph from their current position; new ones rise from below the canvas.
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
        function ease(t) { return 1 - Math.pow(1 - t, 3); }
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
          if (typeof n === 'number') el.textContent = n;
        });

        var wordInput = document.getElementById('customWord');
        // One place that turns the word box into a formation: the
        // shape button, the input listener, and the fonts-ready
        // re-render all call this, so the label can never drift
        // between them. Returns false when there is no word to draw
        // (blank box) instead of drawing anything.
        function drawWord(fallback) {
          var w = (wordInput.value || fallback).toUpperCase();
          if (!w.trim()) return false;
          setFormation(wordPoints(w), '“' + w + '” — your words in the sky', PALETTES.word);
          return true;
        }
        document.querySelectorAll('.shape-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            document.querySelectorAll('.shape-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var key = btn.getAttribute('data-shape');
            if (key === 'word') {
              drawWord('LOVE');
            } else {
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
          var dream = document.getElementById('inDream');
          var line = 'Design we liked in the Formation Studio: ' + currentName + '. ';
          if (dream.value.indexOf(line) === -1) dream.value = (dream.value ? dream.value.replace(/\s+$/, ' ') : '') + line;
          document.getElementById('inquire').scrollIntoView({ behavior: 'smooth' });
          dream.focus();
        });
        // Exposed for tests: the pure geometry, without the DOM.
        window.WHENWHERE = window.WHENWHERE || {};
        window.WHENWHERE.geometry = { resample: resample, resampleRuns: resampleRuns, heartPair: heartPair, thinUniform: thinUniform, wordPoints: wordPoints, skeletonize: skeletonize, finalePts: finalePts, allocateCounts: allocateCounts, separatePoints: separatePoints };
      })();

      /* ============ Package shortcuts ============ */
      document.querySelectorAll('[data-interest]').forEach(function (link) {
        link.addEventListener('click', function () {
          var label = link.getAttribute('data-interest');
          var dream = document.getElementById('inDream');
          if (dream && !dream.value) dream.value = 'Interested in: ' + label + '. ';
          var radios = document.querySelectorAll('input[name="pkg"]');
          radios.forEach(function (r) {
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
        var form = document.getElementById('inquiryForm');
        var dateInput = document.getElementById('inDate');
        var flexBox = document.getElementById('inFlexDate');
        var note = document.getElementById('formNote');
        var endpoint = (CFG.INQUIRY_ENDPOINT || '').trim();
        var configured = !!endpoint;
        var COOLDOWN_MS = CFG.COOLDOWN_MS;
        var inFlight = false;
        var submitBtn = form.querySelector('button[type="submit"]');
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

        function val(id) { return document.getElementById(id).value.trim(); }
        function mark(fieldId, bad) { document.getElementById(fieldId).classList.toggle('invalid', bad); return !bad; }

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

        function validateForm() {
          var ok = true;
          ok = mark('f-name', !val('inName')) && ok;
          var email = val('inEmail');
          ok = mark('f-email', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) && ok;
          ok = mark('f-type', !val('inType')) && ok;
          var flex = flexBox.checked;
          var dateBad = !flex && (!val('inDate') || val('inDate') < dateInput.min);
          ok = mark('f-date', dateBad) && ok;
          if (!ok) { var bad = document.querySelector('.field.invalid input, .field.invalid select'); if (bad) bad.focus(); }
          return ok;
        }
        function collectInquiry() {
          var email = val('inEmail');
          var flex = flexBox.checked;
          var pkg = (form.querySelector('input[name="pkg"]:checked') || {}).value || 'Not specified yet';
          var stage = (form.querySelector('input[name="stage"]:checked') || {}).value || 'Not specified yet';
          var surprise = document.getElementById('inSurprise').checked ? 'Yes' : 'No';
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
        links.addEventListener('click', function (ev) { if (ev.target.closest('a')) setOpen(false); });
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') setOpen(false); });
        window.addEventListener('resize', function () { if (window.innerWidth > 620) setOpen(false); });
      })();
