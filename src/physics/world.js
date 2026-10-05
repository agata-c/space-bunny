/**
 * Deterministic 2D physics on the gameplay plane (z = 0).
 *
 * The bunny is a single circle, so the whole simulation is tiny and — more
 * importantly — *exactly* reproducible. `step()` is shared by the live simulation
 * and by the trajectory preview, which is why the dotted line the player aims
 * with always matches what actually happens.
 *
 * ROUND 2a: the old level game (constellation nodes, capture, aim assist, spring
 * pads, gravity zones) is GONE, replaced by real colliders. Nothing knows about
 * Three.js, meshes or levels beyond plain numbers.
 *
 * NO WALLS. Agata's decision, replacing SPEC 5.1's invisible walls: the bunny can
 * leave the bowl in any direction and go off screen, which is the joke.
 */

export const FIXED_DT = 1 / 180;

/** Resting test: contact on >= this fraction of the last 0.3 s, and slower than this. */
const REST_WINDOW = 0.3; // seconds of contact history to keep
const REST_FRACTION = 0.5;
const REST_SPEED = 0.6;

export function createBody(x, y, r, vx = 0, vy = 0) {
  return {
    x, y, vx, vy, r,
    resting: false,
    /** @type {string|null} what he last touched */
    surface: null,
    /** something was actually struck on this step (the R1b hotfix) */
    contact: false,
    /** which side of the glass he is on; decides which collider applies */
    inBowl: true,
    /** rolling contact history, oldest first — the resting test reads this */
    contactLog: [],
    /** impact speed of the last bounce, for the R2b dizzy check */
    lastImpact: 0
  };
}

const TUNING = {
  airDrag: 0.045, // very light, just keeps the arcs readable
  restitution: {
    glass: 0.34, // the bowl wall: dead-ish, he slides rather than pinballs
    rim: 0.6, // the ring is springy
    cushion: 0.3, // a plop
    // R2i item 1: this was 0.3 AND DEAD - resolveCushion only ever read
    // restitution.cushion, so the "while being dropped back in" case never
    // existed. Now wired up, and a thrown plush toy bounces a little.
    cushionDrop: 0.4,
    pedestal: 0.2,
    floor: 0.26
  },
  friction: { glass: 0.7, rim: 0.9, cushion: 0.86, pedestal: 0.9, floor: 0.82 }
};

export class PhysicsWorld {
  /**
   * @param {object} cfg
   * @param {number} cfg.gravity   downward acceleration (negative)
   * @param {number} cfg.radius    bunny collision radius
   * @param {object} cfg.bowl      { x, y, outerR, innerR, rimY, rimRadius, rimTube, openingR, glassTopAngle }
   * @param {object} cfg.terrain   { platformX, platformR, platformTopY, ledgeX, ledgeY, ledgeR, upperLedgeY, upperLedgeR, tableY }
   */
  constructor(cfg) {
    this.gravity = cfg.gravity ?? -6.0;
    this.radius = cfg.radius ?? 0.4;
    // R2e item 1: what the RIM collides against. Smaller than radius on purpose.
    this.coreRadius = Math.min(cfg.coreRadius ?? cfg.radius ?? 0.4, this.radius);
    this.bowl = cfg.bowl;
    this.terrain = cfg.terrain;
    this.tuning = TUNING;
    this.time = 0;
    /** while DROPPING the cushion is a plop, and his fall speed is capped */
    this.dropping = false;
    this.fallCap = 9;
    /** R2i item 1: the drop gets its own, much higher cap - see step(). */
    this.dropFallCap = 30;
  }

  // ---- the solver -----------------------------------------------------------

