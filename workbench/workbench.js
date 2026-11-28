// @ts-check
/* When&Where Formation Workbench — the design tool for customer meetings.
   Loads the shared geometry (../geometry.js) and the launch settings
   (../config.js: FLEET counts + PALETTES), and renders the formations
   on its own canvas with its own controls. No inquiry form, no content
   Sheet — a design tool, not a booking page. The page is unlisted
   (noindex, no link from the site); the "Copy this design" button
   produces the plain-text summary to carry into the inquiry.
   Classic script, no modules; // @ts-check + types.d.ts via the shared
   global scope (the typedefs are declared in geometry.js). */

/** @type {WhenWhereConfig} */
var CFG = window.WHENWHERE_CONFIG;
if (!CFG || !CFG.FLEET || !CFG.PALETTES) {
  throw new Error('workbench.js: WHENWHERE_CONFIG (config.js) is missing or incomplete — load config.js before workbench.js.');
}

/** @type {WhenWhereRulesEffective} */
var RULES = window.WHENWHERE_RULES_EFFECTIVE;
if (!RULES) {
  throw new Error('workbench.js: WHENWHERE_RULES_EFFECTIVE (rules.js) is missing — load rules.js before workbench.js.');
}

(function () {
  var canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('sky'));
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var W = canvas.width, H = canvas.height;
  var nameEl = document.getElementById('shapeName');
  var countEl = document.getElementById('droneCount');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var COLORS = CFG.COLORS;
  var FLEET = CFG.FLEET;
  var PALETTES = CFG.PALETTES;

  // The formation geometry, bound to this canvas (900x732, the same
  // dimensions as the drone page, so a design here is the design there).
  var GEO = WhenWhereGeometry.create(W, H, PALETTES);
  var heartPair = GEO.heartPair, ringsPts = GEO.ringsPts,
      glassPts = GEO.glassPts, starPts = GEO.starPts,
      finalePts = GEO.finalePts, wordPoints = GEO.wordPoints,
      splitSlides = GEO.splitSlides;
  var TUNING = GEO.tuning;

  var SHAPES = {
    heart: { name: 'Interlocking hearts', points: heartPair },
    rings: { name: 'Wedding rings', points: ringsPts },
    glass: { name: 'Wine glass', points: glassPts },
    star: { name: 'Starburst', points: starPts },
    finale: { name: 'Grand finale', points: finalePts }
  };

  // The palette override (null = the formation's own colours). When a
  // palette is chosen it colours every dot, including the hearts —
  // otherwise heartPair's per-point colours (p.c) would win and the
  // picker would look broken on the one formation with two colours.
  /** @type {string[] | null} */
  var paletteOverride = null;

  var drones = [], startTime = 0, currentName = '';
  /**
   * Shows a formation: the drones morph from their current position
   * (new ones rise from below the canvas). A point's own colour
   * (p.c, set by heartPair) wins over the formation palette — unless
   * a palette override is set, which colours every dot.
   * @param {Point[]} pts - the target positions.
   * @param {string} name - the caption (e.g. 'Interlocking hearts').
   * @param {string[]} [palette] - colours to cycle; CFG.COLORS when omitted.
   */
  function setFormation(pts, name, palette) {
    currentName = name;
    // Word-only controls (word style + timing) are only meaningful
    // when the words are the active formation. The shapes are fixed
    // and a shape has one moment, so those sections hide on shapes
    // and show on words. The word input itself stays visible — it is
    // how you switch to words. The settings are preserved while hidden.
    var isWord = false;
    var activeBtn = document.querySelector('.shape-btn.active');
    if (activeBtn) isWord = activeBtn.getAttribute('data-shape') === 'word';
    var wordStyle = document.getElementById('wordStyleBlock');
    var timing = document.getElementById('timingBlock');
    if (wordStyle) wordStyle.hidden = !isWord;
    if (timing) timing.hidden = !isWord;
    nameEl.textContent = name;
    countEl.textContent = pts.length + ' drones — ' + (pts.length > 100 ? 'a larger show; extra lead time to secure additional units' : 'fits our 100-drone opening fleet');
    drones = pts.map(function (p, idx) {
      var old = drones[idx];
      var c;
      if (paletteOverride) c = paletteOverride[idx % paletteOverride.length];
      else c = p.c || (palette || COLORS)[idx % (palette || COLORS).length];
      return {
        sx: old ? old.x : Math.random() * W, sy: old ? old.y : H + 30 + Math.random() * 120,
        x: old ? old.x : Math.random() * W, y: old ? old.y : H + 30,
        tx: p.x, ty: p.y, d: Math.random() * .55, c: c, ph: Math.random() * Math.PI * 2
      };
    });
    startTime = performance.now();
    if (reduced) { drones.forEach(function (d) { d.x = d.tx; d.y = d.ty; }); draw(performance.now()); }
    refreshExportStats();
  }
  /**
   * Cubic ease-out for the morph.
   * @param {number} t - progress 0-1.
   * @returns {number} eased progress 0-1.
   */
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  /**
   * One frame: every drone at its eased position, bobbing and
   * twinkling, on a clean dark sky (no background stars — the
   * formation is the focus here). Runs on requestAnimationFrame via
   * queueDraw() (paused off-screen / under reduced motion).
   * @param {number} now - the animation timestamp in ms.
   */
  function draw(now) {
    ctx.fillStyle = '#03040d'; ctx.fillRect(0, 0, W, H);
    var t = (now - startTime) / 1000;
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
  var skyVisible = true, drawQueued = false;
  /**
   * Schedules the next frame, unless one is already queued, the page
   * prefers reduced motion, or the sky is scrolled out of view.
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

  // Fleet counts on the buttons come from FLEET, not from hardcoded
  // HTML, so the button labels can never drift from the real counts.
  document.querySelectorAll('[data-fleet]').forEach(function (el) {
    var n = FLEET[el.getAttribute('data-fleet')];
    if (typeof n === 'number') el.textContent = String(n);
  });

  // ---- Word cycle (same as the drone page) ----
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
  /**
   * Draws the word in the box (uppercased), splitting it into slides
   * when it needs more than one, and cycling them SLIDE_MS apart.
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
  /**
   * Re-renders the current formation after a control changes it.
   * Words re-run wordPoints (they read TUNING); shapes re-run with
   * their own points and the current palette override.
   */
  function refreshCurrent() {
    var wordBtn = document.getElementById('wordBtn');
    if (wordBtn && wordBtn.classList.contains('active')) { drawWord(' '); return; }
    var active = document.querySelector('.shape-btn.active');
    if (!active) return;
    var key = active.getAttribute('data-shape');
    if (key && key !== 'word') setFormation(SHAPES[key].points(FLEET[key]), SHAPES[key].name, PALETTES[key]);
  }

  // ---- Shape buttons + word input (same as the drone page) ----
  document.querySelectorAll('.shape-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var wasActive = btn.classList.contains('active');
      document.querySelectorAll('.shape-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var key = btn.getAttribute('data-shape');
      if (key === 'word') {
        if (wasActive) wordInput.value = 'LOVE';
        drawWord('LOVE');
      } else {
        stopWordCycle();
        setFormation(SHAPES[key].points(FLEET[key]), SHAPES[key].name, PALETTES[key]);
      }
    });
  });
  wordInput.addEventListener('focus', function () {
    var btn = document.getElementById('wordBtn');
    if (!btn.classList.contains('active')) btn.click();
  });
  wordInput.addEventListener('input', function () {
    var btn = document.getElementById('wordBtn');
    if (btn.classList.contains('active') && !drawWord(' ')) setFormation([], 'Your words in the sky');
  });
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
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      var btn = document.getElementById('wordBtn');
      if (btn && btn.classList.contains('active')) drawWord(' ');
    });
  }

  // ---- Word style controls (the Readability Lab's knobs) ----
  // The 12 sampled faces (see tools/readability-lab.html): the label
  // is the picker text, the stack is what TUNING.font takes, css2 is
  // the Google Fonts query. Fonts load on demand — only the selected
  // face is fetched, and the word re-renders once it arrives.
  var FONTS = [
    { label: 'Marcellus 700', weight: 700, stack: 'Marcellus, Georgia, serif', css2: 'family=Marcellus' },
    { label: 'Inter 800', weight: 800, stack: 'Inter, sans-serif', css2: 'family=Inter:wght@800' },
    { label: 'Archivo Black 400', weight: 400, stack: 'Archivo Black, sans-serif', css2: 'family=Archivo+Black' },
    { label: 'Oswald 700', weight: 700, stack: 'Oswald, sans-serif', css2: 'family=Oswald:wght@700' },
    { label: 'Roboto 900', weight: 900, stack: 'Roboto, sans-serif', css2: 'family=Roboto:wght@900' },
    { label: 'Montserrat 800', weight: 800, stack: 'Montserrat, sans-serif', css2: 'family=Montserrat:wght@800' },
    { label: 'Poppins 700', weight: 700, stack: 'Poppins, sans-serif', css2: 'family=Poppins:wght@700' },
    { label: 'Bebas Neue 400', weight: 400, stack: 'Bebas Neue, sans-serif', css2: 'family=Bebas+Neue' },
    { label: 'Roboto Mono 700', weight: 700, stack: 'Roboto Mono, monospace', css2: 'family=Roboto+Mono:wght@700' },
    { label: 'Space Mono 700', weight: 700, stack: 'Space Mono, monospace', css2: 'family=Space+Mono:wght@700' },
    { label: 'Playfair Display 800', weight: 800, stack: 'Playfair Display, Georgia, serif', css2: 'family=Playfair+Display:wght@800' },
    { label: 'Merriweather 900', weight: 900, stack: 'Merriweather, Georgia, serif', css2: 'family=Merriweather:wght@900' }
  ];
  var fontSelect = /** @type {HTMLSelectElement} */ (document.getElementById('fontSelect'));
  FONTS.forEach(function (f, i) {
    var opt = document.createElement('option');
    opt.value = String(i); opt.textContent = f.label;
    fontSelect.appendChild(opt);
  });
  var fontIdx = 0;
  /**
   * Loads a font face on demand and re-renders the word once it is
   * really loaded. Do not trust fonts.check alone — it can return
   * true while canvas measurements still fall back to Georgia (the
   * lab's font race, 2026-11-20). Poll the FontFaceSet until a face
   * of the family has status 'loaded', re-issuing fonts.load() on
   * every tick.
   * @param {number} i - the index into FONTS.
   */
  function ensureFont(i) {
    var f = FONTS[i];
    var id = 'wb-font-' + f.stack.split(',')[0].replace(/\s+/g, '-');
    if (!document.getElementById(id)) {
      var link = document.createElement('link');
      link.id = id; link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?' + f.css2 + '&display=swap';
      document.head.appendChild(link);
    }
    var tries = 0;
    (function poll() {
      var faces = [];
      document.fonts.forEach(function (face) { if (face.family === f.stack.split(',')[0]) faces.push(face); });
      if (faces.some(function (face) { return face.status === 'loaded'; })) { refreshCurrent(); return; }
      if (tries++ >= 100) { refreshCurrent(); return; }
      document.fonts.load(f.weight + ' ' + TUNING.size + 'px "' + f.stack.split(',')[0] + '"').catch(function () { return null; });
      setTimeout(poll, 100);
    })();
  }
  fontSelect.addEventListener('change', function () {
    fontIdx = Number(fontSelect.value) || 0;
    var f = FONTS[fontIdx];
    TUNING.font = f.stack; TUNING.weight = f.weight;
    ensureFont(fontIdx);
  });
  /**
   * Wires a range slider to a TUNING field: updates the value label
   * and re-renders the word (if active) on every input.
   * @param {string} id - the slider's element id.
   * @param {string} outId - the <output> element id for the value.
   * @param {string} key - the TUNING field to set.
   * @param {function(number): string} fmt - formats the value for the label.
   */
  function bindRange(id, outId, key, fmt) {
    var el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    var out = document.getElementById(outId);
    el.addEventListener('input', function () {
      var v = Number(el.value);
      TUNING[key] = v;
      out.textContent = fmt(v);
      refreshCurrent();
    });
  }
  bindRange('sizeRange', 'sizeVal', 'size', function (v) { return v + 'px'; });
  bindRange('perGlyphRange', 'perGlyphVal', 'perGlyph', function (v) { return String(v); });
  bindRange('minGapRange', 'minGapVal', 'minGap', function (v) { return v + 'px'; });
  bindRange('thresholdRange', 'thresholdVal', 'threshold', function (v) { return String(v); });
  document.getElementById('sampleStep').addEventListener('change', function () {
    var el = /** @type {HTMLSelectElement} */ (document.getElementById('sampleStep'));
    TUNING.sampleStep = Number(el.value) || 2;
    refreshCurrent();
  });

  // ---- Timing + palette ----
  var slideMsRange = /** @type {HTMLInputElement} */ (document.getElementById('slideMsRange'));
  var slideMsVal = document.getElementById('slideMsVal');
  slideMsRange.addEventListener('input', function () {
    SLIDE_MS = Number(slideMsRange.value) * 1000;
    slideMsVal.textContent = slideMsRange.value + 's';
    // Restart the cycle so the new timing takes effect from slide 1.
    refreshCurrent();
  });
  document.getElementById('paletteSelect').addEventListener('change', function () {
    var el = /** @type {HTMLSelectElement} */ (document.getElementById('paletteSelect'));
    var v = el.value;
    paletteOverride = (v === 'default') ? null : (PALETTES[v] || null);
    refreshCurrent();
  });

  // ---- Use this design ----
  var summaryEl = document.getElementById('designSummary');
  var copyNote = document.getElementById('copyNote');
  /**
   * Builds the plain-text design summary: formation, drone count and
   * fleet fit, palette, and — for words — the style knobs, so the
   * design can be carried into the inquiry or a follow-up email.
   * @returns {string} the summary.
   */
  function buildSummary() {
    var lines = ['Formation Workbench — design summary'];
    var wordBtn = document.getElementById('wordBtn');
    var isWord = !!(wordBtn && wordBtn.classList.contains('active') && wordSlides.length);
    if (isWord) {
      lines.push('Formation: ' + (wordSlides.length > 1
        ? '“' + wordSlides.join('” then “') + '” — your words in the sky (' + wordSlides.length + ' moments)'
        : '“' + wordSlides[0] + '” — your words in the sky'));
      lines.push('Font: ' + FONTS[fontIdx].label);
      lines.push('Type size: ' + TUNING.size + 'px');
      lines.push('Drones per letter: ' + TUNING.perGlyph);
      lines.push('Minimum gap: ' + TUNING.minGap + 'px');
      lines.push('Seconds per moment: ' + (SLIDE_MS / 1000) + 's');
    } else {
      lines.push('Formation: ' + currentName);
    }
    var count = drones.length;
    lines.push('Drones: ' + count + ' — ' + (count > 100 ? 'a larger show; extra lead time to secure additional units' : 'fits our 100-drone opening fleet'));
    var paletteEl = /** @type {HTMLSelectElement} */ (document.getElementById('paletteSelect'));
    lines.push('Palette: ' + (paletteEl.options[paletteEl.selectedIndex] ? paletteEl.options[paletteEl.selectedIndex].textContent : 'Formation default'));
    return lines.join('\n');
  }
  document.getElementById('useDesignBtn').addEventListener('click', function () {
    var text = buildSummary();
    summaryEl.textContent = text;
    var done = function () {
      copyNote.textContent = 'Copied — paste it into the inquiry or a follow-up email.';
      setTimeout(function () {
        copyNote.textContent = 'Copies a plain-text summary — paste it into the inquiry or a follow-up email.';
      }, 4000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { done(); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* the panel still shows it */ }
      document.body.removeChild(ta);
      done();
    }
  });

  // ---- Export to Skybrush (.skyc) ----
  var spacingRange = /** @type {HTMLInputElement} */ (document.getElementById('spacingRange'));
  var takeoffSpacingRange = /** @type {HTMLInputElement} */ (document.getElementById('takeoffSpacingRange'));
  var altitudeRange = /** @type {HTMLInputElement} */ (document.getElementById('altitudeRange'));
  var holdRange = /** @type {HTMLInputElement} */ (document.getElementById('holdRange'));
  var exportStatsEl = document.getElementById('exportStats');
  var exportNote = document.getElementById('exportNote');
  // ---- Venue (Google Earth) ----
  // The venue's home position, for the .kmz export. Saved in this
  // browser so it only has to be typed once per venue.
  var VENUE_KEY = 'wwWorkbenchVenue';
  var venueLat = /** @type {HTMLInputElement} */ (document.getElementById('venueLat'));
  var venueLon = /** @type {HTMLInputElement} */ (document.getElementById('venueLon'));
  var venueOrient = /** @type {HTMLInputElement} */ (document.getElementById('venueOrient'));
  var venueOrientVal = document.getElementById('venueOrientVal');
  var exportKmzBtn = /** @type {HTMLButtonElement} */ (document.getElementById('exportKmzBtn'));
  try {
    var savedVenue = JSON.parse(localStorage.getItem(VENUE_KEY) || 'null');
    if (savedVenue) {
      if (typeof savedVenue.latitude === 'number') venueLat.value = String(savedVenue.latitude);
      if (typeof savedVenue.longitude === 'number') venueLon.value = String(savedVenue.longitude);
      if (typeof savedVenue.orientationDegrees === 'number') venueOrient.value = String(savedVenue.orientationDegrees);
    }
  } catch (e) { /* a corrupt saved venue just means empty fields */ }
  venueOrientVal.textContent = venueOrient.value + '°';
  /**
   * The venue as the .kmz exporter takes it, or null when the
   * latitude/longitude are not both valid numbers.
   * @returns {{ latitude: number, longitude: number, orientationDegrees: number } | null} the venue.
   */
  function currentVenue() {
    var lat = Number(venueLat.value);
    var lon = Number(venueLon.value);
    if (!venueLat.value || !venueLon.value || !isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { latitude: lat, longitude: lon, orientationDegrees: Number(venueOrient.value) || 0 };
  }
  function saveVenue() {
    try {
      var v = currentVenue();
      if (v) localStorage.setItem(VENUE_KEY, JSON.stringify(v));
      else localStorage.removeItem(VENUE_KEY);
    } catch (e) { /* storage full or blocked — the fields still work */ }
  }
  function refreshKmzButton() {
    exportKmzBtn.disabled = !currentVenue();
  }
  [venueLat, venueLon].forEach(function (el) {
    el.addEventListener('input', function () { saveVenue(); refreshKmzButton(); });
  });
  venueOrient.addEventListener('input', function () {
    venueOrientVal.textContent = venueOrient.value + '°';
    saveVenue();
  });
  refreshKmzButton();
  /**
   * The formation on screen as design points — each drone's target
   * position and colour. This is what the exporter maps to the sky;
   * the animated positions are not used.
   * @returns {Point[]} the design points.
   */
  function currentDesignPoints() {
    return drones.map(function (d) {
      return { x: d.tx, y: d.ty, c: d.c };
    });
  }
  /**
   * Reads the export settings from the sliders.
   * @returns {import('../types').WhenWhereSkycOptions}
   */
  function exportOptions() {
    return {
      spacing: Number(spacingRange.value),
      takeoffSpacing: Number(takeoffSpacingRange.value),
      altitude: Number(altitudeRange.value),
      holdSeconds: Number(holdRange.value),
      separatePoints: GEO.separatePoints,
    };
  }
  /**
   * Recomputes the derived export numbers (show width and height, the
   * closest pair and the typical spacing) for the formation on screen
   * and shows them under the settings. Runs on every formation change
   * and every slider input, so the numbers always describe what is
   * on the canvas now.
   */
  function refreshExportStats() {
    var pts = currentDesignPoints();
    if (!pts.length) { exportStatsEl.textContent = ''; return; }
    var s = WhenWhereSkyc.buildShow({ name: currentName, points: pts }, exportOptions()).stats;
    var statsText = s.drones + ' drones · ' + s.width + 'm wide · ' + s.height + 'm tall · ' + s.minHeight + '–' + s.maxHeight + 'm above ground · ' + s.gridWidth + 'm × ' + s.gridDepth + 'm takeoff grid · closest pair ' + s.minSpacing + 'm · typical spacing ' + s.medianSpacing + 'm · ' + s.totalSeconds + 's total (30s up · ' + Number(holdRange.value) + 's hold · 30s down)';
    if (s.maxHeight > RULES.maxAltitudeMeters) statsText += ' · ⚠ highest drone above the ' + RULES.maxAltitudeMeters + 'm ceiling';
    if (s.minSpacing < RULES.minDroneDistanceMeters) statsText += ' · ⚠ closest pair below the ' + RULES.minDroneDistanceMeters + 'm minimum';
    exportStatsEl.textContent = statsText;
  }
  function bindExportRange(el, outId, fmt) {
    var out = document.getElementById(outId);
    el.addEventListener('input', function () {
      out.textContent = fmt(Number(el.value));
      refreshExportStats();
    });
  }
  // The rules file owns the limits: the Takeoff spacing slider cannot
  // go below the rules floor, and the tooltips state the ceiling and
  // floor in force (FAA baseline, or a venue override).
  takeoffSpacingRange.min = String(RULES.minTakeoffSpacingMeters);
  if (Number(takeoffSpacingRange.value) < RULES.minTakeoffSpacingMeters) takeoffSpacingRange.value = String(RULES.minTakeoffSpacingMeters);
  var takeoffTip = document.querySelector('label[for="takeoffSpacingRange"] .tip');
  if (takeoffTip) takeoffTip.setAttribute('data-tip', "Spacing between drones on the takeoff grid, on the ground. Independent of the in-air spacing — tighten it to shrink the takeoff zone without changing the picture. Minimum " + RULES.minTakeoffSpacingMeters + "m keeps the grid clear of Skybrush Live's 0.4m outdoor takeoff check.");
  var altitudeTip = document.querySelector('label[for="altitudeRange"] .tip');
  if (altitudeTip) altitudeTip.setAttribute('data-tip', "Height of the picture's centre above the ground. The shape is centred on this height, so the top reaches about half the picture's height above it and the bottom about half below. The stats line below shows the actual lowest and highest drone for this shape. Keep the highest drone under " + RULES.maxAltitudeMeters + "m — that's the ceiling in force" + (RULES.venueName ? " (" + RULES.venueName + ")" : " (FAA Part 107)") + ".");
  bindExportRange(spacingRange, 'spacingVal', function (v) { return v + 'm'; });
  bindExportRange(takeoffSpacingRange, 'takeoffSpacingVal', function (v) { return v + 'm'; });
  bindExportRange(altitudeRange, 'altitudeVal', function (v) { return v + 'm'; });
  bindExportRange(holdRange, 'holdVal', function (v) { return v + 's'; });
  /**
   * Downloads a byte array as a file.
   * @param {Uint8Array<ArrayBuffer>} bytes - the file bytes.
   * @param {string} filename - the download filename.
   */
  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  document.getElementById('exportSkycBtn').addEventListener('click', function () {
    var pts = currentDesignPoints();
    if (!pts.length) return;
    var out = WhenWhereSkyc.exportSkyc({ name: currentName, points: pts }, exportOptions());
    downloadBytes(out.bytes, out.filename);
    exportNote.textContent = 'Exported ' + out.filename + ' — ' + out.stats.drones + ' drones, ' + out.stats.width + 'm wide at ' + Number(altitudeRange.value) + 'm, ' + out.stats.totalSeconds + 's total (30s takeoff from a ' + out.stats.gridCols + '×' + out.stats.gridRows + ' ground grid, ' + out.stats.gridWidth + 'm × ' + out.stats.gridDepth + 'm, ' + Number(holdRange.value) + 's hold, 30s landing).';
  });
  document.getElementById('exportCsvBtn').addEventListener('click', function () {
    var pts = currentDesignPoints();
    if (!pts.length) return;
    var out = WhenWhereSkyc.exportCsv({ name: currentName, points: pts }, exportOptions());
    downloadBytes(out.bytes, out.filename);
    exportNote.textContent = 'Exported ' + out.filename + ' — one CSV per drone (' + out.stats.drones + ' files), Time,x,y,z,R,G,B every second, ' + out.stats.totalSeconds + 's total.';
  });
  document.getElementById('exportKmzBtn').addEventListener('click', function () {
    var pts = currentDesignPoints();
    if (!pts.length) return;
    var venue = currentVenue();
    if (!venue) {
      exportNote.textContent = 'Enter the venue latitude and longitude above to export to Google Earth.';
      return;
    }
    var out = WhenWhereSkyc.exportKmz({ name: currentName, points: pts }, exportOptions(), venue);
    downloadBytes(out.bytes, out.filename);
    exportNote.textContent = 'Exported ' + out.filename + ' — ' + out.stats.drones + ' flight paths at ' + venue.latitude + ', ' + venue.longitude + ', front facing ' + venue.orientationDegrees + '° from North. Open it in Google Earth to check clearances and sightlines.';
  });
  // 3D preview: saves the formation on screen for preview-3d.html
  // (same design + export settings as the .skyc), then opens it.
  // The options are JSON-serialisable — the function-valued
  // separatePoints is dropped by stringify and re-attached by the
  // preview page.
  document.getElementById('preview3dBtn').addEventListener('click', function () {
    var pts = currentDesignPoints();
    if (!pts.length) return;
    try {
      localStorage.setItem('wwPreview3D', JSON.stringify({ design: { name: currentName, points: pts }, options: exportOptions() }));
    } catch (e) { /* storage blocked — the preview falls back to its demo */ }
    window.open('../preview-3d.html', '_blank');
  });

  // Exposed for tests: the pure geometry, without the DOM, plus the
  // workbench's current design state.
  window.WHENWHERE = window.WHENWHERE || /** @type {WhenWhereNS} */ ({});
  window.WHENWHERE.geometry = { resample: GEO.resample, resampleRuns: GEO.resampleRuns, heartPair: GEO.heartPair, thinUniform: GEO.thinUniform, wordPoints: GEO.wordPoints, skeletonize: GEO.skeletonize, finalePts: GEO.finalePts, allocateCounts: GEO.allocateCounts, separatePoints: GEO.separatePoints, glyphSkeleton: GEO.glyphSkeleton, splitSlides: GEO.splitSlides };
  window.WHENWHERE.tuning = GEO.tuning;
  window.WHENWHERE.workbench = {
    get currentName() { return currentName; },
    get wordSlides() { return wordSlides.slice(); },
    get droneCount() { return drones.length; },
    get paletteOverride() { return paletteOverride; },
    get points() { return currentDesignPoints(); }
  };

  // On load: hearts, like the drone page.
  setFormation(SHAPES.heart.points(FLEET.heart), SHAPES.heart.name, PALETTES.heart);
})();
