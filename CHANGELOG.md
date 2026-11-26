# Changelog

All notable changes to the WhenWhere drone light shows page, one line
per shipped change. To release a new version, bump the version comment
at the top of `index.html` and add a section below.

## Mobile hero padding — 2026-11-26 (no version bump)

- 2026-11-26 — The hero ran flush to the viewport edges on narrow
  screens: `.hero-in`'s `padding:110px 0 84px` (and the ≤620px rule's
  `padding:72px 0 60px`) overrode `.wrap`'s 20px side padding, so at
  390px the kicker, headline, subtext, buttons and chips all started
  at x=0. Measured live at 390px (kicker x=0, width 390) before the
  fix; both rules now carry 20px horizontal padding
  (`110px 20px 84px` / `72px 20px 60px`), matching the rest of the
  page. After the fix the kicker sits at x=20, width 350, and the
  desktop hero is unchanged (the content area narrows 760→720px,
  imperceptible — `box-sizing: border-box` keeps it centred). The
  mobile hero screenshot in the Screenshots section is re-captured
  with the fix.

## Types — 2026-11-26 (no version bump)

- 2026-11-26 — JSDoc types on `config.js` + `studio.js`, checked by TypeScript (`npx tsc --noEmit`, TypeScript 5.9 as a dev dependency, `tsconfig.json` at the repo root). The page's own shapes are now typedefs at the top of `studio.js` — `Point` (with an optional `c` for the heart colours), `Tuning`, `WordItem`, `Glyph`, `Drone`, `Star`, `Inquiry`, `ContentItem`, plus the `WhenWhereConfig` shape in `config.js` and the `WhenWhereGeometry` / `WhenWhereNS` export shapes — and every pure function carries `@param` / `@returns` (the four that already had JSDoc now use the `Point` typedef). The checker is deliberately not strict: strictNullChecks would flag every `getElementById(...).value` in the DOM wiring, and the value here is catching shape mistakes in the geometry + config, not proving every element exists. No build step and no emit — the `.js` files are still the shipped code, and the check runs in CI alongside the smoke + geometry tests. Four tiny code fixes the checker needed, all behaviour-identical: `config.js` now declares `var WHENWHERE_CONFIG` (a top-level var in a classic script IS a window property) instead of assigning to `window.WHENWHERE_CONFIG`; `thinUniform`'s for-in loop variable is `key`, not `k` (a number elsewhere in the same function); `wordPoints` initialises `items`/`gap`/`totalW` at declaration; and the fleet-count button label writes `String(n)` instead of a bare number. Verified: `tsc --noEmit` clean, and a deliberate `targetMin: "fifty"` is flagged `Type 'string' is not assignable to type 'number'`; geometry 52/52 and the smoke test pass unchanged, no JS errors. No page change. **Fix, same day:** the first cut used `jsconfig.json`, which `tsc` does not pick up on its own — a bare `npx tsc --noEmit` printed the help text and exited 1. Renamed to `tsconfig.json` (with `allowJs: true`, which a tsconfig does not imply the way a jsconfig does), so the bare command now exits 0; README, CHANGELOG and the workflow now name `tsconfig.json`.

## v1.5.1 — 2026-11-25

- 2026-11-25 — 30-day warning on the event date, the same pattern as the main site: a date under 30 days out shows a gold heads-up under the Event date field ("a drone show usually needs at least 30 days to line up permits, airspace and the fleet"). Two drone-specific adaptations: it hides when the flexible-date box is ticked (no date, no warning), and it only shows for dates that pass the 14-day floor — warning on a date the form already rejects would promise a submission that can't go through. It never blocks submission. Verified live in headless Chrome (no date hidden, +20d valid shown and not marked invalid, +34d hidden, +10d below the floor hidden, past hidden, flex hides it and unchecking brings it back, no JS errors).

## v1.5.0 — 2026-11-25

- 2026-11-25 — Multi-slide words: the word box now takes up to 40 characters and splits a message into separate moments, each shown in turn (4s apart, looping, the fleet re-assembling between slides). `+` marks an explicit break — "happy + new year" shows Happy, then New Year; "Will + You + Marry + Me" is four moments. Without `+`, whole words are packed into slides of at most 8 non-space glyphs (the most that still reads at the 100-drone budget — HAPPY NEW is 8), so "Happy New Year" becomes "Happy New" then "Year"; a single long word is its own slide. At most 6 slides. The caption shows which moment is up ("1 of 2"); switching to another shape stops the cycle; a single word behaves exactly as before (no slide count). "Use this design in my inquiry" records the whole message ("HAPPY" then "NEW YEAR" — 2 moments), not just the slide showing. A hint line under the box explains `+` (new content key `word-slides-hint`). The splitter is a pure function (`splitSlides`, exported on `window.WHENWHERE.geometry`) with 7 new geometry assertions (52 total). Verified live in headless Chrome: `+` split, auto-split, loop-back, full message in the inquiry, cycle stops on shape change, single word unchanged, no JS errors.