  step(p, dt, events) {
    p.vy += this.gravity * dt;

    const drag = Math.max(0, 1 - this.tuning.airDrag * dt);
    p.vx *= drag;
    p.vy *= drag;

    // R2i item 1 (reviewer's diagnosis): this cap ran on EVERY step, not only
    // while dropping, so his launch went up at 38 but he fell back at 9 - which
    // is why the drop looked "off compared to when he flies when shot". The cap
    // is now the drop's alone: while dropping he may fall at 30, and in every
    // other state the behaviour is bit-for-bit what Agata approved.
    const cap = this.dropping ? this.dropFallCap : this.fallCap;
    if (p.vy < -cap) p.vy = -cap;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    p.contact = false;
    p.surface = null;
    this.updateInBowl(p);

    this.resolveGlass(p, events);
    this.resolveRim(p, events);
    // Round 2c item 1: GATE by side. The cushion sits INSIDE the glass and the
    // pedestal OUTSIDE, so they can never both apply to one body. In R2a they
    // both did: the larger lower step clamped him to ledgeY + r on step 0 while
    // the cushion sat exactly at his resting height and so never caught him, and
    // nothing moved for 27 straight launches.
    if (p.inBowl) this.resolveCushion(p, events);
    else {
      this.resolvePedestal(p, events);
      this.resolveFloor(p, events);
    }

    this.pushContact(p, dt);
    p.resting = this.isResting(p);

    this.time += dt;
    return p;
  }

  /**
   * `inBowl` decides which side of the glass collides, so he can never pass
   * through it. It flips ONLY when the body crosses y = rimY with
   * |x - bowl.x| < openingR — i.e. through the mouth, never through the wall.
   */
  updateInBowl(p) {
    const b = this.bowl;
    // R2c moved _prevY from the world onto the body, so two bodies cannot
    // corrupt each other.
    //
    // R2d item 1: the flip was MISSING. `crossed` was computed and then never
    // used, so p.inBowl never changed in any of R2c's 224 runs and the
    // "0 glass violations" result was vacuous. Initialise first, then test,
    // then update.
    if (p._prevY === undefined) { p._prevY = p.y; return; }
    const crossed = (p.y - b.rimY) * (p._prevY - b.rimY) < 0;
    // He only changes sides through the MOUTH. Anywhere else the glass itself
    // blocks him, so `crossed` there would be a tunnelling bug, not a legal exit.
    if (crossed && Math.abs(p.x - b.x) < b.openingR) p.inBowl = p.y < b.rimY;
    p._prevY = p.y;
  }

  /**
   * Glass, from whichever side he is on, and ONLY the arc below the opening.
   *
   * The old solver applied the full circle up to rimY, which made the mouth
   * unreachable (the R1b blocker). Now: inside, the body is held within
   * innerR - r, unless its direction from the bowl centre points up into the
   * mouth's wedge, where it passes freely.
   */
  resolveGlass(p, events) {
    const b = this.bowl;
    if (p.y > b.rimY) return; // above the cut: free to fly
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-5) return;

    // angle from the +y axis, 0 = straight up
    const fromUp = Math.atan2(Math.abs(dx), dy);
    const inMouthWedge = fromUp < b.glassTopAngle;

