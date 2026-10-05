/**
 * The one and only configuration object.
 *
 * There is a single scene, so there is a single config: the renderer, the
 * physics solver, the terrarium, the decor and the finale are all handed this
 * same object. The shared geometry numbers below are read from here by both the
 * renderer and the solver — nothing else is allowed to hard-code them.
 *
 * UNITS: R = 3.5 world units (the bowl radius). The bowl centre is the world
 * origin. All positions are (x, y, z) with y up and +z towards the camera.
 */

export const CONFIG = {
  id: 'terrarium',
  name: 'terrarium',
  // R4a: the hint's COPY moved to src/ui/i18n.js (key 'hint'). Nothing in
  // config.js may hold a visible string any more. R4b: `hintKey` itself went
  // too - hud.js takes the text straight from T('hint'), so the indirection had
  // no reader left.

  /**
   * World region that must stay on screen. The camera distance is derived from
   * this, so the framing holds on any aspect ratio.
   *
   * Round 1d retuned all three against bunny-puppet-parts/plansza.png at
   * 1500x844: `height` sets how big the terrarium reads (glass 572-925 px),
   * `y` slides it up the frame so the pedestal bottom lands at y ~818, and
   * `camera.tiltDeg` opens up the rim ellipse to ~91 px tall (437-528).
   */
  frame: { y: 3.661, height: 15.856, width: 12 },

  /**
   * fov 44, tilted 12.381 degrees down. Round 1d fitted this against
   * plansza.png's rim ellipse (437-528 px, 91 px tall) at 1500x844; see
   * rounds/R1d.md and the report for why 12.4 rather than the 17-19 the brief
   * expected (at 18 deg the same ellipse measures 117 px).
   */
  camera: { fov: 44, follow: false, tiltDeg: 12.381 },

  physics: {
    // Round 2c item 3, retuned by sweep against the four targets, measured
    // with the TRUE visible bounds at z=0 (corners unprojected onto the
    // plane, so the 12.4-degree camera tilt is included):
    //   visTop +11.60  visBot -5.82  visL/R +-11.84
    // Targets: 1 full pull up leaves through the TOP -> PASS
    //          2 full pull at 45 deg leaves through the SIDE -> IMPOSSIBLE,
    //            see reports/R2c.md D2
    //          3 60% up apex at ~70% of screen height, back in the bowl -> frac 0.69
    //          4 medium air time 1.2-1.8 s -> 2.23 s, the one target missed
    gravity: -36.0,
    /** 0.38 x bunny.H. R1f item 0b: R1e left this at 1.0146 (0.324 x H) because
     * config.js was out of scope then. */
    radius: 1.1916,
    /**
     * R2e item 1, Agata's decision on R2d's D1: "let him squeeze".
     *
     * With the full radius the two RIM posts (x = +-2.45) present an effective
     * radius of rimTube + r = 1.392, so his centre had to satisfy
     * |x| < 2.45 - 1.392 = 1.058 to pass between them. From the seat that capped
     * the usable launch cone at about 12.5 degrees from vertical - far too narrow
     * for a game about flinging him out of a bowl.
     *
     * The rim only needs to stop his body's CORE. His ears and feet may brush the
     * ring for a split second while he tumbles; nothing else in the scene uses
     * this number.
     */
    coreRadius: 0.45,
    /** hard limits; a body beyond these counts as a miss */
    bounds: { x: 20, y: 18 }
  },

  /** The glass ball: its radius, where it is cut open, and the rim sitting there. */
  bowl: {
    x: 0,
    y: 0,
    outerR: 3.5,
    innerR: 3.38,
    rimY: 2.52,
    rimRadius: 2.45,
    rimTube: 0.2,
    /**
     * R2a asked for this and the edit SILENTLY FAILED (CRLF, my R2c D5 trap),
     * and I never grep-verified it. `b.openingR` was therefore undefined for
     * three rounds, so `Math.abs(p.x - b.x) < b.openingR` was always false and
     * p.inBowl could never flip - the real reason R2c's "0 glass violations" was
     * vacuous. It is the radius of the polar cut: outerR * sin(glassTopAngle)
     * = 3.5 * sin(0.767) = 2.431.
     */
    openingR: 2.431,
    /** polar cut angle at the top of the glass sphere */
    glassTopAngle: 0.767,
    /** matching cut at the bottom: -outerR * cos(glassTopAngle) */
    glassBottomY: -2.52
  },

  terrain: {
    platformX: 0,
    platformR: 2.45,
    platformTopY: -2.08,
    ledgeX: 0,
    ledgeY: -2.96,
    ledgeR: 2.87,
    /**
     * R2c: the pedestal is TWO rounded steps, so the solver needs both. These
     * match terrarium.js's PEDESTAL (lowerR 2.87, lowerH 0.42, upperR 2.52,
     * overlap 0.02): upper top = ledgeY + lowerH - overlap = -2.56.
     */
    upperLedgeY: -2.56,
    upperLedgeR: 2.52,
    tableY: -3.4
  },

  /**
   * Bunny height unit (SPEC 4.1), now the TOTAL height including the ears.
   * Round 1d fitted this to Agata's box (705-822 x 528-703 px). The brief
   * predicted H ~ 3.4, but that renders a 228 px bunny against a 175 px box,
   * so the box table won; 2.67 lands inside +-12 px on all four edges.
   */
  bunny: { H: 2.67 },

  /** Where the bunny's collider centre rests: platformTopY + physics.radius. */
  // R2c item 1: platformTopY + radius is EXACTLY -0.8884, and the pad test
  // returns on d >= p.r, so a bunny seated there GRAZES the cushion instead
  // of resting on it. +0.001 puts him in contact; invisible on screen.
  // R2e item 1: seat.x 0.3 -> 0, so he starts centred in the mouth.
  // seat.y stays platformTopY + r + 0.001.
  seat: { x: 0, y: -0.8874 },

  /** World scale of the rig; 1 means the rig is drawn at its authored size. */
  bunnyScale: 1,

  launch: {
    maxPull: 1.7,
    maxSpeed: 38.0,
    grabRadius: 1.6
  },

  // Round 3 adds the real stars and the leaf pads.
  // R4b: `constellations` and `gravityZones` are gone. The constellation node
  // game was deleted in R3a (SPEC 4.4: stars are collected by touch only, no
  // nodes, no gravity assist), and nothing has read gravityZones since. `pads`
  // STAYS - game.js hands it to LeafPads. Verified with tools/deadcode.mjs.
  stars: [],
  pads: [],

  // The round-1 decor is fixed (SPEC 4.3), built by props.js from these numbers.
  props: []
};

export default CONFIG;
