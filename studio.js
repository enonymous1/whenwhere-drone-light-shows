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
         types.d.ts and are declared (via JSDoc import() typedefs) in
         geometry.js — the files share one global scope, so the names
         are usable here without re-declaring them (declaring them in
         both files is a TS6200 conflict). Point.c is set only by
         heartPair (the two hearts get different colours); everywhere
         else the palette supplies the colour. */
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
        var rulesEl = document.getElementById('skyRules');
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // background stars
        var stars = [];
        for (var i = 0; i < 90; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + .3, p: Math.random() * Math.PI * 2 });

        var COLORS = CFG.COLORS;
        var FLEET = CFG.FLEET;
        var PALETTES = CFG.PALETTES;


        // The formation geometry lives in geometry.js (loaded before this
        // file). Bind it to this canvas and alias the functions the page
        // uses directly, so the rest of this file reads exactly as before.
        var GEO = WhenWhereGeometry.create(W, H, PALETTES);
        var heartPair = GEO.heartPair, ringsPts = GEO.ringsPts,
            glassPts = GEO.glassPts, starPts = GEO.starPts,
            finalePts = GEO.finalePts, wordPoints = GEO.wordPoints,
            splitSlides = GEO.splitSlides;
        var SHAPES = {
          heart: { name: 'Interlocking hearts', points: heartPair },
          rings: { name: 'Wedding rings', points: ringsPts },
          glass: { name: 'Wine glass', points: glassPts },
          star: { name: 'Starburst', points: starPts },
          finale: { name: 'Grand finale', points: finalePts }
        };
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
        /**
         * The compliance line under the canvas: this formation as a
         * real show at the reference scale (3m spacing, 40m centre
         * altitude), checked against the rules in force (rules.js).
         * It uses the same exporter the workbench uses
         * (WhenWhereSkyc.buildShow), so the numbers here and in the
         * workbench can never drift. If rules.js or skyc.js did not
         * load, or the formation is empty, the line stays blank — the
         * animation must never break for a missing compliance readout.
         * @param {Point[]} pts - the formation's target positions.
         * @param {string} name - the formation name.
         */
        function updateRulesLine(pts, name) {
          if (!rulesEl) return;
          rulesEl.textContent = '';
          rulesEl.classList.remove('over');
          if (!pts.length) return;
          var rules = window.WHENWHERE_RULES_EFFECTIVE;
          if (!rules || typeof WhenWhereSkyc === 'undefined') return;
          try {
            var ref = WhenWhereSkyc.buildShow(
              { name: name, points: pts },
              { spacing: 3, takeoffSpacing: 3, altitude: 40, holdSeconds: 30, separatePoints: GEO.separatePoints }
            ).stats;
            var ceiling = rules.maxAltitudeMeters;
            var ceilingLabel = rules.venueName
              ? ceiling + 'm ceiling (' + rules.venueName + ')'
              : ceiling + 'm FAA ceiling';
            var over = ref.maxHeight > ceiling;
            var tight = ref.minSpacing < rules.minDroneDistanceMeters;
            var text = 'Reference show (3m spacing, 40m centre altitude): highest drone ' + ref.maxHeight + 'm, closest pair ' + ref.minSpacing + 'm. ';
            if (over) text += '⚠ Above the ' + ceilingLabel + ' — we would tighten the spacing or lower the altitude for your venue.';
            else text += 'Inside the ' + ceilingLabel + '.';
            if (tight) text += ' Closest pair is below the ' + rules.minDroneDistanceMeters + 'm minimum.';
            rulesEl.textContent = text;
            if (over || tight) rulesEl.classList.add('over');
          } catch (e) {
            rulesEl.textContent = '';
          }
        }
        function setFormation(pts, name, palette) {
          currentName = name;
          nameEl.textContent = name;
          countEl.textContent = pts.length + ' drones — ' + (pts.length > 100 ? 'a larger show; extra lead time to secure additional units' : 'fits our 100-drone opening fleet');
          updateRulesLine(pts, name);
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
        var SLIDE_MS = 4000;
        var wordSlides = [];
        var wordSlideIdx = 0;
        var wordTimer = 0;
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
        window.WHENWHERE.geometry = { resample: GEO.resample, resampleRuns: GEO.resampleRuns, heartPair: GEO.heartPair, thinUniform: GEO.thinUniform, wordPoints: GEO.wordPoints, skeletonize: GEO.skeletonize, finalePts: GEO.finalePts, allocateCounts: GEO.allocateCounts, separatePoints: GEO.separatePoints, glyphSkeleton: GEO.glyphSkeleton, splitSlides: GEO.splitSlides };
        window.WHENWHERE.tuning = GEO.tuning;
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
