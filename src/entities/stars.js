import * as THREE from 'three';
import { sparkleGeometry } from '../render/facet.js';
import { predictPath } from '../physics/world.js';
import { CONFIG } from '../game/config.js';

/**
 * R3a item 1: the stars to break. This replaces the old StarField / Constellation
 * node-capture game entirely - SPEC 4.4 is explicit that stars are "collected by
 * touch only ... NOT platforms. He never sits on them, lands on them or links them
 * into constellations. There are no nodes, no capture and no gravity assist".
 *
 * Look (SPEC 4.4): a 4-point sparkle star, extruded with a bevel, flat-shaded and
 * slightly puffy, slowly rotating in-plane, gently bobbing. R3b changed the gold
 * to the moon's tones (lit #FFE9A8 / base #F5D08A / shade #E9A27A) and removed
 * the glow sprites; R3c split the field into THREE kinds - puffy, orb and a hollow
 * outline star - one InstancedMesh each, so the field is three draw calls however
 * many stars are up.
 *
 * (R4b: this header used to say "gold ... with a soft glow ... one for the glows",
 * which stopped being true in R3b.)
 *
 * Layout is generated from the REAL launch envelope rather than picked by hand: we
 * run `predictPath` over 400 simulated launches inside the squeeze cone and keep
 * only the trajectory points a launch could actually pass through. So every star is
 * reachable by construction, and CHECK 3 re-proves it per star.
 */

export const GOAL = 8; // SPEC 5.5: break 8
const PER_ROUND = 12; // SPEC 5.5: 12 stars at random

/** Bunny head half-width is EYE.x = 0.2 in H units, so the head is 0.4 * H wide. */
const HEAD_W = 0.4 * CONFIG.bunny.H; // 0.4 * 2.67 = 1.068
/** SPEC 4.4: "about 1.1x the bunny's head". */
const STAR_W = HEAD_W * 1.1; // 1.1748
/** R3b item 2: about 4 of each kind per layout. */
const KINDS = ['puffy', 'orb', 'outline'];
/** A hit is the bunny's CORE circle overlapping the star's radius - same rule for all kinds. */
const STAR_R = STAR_W * 0.45; // 0.5287
const ORB_W = STAR_W * 0.55; // "a smooth glossy sphere, about 0.55 x the star width"

// R3b item 2 (a): the MOON's tones, not gold. props.js already owns these for
// the crescent: MOON_TONES lit #FFE9A8 / base #F5D08A / shade #E9A27A, with
// MOON_PEACH #F3BF86 toward the bottom, emissive #F5D08A at 0.12.
const MOON_LIT = 0xffe9a8;
const MOON_BASE = 0xf5d08a;
const MOON_SHADE = 0xe9a27a;
const MOON_PEACH = 0xf3bf86;
const MOON_EMISSIVE = 0xf5d08a;
const MOON_EMISSIVE_I = 0.12;
const SPIN = 0.4; // rad/s IN-PLANE (around the camera axis), per R3b item 3
const TILT = (20 * Math.PI) / 180; // +/- 20 deg wobble around vertical: never edge-on
const BOB = 0.15; // +/- 0.15
const SHARDS = 10; // 8-12 per the brief
const SHARD_LIFE = 0.6;
const MAX_SHARDS = SHARDS * PER_ROUND; // one pool for a whole round

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
const TAU = Math.PI * 2;

