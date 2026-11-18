/* WhenWhere drone light shows — page JavaScript (Formation Studio, inquiry form,
   package shortcuts, mobile nav). Extracted from index.html 2026-11-18: the page
   carries no inline executable scripts, so script-src 'self' holds. */
      /* ============ Config: the thing to set before launch ============ */
      var WHENWHERE_CONFIG = {
        // Deployed Apps Script Web app URL (see README.md).
        // Leave blank to keep the copy/download fallback (demo mode).
        INQUIRY_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxGXFDzmwqyUB3vUu-pex2y6VfSR27AMCUbZffagkcWP0SiOaI_IUml0viK1ScUeOE1/exec'
      };
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

        var COLORS = ['#ffd166', '#8fd8ff', '#ff7d9c', '#7dffcb', '#c9a7ff', '#ffffff', '#ffb36b'];
        var FLEET = { heart: 80, rings: 100, glass: 60, star: 200, finale: 240 };
        var PALETTES = {
          heart: ['#ff7d9c', '#ff4d6d', '#ffb3c1', '#ffffff'],
          rings: ['#ffd166', '#e3b356', '#fff3c4', '#ffffff'],
          glass: ['#8fd8ff', '#bfe9ff', '#ffffff', '#7dffcb'],
          star: ['#ffd166', '#ff7d9c', '#8fd8ff', '#ffffff'],
          word: ['#ffd166', '#ffffff', '#e3b356'],
          finale: ['#ffd166', '#ff7d9c', '#8fd8ff', '#ffffff']
        };

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
          var pts = circlePts(cx, cy, 175, 95).concat(circlePts(cx, cy, 118, 65));
          pts = pts.concat(circlePts(cx, cy, 15, 8));
          for (var k = 0; k < 12; k++) {
            var a = k*Math.PI/6 - Math.PI/2;
            for (var j = 0; j < 6; j++) {
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
        // One character at a time, each rastered on a tight canvas just big
        // enough for the glyph (not the full 900x520 stage): wordPoints runs
        // on every keystroke, and a full-stage canvas per character was ~2MB
        // of allocation per keystroke for a 4-letter word. The glyph is drawn
        // centered, so points translate back by the same offset.
        /** Points for a word, rastered one character at a time on tight per-glyph canvases and thinned to the stroke centerline.
            @param {string} text - the word to draw; spaces are kept as gaps (they take no drones).
            @returns {Array<{x: number, y: number}>} exactly target points (25 per glyph, clamped 50-100); each glyph is thinned to its skeleton, so the drones trace the letter one drone wide; the type is the largest bold size that fits the 900px stage (190px down to a 60px floor); [] for empty or whitespace-only text. */
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
          var per = Math.floor(target / chars.length), extra = target - per * chars.length;
          var pts = [], gi = 0;
          items.forEach(function (it) {
            if (it.space) { x += it.w + gap; return; }
            var idx = gi++;
            var n = per + (idx < extra ? 1 : 0);
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
              // Binary grid at the 4px sampling step, with a zero border
              // (the glyph is centered with padding, so the outer ring is
              // empty and the thinning has a border to stop at).
              var gw = Math.floor((tw - 4) / 4) + 1, gh = Math.floor((th - 4) / 4) + 1;
              var grid = [];
              for (var gy = 0; gy < gh + 2; gy++) grid.push(new Array(gw + 2).fill(0));
              for (var y = 4; y < th; y += 4) for (var xx = 4; xx < tw; xx += 4) {
                if (img[(Math.floor(y) * tw + Math.floor(xx)) * 4 + 3] > 110) grid[Math.floor((y - 4) / 4) + 1][Math.floor((xx - 4) / 4) + 1] = 1;
              }
              skeletonize(grid);
              for (var sy = 1; sy < gh + 1; sy++) for (var sx = 1; sx < gw + 1; sx++) {
                if (grid[sy][sx]) cp.push({ x: (sx - 1) * 4 + 4, y: (sy - 1) * 4 + 4 });
              }
            }
            var thinned = thinUniform(cp, n);
            var cx = x + it.w / 2;
            thinned.forEach(function (p) { pts.push({ x: p.x - tw / 2 + cx, y: p.y - th / 2 + H / 2 }); });
            x += it.w + gap;
          });
          return pts;
        }

        var drones = [], targets = [], startTime = 0, currentName = '';
        // Drone reuse: drones that already exist morph from their current position; new ones rise from below the canvas.
        function setFormation(pts, name, palette) {
          targets = pts;
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
          if (!reduced) requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
        setFormation(SHAPES.heart.points(FLEET.heart), SHAPES.heart.name, PALETTES.heart);
        // Fleet counts on the buttons come from FLEET, not from hardcoded
        // HTML, so the button labels can never drift from the real counts.
        document.querySelectorAll('[data-fleet]').forEach(function (el) {
          var n = FLEET[el.getAttribute('data-fleet')];
          if (typeof n === 'number') el.textContent = n;
        });

        var wordInput = document.getElementById('customWord');
        document.querySelectorAll('.shape-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            document.querySelectorAll('.shape-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var key = btn.getAttribute('data-shape');
            if (key === 'word') {
              var w = (wordInput.value || 'LOVE').toUpperCase();
              setFormation(wordPoints(w), '“' + w + '” — your words in the sky', PALETTES.word);
            } else {
              setFormation(SHAPES[key].points(FLEET[key]), SHAPES[key].name, PALETTES[key]);
            }
          });
        });
        wordInput.addEventListener('input', function () {
          var btn = document.getElementById('wordBtn');
          if (btn.classList.contains('active')) {
            var w = (wordInput.value || ' ').toUpperCase();
            if (w.trim()) setFormation(wordPoints(w), '“' + w + '” — your words in the sky', PALETTES.word);
            else setFormation([], 'Your words in the sky');
          }
        });
        document.getElementById('useDesignBtn').addEventListener('click', function () {
          if (typeof currentName === 'undefined') return;
          var dream = document.getElementById('inDream');
          var line = 'Design we liked in the Formation Studio: ' + currentName + '. ';
          if (dream.value.indexOf(line) === -1) dream.value = (dream.value ? dream.value.replace(/\s+$/, ' ') : '') + line;
          document.getElementById('inquire').scrollIntoView({ behavior: 'smooth' });
          dream.focus();
        });
        // Exposed for tests: the pure geometry, without the DOM.
        window.WHENWHERE = window.WHENWHERE || {};
        window.WHENWHERE.geometry = { resample: resample, resampleRuns: resampleRuns, heartPair: heartPair, thinUniform: thinUniform, wordPoints: wordPoints, skeletonize: skeletonize };
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
      /* Two modes, chosen by WHENWHERE_CONFIG.INQUIRY_ENDPOINT (set at the top of this file):
         configured (endpoint set) - submit POSTs the 12 fields to the Apps Script web app, which
         appends a row to the private Sheet and sends the notification email; the page shows a short
         thank-you. Demo mode (endpoint blank) - no network call; the inquiry text is built in the
         result panel for copy/download instead. A 5-minute localStorage cooldown (wwDroneLastInquiry)
         plus an in-flight guard stop double submits. */
      (function () {
        var form = document.getElementById('inquiryForm');
        var dateInput = document.getElementById('inDate');
        var flexBox = document.getElementById('inFlexDate');
        var note = document.getElementById('formNote');
        var cfg = (typeof WHENWHERE_CONFIG !== 'undefined') ? WHENWHERE_CONFIG : {};
        var endpoint = (cfg.INQUIRY_ENDPOINT || '').trim();
        var configured = !!endpoint;
        var COOLDOWN_MS = 5 * 60 * 1000;
        var inFlight = false;
        var submitBtn = form.querySelector('button[type="submit"]');
        function setNote() {
          if (note) note.textContent = configured
            ? 'Submitting sends your inquiry to WhenWhere. We only use your details to reply about your event.'
            : 'Demo mode: no inquiry endpoint is connected yet, so submitting builds your inquiry below to copy or download. See README.md to connect the inquiry form.';
        }
        setNote();

        // Founding season starts in 2027, and shows still need 14 days' lead time.
        var minDate = new Date(); minDate.setDate(minDate.getDate() + 14);
        var seasonStart = new Date('2027-01-01T00:00:00');
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

        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (inFlight) return; /* double-click / double-Enter while sending */
          setNote();
          var ok = true;
          ok = mark('f-name', !val('inName')) && ok;
          var email = val('inEmail');
          ok = mark('f-email', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) && ok;
          ok = mark('f-type', !val('inType')) && ok;
          var flex = flexBox.checked;
          var dateBad = !flex && (!val('inDate') || val('inDate') < dateInput.min);
          ok = mark('f-date', dateBad) && ok;
          if (!ok) { var bad = document.querySelector('.field.invalid input, .field.invalid select'); if (bad) bad.focus(); return; }

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

          if (!configured) { showResult(first, lines, false, false); return; }

          /* Spam guard (browser side): one send per browser per 5 minutes.
             The server enforces the same window, so this is just the
             friendly version — no second POST at all. */
          var lastSent = 0;
          try { lastSent = +localStorage.getItem('wwDroneLastInquiry') || 0; } catch (e) { lastSent = 0; }
          if (Date.now() - lastSent < COOLDOWN_MS) {
            if (note) note.textContent = "Your inquiry is already in. It was sent a few minutes ago — we've got it, and we'll reply from our personal email, usually within two working days.";
            if (note) note.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
          }

          /* Live mode: POST to the Apps Script endpoint, which appends a row
             to the private Sheet and emails a notification. Replies come
             from our personal email. */
          inFlight = true;
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }
          var params = new URLSearchParams();
          params.set('name', val('inName')); params.set('email', email);
          params.set('phone', val('inPhone')); params.set('type', val('inType'));
          params.set('date', dateStr); params.set('venue', val('inVenue'));
          params.set('guests', val('inGuests')); params.set('budget', val('inBudget'));
          params.set('pkg', pkg); params.set('dream', val('inDream'));
          params.set('stage', stage); params.set('surprise', surprise);
          fetch(endpoint, { method: 'POST', body: params })
            .then(function (res) { if (!res.ok) throw new Error('send failed'); return res.text(); })
            .then(function () {
              try { localStorage.setItem('wwDroneLastInquiry', String(Date.now())); } catch (e) {}
              showResult(first, lines, true, false);
            })
            .catch(function () { showResult(first, lines, false, true); })
            .finally(function () {
              inFlight = false;
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send my inquiry'; }
            });
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
