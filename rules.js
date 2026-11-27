// @ts-check
/* When&Where drone light shows — flight rules.
   This is the one file to edit when the limits change: the FAA
   baseline below, or a venue that allows different limits. Both the
   main site's Formation Studio preview and the workbench's Skybrush
   export read the rules from here (loaded before them), so a change
   here moves the ceiling warning, the exported safety thresholds,
   and the preview's compliance line together — no code changes.
   studio.js and workbench.js read the RESOLVED rules
   (WHENWHERE_RULES_EFFECTIVE), never the baseline directly, so a
   venue override applies everywhere at once. If this file is
   missing, the workbench fails loudly instead of exporting with
   stale limits; the studio preview keeps animating but hides its
   compliance line. */
/**
 * Flight rules for the drone light shows page, read by studio.js
 * and the workbench exporter via window.WHENWHERE_RULES_EFFECTIVE.
 * Declared as top-level vars (a var in a classic script IS a window
 * property), so the checker knows the shape on both sides of the
 * load. The shapes themselves live in types.d.ts.
 * @typedef {import('./types').WhenWhereRules} WhenWhereRules
 * @typedef {import('./types').WhenWhereRulesEffective} WhenWhereRulesEffective
 * @typedef {import('./types').WhenWhereVenue} WhenWhereVenue
 */

/** @type {WhenWhereRules} */
var WHENWHERE_RULES = {
  // FAA Part 107 baseline (US). 400 ft above ground level is
  // 121.92m; 120m is the round number the industry uses, and the
  // ceiling Skybrush Live enforces through settings.validation.
  maxAltitudeMeters: 120,

  // Takeoff grid spacing floor, in metres. Must stay clear of
  // Skybrush Live's load check (0.4m outdoor / 0.2m indoor between
  // takeoff positions), so the floor sits 0.1m above the outdoor
  // threshold. The workbench's Takeoff spacing slider cannot go
  // below this.
  minTakeoffSpacingMeters: 0.5,

  // Minimum distance between drones in flight, in metres. A show
  // drone's arms are ~0.45m, so two drones need well over 0.9m
  // centre-to-centre before their props meet; 1.5m is the floor the
  // preview and the export both warn under. The export's own
  // minDistance is the formation's actual closest pair, which the
  // geometry enforces to be at least half the nominal spacing.
  minDroneDistanceMeters: 1.5,

  // Venue override. Leave null to fly under the FAA baseline above.
  // When a venue allows different limits — a Part 107 waiver for a
  // higher ceiling, an indoor venue with a lower one — replace the
  // null with the venue's rules. Any field left out keeps the
  // baseline value for that field, so a venue only overrides what
  // it actually changes.
  //
  // Example (a venue with a waiver to 150m):
  // venue: {
  //   name: 'Riverside Park — Part 107 waiver',
  //   maxAltitudeMeters: 150,
  // },
  venue: null,
};

/**
 * The rules in force: the FAA baseline above, with any venue
 * override applied on top. Computed once at load — the venue is
 * set in this file, so the resolved rules do not change at runtime.
 * @type {WhenWhereRulesEffective}
 */
var WHENWHERE_RULES_EFFECTIVE = (function () {
  var base = WHENWHERE_RULES;
  var venue = base.venue;
  var maxAltitudeMeters = base.maxAltitudeMeters;
  var minTakeoffSpacingMeters = base.minTakeoffSpacingMeters;
  var minDroneDistanceMeters = base.minDroneDistanceMeters;
  var venueName = null;
  if (venue) {
    if (typeof venue.maxAltitudeMeters === 'number') maxAltitudeMeters = venue.maxAltitudeMeters;
    if (typeof venue.minTakeoffSpacingMeters === 'number') minTakeoffSpacingMeters = venue.minTakeoffSpacingMeters;
    if (typeof venue.minDroneDistanceMeters === 'number') minDroneDistanceMeters = venue.minDroneDistanceMeters;
    venueName = typeof venue.name === 'string' ? venue.name : null;
  }
  return {
    maxAltitudeMeters: maxAltitudeMeters,
    minTakeoffSpacingMeters: minTakeoffSpacingMeters,
    minDroneDistanceMeters: minDroneDistanceMeters,
    venueName: venueName,
  };
})();