/** Seeded RNG so a layout can be reproduced; the seed is logged with the layout. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Stars {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   * @param {import('../physics/world.js').PhysicsWorld} opts.world  for predictPath
   * @param {object} opts.level                                   terrain + launch tuning
   * @param {{top:number,bottom:number,left:number,right:number}} opts.bounds visible bounds
   * @param {() => number} opts.time                              the game's clock
   */
  constructor(scene, { world, level, bounds, time }) {
    this.world = world;
    this.level = level;
    // R3a: bounds must be a LIVE getter, not a snapshot. visibleBounds() depends
    // on the camera, and the camera reframes as the game runs - a snapshot taken
    // in buildScene() placed 3-5 stars per layout OUTSIDE the visible area.
    this.getBounds = typeof bounds === 'function' ? bounds : () => bounds;
    this.now = time;

    this.seed = 1;
    this.goal = GOAL;
    this.total = 0;
    this.broken = 0;
    this.goalReached = false;
    /** @type {{x:number,y:number,z:number,r:number,broken:boolean,phase:number,period:number}[]} */
    this.list = [];

    // ---- R3b item 2: ONE InstancedMesh per kind, three in total ------------
    // PUFFY   - the extruded, bevelled 4-point star (SPEC 4.4's shape)
    // ORB     - a smooth glossy sphere, 0.55 x the star width
    // OUTLINE - a hollow 4-point star: the same 4-point outline swept as a THICK
    //           bevelled tube, same overall width as the puffy star
    const puffyGeo = sparkleGeometry(STAR_W * 0.5, STAR_W * 0.17, STAR_W * 0.13, 4);
    paintMoon(puffyGeo, true);
    const orbGeo = new THREE.SphereGeometry(ORB_W * 0.5, 20, 14);
    paintMoon(orbGeo, false);
    const outlineGeo = outlineStarGeometry(STAR_W * 0.5, STAR_W * 0.13);
    paintMoon(outlineGeo, true);
    const matStar = () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.55,
        metalness: 0.1,
        emissive: MOON_EMISSIVE,
        emissiveIntensity: MOON_EMISSIVE_I,
        toneMapped: true
      });
    const matOrb = () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: false, // "smooth glossy sphere"
        roughness: 0.22,
        metalness: 0.15,
        emissive: MOON_EMISSIVE,
        emissiveIntensity: MOON_EMISSIVE_I,
        toneMapped: true
      });
    this.meshes = {
      puffy: new THREE.InstancedMesh(puffyGeo, matStar(), PER_ROUND),
      orb: new THREE.InstancedMesh(orbGeo, matOrb(), PER_ROUND),
      outline: new THREE.InstancedMesh(outlineGeo, matStar(), PER_ROUND)
    };
    for (const k of KINDS) {
      const m = this.meshes[k];
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.name = 'stars_' + k;
      scene.add(m);
    }
    this.mesh = this.meshes.puffy;

    // R3b item 3 (b): Agata - "they glow, and while they rotate the glow rotates
    // with them and vanishes. Looks strange. Remove the glow." The glow mesh and
    // its InstancedMesh are DELETED. The twinkle and poof glows are untouched -
    // she only objected to the stars'.

    // ---- the shatter shard pool (one more InstancedMesh, flat-shaded) ------
    this.shardAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHARDS), 1);
    this.shardAlpha.setUsage(THREE.DynamicDrawUsage);
    const shardGeo = new THREE.TetrahedronGeometry(STAR_W * 0.16, 0);
    paintMoon(shardGeo, true); // R3b item 2: shards tinted to match the moon tones
    this.shards = new THREE.InstancedMesh(
      shardGeo,
      additiveFadeMaterial(),
      MAX_SHARDS
    );
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.frustumCulled = false;
    this.shards.count = 0;
    this.shards.name = 'starShards';
    scene.add(this.shards);
    this.live = []; // active shard particles

    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.rebuild(this.seed);
  }

  // ---- layout --------------------------------------------------------------

  /**
   * Pick a fresh layout from the real launch envelope.
   * @returns {{seed:number, placed:number, minGap:number, minBowlDist:number, samples:number}}
   */
  rebuild(seed) {
    this.seed = seed >>> 0;
    const rng = makeRng(this.seed);
    const b = this.level.bowl;
    const bounds = this.getBounds();
    const margin = STAR_W; // "inside the visible bounds, with a margin of 1 star width"
    const minY = b.rimY + 1.5; // "above y = rimY + 1.5"
    const minBowl = b.outerR + 1.5; // "at least outerR + 1.5 from the bowl centre"
    const seat = this.level.seat;
    const maxSpeed = this.level.launch.maxSpeed;
    const maxPull = this.level.launch.maxPull;

    // Agata 2026-10-05 (a REAL bug: "7/8 and no 8th star"): the round must ALWAYS have
    // enough stars inside the visible area. If the strict pass cannot place
    // PER_ROUND of them (a narrow or odd window), relax in steps: stars may be a
    // little cropped, packed a little closer, found with more sample launches.
    const gapBase = STAR_W * 1.6;
    const passes = [
      { margin: STAR_W, gap: gapBase, launches: 400 },
      { margin: STAR_W * 0.25, gap: gapBase, launches: 400 },
      { margin: STAR_W * 0.25, gap: STAR_W * 1.25, launches: 800 },
      { margin: 0, gap: STAR_W * 1.0, launches: 1200 }
    ];
    let picked = [];
    let samples = 0;
    for (const pass of passes) {
      const r = this._candidates(rng, bounds, pass.margin, pass.launches);
      samples += r.samples;
      const pk = this._pickPoints(r.cand, rng, pass.gap, PER_ROUND, []);
      if (pk.length > picked.length) picked = pk;
      if (picked.length >= PER_ROUND) break;
    }

    // R3b item 2: about 4 of each kind, dealt round-robin over a SHUFFLED list
    // so the kinds are spread through the layout instead of clustered.
    const kindOrder = [];
    for (let i = 0; i < PER_ROUND; i++) kindOrder.push(KINDS[i % KINDS.length]);
    for (let i = kindOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t2 = kindOrder[i];
      kindOrder[i] = kindOrder[j];
      kindOrder[j] = t2;
    }
    this.list = picked.map((c, i) => ({
      x: c.x,
      y: c.y,
      z: 0,
      // "Hit radius: the same rule for all kinds (0.45 x the kind's width)"
      r: STAR_R,
      kind: kindOrder[i % kindOrder.length],
      broken: false,
      phase: rng() * TAU, // "a random phase each"
      period: 3 + rng() * 2, // "3-5 s period"
      spin: rng() * TAU
    }));
    this.total = this.list.length;
    this.broken = 0;
    this.goalReached = false;
    this.live.length = 0;
    this._boundsKey = this._keyOf(bounds);
    this._visT = 0;

    // measured, for the report
    let minGapFound = Infinity;
    for (let i = 0; i < this.list.length; i++) {
      for (let j = i + 1; j < this.list.length; j++) {
        minGapFound = Math.min(minGapFound, Math.hypot(this.list[i].x - this.list[j].x, this.list[i].y - this.list[j].y));
      }
    }
    let minBowlDist = Infinity;
    for (const s of this.list) minBowlDist = Math.min(minBowlDist, Math.hypot(s.x - b.x, s.y - b.y));
    return {
      seed: this.seed,
      placed: this.list.length,
      minGap: this.list.length > 1 ? minGapFound : null,
      minBowlDist,
      samples
    };
  }

  // ---- keeping the round winnable -----------------------------------------

  /** Points a real launch could pass through, inside `bounds` shrunk by `margin`. */
  _candidates(rng, bounds, margin, launches) {
    const b = this.level.bowl;
    const minY = b.rimY + 1.5; // above y = rimY + 1.5
    const minBowl = b.outerR + 1.5; // at least outerR + 1.5 from the bowl centre
    const seat = this.level.seat;
    const maxSpeed = this.level.launch.maxSpeed;
    const cand = [];
    let samples = 0;
    for (let i = 0; i < launches; i++) {
      const ang = ((rng() * 2 - 1) * 23 * Math.PI) / 180; // inside the squeeze cone
      const power = 0.35 + rng() * 0.65;
      const speed = Math.min(maxSpeed, power * maxSpeed);
      const vx = -Math.sin(ang) * speed;
      const vy = Math.cos(ang) * speed;
      const path = predictPath(this.world, { x: seat.x, y: seat.y, vx, vy, inBowl: true });
      for (const p of path.points) {
        samples++;
        if (p.x < bounds.left + margin || p.x > bounds.right - margin) continue;
        if (p.y < bounds.bottom + margin || p.y > bounds.top - margin) continue;
        if (p.y < minY) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < minBowl) continue;
        cand.push({ x: p.x, y: p.y });
      }
    }
    return { cand, samples };
  }

  /** Shuffle, then greedily take up to maxN points `gap` apart (and from `existing`). */
  _pickPoints(cand, rng, gap, maxN, existing) {
    const c2 = cand.slice();
    for (let i = c2.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = c2[i];
      c2[i] = c2[j];
      c2[j] = t;
    }
    const picked = [];
    for (const c of c2) {
      if (picked.length >= maxN) break;
      let ok = true;
      for (const q of existing) {
        if (Math.hypot(c.x - q.x, c.y - q.y) < gap) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const q of picked) {
          if (Math.hypot(c.x - q.x, c.y - q.y) < gap) {
            ok = false;
            break;
          }
        }
      }
      if (ok) picked.push(c);
    }
    return picked;
  }

  _keyOf(b) {
    return [b.left, b.right, b.top, b.bottom].map((v) => (Number.isFinite(v) ? v.toFixed(2) : 'x')).join(',');
  }

  _boundsOk(b) {
    return [b.left, b.right, b.top, b.bottom].every(Number.isFinite) && b.right - b.left > 2 && b.top - b.bottom > 2;
  }

  /** A star counts as in view when its CENTRE is inside the visible area (cropping is fine). */
  _inView(s, b) {
    return s.x >= b.left && s.x <= b.right && s.y >= b.bottom && s.y <= b.top;
  }

  /**
   * Agata 2026-10-05: "make sure the spawned stars are always in the visible range
   * (they can be cropped); 7/8 and no 8th star shouldn't happen". Two causes were
   * reproduced: a layout built for a WIDE window loses stars off the sides when the
   * window gets narrower, and a layout that placed fewer than the goal can never be
   * finished. This runs twice a second (cheap) and re-lays out only when needed:
   *  - an unbroken star outside the view is moved to a reachable spot inside it;
   *  - if fewer unbroken stars are in view than the stars still needed (+1 spare),
   *    new ones are added.
   * It waits until the window size has stopped changing for one tick.
   */
  checkVisibility(dt) {
    this._visT = (this._visT ?? 0) + dt;
    if (this._visT < 0.5) return;
    this._visT = 0;
    if (this.goalReached) return;
    const b = this.getBounds();
    if (!this._boundsOk(b)) return;
    const key = this._keyOf(b);
    const stable = key === this._boundsKey;
    this._boundsKey = key;
    if (!stable) return; // still resizing: look again next tick
    const need = Math.max(0, this.goal - this.broken);
    const live = this.list.filter((s) => !s.broken);
    const stale = live.filter((s) => !this._inView(s, b));
    const inView = live.length - stale.length;
    if (stale.length > 0 || inView < need) this.revalidate();
  }

  revalidate() {
    const b = this.getBounds();
    if (!this._boundsOk(b)) return null;
    this._revalN = (this._revalN ?? 0) + 1;
    const rng = makeRng((this.seed ^ Math.imul(this._revalN, 0x9e3779b1)) >>> 0);
    const t = this.now();
    const live = () => this.list.filter((s) => !s.broken);
    const stale = live().filter((s) => !this._inView(s, b));
    const keep = live().filter((s) => this._inView(s, b));
    const need = Math.max(0, this.goal - this.broken);
    const want = Math.max(stale.length, need + 1 - keep.length, 0); // points to find
    let moved = 0;
    let added = 0;
    if (want > 0) {
      let pts = [];
      const tries = [
        { margin: STAR_W * 0.25, gap: STAR_W * 1.6, launches: 400 },
        { margin: STAR_W * 0.25, gap: STAR_W * 1.25, launches: 800 },
        { margin: 0, gap: STAR_W * 1.0, launches: 1200 }
      ];
      for (const tr of tries) {
        const r = this._candidates(rng, b, tr.margin, tr.launches);
        const pk = this._pickPoints(r.cand, rng, tr.gap, want, keep);
        if (pk.length > pts.length) pts = pk;
        if (pts.length >= want) break;
      }
      // out-of-view stars move first, the rest are NEW stars
      for (const s of stale) {
        const p = pts.shift();
        if (!p) break;
        s.x = p.x;
        s.y = p.y;
        s.born = t;
        moved++;
      }
      while (pts.length > 0 && keep.length + moved + added < need + 1) {
        const p = pts.shift();
        const counts = { puffy: 0, orb: 0, outline: 0 };
        for (const s of live()) counts[s.kind]++;
        const kind = KINDS.slice().sort((x, y) => counts[x] - counts[y])[0];
        this.list.push({
          x: p.x,
          y: p.y,
          z: 0,
          r: STAR_R,
          kind,
          broken: false,
          phase: rng() * TAU,
          period: 3 + rng() * 2,
          spin: rng() * TAU,
          born: t
        });
        added++;
      }
      this.total = this.list.length;
    }
    const info = { moved, added, stillOut: live().filter((s) => !this._inView(s, b)).length };
    // R4b item 1: dev only - this string was still in the production bundle.
    if (import.meta.env.DEV && (moved || added)) console.log('STAR REVALIDATE', JSON.stringify(info));
    return info;
  }

  // ---- hit + shatter -------------------------------------------------------

  /**
   * R3a: the reachability proof, using the SAME predictPath the layout was built
   * from. For each star it sweeps the squeeze cone (angle -23..23 deg in 1 deg
   * steps, power 0.35..0.95 in 0.10 steps) and reports the first launch whose
   * trajectory passes within coreRadius + starR of it. CHECK 3 wants 12/12.
   */
  reachabilityReport(coreRadius) {
    const seat = this.level.seat;
    const maxSpeed = this.level.launch.maxSpeed;
    const hit = new Array(this.list.length).fill(null);
    outer: for (let ai = 0; ai <= 46; ai++) {
      const angDeg = -23 + ai;
      for (let pi = 0; pi <= 6; pi++) {
        const power = 0.35 + pi * 0.1;
        const a = (angDeg * Math.PI) / 180;
        const speed = Math.min(maxSpeed, power * maxSpeed);
        const path = predictPath(this.world, {
          x: seat.x,
          y: seat.y,
          vx: -Math.sin(a) * speed,
          vy: Math.cos(a) * speed,
          inBowl: true
        });
        for (let i = 0; i < this.list.length; i++) {
          if (hit[i]) continue;
          const s = this.list[i];
          for (const p of path.points) {
            if (Math.hypot(p.x - s.x, p.y - s.y) <= coreRadius + s.r) {
              hit[i] = { angleDeg: angDeg, power: +power.toFixed(2) };
              break;
            }
          }
        }
        if (hit.every(Boolean)) break outer;
      }
    }
    return hit;
  }

  /** The first unbroken star whose radius overlaps a circle at (x,y) of radius r. */
  hitTest(x, y, r) {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (s.broken) continue;
      if (Math.hypot(x - s.x, y - s.y) <= r + s.r) return i;
    }
    return -1;
  }

  /** Break star i: shards fly out, and the sparkle burst comes from poof.js. */
  shatter(i, rng = Math.random) {
    const s = this.list[i];
    if (!s || s.broken) return null;
    s.broken = true;
    this.broken++;
    if (this.broken >= this.goal && !this.goalReached) {
      this.goalReached = true;
      if (import.meta.env.DEV) console.log('GOAL');
    }
    for (let k = 0; k < SHARDS; k++) {
      if (this.live.length >= MAX_SHARDS) this.live.shift();
      const a = rng() * TAU;
      const sp = 1.6 + rng() * 3.4;
      this.live.push({
        x: s.x,
        y: s.y,
        z: s.z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        spin: (rng() - 0.5) * 14,
        rot: rng() * TAU,
        sc: 0.5 + rng() * 0.9,
        t: 0
      });
    }
    return s;
  }

  clearShards() {
    this.live.length = 0;
    this.shards.count = 0;
    this.shards.visible = false;
  }

  // ---- per frame -----------------------------------------------------------

  update(dt) {
    this.checkVisibility(dt);
    const t = this.now();
    const counts = { puffy: 0, orb: 0, outline: 0 };
    for (const s of this.list) {
      if (s.broken) continue;
      const mesh = this.meshes[s.kind];
      if (!mesh) continue;
      const n = counts[s.kind];
      const y = s.y + Math.sin((t / s.period) * TAU + s.phase) * BOB;
      _p.set(s.x, y, s.z);
      if (s.kind === 'orb') {
        // "Orbs: just the bob." A sphere has no in-plane read anyway.
        _q.identity();
      } else {
        // R3b item 3: a slow IN-PLANE spin plus a +/-20 deg tilt wobble around
        // vertical, so it is never edge-on. The star's flat plane is XY (the
        // outline is built in XY and extruded along Z, facing the camera), so
        // IN-PLANE is a rotation about Z. An earlier version put this on X,
        // which tipped the star toward the camera rather than spinning it - one
        // star fell to 30% of its max projected width, which is exactly the
        // sliver Agata screenshotted.
        _e.y = Math.sin((t / s.period) * TAU + s.phase) * TILT;
        _e.z = t * SPIN + s.spin;
        _q.setFromEuler(_e);
      }
      // relocated / newly added stars pop in (0 -> 1.15 -> 1) so they never just blink on
      let pop = 1;
      if (s.born !== undefined) {
        const u = Math.min(1, Math.max(0, (t - s.born) / 0.4));
        pop = u < 1 ? Math.min(1.15, u * 2.2) * (0.85 + 0.15 * u) : 1;
        if (u >= 1) s.born = undefined;
      }
      _s.setScalar(Math.max(0.001, pop));
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      counts[s.kind] = n + 1;
    }
    for (const k of KINDS) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      mesh.visible = counts[k] > 0;
      if (counts[k] > 0) mesh.instanceMatrix.needsUpdate = true;
    }

    // shards
    let sn = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.t += dt;
      if (p.t > SHARD_LIFE) {
        this.live.splice(i, 1);
        continue;
      }
      const u = p.t / SHARD_LIFE;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 9 * dt; // a little gravity so they arc
      p.rot += p.spin * dt;
      _p.set(p.x, p.y, p.z);
      _q.setFromEuler(new THREE.Euler(p.rot, p.rot * 0.7, p.rot * 0.4));
      const sc = p.sc * (1 - u * 0.7);
      _s.setScalar(sc);
      _m.compose(_p, _q, _s);
      this.shards.setMatrixAt(sn, _m);
      this.shardAlpha.array[sn] = (1 - u) * (1 - u);
      sn++;
    }
    this.shards.count = sn;
    this.shards.visible = sn > 0;
    if (sn > 0) {
      this.shards.instanceMatrix.needsUpdate = true;
      this.shardAlpha.needsUpdate = true;
    }
    // R3b item 2: the live-star count, summed over the three kinds.
    return counts.puffy + counts.orb + counts.outline;
  }

  /** For the HUD / snapshot. */
  snapshot() {
    return { stars: this.broken, starTotal: this.total, goal: this.goal, goalReached: this.goalReached };
  }
}

