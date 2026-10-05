import * as THREE from 'three';
import { sparkleGeometry, radialTexture } from '../render/facet.js';

/**
 * R2h item 1: the magic poof.
 *
 * Agata's complaint: when he lands OUTSIDE the bowl he "just vanishes and reappears
 * in the bowl: mechanically OK, but it looks like a glitch". So the miss gets a
 * puff of cloud and a burst of gold sparkles, and he shrinks away inside it.
 *
 * Allocation and draw calls are the two constraints the brief cares about, so:
 *   - every puff sphere and every sparkle lives in ONE InstancedMesh apiece, i.e.
 *     exactly 2 draw calls whether there are 0 poofs on screen or 4;
 *   - the per-poof layout (10 puff offsets, 16 sparkle directions) is generated ONCE
 *     per pool slot in the constructor, so play() only writes numbers;
 *   - the per-instance fade rides on an `aAlpha` instanced attribute multiplied into
 *     gl_FragColor.a - the same onBeforeCompile + customProgramCacheKey shape
 *     materials.js already uses for the glass rim, so no new material pattern.
 *
 * Colours are the brief's hexes. They sit in the project's pastel family next to
 * PALETTE.pink (0xf9c6e2) and PALETTE.lilac (0xe2d8f8).
 */
const PINK = 0xf7a8d8;
const LILAC = 0xd7b8f5;
const CREAM = 0xffe7a8; // pale gold, the only sparkle tone now
const CLOUD_DEEP = 0xe7a3ee;
const CLOUD_MID = 0xc9a0ee;

// R2i item 2. Agata on R2h's poof: "the stars are too big, and the contrast is
// very visible in shape, size and colour" - and R2h's own D6 said the cloud did
// not read as a cloud. So: the sparkles dropped from outer 0.34 to 0.12 (about 3x
// smaller, as specified) and 16 -> 20 of them, the cloud went DEEPER and more
// saturated so it stands off the lilac sky, WHITE is gone from the cloud, and
// both halves now share one 0.45 s life so they read as ONE effect.
const CLOUD_COLS = [CLOUD_DEEP, CLOUD_MID, PINK];
const SPARK_COLS = [CREAM, CREAM, CREAM, PINK]; // "a few #F7A8D8 pink ones mixed in"
const CLOUD_ALPHA = 0.85; // "opacity about 0.85 -> 0"
const SPARK_ALPHA = 0.85; // "at most 0.85 opacity"
const PUFFS = 8; // R2j: "7-9 OPAQUE puff balls"
const SPARKS = 20; // "use 20 smaller ones instead of 16"
const RING_N = 12; // the landing twinkle ring
const MAX_LIVE = 4; // concurrent poofs; the rest reuse a slot
const CLOUD_LIFE = 0.45; // R2i: sparkles "appear AT THE SAME TIME as the cloud ... and fade with it (about 0.45 s)"
const SPARK_LIFE = 0.45;
const TWINKLE_LIFE = 0.5; // "about 0.5 s"
// R2j item 2: a real cartoon poof. Agata on R2i - the cloud "looks like a
// clip-art mistake. It doesn't read as a cloud, more like a mistake" (one flat
// blurry pink disc). The cause is exactly what the brief says: overlapping
// TRANSPARENT flat-shaded spheres all fading by alpha together merge into one
// soft disc. So the puffs are now OPAQUE and lit, and the fade is replaced by
// each ball shrinking away on its own.
const CLOUD_TOP = 0xfbe3f8; // pink-white on top
const CLOUD_UNDER = 0xd9b8f2; // lilac underneath
const PUFF_POP = 0.12; // "scale 0 -> 1.15 -> 1.0 in about 0.12 s"
const PUFF_OVERSHOOT = 1.15;
const PUFF_STAGGER = 0.015; // "staggered by about 0.02 s per puff"
const PUFF_SHRINK = 0.3; // "then each SHRINKS to 0 individually ... about 0.35 s"
const PUFF_SHRINK_AT = 0.15;
// A cloud SILHOUETTE, not a random ball: four bigger puffs on a flat-ish bottom
// row, smaller ones bumping up on top and at the sides. Sizes 0.35-0.7.
const PUFF_SHAPE = [
  [-0.85, 0.0, 0.55],
  [-0.3, -0.05, 0.7],
  [0.28, -0.05, 0.66],
  [0.85, 0.02, 0.52],
  [-1.15, 0.24, 0.35],
  [-0.5, 0.44, 0.44],
  [0.02, 0.54, 0.48],
  [0.52, 0.42, 0.42]
];
const CLOUD_SPREAD = 1.15; // "drifts slightly outward and up"
const CLOUD_RISE = 0.4;
const CLOUD_R0 = 0.3;
const CLOUD_R1 = 1.6;
const RISE = 0.5; // "slightly rising"
/** R2i item 3: in front of the glass, not inside it. bowl.outerR is 3.5. */
const FRONT_Z = 3.8;
// R2j item 3: the twinkle has to POP. Agata on R2i - "OK in position, but it
// MERGES with the background. Not solid white, but now they just blend". So:
// bigger (0.12 -> 0.17), two-tone (a #F4C766 gold core inside a #FFF2C8 cream
// rim rather than one flat tone), a soft additive glow behind each star, and a
// scale pop + twinkle so it is not a static ring.
const TW_STAR_OUTER = 0.17;
const TW_GOLD = 0xf4c766;
const TW_CREAM = 0xfff2c8;
const TW_GLOW = 0xffe7a8;
const TW_GLOW_ALPHA = 0.5; // "#FFE7A8 at about 0.5"
const TW_POP_AT = 0.15; // 0 -> 1.2 -> 1
const TW_HZ = 8; // "scale 0.8-1.1 at about 8 Hz"

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _AXIS_Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
/** Deterministic per-slot noise, so a replay looks identical. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** MeshBasicMaterial with a per-instance alpha, so one mesh can fade each copy alone. */
function instancedFadeMaterial(extra = {}) {
  const m = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    ...extra
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
  m.customProgramCacheKey = () => 'r2h-instanced-fade';
  return m;
}