    if (p.inBowl) {
      if (inMouthWedge) return; // passing out through the mouth
      const maxD = b.innerR - p.r;
      if (d <= maxD) return;
      p.x = b.x + (dx / d) * maxD;
      p.y = b.y + (dy / d) * maxD;
      bounce(p, -dx / d, -dy / d, this.tuning.restitution.glass, this.tuning.friction.glass, events, 'glass-in');
    } else {
      if (inMouthWedge) return; // passing in through the mouth
      const minD = b.outerR + p.r;
      if (d >= minD) return;
      p.x = b.x + (dx / d) * minD;
      p.y = b.y + (dy / d) * minD;
      bounce(p, dx / d, dy / d, this.tuning.restitution.glass, this.tuning.friction.glass, events, 'glass-out');
    }
  }

  /** The two tube cross-sections of the rim ring. Springy. */
  resolveRim(p, events) {
    const b = this.bowl;
    // R2c item 2: resolveDisc() adds p.r ITSELF, so the disc radius passed
    // in must be the TUBE radius alone. Passing rimTube + p.r (as R2a did)
    // made the effective reach rimTube + 2r = 2.583 instead of 1.392, so the
    // two posts overlapped ACROSS the whole mouth (2.45 - 2.583 = -0.13),
    // forming an invisible ceiling that capped every launch at y ~ 1.4.
    // R2e item 1: the rim stops his CORE, not his bounding circle. Everything
    // else - glass inside and out, cushion, pedestal, floor - keeps the full r,
    // so his silhouette can still brush the ring while he squeezes through.
    const core = this.coreRadius;
    for (const sx of [-1, 1]) {
      resolveDisc(p, b.x + sx * b.rimRadius, b.y + b.rimY, b.rimTube, core,
        this.tuning.restitution.rim, this.tuning.friction.rim, events, 'rim');
    }
  }

  /** The cushion: its top at platformTopY over |x| <= platformR, rounded ends. */
  resolveCushion(p, events) {
    const t = this.terrain;
    // R2i item 1: the springier plop is only for the drop, so a normal landing
    // keeps the 0.3 Agata plays with.
    const e = this.dropping ? this.tuning.restitution.cushionDrop : this.tuning.restitution.cushion;
    resolveRoundedTop(p, t.platformX, t.platformR, t.platformTopY,
      e, this.tuning.friction.cushion, events, 'cushion');
  }

  /** The pedestal, outside the bowl: upper and lower steps, rounded. */
  resolvePedestal(p, events) {
    const t = this.terrain;
    resolveRoundedTop(p, t.ledgeX, t.upperLedgeR ?? t.ledgeR, t.upperLedgeY,
      this.tuning.restitution.pedestal, this.tuning.friction.pedestal, events, 'pedestal-upper');
    resolveRoundedTop(p, t.ledgeX, t.ledgeR, t.ledgeY,
      this.tuning.restitution.pedestal, this.tuning.friction.pedestal, events, 'pedestal-lower');
  }

  /** The floor. */
  resolveFloor(p, events) {
    const t = this.terrain;
    if (p.y - p.r >= t.tableY) return;
    p.y = t.tableY + p.r;
    bounce(p, 0, 1, this.tuning.restitution.floor, this.tuning.friction.floor, events, 'floor');
  }

  // ---- the resting test (replaces the old grounded/surfaceBelow logic) -------

  pushContact(p, dt) {
    p.contactLog.push({ t: this.time, c: p.contact });
    // keep only the last REST_WINDOW seconds
    while (p.contactLog.length && this.time - p.contactLog[0].t > REST_WINDOW) p.contactLog.shift();
    void dt;
  }

  /**
   * Resting = contact on >= 50 % of the last 0.3 s AND slow. The contact history
   * is what stops this firing at the apex of a lob, where speed dips under the
   * threshold for a step or two with nothing touched (the R1b hotfix).
   */
  isResting(p) {
    const speed = Math.hypot(p.vx, p.vy);
    if (speed >= REST_SPEED) return false;
    const log = p.contactLog;
    if (!log || log.length < 4) return false;
    let hits = 0;
    for (const e of log) if (e.c) hits++;
    return hits / log.length >= REST_FRACTION;
  }

  /** Kill the last of the motion once something has actually been touched. */
  settle(p) {
    if (!p.contact) return;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed < 0.34) {
      p.vx = 0;
      p.vy = 0;
    }
  }

  // R2f: outOfBounds() and surfaceBelow() are DELETED, replacing the
  // reviewer's stand-in hotfix. That hotfix existed only because game.js still
  // called outOfBounds(), which R2a had deleted, so every fixed step threw a
  // TypeError and the bunny froze in the bowl - Agata could not play at all.
  // Off-screen is now decided in game.js against stage.visibleBounds(), which is
  // the thing the player can actually see, and resting comes from the solver's
  // own contact history instead of asking what surface is underneath.

}

