/**
 * THE LOOK FILE. Round 1m.
 *
 * Every tunable look constant lives here as plain JSON-able data: numbers and
 * hex strings without a leading '#'. Nothing in this file has any behaviour, so
 * the panel (?tune) can diff a working LOOK against this one and export only
 * what Agata actually changed.
 *
 * HOW THE VALUES REACH THE SCENE
 * Modules do NOT read this file once and forget it. Each one calls
 * `onLook(fn)` at build time to register an applier, so when the panel changes
 * a value it calls `emitLook()` and every module re-reads LOOK and updates the
 * live scene - no reload, no rebuild.
 *
 * The values below are R1l's values EXACTLY. Round 1m's acceptance test is a
 * pixel diff of the game view across the extraction of this file, and that diff
 * is only meaningful while nothing here drifts from what the modules had
 * hard-coded. reports/R1m.md carries the measured diff.
 *
 * Colours are stored as bare hex strings ('rrggbb') so a copied settings blob is
 * valid JSON with no parsing. `num()` and `hex()` below are the only readers.
 */

/** 'rrggbb' | 0xrrggbb -> 0xrrggbb */
export function hex(v, fallback = 0xffffff) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return fallback;
  const s = v.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return fallback;
  return parseInt(s, 16);
}

/** look value -> number, with a fallback for anything missing */
export function num(v, fallback = 0) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// THE DEFAULTS
// ---------------------------------------------------------------------------
export const LOOK = {
  // ---- global -------------------------------------------------------------
  exposure: 1.4,

  // ---- sky, environment and floor ----------------------------------------
  // Round 1n item 6: Agata's own setting, from docs/agata-look-r1m.json. She set
  // this while the sky control was dead (the bgTex/envTex bug this round fixes),
  // so she had never SEEN the result - this is the first time it renders.
  sky: { top: 'cfabe0', bottom: 'd4ade1' },
  env: { top: 'f2f0ff', bottom: 'cdb6f2' },
  floor: {
    near: 'ffc2f7',
    far: 'd7b2e9',
    radius: 34,
    z: -7,
    spotColor: '6966ff',
    spotOpacity: 0.62
  },

  // ---- the cushion (the platform the bunny sits on) ------------------------
  // R1l D2: one flat emissive cannot put the top at L 0.65 AND the side 0.03
  // below it, so the top and the side band are separate materials with separate
  // emissives. See `splitGroupsByHeight` in render/facet.js.
  cushion: {
    top: 'ac61b3',
    side: '611396',
    topEmissive: 'a996c5',
    topEmissiveIntensity: 0.46,
    sideEmissive: 'e88fd8',
    sideEmissiveIntensity: 0.46,
    roughness: 0.9,
    envMapIntensity: 0.15
  },

  // ---- the pedestal (the podium under the bowl) ---------------------------
  pedestal: {
    left: '8c7dd9',
    right: 'c85fc0',
    emissive: 'be88c8',
    emissiveIntensity: 0.7,
    roughness: 0.25,
    envMapIntensity: 0.85,
    clearcoat: 1
  },

  // ---- the rim ring --------------------------------------------------------
  rim: {
    a: 'fdaadf',
    b: 'd1a3ff',
    emissiveIntensity: 0.6,
    roughness: 0.25,
    envMapIntensity: 0.85
  },

  // ---- the glass bowl ------------------------------------------------------
  glass: {
    color: 'fbf7fe',
    attenuationColor: 'e6d8fa',
    attenuationDistance: 30,
    envMapIntensity: 1.3,
    specularIntensity: 0.55,
    // Round 2a item 0: 0.875 -> 0. The rim is OPAQUE, so three.js drew it into
    // the glass's transmission buffer, refracted it, and composited that back
    // BEHIND the directly-drawn rim - a displaced second copy. The additive
    // back-side sheen added a third. Measured on the back-rim region of R2's
    // A/B: hiding the glass changed 50.5% of those pixels, hiding the sheen
    // 38.4%, and thickness 0 alone 19.8% - thickness/ior is the smallest lever
    // that attacks the offset itself. At 0 the bowl is thin-walled: transmission
    // still works, but there is no refraction displacement, so the ghost
    // collapses onto the real rim. Edges and interior are unaffected.
    thickness: 0,
    ior: 1.3,
    transmission: 1.0,
    clearcoat: 0,
    sheenOpacity: 0.32,
    sheenOpacityLite: 0.3,
    edgeL: 'ff66cc',
    edgeM: 'cf8fe4',
    edgeR: 'c49cf2',
    rimColor: 'e0a0ff',
    rimStrength: 0.65,
    rimPower: 4
  },

  // ---- lights --------------------------------------------------------------
  // `rightFill` is NEW in R1m and defaults to 0, so nothing changes on load.
  // It exists because R1l D5 showed the pedestal's right flank cannot be lifted
  // by albedo or emissive alone - nothing in the rig lit it from the right.
  lights: {
    hemi: { sky: 'e8f0ff', ground: 'f3d9f5', intensity: 0.35 },
    key: { color: 'fff8f4', intensity: 2.3 },
    pinkLeft: { color: 'f7a8d8', intensity: 1.3 },
    blueRight: { color: '9fc2ff', intensity: 1.0 },
    blueRim: { color: '9fc2ff', intensity: 1.0 },
    bounce: { color: 'ffd2ec', intensity: 0 },
    inner: { color: 'ffc6e8', intensity: 0 },
    rightFill: { color: 'e8d4ff', intensity: 0 }
  },

  // ---- the bunny's contact shadow (R1l item 1) -----------------------------
  bunny: {
    shadowOpacity: 0.28,
    shadowRadius: 0.5, // world radii, in units of bunny H
    shadowColor: '5a2a8a'
  },

  // ---- flower petals -------------------------------------------------------
  petals: { count: 140, radius: 0.035 },

  // ---- leaf colours --------------------------------------------------------
  leafTones: {
    mint: { lit: 'b5fff0', base: '5adcce', shade: '2fa3a6', emissive: '2f8f7a' },
    teal: { lit: '86e4ea', base: '30b0c5', shade: '1e7896', emissive: '1c6e86' },
    blue: { lit: 'c4f1ff', base: '59cefb', shade: '2a86cc', emissive: '2a7ab0' }
  },
  leafTipPull: '73d4f2',

  // ---- placement -----------------------------------------------------------
  // x / z are platform-local, len the blade length, lean the tilt away from the
  // platform centre in degrees, yaw the twist about its own axis.
  leaves: {
    L1: { kind: 'curved', tone: 'blue', x: -1.34, z: -0.86, len: 2.07, lean: 30, yaw: 63.2 },
    L2: { kind: 'narrow', tone: 'teal', x: -0.5, z: -1.52, len: 2.27, lean: 28, yaw: 14.4 },
    L3: { kind: 'narrow', tone: 'teal', x: -1.12, z: -1.16, len: 1.62, lean: 35, yaw: 0 },
    L4: { kind: 'pointed', tone: 'mint', x: -0.78, z: 0.46, len: 2.56, lean: 52, yaw: 99.4 },
    L5: { kind: 'narrow', tone: 'teal', x: 0.54, z: -1.5, len: 2.03, lean: 21, yaw: 12.5 },
    L6: { kind: 'curved', tone: 'blue', x: 1.52, z: -0.42, len: 1.58, lean: 30, yaw: -30 },
    L7: { kind: 'pointed', tone: 'mint', x: 0.8, z: 0.44, len: 2.05, lean: 56, yaw: -10.6 }
  },

  // `stemX` / `stemZ` are the ONE point on the cushion that F1's stems spring
  // from (R1m item 3); `leanZ` tips the whole cluster toward the viewer's left.
  clusters: {
    F1: { x: -0.95, z: 0.32, yaw: 0.3, leanZ: 23, stemX: -0.62, stemZ: 0.66 },
    F2: { x: 1.22, z: 0.5, yaw: -0.5, leanZ: 0, stemX: 1.22, stemZ: 0.5 }
  },

  // head offsets from their cluster's base
  heads: [
    { x: 0.0, y: 0.95, z: 0.0 },
    { x: 0.36, y: 1.28, z: 0.07 }
  ],

  moon: { x: 1.02, z: -0.98, height: 2.85, leanDeg: -12 },

  /**
   * R4-sounds item 5: sound levels, so the existing ?tune panel grows a "sound"
   * folder automatically and Agata can audition and balance every sound.
   *
   * `master` is the calm default the brief asks for (0.55). It is the ONE number
   * that decides whether the 0.85 ceiling in the brief can hold: individual
   * recipes peak well under 1.0, so 0.85 / 0.55 = 1.54 of headroom exists at the
   * default. Raising master towards 1.0 is the one way to push a peak past 0.85,
   * and that is a deliberate choice an audible master gain should be allowed to
   * make - the DynamicsCompressor after it is the backstop.
   */
  sound: {
    // R4e: the recorded files are in place (public/sounds/), so the sound is
    // back on. master 0.8 with the limiter after it; the per-sound gains below
    // are Agata's mix, tweakable in the ?tune panel.
    master: 0.8,
    sfx: 1,
    ambient: 0.7,
    gains: {
      aim: 1,
      launch: 1,
      impact: 0.9,
      star: 0.8,
      dizzy: 1,
      poof: 1,
      whoosh: 1,
      drop: 1,
      land: 1,
      helmet: 1,
      rocket: 1,
      space: 1,
      born: 1,
      endcard: 1,
      ui: 1
    }
  }
};

