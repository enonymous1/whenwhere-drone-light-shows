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

/** One venue's rule overrides (rules.js). Any field left out keeps the FAA baseline. */
export interface WhenWhereVenue {
  /** Human-readable venue name, shown where the rules are in force. */
  name?: string;
  /** Ceiling for this venue, in metres above ground level. */
  maxAltitudeMeters?: number;
  /** Takeoff grid spacing floor for this venue, in metres. */
  minTakeoffSpacingMeters?: number;
  /** Minimum distance between drones in flight for this venue, in metres. */
  minDroneDistanceMeters?: number;
  /** Launch-pad pitch norm for this venue, in metres. */
  minLaunchPitchMeters?: number;
  /** Safety-buffer expansion for this venue, in metres of extra clear ground per metre of altitude. */
  bufferMetersPerAltitudeMeters?: number;
}

/** Flight rules (rules.js): the FAA Part 107 baseline, plus an optional venue override. */
export interface WhenWhereRules {
  /** Maximum altitude above ground level, in metres (FAA Part 107: 120m / 400ft). */
  maxAltitudeMeters: number;
  /** Takeoff grid spacing floor, in metres (must clear Skybrush Live's 0.4m outdoor check). */
  minTakeoffSpacingMeters: number;
  /** Minimum distance between drones in flight, in metres. */
  minDroneDistanceMeters: number;
  /** Launch-pad pitch norm, in metres: swarm drones are spaced 2–3 m apart so downwash doesn't buffet neighbours. */
  minLaunchPitchMeters: number;
  /** Safety-buffer expansion, in metres of extra clear ground per metre of show altitude (10 m per 100 ft ≈ 0.328). */
  bufferMetersPerAltitudeMeters: number;
  /** Venue override, or null for the FAA baseline. */
  venue?: WhenWhereVenue | null;
}

/** The rules in force: the FAA baseline with any venue override applied (rules.js). */
export interface WhenWhereRulesEffective {
  readonly maxAltitudeMeters: number;
  readonly minTakeoffSpacingMeters: number;
  readonly minDroneDistanceMeters: number;
  readonly minLaunchPitchMeters: number;
  readonly bufferMetersPerAltitudeMeters: number;
  /** The venue name, or null when the FAA baseline is in force. */
  readonly venueName: string | null;
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
  skyc?: WhenWhereSkycModule;
  preview3d?: WhenWherePreview3d;
}

/** The 3D preview page's live state (preview-3d.js). */
export interface WhenWherePreview3d {
  /** The show time in seconds. */
  readonly time: number;
  /** Whether the show is playing. */
  readonly playing: boolean;
  /** The number of drones in the show. */
  readonly drones: number;
  /** The show's total length in seconds. */
  readonly totalSeconds: number;
  /** The orbit target (the point the camera looks at), [x, y, z]. */
  readonly target: number[];
  /** The camera's distance from the target, in metres. */
  readonly radius: number;
  /** Whether the measurement lines and labels are shown. */
  readonly measurements: boolean;
  /** The measurement label texts, in order: width, height, altitude, takeoff grid, then the sightline distances. */
  readonly measureLabels: string[];
  /** The camera's ground distance from the takeoff grid's centre, in metres. */
  readonly cameraDistance: number;
  /** The camera marker's label text. */
  readonly cameraLabel: string;
  /** The safety-buffer circle's radius, in metres. */
  readonly bufferRadius: number;
  setTime(v: number): void;
  setPlaying(p: boolean): void;
  /** A drone's Three.js position [-y, z, x] at time t (seconds). */
  sampleDrone(i: number, t: number): number[];
  /** Move the picture on screen by (dx, dy) pixels (right / down). */
  panBy(dxPx: number, dyPx: number): void;
  /** Multiply the camera's distance by factor (smaller = closer). */
  zoomBy(factor: number): void;
  /** Back to the audience view, centred on the picture. */
  resetView(): void;
  /** Show or hide the measurement lines and labels. */
  setMeasurements(on: boolean): void;
}

/** The workbench page's current design state (workbench/workbench.js). */
export interface WhenWhereWorkbench {
  readonly currentName: string;
  readonly wordSlides: string[];
  readonly droneCount: number;
  readonly paletteOverride: string[] | null;
  /** The formation on screen as design points (targets + colours). */
  readonly points: Point[];
}

/** The numbers a .skyc export reports back (workbench/skyc.js). */
export interface WhenWhereSkycStats {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly minSpacing: number;
  readonly medianSpacing: number;
  readonly drones: number;
  /** Takeoff + hold + landing, in seconds. */
  readonly totalSeconds: number;
  /** The takeoff grid's columns and rows. */
  readonly gridCols: number;
  readonly gridRows: number;
  /** Lowest and highest drone height above home level, in metres. */
  readonly minHeight: number;
  readonly maxHeight: number;
  /** The takeoff grid spacing and its footprint, in metres. */
  readonly gridSpacing: number;
  readonly gridWidth: number;
  readonly gridDepth: number;
}

/** One formation, as the .skyc exporter takes it. */
export interface WhenWhereSkycDesign {
  readonly name: string;
  readonly points: Point[];
}

/** The export settings (workbench/skyc.js). */
export interface WhenWhereSkycOptions {
  readonly spacing: number;
  /** Ground grid spacing, independent of the formation spacing. */
  readonly takeoffSpacing?: number;
  readonly altitude: number;
  readonly holdSeconds: number;
  readonly title?: string;
  readonly separatePoints: (pts: Point[], minDist: number) => Point[];
}

/** A venue for the Google Earth export (workbench/skyc.js). */
export interface WhenWhereKmzVenue {
  /** Home latitude, decimal degrees (-90 to 90). */
  latitude: number;
  /** Home longitude, decimal degrees (-180 to 180). */
  longitude: number;
  /** Show orientation in degrees, X axis (front) vs North, clockwise; 0 = front faces North. */
  orientationDegrees?: number;
}

/** The .skyc export module (workbench/skyc.js). */
export interface WhenWhereSkycModule {
  srgbToLinearByte(v: number): number;
  hexToRgb(hex: string): number[];
  encodeVaruint(n: number): number[];
  encodeLightProgram(rgb: number[], holdSeconds: number): Uint8Array;
  encodeLightProgramSegments(
    segments: { rgb: number[]; seconds: number }[],
  ): Uint8Array;
  takeoffGrid(count: number, spacing: number): number[][];
  base64(bytes: Uint8Array): string;
  crc32(bytes: Uint8Array): number;
  buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer>;
  nearestNeighbourStats(pts: Point[]): { min: number; median: number };
  buildShow(
    design: WhenWhereSkycDesign,
    options: WhenWhereSkycOptions
  ): { show: object; stats: WhenWhereSkycStats };
  exportSkyc(
    design: WhenWhereSkycDesign,
    options: WhenWhereSkycOptions
  ): { bytes: Uint8Array<ArrayBuffer>; filename: string; stats: WhenWhereSkycStats };
  sampleTrajectory(points: [number, number[], number[]][], t: number): number[];
  exportCsv(
    design: WhenWhereSkycDesign,
    options: WhenWhereSkycOptions
  ): { bytes: Uint8Array<ArrayBuffer>; filename: string; stats: WhenWhereSkycStats };
  exportKmz(
    design: WhenWhereSkycDesign,
    options: WhenWhereSkycOptions,
    venue: WhenWhereKmzVenue
  ): { bytes: Uint8Array<ArrayBuffer>; filename: string; stats: WhenWhereSkycStats };
  localToLonLat(p: number[], lat0: number, lon0: number, theta: number): number[];
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
