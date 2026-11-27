// WhenWhere drone light shows — shared types.
//
// The canonical home for the types the page's scripts use. config.js
// and studio.js reference these via JSDoc import() types, so there is
// one definition of each type and the JSDoc never drifts from it.
// TypeScript only type-checks the page (tsc --noEmit); this file is
// never loaded by the browser.
//
// It exists as a .ts file so the repo's TypeScript usage is visible to
// GitHub's language detection, which counts files by extension and
// cannot see JSDoc types in .js files. The page's scripts are classic
// scripts (no import/export), so these are plain exported types, not a
// module the page loads.

/** Launch settings for the drone light shows page (config.js). */
export interface WhenWhereConfig {
  /** Deployed Apps Script Web app URL ('' = demo mode: copy/download fallback). */
  INQUIRY_ENDPOINT: string;
  /** Drones per formation. */
  FLEET: { heart: number; rings: number; glass: number; star: number; finale: number };
  /** Fallback colours per formation. */
  COLORS: string[];
  /** Colours per formation. */
  PALETTES: { heart: string[]; rings: string[]; glass: string[]; star: string[]; word: string[]; finale: string[] };
  /** Re-send cooldown in ms. */
  COOLDOWN_MS: number;
  /** localStorage key recording the last send. */
  INQUIRY_KEY: string;
  /** Earliest bookable date, days out. */
  DATE_MIN_DAYS_AHEAD: number;
  /** Earliest bookable date, ISO floor ('2027-01-01'). */
  DATE_MIN_FLOOR: string;
  /** Published Sheet CSV for site content ('' = content.json fallback). */
  CONTENT_CSV_URL: string;
}

/** A single drone position on the canvas. `c` is set only by heartPair. */
export interface Point {
  x: number;
  y: number;
  c?: string;
}

/** The word renderer tuning (see TUNING in the studio). */
export interface Tuning {
  font: string;
  weight: number;
  size: number;
  sizeMin: number;
  maxW: number;
  perGlyph: number;
  targetMin: number;
  targetMax: number;
  minGap: number;
  sampleStep: number;
  threshold: number;
}

/** One layout item in wordPoints: a glyph ({c, w}) or a space gap ({space: true, w}) — a space takes no drones. */
export interface WordItem {
  space?: boolean;
  c?: string;
  w: number;
}

/** A rasterised + skeletonised glyph. */
export interface Glyph {
  cp: Point[];
  tw: number;
  th: number;
}

/** A drone on the canvas: start (sx, sy), current (x, y), target (tx, ty), delay d, colour c, twinkle phase ph. */
export interface Drone {
  sx: number;
  sy: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  d: number;
  c: string;
  ph: number;
}

/** A background star (studio + hero starfields). */
export interface Star {
  x: number;
  y: number;
  r: number;
  p: number;
}

/** What collectInquiry() returns: the visitor's first name, the plain-text inquiry, and the URLSearchParams posted to the Apps Script endpoint. */
export interface Inquiry {
  first: string;
  lines: string;
  params: URLSearchParams;
}

/** One row of the content Sheet, keyed by content key. */
export interface ContentItem {
  text: string;
  image: string;
  alt: string;
}

/** The pure geometry the page exposes for tests and the Readability Lab (window.WHENWHERE.geometry). */
export interface WhenWhereGeometry {
  resample: (pts: Point[], n: number) => Point[];
  resampleRuns: (pts: Point[], n: number) => Point[];
  heartPair: (n: number) => Point[];
  thinUniform: (pts: Point[], target: number) => Point[];
  wordPoints: (word: string) => Point[];
  skeletonize: (grid: number[][]) => number[][];
  finalePts: (n: number) => Point[];
  allocateCounts: (lengths: number[], total: number) => number[];
  separatePoints: (pts: Point[], minDist: number) => Point[];
  glyphSkeleton: (ch: string, size: number) => Glyph;
  splitSlides: (text: string) => string[];
}

/** The namespace the page exposes (window.WHENWHERE). */
export interface WhenWhereNS {
  geometry: WhenWhereGeometry;
  tuning: Tuning;
  workbench?: WhenWhereWorkbench;
}

/** The workbench page's current design state (workbench/workbench.js). */
export interface WhenWhereWorkbench {
  readonly currentName: string;
  readonly wordSlides: string[];
  readonly droneCount: number;
  readonly paletteOverride: string[] | null;
}

/**
 * The full set a geometry instance provides: the 11 functions the
 * tests and the Readability Lab read through window.WHENWHERE.geometry,
 * plus the formation functions the page's SHAPES registry needs
 * (ringsPts / glassPts / starPts are not in the 11), plus TUNING.
 * Returned by WhenWhereGeometry.create(W, H) in geometry.js.
 */
export interface WhenWhereGeometrySet extends WhenWhereGeometry {
  ringsPts: (n: number) => Point[];
  glassPts: (n: number) => Point[];
  starPts: (n: number) => Point[];
  tuning: Tuning;
}