// ---------------------------------------------------------------------------
// LIVE UPDATES
// ---------------------------------------------------------------------------
/**
 * A frozen snapshot of LOOK taken the moment this module is first evaluated.
 * `changed()` compares against it, which is what lets an applier skip work that
 * would be a no-op. That matters: R1m's acceptance test is a ZERO-pixel diff
 * across the extraction of this file, so no applier may touch the scene on load.
 */
export const DEFAULTS = Object.freeze(JSON.parse(JSON.stringify(LOOK)));

/** Has `path` been changed from the shipped default? */
export function changed(path) {
  return JSON.stringify(getPath(LOOK, path)) !== JSON.stringify(getPath(DEFAULTS, path));
}

const subs = [];

/**
 * Register an applier. `fn` is called once immediately with the current LOOK and
 * again on every emitLook(). Modules use this so the panel can change anything
 * without a reload.
 * @returns {() => void} unsubscribe
 */
export function onLook(fn) {
  subs.push(fn);
  fn(LOOK);
  return () => {
    const i = subs.indexOf(fn);
    if (i >= 0) subs.splice(i, 1);
  };
}

/**
 * Like onLook, but NOT fired immediately - only on emitLook(). Use this for
 * anything that MOVES the scene, so the initial build is never disturbed.
 */
