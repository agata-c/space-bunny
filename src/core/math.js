/** Tiny maths helpers used all over the place. */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeOutBack(t, overshoot = 1.7) {
  const c1 = overshoot;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** Deterministic pseudo random in [0,1) — same result on every reload. */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// R4b item 1: invLerp, dampVec, angleDelta, easeInCubic, easeInOutSine,
// easeOutElastic, rand, pick and distToSegment used to live here. Nothing
// imported them (tools/deadcode.mjs), so they were deleted rather than left as
// a public API nobody calls.