export class Poof {
  constructor(scene) {
    this.time = 0;

    // ---- one InstancedMesh for every puff ball (R2j: OPAQUE and LIT) ---------
    // A smooth sphere with a baked vertical gradient, pink-white on top and lilac
    // underneath, so each ball reads as a ROUND ball with light above and shade
    // below against the lilac sky instead of dissolving into a flat disc. Still
    // one draw call, and no alpha attribute at all - the shrink IS the fade.
    const cloudGeo = new THREE.SphereGeometry(1, 18, 13);
    {
      const pos = cloudGeo.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      const top = new THREE.Color(CLOUD_TOP);
      const under = new THREE.Color(CLOUD_UNDER);
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = clamp01((pos.getY(i) + 1) / 2);
        tmp.copy(under).lerp(top, smooth(Math.min(1, Math.max(0, (t - 0.34) / 0.5))));
        cols[i * 3] = tmp.r;
        cols[i * 3 + 1] = tmp.g;
        cols[i * 3 + 2] = tmp.b;
      }
      cloudGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }
    const cloudMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9, // "roughness about 0.9"
      metalness: 0,
      flatShading: false // "smooth shading"
    });
    this.cloud = new THREE.InstancedMesh(cloudGeo, cloudMat, PUFFS * MAX_LIVE);
    this.cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cloud.frustumCulled = false;
    this.cloud.count = 0;
    this.cloud.renderOrder = 6;
    this.cloud.name = 'poofCloud';
    scene.add(this.cloud);

    // ---- one InstancedMesh for every 4-point sparkle -------------------------
    // R2i item 2: outer 0.34 -> 0.12, inner 0.11 -> 0.04. They were "about 3x
    // too big" against the cloud.
    const sparkGeo = sparkleGeometry(0.12, 0.04, 0.05, 4);
    this.sparkAlpha = new THREE.InstancedBufferAttribute(new Float32Array(SPARKS * MAX_LIVE), 1);
    this.frontAlpha = new THREE.InstancedBufferAttribute(new Float32Array(RING_N * MAX_LIVE), 1);
    this.sparkAlpha.setUsage(THREE.DynamicDrawUsage);
    sparkGeo.setAttribute('aAlpha', this.sparkAlpha);
    this.spark = new THREE.InstancedMesh(
      sparkGeo,
      instancedFadeMaterial({ blending: THREE.AdditiveBlending }),
      SPARKS * MAX_LIVE
    );
    this.spark.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spark.frustumCulled = false;
    this.spark.count = 0;
    this.spark.renderOrder = 7;
    this.spark.name = 'poofSpark';
    scene.add(this.spark);

    // ---- R2i item 3: the landing twinkle, IN FRONT of the glass ---------------
    // It was being drawn INTO the transmissive glass pass, so it read as
    // "behind the bowl" (Agata's note 3). depthTest false plus a renderOrder
    // above the glass (terrarium.js sets glass.renderOrder = 4) plus a z in
    // front of the bowl is what actually fixes it; renderOrder alone was not
    // enough because the depth buffer still rejected the fragments.
    // R2j item 3: two instances per star - a #FFF2C8 cream star with a smaller
    // #F4C766 gold core - so it is two-tone without another draw call.
    const frontGeo = sparkleGeometry(TW_STAR_OUTER, TW_STAR_OUTER * 0.33, 0.06, 4);
    this.front = new THREE.InstancedMesh(
      frontGeo,
      instancedFadeMaterial({ depthTest: false, blending: THREE.AdditiveBlending }),
      RING_N * 2 * MAX_LIVE
    );
    this.front.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.front.frustumCulled = false;
    this.front.count = 0;
    this.front.renderOrder = 9; // above glass 4, cloud 6, sparkles 7, sparks 8
    this.front.name = 'poofFront';
    scene.add(this.front);

    // the soft additive glow behind each star, one instanced quad
    this.frontGlowAlpha = new THREE.InstancedBufferAttribute(
      new Float32Array(RING_N * MAX_LIVE),
      1
    );
    this.frontGlowAlpha.setUsage(THREE.DynamicDrawUsage);
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.setAttribute('aAlpha', this.frontGlowAlpha);
    this.frontGlow = new THREE.InstancedMesh(
      glowGeo,
      instancedFadeMaterial({
        depthTest: false,
        blending: THREE.AdditiveBlending,
        map: radialTexture('rgba(255,231,168,1)', 'rgba(255,231,168,0)', [
          [0, 'rgba(255,231,168,0.85)'],
          [0.4, 'rgba(255,231,168,0.32)'],
          [1, 'rgba(255,231,168,0)']
        ])
      }),
      RING_N * MAX_LIVE
    );
    this.frontGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.frontGlow.frustumCulled = false;
    this.frontGlow.count = 0;
    this.frontGlow.renderOrder = 8; // just behind the stars, still in front of the glass
    this.frontGlow.name = 'poofFrontGlow';
    scene.add(this.frontGlow);

    // ---- pool: layout generated once, never per poof --------------------------
    this.slots = [];
    for (let i = 0; i < MAX_LIVE; i++) this.slots.push(this.makeSlot(i));
    this.write();
  }

  makeSlot(i) {
    const r = rng(1000 + i * 7919);
    const puffs = [];
    for (let k = 0; k < PUFFS; k++) {
      const sh = PUFF_SHAPE[k % PUFF_SHAPE.length];
      puffs.push({
        dx: sh[0],
        dy: sh[1],
        dz: (r() - 0.5) * 0.18, // a little depth so it is not a flat cut-out
        size: sh[2],
        ph: r()
      });
    }
    const sparks = [];
    for (let k = 0; k < SPARKS; k++) {
      const a = (k / SPARKS) * TAU + r() * 0.35;
      sparks.push({
        dx: Math.cos(a),
        dy: r() * 0.55 - 0.12,
        dz: Math.sin(a),
        sp: 1.7 + r() * 1.9,
        spin: (r() - 0.5) * 7,
        sc: 0.7 + r() * 0.7,
        col: SPARK_COLS[k % SPARK_COLS.length],
        ph: r() * 0.55
      });
    }
    // R2i item 3: the landing twinkle ring - a flat circle of tiny soft stars
    // around his head, drawn in FRONT of the glass.
    const ring = [];
    for (let k = 0; k < RING_N; k++) {
      const a = (k / RING_N) * TAU;
      ring.push({
        dx: Math.cos(a),
        dy: Math.sin(a) * 0.62,
        sc: 0.7 + r() * 0.5,
        spin: (r() - 0.5) * 5,
        col: SPARK_COLS[k % SPARK_COLS.length],
        ph: r()
      });
    }
    return {
      live: false,
      t: 0,
      x: 0,
      y: 0,
      k: 1,
      cloudless: false,
      burst: false,
      puffs,
      sparks,
      ring
    };
  }

  /** Take a free slot, else the one furthest through its life. */
  claim() {
    for (const s of this.slots) if (!s.live) return s;
    let best = this.slots[0];
    for (const s of this.slots) if (s.t > best.t) best = s;
    return best;
  }

  /** The big one: cloud + gold burst, for a miss outside the bowl. */
  play(x, y, k = 1) {
    const s = this.claim();
    s.live = true;
    s.t = 0;
    s.x = x;
    s.y = y;
    s.k = k;
    s.cloudless = false;
    s.burst = false;
    return s;
  }

  /**
   * R2i item 3: the landing twinkle. Drawn in front of the glass (FRONT_Z,
   * depthTest false, renderOrder 9) because inside the transmissive bowl it read
   * as "behind the bowl" and the eye could not see it.
   */
  twinkle(x, y, k = 1) {
    const s = this.claim();
    s.live = true;
    s.t = 0;
    s.x = x;
    s.y = y;
    s.k = k;
    s.cloudless = true;
    s.burst = false;
    return s;
  }

  /**
   * R3a item 1: the shatter sparkle burst. Sparkles only, no cloud, and NOT the
   * front-of-glass ring - shards fly in the scene, not on the lens.
   */
  burst(x, y, k = 1) {
    const s = this.claim();
    s.live = true;
    s.t = 0;
    s.x = x;
    s.y = y;
    s.k = k;
    s.cloudless = true;
    s.burst = true;
    return s;
  }

  clear() {
    for (const s of this.slots) s.live = false;
    this.write();
  }

  update(dt) {
    this.time += dt;
    let live = 0;
    for (const s of this.slots) {
      if (!s.live) continue;
      s.t += dt;
      // R2i: the twinkle lives a touch longer than the poof (0.5 vs 0.45).
      if (s.t > (s.cloudless ? TWINKLE_LIFE : SPARK_LIFE)) {
        s.live = false;
        continue;
      }
      live++;
    }
    this.write();
    return live;
  }

  /** Push the live particles into the two instance buffers. */
  write() {
    let ci = 0;
    let si = 0;
    let fi = 0;
    for (const s of this.slots) {
      if (!s.live) continue;
      const k = s.k;
      // ---- cloud: 0.3 -> 1.6 radius, quick fade in then out, slight rise ----
      if (!s.cloudless) {
        // R2j item 2: pop in with an overshoot, drift out and up, then shrink to
        // nothing individually. NO alpha - that was what merged the puffs into
        // one disc. Each ball owns its own clock.
        const t = s.t;
        const spread = CLOUD_SPREAD * k;
        const rise = Math.min(t, 0.5) * CLOUD_RISE * k;
        for (let i = 0; i < s.puffs.length; i++) {
          const p = s.puffs[i];
          const popAt = i * PUFF_STAGGER;
          const tPop = (t - popAt) / PUFF_POP;
          const shrinkAt = PUFF_SHRINK_AT + i * PUFF_STAGGER;
          const tShrink = (t - shrinkAt) / PUFF_SHRINK;
          let sc = 0;
          if (tPop > 0 && tPop < 1) {
            // 0 -> 1.15 -> 1.0 overshoot
            sc = tPop < 0.62
              ? (tPop / 0.62) * PUFF_OVERSHOOT
              : PUFF_OVERSHOOT - ((tPop - 0.62) / 0.38) * (PUFF_OVERSHOOT - 1);
          } else if (tPop >= 1) {
            sc = 1;
          }
          if (tShrink > 0) sc *= Math.max(0, 1 - tShrink * tShrink);
          if (sc <= 0.002) continue; // this ball is gone; do not emit it
          _p.set(
            s.x + p.dx * spread,
            s.y + p.dy * spread + rise,
            p.dz * spread
          );
          _s.setScalar(p.size * sc * k);
          _m.compose(_p, _q, _s);
          this.cloud.setMatrixAt(ci, _m);
          ci++;
        }
      }
      // ---- R2i item 3: a twinkle is the FRONT ring, never the inner sparkles ----
      if (s.cloudless && !s.burst) {
        const ru = clamp01(s.t / TWINKLE_LIFE);
        const ra = (ru < 0.12 ? smooth(ru / 0.12) : 1) * (1 - ru) * SPARK_ALPHA;
        const rr = (0.55 + ru * 0.75) * k;
        // R2j item 3: 0 -> 1.2 -> 1 pop, then an 8 Hz twinkle at 0.8-1.1.
        const pop = ru < TW_POP_AT / TWINKLE_LIFE ? 1.2 * smooth(ru / (TW_POP_AT / TWINKLE_LIFE)) : 1;
        const twink = 0.95 + 0.15 * Math.sin(this.time * Math.PI * 2 * TW_HZ + ru * 9);
        for (const rg of s.ring) {
          _p.set(s.x + rg.dx * rr, s.y + rg.dy * rr + 0.35 * k, FRONT_Z);
          _q.setFromAxisAngle(_AXIS_Z, this.time * rg.spin + rg.ph * TAU);
          const sc = rg.sc * k * pop * twink;
          _s.set(sc, sc, sc);
          _m.compose(_p, _q, _s);
          this.front.setMatrixAt(fi * 2, _m);
          this.front.setColorAt(fi * 2, _c.setHex(TW_CREAM));
          this.frontAlpha.array[fi * 2] = ra;
          _s.set(sc * 0.52, sc * 0.52, sc * 0.52);
          _m.compose(_p, _q, _s);
          this.front.setMatrixAt(fi * 2 + 1, _m);
          this.front.setColorAt(fi * 2 + 1, _c.setHex(TW_GOLD));
          this.frontAlpha.array[fi * 2 + 1] = ra;
          // the glow quad behind it, facing the camera, radius about 2x the star
          const gs = TW_STAR_OUTER * 4.4 * sc;
          _s.set(gs, gs, gs);
          _m.compose(_p, _q, _s);
          this.frontGlow.setMatrixAt(fi, _m);
          this.frontGlowAlpha.array[fi] = ra * TW_GLOW_ALPHA;
          fi++;
        }
        continue;
      }
      // ---- sparkles: fly outward, spin, fade ----
      const su = clamp01(s.t / SPARK_LIFE);
      const sa = (su < 0.1 ? smooth(su / 0.1) : 1) * (1 - su) * SPARK_ALPHA;
      for (const sp of s.sparks) {
        const d = (sp.ph + su) * sp.sp * k;
        _p.set(s.x + sp.dx * d, s.y + sp.dy * d + su * RISE * 0.6 * k, sp.dz * d);
        _q.setFromAxisAngle(
          _AXIS_Z,
          this.time * sp.spin + sp.ph * TAU
        );
        const sc = sp.sc * k * (1 - su * 0.45);
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        this.spark.setMatrixAt(si, _m);
        this.spark.setColorAt(si, _c.setHex(sp.col));
        this.sparkAlpha.array[si] = sa;
        si++;
      }
    }
    this.cloud.count = ci;
    this.spark.count = si;
    this.front.count = fi * 2;
    this.frontGlow.count = fi;
    this.cloud.instanceMatrix.needsUpdate = true;
    this.spark.instanceMatrix.needsUpdate = true;
    this.front.instanceMatrix.needsUpdate = true;
    this.sparkAlpha.needsUpdate = true;
    this.frontAlpha.needsUpdate = true;
    if (this.front.instanceColor) this.front.instanceColor.needsUpdate = true;
    if (this.cloud.instanceColor) this.cloud.instanceColor.needsUpdate = true;
    if (this.spark.instanceColor) this.spark.instanceColor.needsUpdate = true;
    this.cloud.visible = ci > 0;
    this.spark.visible = si > 0;
    this.front.visible = fi > 0;
    this.frontGlow.visible = fi > 0;
    this.frontGlow.instanceMatrix.needsUpdate = true;
    this.frontGlowAlpha.needsUpdate = true;
  }

  /** How many poofs are on screen right now - for the report and the probe. */
  liveCount() {
    let n = 0;
    for (const s of this.slots) if (s.live) n++;
    return n;
  }
}