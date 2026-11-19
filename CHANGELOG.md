# Changelog

All notable changes to the WhenWhere drone light shows page, one line
per shipped change. To release a new version, bump the version comment
at the top of `index.html` and add a section below.

## v1.4.4 — 2026-11-19

- 2026-11-19 — Readability: the word-rendering call is now one `drawWord(fallback)` helper used by the shape-button click, the input listener, and the fonts-ready re-render, so the label can never drift between them (it returns false on a blank box instead of drawing). The submit handler is split into `validateForm()` (marks fields, focuses the first bad one), `collectInquiry()` (fields + result text + POST params), and `sendInquiry()` (the fetch and the result panel) — the handler itself now reads as validate → collect → cooldown check → send. No behavior change.

## v1.4.3 — 2026-11-19

- 2026-11-19 — Launch settings move to `config.js` (loaded before `studio.js`): the Apps Script endpoint, the fleet counts, the palettes, the re-send cooldown and its localStorage key, and the earliest-date rule (14 days out, never before 2027-01-01). `studio.js` reads them off `window.WHENWHERE_CONFIG` and has no defaults of its own — if `config.js` is missing, the page fails loudly instead of rendering with stale numbers. The algorithmic constants (resample jump, skeleton step, shadowBlur, animation timings, word sizing) stay with their functions in `studio.js`. `tools/build.py` now checks that `config.js` loads before `studio.js`, that the fleet counts live in `config.js`, and runs both files through `node --check`. The Apps Script setup note in `docs/apps-script/Code.gs` now points at `config.js` for the endpoint.

## v1.4.2 — 2026-11-19

- 2026-11-19 — Form verdict is now read from the body, not the status: Apps Script always answers HTTP 200, so `doPost` returns JSON `{"ok":true}` / `{"ok":false,"error":...}` (and `{"ok":true,"duplicate":true}` for a repeat inside the 5-minute window) and the page only shows "thank you" when `ok` is true — a failed `ok` falls through to the copy/download fallback instead of a false success. The client still accepts the old endpoint's plain 'ok' until the script is redeployed.
- 2026-11-19 — Sheets formula injection closed: `doPost` prefixes any value starting with `=`, `+`, `-`, `@`, tab or carriage return with a single quote before `appendRow`, so a hostile dream or name field can't run as a formula in the leads Sheet. (Needs the Apps Script re-paste + redeploy; the page change above is safe to push first.)
- 2026-11-19 — `finalePts(n)` now honors `n` (it always output 240): the count is split across the four parts in the original proportions, remainder to the rays, so the total is exactly `n`.
- 2026-11-19 — `useDesignBtn` guard fixed (`if (!currentName)` — the old `typeof` check could never fire, so an early click appended an empty design line); dead `targets` array removed.
- 2026-11-19 — The word tool re-renders once when the fonts are ready, so typing before Marcellus loads no longer leaves Georgia-shaped dots in place after the font arrives.
- 2026-11-19 — The animation loop now pauses when the canvas scrolls out of view (`IntersectionObserver` + a `queueDraw` guard, so the restart can't start a second loop). `requestAnimationFrame` already pauses when the tab is hidden.
- 2026-11-19 — Geometry tests grow to 36 assertions: three for `finalePts` (240 and 120 return exactly that many points, all inside the canvas).

## v1.4.1 — 2026-11-19

- 2026-11-19 — Themed scrollbar: the browser default is a light track, which stuck out against the Night & Gold page. The track is now the page background, the thumb the muted line color, gold on hover — all variables, so it follows light/dark like the rest (Firefox `scrollbar-color` + WebKit pseudo-elements, 10px).

## v1.4.0 — 2026-11-18

- 2026-11-18 — Word rendering is now a single-line skeleton: each glyph is rastered and thinned to its stroke centerline (Zhang-Suen), so the drones trace the letter one drone wide instead of filling the stroke — the R's finally read as R's, and the font matters less. Counts are unchanged (25 per glyph, clamped 50–100), and the space gap from v1.3.0 is untouched.
- 2026-11-18 — Geometry tests grow to 33 assertions: three for skeletonize itself (a 5×5 block thins to its center pixel, a 3×9 bar to its middle line, a 3×3 block to its center).

## v1.3.0 — 2026-11-18

- 2026-11-18 — Word readability: spaces are now real gaps between words (they take no drones), so "MARRY ME" reads as two words instead of "MARRYME". The type is the largest bold size that fits the 900px stage (190px down to a 60px floor) instead of 190px for 5 characters and 130px beyond — 6–8 letter words render bigger, and a long word shrinks to fit instead of running off the stage. Drone counts are unchanged (25 per glyph, clamped 50–100).
- 2026-11-18 — Geometry tests grow to 30 assertions: a space leaves a word-sized gap between the Y and M clusters of "MARRY ME" (102px vs 45px without the space), and "CONGRATULATIONS" still returns 100 points inside the canvas.

## v1.2.0 — 2026-11-18

- 2026-11-18 — Studio JavaScript extracted into `studio.js`: the page carries no inline executable script, `studio.js` is checked with `node --check`, and a Content Security Policy (`script-src 'self'`, plus the fonts and Apps Script allowances) is set in the page head. The geometry functions are exposed as `window.WHENWHERE.geometry` for the planned unit tests.
- 2026-11-18 — Geometry unit tests: `tests/geometry.mjs` asserts the pure geometry in headless Chrome (30 assertions, no new dependencies) and runs in CI; mutation-checked against a broken word count and a `resampleRuns` that interpolates across breaks. The hearts cross once in the current layout, not twice as the review guessed — the test asserts the one observed crossing.

## v1.1.0 — 2026-11-18

- 2026-11-18 — `index.html` is the source of truth: the ~60 string replacements and the frozen `tools/source.html` upload are gone; `tools/build.py` now only optimizes images and runs the checks.

## v1.0.0 — 2026-11-18

- 2026-11-12 — Initial page: Formation Studio, inquiry form, Night & Gold theme.
- 2026-11-17 — Nav brand left-anchored, links point at the Pages main site, hello@ removed.
- 2026-11-17 — Inquiry form wired to the Apps Script backend (Sheet row + notification email).
- 2026-11-17 — `INQUIRY_ENDPOINT` set to the deployed Apps Script URL.
- 2026-11-17 — Site-review fixes: hidden-input horizontal overflow, calendar wrapping, form validation, images extracted to `assets/`, SEO tags.
- 2026-11-17 — CI smoke-test launch fixed (`CHROME_PATH`); mobile nav links restored.
- 2026-11-17 — Hamburger menu for the mobile nav.
- 2026-11-18 — README hero screenshot re-captured (the old one showed the photo broken); site marked live.
- 2026-11-18 — `REVIEW.md` deleted; its open items moved into the README.
- 2026-11-18 — Five small fixes: canvas guard, clipboard fallback off-screen, clear-word clears the sky, local-time date minimum, `currentName` guard.
- 2026-11-18 — Short thank-you on successful send (details hidden); Inquiries sheet gets a header row.
- 2026-11-18 — Clearer Inquiries headers, matching the form's labels.
- 2026-11-18 — Documentation: form IIFE header comment, `setFormation` comment, JSDoc on the four geometry functions.
- 2026-11-18 — Version + changelog: `<!-- v1.0.0 -->` comment, this file, `--check` and `--help` on the build script.