// ---- collision helpers -----------------------------------------------------

/**
 * Circle-vs-disc. `cr` is the DISCRadius alone; `pr` is what the body's own
 * radius should be for this collider - normally p.r, but the rim passes
 * coreRadius instead (R2e item 1).
 */
function resolveDisc(p, cx, cy, cr, pr, restitution, friction, events, tag) {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d = Math.hypot(dx, dy);
  const minD = cr + pr;
  if (d >= minD) return;
  const nx = d > 1e-6 ? dx / d : 0;
  const ny = d > 1e-6 ? dy / d : 1;
  p.x = cx + nx * minD;
  p.y = cy + ny * minD;
  bounce(p, nx, ny, restitution, friction, events, tag);
}

/**
 * A rounded TOP surface: a horizontal segment from (cx-halfW) to (cx+halfW) at
 * height top, with the two ends rounded off by the body's own radius. This is a
 * pad, not a disc — the old solver used a sphere of radius platformR centred
 * platformTopY - platformR, so the cushion curved away at the edges and the
 * pedestal had no shape at all.
 */
function resolveRoundedTop(p, cx, halfW, top, restitution, friction, events, tag) {
  const ax = cx - halfW;
  const bx = cx + halfW;
  // closest point on the segment
  const qx = p.x < ax ? ax : p.x > bx ? bx : p.x;
  const qy = top;
  const dx = p.x - qx;
  const dy = p.y - qy;
  const d = Math.hypot(dx, dy);
  if (d >= p.r) return;
  if (dy < 0) return; // only from above: the pad has no underside
  let nx, ny;
  if (d > 1e-6) { nx = dx / d; ny = dy / d; }
  else { nx = 0; ny = 1; }
  p.x = qx + nx * p.r;
  p.y = qy + ny * p.r;
  bounce(p, nx, ny, restitution, friction, events, tag);
}

function bounce(p, nx, ny, restitution, friction, events, tag) {
  const vn = p.vx * nx + p.vy * ny;
  if (vn >= 0) return;
  p.contact = true; // something was actually struck this step
  const tx = -ny;
  const ty = nx;
  const vt = (p.vx * tx + p.vy * ty) * friction;
  const vn2 = -vn * restitution;
  p.vx = nx * vn2 + tx * vt;
  p.vy = ny * vn2 + ty * vt;
  p.lastImpact = -vn;
  if (events) {
    events.bounces = events.bounces || [];
    events.bounces.push({ x: p.x, y: p.y, speed: -vn, tag });
  }
}

/**
 * Replay the exact solver forward from a launch state.
 *
 * REWRITTEN in R2a together with the colliders: the old version called
 * `world.checkCapture()` and stopped on `p.resting`, both of which the node game
 * owned and both of which item 1 deleted. It still shares `world.step()` with the
 * live simulation, which is the whole reason the aim dots match the flight.
 *
 * Stops when: the body rests, or it has been off the playfield for long enough
 * that continuing is pointless. `time` bounds the preview.
 */
export function predictPath(world, start, { time = 2.4, sampleEvery = 4 } = {}) {
  const p = {
    x: start.x, y: start.y, vx: start.vx, vy: start.vy, r: world.radius,
    resting: false, surface: null, contact: false,
    inBowl: start.inBowl === undefined ? true : start.inBowl,
    contactLog: [], lastImpact: 0
  };
  const steps = Math.max(1, Math.round(time / FIXED_DT));
  const points = [];
  const events = { bounces: [] };
  let restAt = null;

  for (let i = 0; i < steps; i++) {
    world.step(p, FIXED_DT, events);
    if (i % sampleEvery === 0) points.push({ x: p.x, y: p.y });
    if (p.resting && i > 10) {
      points.push({ x: p.x, y: p.y, land: true });
      restAt = p.x;
      break;
    }
  }
  return { points, restAt, bounces: events.bounces, body: p };
}
