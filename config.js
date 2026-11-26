// @ts-check
/* When&Where drone light shows — launch settings.
   This is the one file to edit when the show changes: the form
   endpoint, the fleet counts, the colours, the re-send cooldown,
   and the earliest bookable date. Everything in studio.js is the
   machinery; the numbers below are the show. studio.js reads this
   file (loaded before it) and has no defaults of its own for these
   values — if this file is missing, the page fails loudly instead
   of rendering with stale numbers. */
/**
 * Launch settings for the drone light shows page, read by studio.js
 * via window.WHENWHERE_CONFIG. Declared as a top-level var (a var in a
 * classic script IS a window property), so the checker knows the shape
 * on both sides of the load.
 * @typedef {Object} WhenWhereConfig
 * @property {string} INQUIRY_ENDPOINT - Deployed Apps Script Web app URL ('' = demo mode: copy/download fallback).
 * @property {{heart: number, rings: number, glass: number, star: number, finale: number}} FLEET - Drones per formation.
 * @property {string[]} COLORS - Fallback colours per formation.
 * @property {{heart: string[], rings: string[], glass: string[], star: string[], word: string[], finale: string[]}} PALETTES - Colours per formation.
 * @property {number} COOLDOWN_MS - Re-send cooldown in ms.
 * @property {string} INQUIRY_KEY - localStorage key recording the last send.
 * @property {number} DATE_MIN_DAYS_AHEAD - Earliest bookable date, days out.
 * @property {string} DATE_MIN_FLOOR - Earliest bookable date, ISO floor ('2027-01-01').
 * @property {string} CONTENT_CSV_URL - Published Sheet CSV for site content ('' = content.json fallback).
 */

/** @type {WhenWhereConfig} */
var WHENWHERE_CONFIG = {
  // Deployed Apps Script Web app URL (see README.md).
  // Leave blank to keep the copy/download fallback (demo mode).
  INQUIRY_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxGXFDzmwqyUB3vUu-pex2y6VfSR27AMCUbZffagkcWP0SiOaI_IUml0viK1ScUeOE1/exec',

  // Drones per formation. The buttons and the count labels read
  // these, so they can never drift from the real counts.
  FLEET: { heart: 80, rings: 100, glass: 60, star: 200, finale: 240 },

  // Colours per formation (COLORS is the fallback when a shape has
  // no palette of its own).
  COLORS: ['#ffd166', '#8fd8ff', '#ff7d9c', '#7dffcb', '#c9a7ff', '#ffffff', '#ffb36b'],
  PALETTES: {
    heart: ['#ff7d9c', '#ff4d6d', '#ffb3c1', '#ffffff'],
    rings: ['#ffd166', '#e3b356', '#fff3c4', '#ffffff'],
    glass: ['#8fd8ff', '#bfe9ff', '#ffffff', '#7dffcb'],
    star: ['#ffd166', '#ff7d9c', '#8fd8ff', '#ffffff'],
    word: ['#ffd166', '#ffffff', '#e3b356'],
    finale: ['#ffd166', '#ff7d9c', '#8fd8ff', '#ffffff']
  },

  // Re-send cooldown: one inquiry per browser per 5 minutes (the
  // server enforces the same window; this is the friendly version).
  // INQUIRY_KEY is the localStorage entry that records the last send.
  COOLDOWN_MS: 5 * 60 * 1000,
  INQUIRY_KEY: 'wwDroneLastInquiry',

  // Earliest bookable date: 14 days out, and never before the
  // founding season opens (2027-01-01).
  DATE_MIN_DAYS_AHEAD: 14,
  DATE_MIN_FLOOR: '2027-01-01',

  // Site content (text + images): File > Share > Publish to web > CSV
  // link from the CONTENT Sheet (key | text | image | alt). Leave blank
  // to read content.json beside this page instead.
  CONTENT_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRBNnmT-q8v3IJ_iuMcxVFdJ001to_gjZiFQlxkXo0RDxGOQ2rIryhx3jTOwsY4KB7wcbZlOMw4T0ZD/pub?gid=0&single=true&output=csv'
};
