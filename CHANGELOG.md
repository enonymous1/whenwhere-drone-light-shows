# Changelog

All notable changes to the WhenWhere drone light shows page, one line
per shipped change. To release a new version, bump the version comment
at the top of `index.html` and add a section below.

## v1.2.0 — 2026-11-18

- 2026-11-18 — Studio JavaScript extracted into `studio.js`: the page carries no inline executable script, `studio.js` is checked with `node --check`, and a Content Security Policy (`script-src 'self'`, plus the fonts and Apps Script allowances) is set in the page head. The geometry functions are exposed as `window.WHENWHERE.geometry` for the planned unit tests.
- 2026-11-18 — Geometry unit tests: `tests/geometry.mjs` asserts the pure geometry in headless Chrome (26 assertions, no new dependencies) and runs in CI; mutation-checked against a broken word count and a `resampleRuns` that interpolates across breaks. The hearts cross once in the current layout, not twice as the review guessed — the test asserts the one observed crossing.

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