export function onLookChange(fn) {
  subs.push(fn);
  return () => {
    const i = subs.indexOf(fn);
    if (i >= 0) subs.splice(i, 1);
  };
}

/** Tell every registered module to re-read LOOK and update the live scene. */
export function emitLook() {
  for (const fn of subs) fn(LOOK);
}

/** Deep clone, so callers can diff against the defaults without touching LOOK. */
export function cloneLook(src = LOOK) {
  return JSON.parse(JSON.stringify(src));
}

/**
 * Flatten LOOK to dotted paths -> primitive, for diffing and for building the
 * lil-gui control tree.
 * @param {object} [src]
 * @param {string} [prefix]
 * @param {object} [out]
 */
export function flatten(src = LOOK, prefix = '', out = {}) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

/** Write a dotted path into a plain object tree. Creates nothing; overwrites. */
export function setPath(tree, path, value) {
  const parts = path.split('.');
  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  return tree;
}

/** Read a dotted path out of a plain object tree. */
function getPath(tree, path) {
  let node = tree;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Only the entries where `current` differs from `defaults`, as a NESTED object.
 * This is exactly what "Copy settings" exports, so the blob stays readable when
 * pasted back into look.js.
 */
export function diffLook(current, defaults = LOOK) {
  const out = {};
  const now = flatten(current || {});
  const was = flatten(defaults || {});
  for (const path of Object.keys(now)) {
    if (JSON.stringify(now[path]) !== JSON.stringify(was[path])) setPath(out, path, now[path]);
  }
  return out;
}

/** Merge a nested settings blob (from "Copy settings") into a LOOK tree. */
export function mergeLook(target, blob) {
  for (const k of Object.keys(blob)) {
    const bv = blob[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      mergeLook(target[k], bv);
    } else target[k] = bv;
  }
  return target;
}