## v1.4.9 — 2026-11-21

- 2026-11-21 — Site content is now editable from a Google Sheet: every bit of marketing copy (hero, occasions, studio intro, packages, how it works, why drones, FAQ, form labels, footer — 126 text items) and all 7 photos are tagged in `index.html` with `data-content="key"` / `data-content-img="key"`, and a loader at the end of `studio.js` fetches the content and overrides the tagged elements. The source is `CONTENT_CSV_URL` in `config.js` (a Sheet published as CSV, columns `key | text | image | alt`); when it is blank the page reads `content.json` beside the page instead. The hardcoded HTML stays as the fallback and blank cells are ignored, so the page is unchanged if the Sheet is unreachable and a half-filled Sheet never wipes text. A few rows keep markup (the hero headline, the phone label, the "Questions first?" line) and must keep their tags when edited. `docs/content.csv` is the current Sheet contents (133 rows). The CSP's `connect-src` now also allows `'self'` (for `content.json`) and `https://docs.google.com` (for the Sheet CSV) — without those the fetch was blocked. Not in the Sheet: nav labels, the shape buttons and drone counts (driven by `FLEET`), the submit button and form note (set by the form's mode), the result panel, validation messages, and the checkbox/radio option labels (they contain the inputs). Verified by loading the page three ways: the `content.json` fallback renders the original copy, a changed `content.json` overrides text/image/alt/HTML, and a changed CSV (including a value with a comma and an embedded quote) overrides the same. Geometry tests pass unchanged (45/45); `build.py --check` passes.
- 2026-11-21 — The content Sheet is connected: `CONTENT_CSV_URL` in `config.js` now holds the published Sheet CSV link. The published URL 307-redirects to a per-document `doc-*-sheets.googleusercontent.com` host, which the CSP blocked (the page silently fell back to `content.json`); `connect-src` now allows `https://*.googleusercontent.com`, which also covers the Apps Script host. Verified live: the page fetches the Sheet CSV and never touches `content.json`.

## v1.4.8 — 2026-11-20

- 2026-11-20 — Readability Lab: a standalone diagnostic page at `tools/readability-lab.html` (public at `/tools/readability-lab.html` once deployed — the deploy ships the whole repo). It drives the real page through a hidden iframe, so every render uses the live `wordPoints` pipeline: font (12 sampled faces), type size, dots per glyph, minimum dot gap, sampling step (2/4px) and raster threshold controls, an A–Z + 0–9 live grid with per-letter spacing coloured against the 25px floor, and a word preview with the drone count, floor total and margin. Serve the repo over HTTP to use it — `file://` blocks the iframe.
- 2026-11-20 — `studio.js`: the word-pipeline tuning is hoisted into `window.WHENWHERE.tuning` (font, weight, size, perGlyph, minGap, sampleStep, threshold), read live by `wordPoints`; `glyphSkeleton(ch, size)` is factored out of `wordPoints` and exposed on the geometry export. No behaviour change — the defaults are the shipped values and the geometry tests pass unchanged (45/45).

## Docs — 2026-11-20 (no version bump)

- 2026-11-20 — The word readability floor is now recorded in `docs/readability-floor.md` (with the probe renders in `docs/readability-floor/`): 25px spacing is the minimum at which a letter still reads (30px loses short features, 40px breaks letters), with a per-letter table for all A–Z + 0–9 (I needs 5 dots, Q needs 20) and per-word totals showing the 100-drone budget clears the floor for every probed word but only buys the dense 15px level for words of 4 glyphs or fewer. No page change.
- 2026-11-20 — README refresh: the hero still (`docs/screenshots/hero.jpg`) is re-captured from the current page at 1280×900 in dark mode, so it shows the themed scrollbar (v1.4.1) instead of the old default one; the Configuration and form-setup sections now point at `config.js` (where `WHENWHERE_CONFIG` has lived since v1.4.3, not `studio.js`); the file tree says 45 geometry assertions, not 26; the Description lists `config.js` with current file sizes; and the LOVE split in the v1.4.6/v1.4.7 entries is corrected to 16/38/22/24 (the E share was misstated as 25). No page change.
- 2026-11-20 — Formation stills re-captured from the current page (`docs/screenshots/formation-{hearts,finale,love}.png`, figure box at 1280×900 in dark mode, reduced motion): LOVE now shows the skeleton rendering (v1.4.0+, 2px sampling) instead of the pre-skeleton filled version from Nov 12; hearts and finale re-captured for a consistent set (their geometry is unchanged — the finale at 240 is byte-identical since v1.4.2). The assembly GIF was reviewed and is current (same hearts, same animation). No page change.
- 2026-11-20 — The grand finale is now a GIF (`docs/screenshots/formation-finale.gif`, 15 frames, 640×459), replacing the still, so the README shows its rotation (0.15 rad/s; the 12 spikes sweep ~26° over the 3s clip). Captured with `tests/capture-assembly.mjs finale … 3000` — the 3000ms settle waits for the assembly to finish first. The capture script gained that optional settle delay plus a readiness wait (it now waits for `window.WHENWHERE.geometry` before clicking) and a fail-loud check that the requested shape actually activated: the first finale attempt silently captured the hearts, because the click fired before studio.js attached its listeners and the hearts are the default. No page change.