/**
 * R3b item 2: the moon's tones, lit on top, deeper toward the bottom (with the
 * peach note low down), matching props.js MOON_TONES.
 */
function paintMoon(geo, faceted) {
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const lit = new THREE.Color(MOON_LIT);
  const base = new THREE.Color(MOON_BASE);
  const shade = new THREE.Color(MOON_SHADE);
  const peach = new THREE.Color(MOON_PEACH);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const raw = pos.getY(i);
    const span = Math.max(1e-6, Math.max(...Array.from({ length: pos.count }, (_, j) => Math.abs(pos.getY(j)))));
    const t = clamp01(raw / span * 0.5 + 0.5);
    if (t > 0.66) tmp.copy(base).lerp(lit, (t - 0.66) / 0.34);
    else if (t < 0.34) tmp.copy(shade).lerp(peach, (0.34 - t) / 0.34);
    else tmp.copy(shade).lerp(base, (t - 0.34) / 0.32);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  void faceted;
  return geo;
}

/**
 * R3b item 2: the OUTLINE star - a hollow 4-point star. Built as an extruded
 * 4-point shape with a smaller 4-point HOLE in it, so it is a thick bevelled
 * outline with the middle missing, exactly as in Agata's reference.
 */
function outlineStarGeometry(outer, inner) {
  const outline = new THREE.Shape();
  const hole = new THREE.Path();
  const R = outer;
  const r = R * 0.62; // the hole, leaving a thick band
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rad = i % 2 === 0 ? R : R * 0.34;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.3;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  hole.closePath();
  outline.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outline, {
    depth: inner,
    bevelEnabled: true,
    bevelThickness: inner * 0.5,
    bevelSize: inner * 0.45,
    bevelSegments: 2,
    curveSegments: 1
  });
  g.center();
  return g;
}

/** MeshBasicMaterial with a per-instance alpha, like the twinkle's. */
function additiveFadeMaterial(map) {
  // R3a: passing `map: undefined` makes three log "parameter 'map' has value of
  // undefined", so the key is only present when there IS a map.
  const m = new THREE.MeshBasicMaterial({
    ...(map ? { map } : {}),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'attribute float aAlpha;\nvarying float vAlpha;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvAlpha = aAlpha;');
    sh.fragmentShader =
      'varying float vAlpha;\n' +
      sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        'gl_FragColor.a *= vAlpha;\n#include <dithering_fragment>'
      );
  };
  m.customProgramCacheKey = () => 'r3a-instanced-fade';
  return m;
}
