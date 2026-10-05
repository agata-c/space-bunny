/**
 * The pastel palette lifted straight out of the reference art.
 * Every colour in the game comes from here so the whole scene stays in one
 * pastel family: pink light from the left, periwinkle shadow on the right.
 *
 * The `bunny* / rim* / leaf* / flower* / moon* / gold*` keys are the SPEC 3
 * table; the older keys are kept because other modules still import them.
 */

export const PALETTE = {
  // bunny / soft plastics
  blushPink: 0xffc2e2,
  pink: 0xf9c6e2,
  lilac: 0xe2d8f8,
  periwinkle: 0xb9c3f2,
  deepPeri: 0x93a4ea,
  snow: 0xf6f1ff,

  // dark details (the eye's colour moves to the SPEC 3 block below, where R1e
  // re-sampled it from the puppets)
  ink: 0x4a3a72,

  // gold accents
  gold: 0xf4c766,
  goldDeep: 0xf0a94b,
  goldPale: 0xfff0c4,

  // leaves
  leafMint: 0x6fe4d0,
  leafTeal: 0x3fcbb6,
  leafSky: 0x6fd2f2,
  leafDeep: 0x2fa9d6,

  // flowers
  flower: 0xb87df0,
  flowerPale: 0xd9b6ff,
  flowerStem: 0xc98ae8,

  // scene
  glassTint: 0xf6b8e6,
  glassRim: 0xbcd0ff,
  table: 0xd9c8f5,
  pedestal: 0xf0d8f0,
  cushion: 0xf6dcf0,
  moon: 0xffe6a8,

  // ---- SPEC 3 palette ----------------------------------------------------
  // Bunny facets: bright lavender-white, NOT dull purple. Round 1d re-picked
  // these off plansza.png — head front #CCB7FB, lit upper-left #F7A2FB (much
  // more saturated than R1's #F2BDEB), body #DEB7FC.
  // Bunny facets: R1e re-split them for the assembled puppets — a saturated
  // magenta-pink on the lit left facets, a lavender-white base, periwinkle
  // away from the key light. Final colour matching waits for R1f's relight;
  // this round only needs the three-tone split to read.
  bunnyBase: 0xd0c8fb,
  bunnyLit: 0xff7cff,
  bunnyShade: 0x9a90f0,
  // R1e: the eye is a dark teal and the cheek mark a softer pink, both
  // sampled off the puppets (bunny.js only zeroes the blush's emissive).
  blush: 0xed80b8,
  eye: 0x023d4a,

  // rim / joints / platform / pedestal gradient
  // Round 1i item 3, sampled off bunny-puppet-parts/shells-ref.png: pink on the
  // top/back of the ring, lilac-blue on the front/underside.
  rimA: 0xecacfd,
  rimB: 0xa88cf8,

  // crystal leaves — saturated, not grey. Round 1d: mint #5ADCCE, blue
  // #59CEFB, deep teal #30B0C5 for the shaded bases.
  leafA: 0x5adcce,
  leafB: 0x59cefb,
  leafMid: 0x30b0c5,

  // flower clusters — lighter and more vivid than R1's #B05CE8 / #9B4FF0
  flowerA: 0xd770fb,
  flowerB: 0x8a2be0,

  // crescent moon: lit #E0B88B shading toward lilac (round 1d)
  moonA: 0xe0b88b,
  moonB: 0xc7a6dc,

  // stars / constellations
  goldHi: 0xffe7a8
};

/** Shared renderer/scene tuning. */
export const RENDER = {
  /**
   * Round 1d replaced R1c's fog "infinity cove" with Agata's flat lilac sky and
   * a visible, soft-edged floor disc (see terrarium.js `buildTable`). The sky is
   * nearly flat: #CFABE0 at the top easing to #D4ADE1 at the bottom.
   */
  bgTop: 0xcfabe0,
  bgBottom: 0xd4ade1,
  /**
   * Round 1f: the environment map (the reflection source) is NEUTRAL-COOL, not
   * the pink sky pair. With pink in the environment every surface picked up
   * rose in its reflections, which is half of why the mints, golds and violets
   * read wrong in R1c-R1e even when their material colours were right.
   */
  envTop: 0xf2f0ff,
  envBottom: 0xe6ddf5,
  /** Floor disc gradient: centre (near the camera) -> rim (the soft far edge). */
  floorNear: 0xd591f5,
  floorFar: 0xeaafe4,
  /** The soft pink pool on the floor under the pedestal's front-left. */
  floorSpot: 0xe07fc5
};