## Backend — 2026-11-25 (no version bump)

- 2026-11-25 — The visitor now gets a confirmation email ("Thanks — your drone light show inquiry is in"), the same pattern as the main site's R39: `SEND_CONFIRMATION` (on by default) sends it via a pure `buildConfirmEmail(email, fields, dream)` — same Night & Gold wrapper and field rows as the notification, no Sheet link (owner-only), promising a personal reply usually within two working days (the pipeline doc's stated aim), with the "nothing else is coming unless you ask" disclaimer. The confirmation goes FIRST, then the notification; both are best-effort (a mail failure is logged, never fails a saved inquiry); deduped repeats return `ok` before any mail is sent, so nobody gets a second confirmation; a leftover placeholder `NOTIFY_EMAIL` is never mailed to. Verified by a Node mock harness (25 checks): row + both emails in order, dedup, the off-switch, mail failure, placeholder guard, HTML escaping. No page change; re-paste + redeploy the Apps Script as a new version for it to take effect.

## Test harness — 2026-11-25 (no version bump)

- 2026-11-25 — The smoke test's `'E + J': 75` expectation went stale with v1.5.0: `+` now splits a message into separate moments, so the first slide ("E") shows 50 drones, not 75. The space-gap count test moves to `'A B C': 75` (3 glyphs, no `+`), and a new multi-slide check asserts `'E + J'` shows "50 drones" with a "(1 of 2)" caption. Verified over HTTP with the proxy (the file:// run flakes on this box when Google Fonts hangs and studio.js hasn't run before the clicks fire — all counts read empty; that is the known environmental flake, not a code failure). No page change.

## Backend — 2026-11-20 (no version bump)

- 2026-11-20 — The notification email now links back to the Sheet: both the plain-text and HTML bodies end with a "View all inquiries in the private Sheet" link that opens the spreadsheet at the Inquiries tab (`#gid=`), so one click shows the full history around the row that just landed. No page change; re-paste + redeploy the Apps Script as a new version for it to take effect.

## v1.4.7 — 2026-11-20

- 2026-11-20 — Word skeletons are sampled at 2px instead of 4px (`SAMPLE_STEP`, next to `MIN_DOT_GAP` in studio.js): the raster grid is 4x denser, so the thinned centerline follows curves and diagonals more closely — the O reads rounder, the V arms straighter. The dots are 8.4px wide with a 12px glow, so the gain is subtle rather than dramatic; the measured cost is ~2ms per keystroke (MARRY ME 5.7 → 7.5ms median) and every other metric is unchanged (LOVE still 16/38/22/24, closest pair 10.48px, IW 10/40, MARRY ME gaps 104/61). All 45 geometry assertions pass with no threshold changes.

## Test harness — 2026-11-20 (no version bump)

- 2026-11-20 — The geometry test went red in CI on teardown: `child.kill('SIGKILL')` returns at once, and the recursive remove of the temp Chrome profile ran while the browser was still shutting down, failing with ENOTEMPTY — before the run could report pass or fail. Cleanup now waits for the browser process to exit (5s cap as a backstop), retries the remove, and warns instead of failing if a temp profile still can't be removed. Same fix in the smoke test, which shared the pattern. The page itself is unchanged.

## v1.4.6 — 2026-11-19

- 2026-11-19 — Word density + separation: the dot budget is now split across glyphs in proportion to their stroke lengths (`allocateCounts`, by skeleton pixel count) instead of equally, so a wide letter gets more drones than a narrow one — LOVE goes from 25/25/25/25 to 16/38/22/24 and every glyph sits at ~11px spacing. Dots are then pushed apart to a 10.5px minimum gap (`separatePoints`, 2.5x the 4.2px drone radius, repeated until settled), so the packed L stem and the V-arm clumps open up; LOVE's closest pair went from 8px to 10.45px. No behavior change to counts (still exactly 50–100) or to the space gap. Geometry tests 36 → 45: the MARRY ME gap test now finds the gap as the largest jump in sorted x (glyph boundaries move with the split), plus allocateCounts / separatePoints / IW-split / LOVE-minimum-distance assertions, with thresholds probed in both fonts (Marcellus and the fallback serif).

## v1.4.5 — 2026-11-19

- 2026-11-19 — Clicking (or tabbing) into the Your-words box now activates the Your words shape the same way clicking its button would, so the visitor sees their text right away instead of typing into a box that does nothing until the button is picked. Clicking in while the shape is already active does nothing extra — no re-draw.

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
