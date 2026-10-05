/**
 * The bunny.
 *
 * Rebuilt in round 1e from Agata's assembled Photoshop puppets
 * (bunny-puppet-parts/bunny-front-puppet/bunny2.png), every number in units of
 * H — H being the TOTAL height, ears included, feet bottom at 0, +z forward.
 *
 * Two things give the puppet its look:
 *
 *  - FACETS. The cutouts are a LOW-segment UV sphere — big quad-ish facets in
 *    latitude bands — not a fine icosphere. Every solid part is a
 *    SphereGeometry at 12x8 (head, body) or 8x6 (limbs, tail), made non-indexed
 *    so computeVertexNormals gives hard flat shading, and jittered 3 % while
 *    the vertices are still shared by position so the surface cannot tear.
 *
 *  - SHAPE. The head is an EGG lying forward (Agata: "egg-shaped face at 3/4 is
 *    funnier than a snowman, and gives depth") — longer front-to-back than
 *    wide, widest at its lower third, with a flat bottom that sits straight
 *    down onto the body so there is no neck gap. The body is a squat vase. The
 *    ears are chunky 6-sided lathes, not thin blades. Colour is one flat tone
 *    per face picked from the face normal (see `paintByNormal`).
 *
 * The pink cheeks are blush, never a nose, and they are optional (`blush` flag /
 * `?noblush` / the B key).
 */

import * as THREE from 'three';
import { LOOK, onLook, hex, num } from '../game/look.js';
import { PALETTE } from '../core/palette.js';
import { CONFIG } from '../game/config.js';
import { jitterVertices, paintByNormal, radialTexture, sparkleGeometry } from '../render/facet.js';
import { softPlastic, eyeMaterial, blushMaterial } from '../render/materials.js';
import { clamp, clamp01, damp } from '../core/math.js';

const DEG = Math.PI / 180;
// R2j item 1: scratch objects for the dizzy star ring (no per-frame allocation).
const _dzM = new THREE.Matrix4();
const _dzQ = new THREE.Quaternion();
const _dzP = new THREE.Vector3();
const _dzS = new THREE.Vector3();
const _dzC = new THREE.Color();
const _dzZ = new THREE.Vector3(0, 0, 1);
// R2h item 2: floppy-spring drive gains (see updateFloppy).
const EAR_GAIN = 2.4; // R2h: raised from 2.4 baseline is unchanged; DRIVE_GROUND
// below is what buys the post-landing wobble.
const LIMB_GAIN = 1.0;
const DRIVE_AIR = 0.055;
const DRIVE_GROUND = 0.04;

/** Face jitter, as a fraction of each part's largest dimension. */
const JITTER = 0.03;
/** The tail is a lumpy puff, so it gets a heavier hand (R1e item 9). */
const TAIL_JITTER = 0.1;

/** Sphere segments: the puppet's big flat facets, not a smooth ball. */
const SEG_BIG = [12, 8];
const SEG_LIMB = [8, 6];

/**
 * Round 1e screen-box fit. R1d's box (705-822 x 528-703 at 1500x844) is 175 px
 * tall, and the brief says to keep it "by rescaling H at the end if needed".
 * At CONFIG.bunny.H = 2.67 the rebuilt bunny measures 149 px tall at the same
 * camera, so H is scaled by 175/149.
 *
 * Only the VISUAL height changes: `baseOffset = -colliderRadius / scale` does
 * not involve H, so the soles stay planted on the platform, and the collider
 * itself is untouched (it is `level.physics.radius` in config.js, outside this
 * round's scope - see the report).
 */
const H_FIT = 175 / 149;

/**
 * Head: an egg lying FORWARD, so rz > rx.
 *
 * R1e specified centre y = 0.61 with a flat bottom clamped at centre - 0.10,
 * which leaves a 0.10 gap between the head's flat underside (0.51) and the top
 * of the body (0.21 + 0.20 = 0.41). Measuring the puppet shows no such gap, so
 * per "when in doubt, the image wins" the head sits at 0.52: its flat bottom
 * lands on 0.42, right on the body's crown. That also puts the eyes (0.52) and
 * blush (0.49) at the right height ON the head — 32 % and 23 % of the way up —
 * instead of jammed against its underside. Widths and the z radii are the
 * brief's, measured against the puppet and agreeing within 6 %.
 */
const HEAD = { rx: 0.25, ry: 0.21, rz: 0.3, y: 0.52, z: 0.02, eggTaper: 0.18, lowThird: 0.08, flat: 0.128, muzzle: 0.02 };
/** Body: a squat vase, widest low, narrowing above the centre. */
const BODY = { rx: 0.22, ry: 0.2, rz: 0.2, y: 0.21, z: -0.02, taper: 0.4 };
/** Neck: buried in the head/body overlap, so a Round-2 head wobble shows no gap. */
const NECK = { r: 0.09, y0: 0.36, y1: 0.5 };
/**
 * Eyes and blush, placed on the head surface (see `headSurface`).
 *
 * Round 1f moved the eyes out to +/-0.20 (from +/-0.16) and up to 0.53, because
 * at 3/4 restYaw the player could see BOTH eyes and the near one sat too far
 * forward. Rabbit eyes are on the sides of the head, and at +/-0.20 the far eye
 * is fully hidden while the near one sits beside the blush.
 */
const EYE = { r: 0.032, x: 0.2, y: 0.53 };
const BLUSH = { r: 0.045, x: 0.23, y: 0.49, squash: 0.35 };
/**
 * Ears: chunky 6-sided lathes. Tilts are out / back, in degrees.
 *
 * R1e gave a max width of 0.11, but with a fast taper the ears rendered as thin
 * blades against the puppet's - the single biggest remaining difference. Two
 * changes fixed it, and only one of them was about width: the PROFILE now holds
 * most of its width out to ~75 % of the length before rounding off to a small
 * point (that was the real fix), while the width itself goes back DOWN to
 * 0.095, because the puppet's ears measure only ~0.169 H across and 0.11
 * already rendered at 0.221. Net 0.19 H across, +12 % on the puppet - see the
 * R1e report.
 */
const EAR = {
  len: 0.29,
  wMax: 0.095,
  wAt: 0.4,
  thickL: 0.07,
  thickR: 0.08,
  outL: 22,
  outR: 40,
  back: 6,
  x: 0.11,
  // 1.0 H - 0.29 H length: the ear TIP defines the top of the bunny, so the
  // unsunk base sits here and `sink` is taken up by extending the lathe
  // downwards instead (see facetedEar).
  y: 0.71,
  z: -0.02,
  sink: 0.05
};
/**
 * Arms (R1e item 7) and hind legs (item 8), in units of H.
 *
 * R1e pinned the shoulder at (0.13, 0.36, 0.08), but with BODY.rx 0.22 and
 * taper 0.40 the torso only reaches x = 0.10 at that height and 0.05 at that
 * depth, so the elbow landed OUTSIDE the body and each arm read as two balls
 * floating in mid air. The shoulder is pulled in to x 0.105 / z 0.03 and the
 * out angle widened to 40 deg, which roots the arm in the torso and still
 * carries the paw out to x ~0.21. The brief's "paws end near x +/-0.25,
 * y 0.23" is not reachable from a 0.36-high shoulder with a 0.28-long
 * two-segment arm (it would need ~63 deg of out angle, splaying him like a
 * scorpion) — see the R1e report.
 */
const ARM = {
  shoulderX: 0.105,
  shoulderY: 0.36,
  shoulderZ: 0.03,
  upper: [0.055, 0.07, 0.055],
  out: 40,
  fwd: 25,
  fore: [0.06, 0.07, 0.065],
  foreFwd: 45
};
const LEG = {
  hipX: 0.14,
  hipY: 0.1,
  hipZ: 0.04,
  thigh: [0.11, 0.11, 0.14],
  thighAt: [0.17, 0.12, 0.0],
  foot: [0.07, 0.06, 0.12],
  footAt: [0.21, 0.06, 0.14],
  footOut: 15
};
/**
 * R3b item 6: Agata - "I think the bunny lost his tail at some point." It was
 * still there (tailPivot -> spring -> mesh, visible), but its centre sat exactly
 * on the body's back surface, so at restYaw -50 it hid behind the body and the
 * thigh. Moved out and slightly larger so it reads as a lumpy puff on his
 * back-right in the game view.
 */
const TAIL = { r: 0.08, at: [0, 0.13, -0.27] };
/**
 * Resting yaw: EVERYTHING faces the viewer's LEFT with the tail showing on the
 * right, as in the original turnaround's 3/4 column and the hero image
 * (R1e item 10). plansza.png and the 3/4 puppet show him mirrored, so we keep
 * R1d's box size but not their facing. It lives in its own group OUTSIDE `root`
 * so squash/lean never fight it, and inside `group` so Round 2's tumbling can be
 * layered on top of it.
 */
const REST_YAW = -50;

/**
 * Round 1d: a whisper of self-illumination on the bunny's own materials only,
 * so his facets read bright lavender-white (#CCB7FB front, #F7A2FB lit) rather
 * than dull purple. The brief caps this at 0.15; the geometry, palette-driven
 * facet painting and everything else are untouched.
 */
const BUNNY_EMISSIVE = 0xe9dcff;
const BUNNY_EMISSIVE_INTENSITY = 0.12;

export class Bunny {
  constructor({ blush = true, scale = 1, colliderRadius = 0.4, H = CONFIG.bunny.H * H_FIT } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'bunny';
    /** World scale of the whole rig. */
    this.scale = scale;
    /** Radius of the physics circle this rig stands on. */
    this.colliderRadius = colliderRadius;
    /** The height unit every part is authored in (SPEC 4.1). */
    this.H = H;

    /** resting three-quarter turn, radians; Round 2 tumbles inside `yaw` */
    this.restYaw = REST_YAW * DEG;
    this.yaw = new THREE.Group();
    this.yaw.name = 'yaw';
    this.yaw.rotation.y = this.restYaw;
    this.group.add(this.yaw);

    /** root pivot used for squash / stretch so scale never fights rotation */
    this.root = new THREE.Group();
    this.yaw.add(this.root);

    // R2b: the FAKE ragdoll's tumble pivot - a rotation about z INSIDE yaw, so it
    // composes with restYaw instead of fighting it. No physics engine: a damped
    // spring driven by angular velocity and bounce impulses.
    this.tumble = new THREE.Group();
    this.tumble.name = 'tumble';
    this.yaw.add(this.tumble);
    this.tumbleAngle = 0;
    this.tumbleVel = 0;
    this.spin = 0;
    // Floppy springs in RADIANS. lower stiff = looser. Ears very loose so they
    // stream behind him and flap up while he falls; neck stiff; limbs flail.
    // R2h item 2: plush-toy floppiness. Agata - "the ears more floppy, same
    // as the hands etc. It'd be funnier, like you shoot a plush toy."
    //
    // The R2g numbers pinned the ears at EXACTLY the +/-70 deg clamp, so they
    // stopped moving the instant they arrived: a clamp is a wall, and a wall
    // reads as a stuck pose, not a toy. Every hard clamp is now a SOFT limit
    // applied only at output, angle = L * tanh(raw / L), which asymptotes
    // smoothly instead of stopping dead.
    //
    // `soft` is that limit L in radians; stiffness and damping are per the
    // brief's table (lower k AND lower damping ratio, so they overshoot and
    // wobble instead of arriving).
    this.floppySpec = {
      neck: { stiff: 55, damp: 0.35, soft: 0.610865 }, //      35 deg
      earBaseL: { stiff: 16, damp: 0.22, soft: 1.919862 }, //   110 deg
      earBaseR: { stiff: 16, damp: 0.22, soft: 1.919862 }, //   110 deg
      shoulderL: { stiff: 22, damp: 0.28, soft: 1.658063 }, //  95 deg
      shoulderR: { stiff: 22, damp: 0.28, soft: 1.658063 }, //  95 deg
      elbowL: { stiff: 22, damp: 0.28, soft: 1.658063 }, //     95 deg
      elbowR: { stiff: 22, damp: 0.28, soft: 1.658063 }, //     95 deg
      hipL: { stiff: 26, damp: 0.3, soft: 1.308997 }, //       75 deg
      hipR: { stiff: 26, damp: 0.3, soft: 1.308997 }, //       75 deg
      tailPivot: { stiff: 40, damp: 0.3, soft: 0.785398 } //    45 deg
    };
    this.floppy = new Map();
    this.dizzyT = 0;

    this.matBody = softPlastic({
      roughness: 0.72,
      envMapIntensity: 0.55,
      emissive: BUNNY_EMISSIVE,
      emissiveIntensity: BUNNY_EMISSIVE_INTENSITY
    });
    this.matHead = softPlastic({
      roughness: 0.7,
      envMapIntensity: 0.6,
      emissive: BUNNY_EMISSIVE,
      emissiveIntensity: BUNNY_EMISSIVE_INTENSITY
    });
    this.matEar = softPlastic({
      roughness: 0.74,
      envMapIntensity: 0.5,
      emissive: BUNNY_EMISSIVE,
      emissiveIntensity: BUNNY_EMISSIVE_INTENSITY
    });
    this.matEye = eyeMaterial();
    this.matHighlight = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0,
      emissive: 0xffffff,
      emissiveIntensity: 0.25,
      flatShading: false
    });

    this.blushEnabled = blush;
    this.matBlush = blushMaterial();
    // R1e item 5: Agata replaced the old mark — it was too oval and too
    // bright — with a round, softer one and NO emissive. The material factory
    // is out of scope for this round, so the emissive is zeroed here.
    this.matBlush.color.setHex(PALETTE.blush);
    this.matBlush.emissive.setHex(0x000000);
    this.matBlush.emissiveIntensity = 0;

    this.build();

    // --- animation state ---
    this.lean = 0;
    this.leanVel = 0;
    // R2b: `squash` now MEANS THE HEIGHT (1 = his normal shape), so it must
    // start at 1. It used to start at 0 back when the value was an offset, which
    // under the new meaning renders him at 60% height until something resets it.
    this.squash = 1;
    this.squashVel = 0;
    /** 0..1 pull strength, drives the crouch */
    this.pullPower = 0;
    this.facing = 1;
    this.earPhase = 0;
    this.earTrail = [0, 0];
    this.earTrailVel = [0, 0];
    this.glow = 0;
    this.glowTarget = 0;
    this.happyTimer = 0;
    this.blinkTimer = 2.4;
    this.blink = 0;
    this.time = 0;
  }

  // ---- construction --------------------------------------------------------

  /**
   * A faceted ellipsoid: a LOW-segment UV sphere scaled to its radii, jittered,
   * optionally reshaped by `shape`, then made non-indexed and painted.
   *
   * The jitter runs while the vertices are still shared by position, so the
   * surface never tears open; `facet`-style non-indexing then makes
   * computeVertexNormals produce hard per-face normals.
   *
   * @param {object} o
   * @param {number[]} o.radii  [rx, ry, rz] in world units
   * @param {number[]} o.at      where the part sits in rig units; this is also
   *   the mesh's offset inside `parent` unless `local` says otherwise
   * @param {number[]} [o.local] override the mesh offset (the head group already
   *   carries HEAD.y, so its mesh passes [0,0,0] and would otherwise land twice
   *   as far out)
   * @param {number[]} [o.seg]   sphere segments, default the big 12x8
   * @param {number} [o.jitter]  default 3 %
   * @param {(a:Float32Array, o:object)=>void} [o.shape] in-place vertex reshape.
   *   The shaper always works with the part's centre at the mesh-local origin,
   *   so it never has to know where the part ends up.
   */
  facetedPart({ radii, at, local = null, seg = SEG_BIG, seed, material, parent, jitter = JITTER, shape = null }) {
    const [rx, ry, rz] = radii;
    const geo = new THREE.SphereGeometry(1, seg[0], seg[1]);
    geo.scale(rx, ry, rz);
    if (shape) shape(geo.attributes.position.array, { rx, ry, rz, H: this.H });
    jitterVertices(geo, jitter, seed);
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();
    paintByNormal(flat);
    const mesh = new THREE.Mesh(flat, material);
    const off = local ?? at;
    mesh.position.set(off[0] * this.H, off[1] * this.H, off[2] * this.H);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * The head's egg: an ellipsoid lying forward, tapered toward the muzzle,
   * widest at its lower third and flattened underneath.
   *
   * @param {Float32Array} a  vertex positions, mesh-local (centre at the origin)
   * @param {object} o  { rx, ry, rz, H } in world units
   */
  static shapeHead(a, o) {
    const floorY = -HEAD.flat * o.H;
    for (let i = 0; i < a.length; i += 3) {
      const z = a[i + 2];
      const y = a[i + 1];

      // 1. egg taper: a narrower cross-section toward the muzzle (+z)
      if (z > 0) {
        const k = 1 - HEAD.eggTaper * (z / o.rz);
        a[i] *= k;
        a[i + 1] *= k;
      }
      // 2. widest at the lower third: swell what is above the centre, most at
      //    the centre itself and least at the crown
      if (y > 0) {
        const t = Math.min(1, y / o.ry);
        const k = 1 + HEAD.lowThird * (1 - t);
        a[i] *= k;
        a[i + 2] *= k;
      }
      // 3. a little extra muzzle / cheek mass low at the front
      if (z > 0 && y < 0) a[i + 2] += HEAD.muzzle * o.H;
      // 4. flat bottom, so the head sits straight down onto the body
      if (a[i + 1] < floorY) a[i + 1] = floorY;
    }
  }

  /**
   * Chunky 6-sided lathe ear: fat rounded base, widest at `wAt`, pointed tip.
   *
   * The profile starts EAR.sink BELOW the pivot so the base is buried in the
   * skull while the tip still lands exactly on 1.0 H — sinking by translating
   * the pivot instead would drop the tip short and shorten his ears.
   */
  facetedEar(seed, material, parent, thick) {
    const H = this.H;
    const base = -EAR.sink / EAR.len;
    const profile = [];
    const add = (t, r) => profile.push(new THREE.Vector2(r * H, t * EAR.len * H));
    add(base, EAR.wMax * 0.34);
    add(base * 0.45, EAR.wMax * 0.78);
    add(0.1, EAR.wMax * 0.92);
    add(EAR.wAt, EAR.wMax);
    add(0.62, EAR.wMax * 0.95);
    add(0.78, EAR.wMax * 0.78);
    add(0.9, EAR.wMax * 0.46);
    add(1.0, 0.0001);
    const geo = new THREE.LatheGeometry(profile, 6);
    // the lathe is a solid of revolution, so squash z to get the flat ear
    geo.scale(1, 1, thick / EAR.wMax);
    jitterVertices(geo, JITTER, seed);
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();
    paintByNormal(flat);
    const mesh = new THREE.Mesh(flat, material);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * A point on the front of the head plus its outward normal.
   *
   * The eyes sit well inside the egg, but the blush at x = 0.23 is close to the
   * 0.25 half-width and lands marginally OUTSIDE the plain ellipsoid — which is
   * correct, because in the puppet the blush is clipped by the head's
   * silhouette. So the (x, y) hint is projected onto the egg's cross-section
   * before solving for z: that keeps the mark on the skin at the outer cheek
   * instead of floating off it.
   *
   * @param {number} x rig-local x offset
   * @param {number} y rig-local y (sole = 0)
   */
  headSurface(x, y) {
    const H = this.H;
    const rx = HEAD.rx * H;
    const ry = HEAD.ry * H;
    const rz = HEAD.rz * H;
    const cy = HEAD.y * H;
    const cz = HEAD.z * H;

    let a = x / rx;
    let b = (y - cy) / ry;
    const r = Math.hypot(a, b);
    if (r > 0.995) {
      const k = 0.995 / r;
      a *= k;
      b *= k;
      x = a * rx;
      y = cy + b * ry;
    }
    const k2 = 1 - a * a - b * b;
    const s = k2 > 0 ? Math.sqrt(k2) : 0;
    const z = cz + s * rz;

    // the outward normal of the ellipsoid at that point
    const n = new THREE.Vector3(x / (rx * rx), (y - cy) / (ry * ry), (z - cz) / (rz * rz));
    if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
    else n.normalize();

    // head-group-local. The head group hangs off the neck pivot at 0.4H, so its
    // own offset is only (HEAD.y - 0.4)H — the ellipsoid solved above is
    // centred on the head's RIG-space centre, which is what has to come off.
    return { local: new THREE.Vector3(x, y - cy, z - cz), n };
  }

  build() {
    const H = this.H;
    this.baseOffset = -this.colliderRadius / this.scale;

    // ---- core: the physics body is a circle of radius `colliderRadius`
    // centred on the scene position, and the rig's feet sit at its own y = 0,
    // so dropping the root by the collider radius lands the soles exactly on
    // the bottom of that circle at any world scale.
    const core = new THREE.Group();
    core.name = 'core';
    this.core = core;
    this.body = core; // suit.js parents the helmet to this
    this.root.add(core);

    // ---- torso: a squat vase, widest low, tapering above the centre
    const bodyShape = (a, o) => {
      for (let i = 0; i < a.length; i += 3) {
        const y = a[i + 1];
        if (y <= 0) continue;
        const k = 1 - BODY.taper * Math.min(1, y / o.ry);
        a[i] *= k;
        a[i + 2] *= k;
      }
      // flat sole, so he sits flat on the platform instead of on a rounded pole
      let lo = Infinity;
      for (let i = 1; i < a.length; i += 3) lo = Math.min(lo, a[i]);
      const sole = lo + 0.02 * o.H;
      for (let i = 1; i < a.length; i += 3) if (a[i] < sole) a[i] = sole;
    };
    this.facetedPart({
      radii: [BODY.rx * H, BODY.ry * H, BODY.rz * H],
      at: [0, BODY.y, BODY.z],
      seed: 1301,
      material: this.matBody,
      parent: core,
      shape: bodyShape
    });

    // ---- neck: a stub cylinder bridging body and head, buried in both so a
    // Round-2 head wobble can never open a gap
    const neckGeo = new THREE.CylinderGeometry(NECK.r * H, NECK.r * H, (NECK.y1 - NECK.y0) * H, 10, 1, false);
    neckGeo.translate(0, ((NECK.y0 + NECK.y1) / 2) * H, 0);
    jitterVertices(neckGeo, JITTER, 1501);
    neckGeo.computeVertexNormals();
    paintByNormal(neckGeo);
    core.add(new THREE.Mesh(neckGeo, this.matBody));

    // ---- neck pivot -> head: one big egg dome sitting straight down into the
    // body, so there is no neck gap
    const neck = new THREE.Group();
    neck.name = 'neck';
    neck.position.set(0, 0.4 * H, 0);
    core.add(neck);

    const head = new THREE.Group();
    head.name = 'head';
    head.position.set(0, (HEAD.y - 0.4) * H, HEAD.z * H);
    neck.add(head);
    this.head = head;

    this.facetedPart({
      radii: [HEAD.rx * H, HEAD.ry * H, HEAD.rz * H],
      at: [0, HEAD.y, HEAD.z],
      // the head group already sits at HEAD.y, so the mesh itself is centred
      local: [0, 0, 0],
      seed: 2207,
      material: this.matHead,
      parent: head,
      shape: Bunny.shapeHead
    });

    // ---- ears: chunky lathes, bases sunk into the skull. Viewer-left splays
    // 22 deg, viewer-right 40 deg; both tip 6 back. The right one is thicker.
    const earL = new THREE.Group();
    earL.name = 'earBaseL';
    earL.position.set(-EAR.x * H, (EAR.y - HEAD.y) * H, (EAR.z - HEAD.z) * H);
    earL.rotation.set(-EAR.back * DEG, 0, EAR.outL * DEG);
    head.add(earL);

    const earR = new THREE.Group();
    earR.name = 'earBaseR';
    earR.position.set(EAR.x * H, (EAR.y - HEAD.y) * H, (EAR.z - HEAD.z) * H);
    earR.rotation.set(-EAR.back * DEG, 0, -EAR.outR * DEG);
    head.add(earR);

    // The base is already buried by the lathe profile, so the pivot itself is not
    // pushed down.
    this.facetedEar(3301, this.matEar, earL, EAR.thickL);
    this.facetedEar(3407, this.matEar, earR, EAR.thickR);

    this.ears = [
      { pivot: earL, side: 'L', sx: -1, phase: 0, rest: { x: -EAR.back * DEG, z: EAR.outL * DEG } },
      { pivot: earR, side: 'R', sx: 1, phase: 1.9, rest: { x: -EAR.back * DEG, z: -EAR.outR * DEG } }
    ];
    /** every pivot Round 2 animates */
    this.pivots = {
      neck,
      earL,
      earR,
      armL: null,
      armR: null,
      elbowL: null,
      elbowR: null,
      footL: null,
      footR: null,
      tail: null
    };

    // ---- arms: out to the sides and forward, paws ending near x +/- 0.25
    for (const sx of [-1, 1]) {
      const L = sx < 0;
      const key = L ? 'armL' : 'armR';
      const pivot = new THREE.Group();
      pivot.name = `shoulder${L ? 'L' : 'R'}`;
      pivot.position.set(sx * ARM.shoulderX * H, ARM.shoulderY * H, ARM.shoulderZ * H);
      // Swing the whole arm out and FORWARD. A limb hanging down the local -y
      // swings towards +z (forward) only under a NEGATIVE x rotation:
      // Rx(t) maps (0,-1,0) to (0, -cos t, -sin t), so t < 0 gives +z.
      pivot.rotation.set(-ARM.fwd * DEG, 0, sx * ARM.out * DEG);
      core.add(pivot);
      this.pivots[key] = pivot;

      const upper = this.facetedPart({
        radii: [ARM.upper[0] * H, ARM.upper[1] * H, ARM.upper[2] * H],
        at: [0, -ARM.upper[1], 0],
        seg: SEG_LIMB,
        seed: 4409 + sx * 7,
        material: this.matBody,
        parent: pivot
      });

      // elbow sits at the far end of the upper arm
      const elbow = new THREE.Group();
      elbow.name = `elbow${L ? 'L' : 'R'}`;
      elbow.position.set(0, -ARM.upper[1] * 2 * H, 0);
      pivot.add(elbow);
      this.pivots[L ? 'elbowL' : 'elbowR'] = elbow;

      // forearm + paw, bent further forward
      const fore = new THREE.Group();
      fore.rotation.x = -ARM.foreFwd * DEG;
      elbow.add(fore);
      this.facetedPart({
        radii: [ARM.fore[0] * H, ARM.fore[1] * H, ARM.fore[2] * H],
        at: [0, -ARM.fore[1], 0],
        seg: SEG_LIMB,
        seed: 4703 + sx * 7,
        material: this.matBody,
        parent: fore
      });
      void upper;
    }

    // ---- hind legs: a big round thigh plus a foot pointing forward and out
    for (const sx of [-1, 1]) {
      const L = sx < 0;
      const pivot = new THREE.Group();
      pivot.name = `hip${L ? 'L' : 'R'}`;
      pivot.position.set(sx * LEG.hipX * H, LEG.hipY * H, LEG.hipZ * H);
      core.add(pivot);
      this.pivots[L ? 'footL' : 'footR'] = pivot;

      this.facetedPart({
        radii: [LEG.thigh[0] * H, LEG.thigh[1] * H, LEG.thigh[2] * H],
        at: [sx * (LEG.thighAt[0] - LEG.hipX), LEG.thighAt[1] - LEG.hipY, LEG.thighAt[2] - LEG.hipZ],
        seg: SEG_LIMB,
        seed: 5501 + sx * 11,
        material: this.matBody,
        parent: pivot
      });

      const foot = new THREE.Group();
      foot.position.set(
        sx * (LEG.footAt[0] - LEG.hipX) * H,
        (LEG.footAt[1] - LEG.hipY) * H,
        (LEG.footAt[2] - LEG.hipZ) * H
      );
      foot.rotation.y = sx * LEG.footOut * DEG;
      pivot.add(foot);
      this.facetedPart({
        radii: [LEG.foot[0] * H, LEG.foot[1] * H, LEG.foot[2] * H],
        at: [0, 0, 0],
        seg: SEG_LIMB,
        seed: 5701 + sx * 11,
        material: this.matBody,
        parent: foot
      });
    }

    // ---- tail: a lumpy puff behind
    const tail = new THREE.Group();
    tail.name = 'tailPivot';
    tail.position.set(TAIL.at[0] * H, TAIL.at[1] * H, TAIL.at[2] * H);
    core.add(tail);
    this.pivots.tail = tail;
    this.facetedPart({
      radii: [TAIL.r * H, TAIL.r * H, TAIL.r * H],
      at: [0, 0, 0],
      seg: SEG_LIMB,
      seed: 6607,
      jitter: TAIL_JITTER,
      material: this.matBody,
      parent: tail
    });

    // ---- eyes: dark teal, faceted, on the head surface and pushed out along its
    // normal. The white catchlight rides on top.
    this.eyes = [];
    const eyeR = EYE.r * H;
    // IcosahedronGeometry already ships non-indexed, so the facets are hard
    const eyeGeo = new THREE.IcosahedronGeometry(eyeR, 1);
    eyeGeo.computeVertexNormals();
    for (const sx of [-1, 1]) {
      const { local, n } = this.headSurface(sx * EYE.x * H, EYE.y * H);
      const eye = new THREE.Mesh(eyeGeo, this.matEye);
      eye.position.copy(local).addScaledVector(n, 0.35 * eyeR);
      head.add(eye);
      this.eyes.push(eye);

      // tiny white catchlight, upper-left and towards the camera
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.0095 * H, 10, 8), this.matHighlight);
      spark.position.set(-0.42 * eyeR, 0.5 * eyeR, 0.78 * eyeR);
      eye.add(spark);
    }

    // ---- R2j item 1: the "x x" dizzy eyes ---------------------------------
    // Two thin crossed boxes per eye, on the SAME surface point and normal as the
    // real eye, hidden until a hard landing. Length 0.05 H, thickness 0.012 H,
    // in the eye colour (matEye is the dark teal #023D4A).
    this.xEyes = [];
    const xBar = new THREE.BoxGeometry(0.05 * H, 0.012 * H, 0.012 * H);
    const faceFwd = new THREE.Vector3(0, 0, 1);
    for (const sx of [-1, 1]) {
      const { local, n } = this.headSurface(sx * EYE.x * H, EYE.y * H);
      const g = new THREE.Group();
      g.position.copy(local).addScaledVector(n, 0.35 * eyeR);
      g.quaternion.setFromUnitVectors(faceFwd, n);
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(xBar, this.matEye);
        bar.rotation.z = rot;
        g.add(bar);
      }
      g.visible = false;
      g.scale.setScalar(0.0001);
      head.add(g);
      this.xEyes.push(g);
    }

    // ---- R2j item 1: the three orbiting dizzy stars ------------------------
    // ONE InstancedMesh, 6 instances = 3 stars x 2 layers (a #FFE7A8 star with a
    // smaller #F4C766 core, so it is two-tone without a second draw call). It is
    // a child of `head`, so the ring follows the head pivot rather than the world.
    this.matDizzy = new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false });
    this.dizzyStars = new THREE.InstancedMesh(
      sparkleGeometry(0.12, 0.04, 0.05, 4),
      this.matDizzy,
      6
    );
    this.dizzyStars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dizzyStars.frustumCulled = false;
    this.dizzyStars.name = 'dizzyStars';
    const ringTilt = new THREE.Group(); // the 15 deg lean toward the camera
    ringTilt.rotation.x = -15 * DEG;
    const ringSpin = new THREE.Group(); // the orbit itself
    ringSpin.add(this.dizzyStars);
    ringTilt.add(ringSpin);
    ringTilt.position.y = 0.75 * H; // ~0.15 H above the crown
    ringTilt.visible = false;
    head.add(ringTilt);
    this.dizzyRing = ringTilt;
    this.dizzySpin = ringSpin;
    this.dizzyStarR = 0.35 * H;

    // ---- blush: a ROUND, softer mark at the outer cheek, just below and
    // outside each eye. A flat disc would sit coplanar with the skin and
    // flicker; a squashed ball intersects it along a clean curve instead.
    this.blushGroup = new THREE.Group();
    head.add(this.blushGroup);
    const blushGeo = new THREE.IcosahedronGeometry(BLUSH.r * H, 1);
    blushGeo.computeVertexNormals();
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const sx of [-1, 1]) {
      const { local, n } = this.headSurface(sx * BLUSH.x * H, BLUSH.y * H);
      const b = new THREE.Mesh(blushGeo, this.matBlush);
      b.position.copy(local);
      b.quaternion.setFromUnitVectors(fwd, n);
      b.scale.set(1, 1, BLUSH.squash);
      this.blushGroup.add(b);
    }
    this.blushGroup.visible = this.blushEnabled;

    // ---- "full" glow: collects star energy, brightens as he eats
    const glowTex = radialTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color(PALETTE.goldPale),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.glowSprite = new THREE.Sprite(glowMat);
    this.glowSprite.scale.set(2.6, 2.6, 1);
    this.glowSprite.position.set(0, 0.8, -0.1);
    this.root.add(this.glowSprite);

    // subtle contact shadow blob (also useful in flight, reads as height).
    // depthTest stays ON: with it off this transparent quad draws over the
    // bunny itself and cuts a horizontal band across his body.
    // Round 1l item 1: a deep VIOLET #5A2A8A contact shadow, not grey, so the bunny
    // sits ON the cushion instead of merging with it.
    const shadowHex = LOOK.bunny.shadowColor || '5a2a8a';
    const shadowRGB = 'rgba(' +
      parseInt(shadowHex.slice(0, 2), 16) + ',' +
      parseInt(shadowHex.slice(2, 4), 16) + ',' +
      parseInt(shadowHex.slice(4, 6), 16) + ',';
    const shadowTex = radialTexture(shadowRGB + '0.62)', shadowRGB + '0)');
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: num(LOOK.bunny.shadowOpacity, 0.28),
      depthWrite: false
    });
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    // not a child of `group`: the shadow must not inherit the world scale
    this.contactShadow.scale.setScalar(1 / this.scale);
    this.group.add(this.contactShadow);

    this.applyScale();
    onLook(() => this.applyShadowLook());
  }

  /** Round 1m: the panel's Bunny folder - opacity and radius only. */
  applyShadowLook() {
    if (this.contactShadow) {
      this.contactShadow.material.opacity = num(LOOK.bunny.shadowOpacity, 0.28);
    }
  }

  /**
   * R2b: launch sets an angular velocity whose SIGN comes from which way he was
   * thrown and whose MAGNITUDE scales with power. A damped spring returns it to
   * 0, so on READY he eases upright over ~0.4 s and never snaps.
   */
  updateTumble(dt, s) {
    // R2g item 2 (my R2b D2): the restoring spring was eating the whole rotation -
    // spin was set correctly (3.95 rad/s on a -20 deg throw) but tumbleAngle
    // peaked at 0.076 rad, 4.3 degrees, so he never visibly turned over.
    //
    // Now: in FLIGHT he integrates spin with only light air damping (~0.3/s) and
    // NO restoring spring, so he keeps turning. On READY (and when DROPPING
    // starts) he eases to the NEAREST upright - a multiple of 2pi - over ~0.4 s,
    // so he never snaps and never unwinds the long way round.
    if (s.aiming) {
      const ax = s.aimingDir ? s.aimingDir.x : 0;
      this.spin = damp(this.spin, -ax * 3.2 * (this.pullPower || 0), 8, dt);
    } else if (s.airborne) {
      this.spin *= Math.max(0, 1 - 0.3 * dt);
    } else {
      this.spin = damp(this.spin, 0, 6, dt);
    }
    if (!Number.isFinite(this.spin)) this.spin = 0;
    this.spin = clamp(this.spin, -14, 14);

    if (s.airborne) {
      this.tumbleAngle += this.spin * dt;
      this.tumbleVel = this.spin;
    } else {
      // nearest upright: how many whole turns are we past?
      const upright = Math.round(this.tumbleAngle / (Math.PI * 2)) * Math.PI * 2;
      this.tumbleVel += (-(this.tumbleAngle - upright) * 46 - this.tumbleVel * 2 * Math.sqrt(46) * 0.95) * dt;
      this.tumbleAngle += this.tumbleVel * dt;
      if (Math.abs(this.tumbleAngle - upright) < 0.004) {
        this.tumbleAngle = upright;
        this.tumbleVel = 0;
      }
    }
    if (!Number.isFinite(this.tumbleAngle)) {
      this.tumbleAngle = 0;
      this.tumbleVel = 0;
    }
    this.tumble.rotation.z = this.tumbleAngle;
  }

  /**
   * R2b: floppy parts on damped springs, driven by the body's acceleration in
   * the bunny's LOCAL frame, so the ears stream behind him in flight and flap up
   * while he falls. Every angle is clamped and every divide guarded, because a
   * NaN here silently scales the whole rig away (R1b's finding).
   *
   * The pivots are local consts in the builder, not this.<name>, so they are
   * indexed by their own names once: neck, earBaseL/R, shoulderL/R, elbowL/R,
   * hipL/R, tailPivot.
   */
  /** Resolve a rig node by its own name - the floppy pivots are local consts. */
  findByName(name) {
    let hit = null;
    this.yaw.traverse((n) => {
      if (!hit && n.isObject3D && n.name === name) hit = n;
    });
    return hit;
  }

  updateFloppy(dt, s) {
    if (!this._floppyNodes) {
      // R2g item 1 (my R2b D3 + D6): the pre-existing "trailing ears" block
      // BELOW this one writes ear.pivot.rotation.z, so my springs and it were
      // fighting over one property - which is why the ears reached 1.788 rad
      // despite a 1.222 clamp, and why an absolute assignment risked flattening
      // the authored rest tilt (left 22, right 40).
      //
      // Fix: each spring gets its OWN identity child group between the pivot
      // and its meshes. The pivot keeps the rest tilt and the trail; the spring
      // adds on top and can no longer be overwritten. Identity, so the authored
      // pose is bit-for-bit unchanged at rest.
      this._floppyNodes = new Map();
      // ONLY the pivots in floppySpec get a spring group. Wrapping EVERY named
      // node recursed without bound - the wrapper is itself a named child, so
      // traverse reached it, wrapped it again, and updateMatrixWorld blew the
      // stack. Caught in a preview build; node --check passed straight through.
      for (const key of Object.keys(this.floppySpec)) {
        const pivot = this.findByName(key);
        if (!pivot) continue;
        const inner = new THREE.Group();
        inner.name = key + "__spring";
        while (pivot.children.length) inner.add(pivot.children[0]);
        pivot.add(inner);
        this._floppyNodes.set(key, inner);
      }
    }
    const ax = Number.isFinite(s.accelX) ? s.accelX : 0;
    const ay = Number.isFinite(s.accelY) ? s.accelY : 0;
    const cy = Math.cos(this.restYaw);
    const sy2 = Math.sin(this.restYaw);
    const lax = ax * cy - ay * sy2;
    const lay = ax * sy2 + ay * cy;
    // R2h item 2 gains, measured against the brief's targets (ears >= 80 deg
    // through a full-power shot, arms >= 40 deg). The deadzone matters more than
    // the gain: at rest the velocity derivative is float noise, and feeding that
    // to a soft k=16 spring left the ears parked 1.3 deg off the authored tilt
    // and never let them go. Below 0.05 m/s the drive is exactly zero, so at rest
    // they return EXACTLY to the authored pose.
    const still = Math.hypot(s.vx, s.vy) < 0.05;
    const drive = still ? 0 : s.airborne ? DRIVE_AIR : DRIVE_GROUND;
    for (const key of Object.keys(this.floppySpec)) {
      const spec = this.floppySpec[key];
      let rec = this.floppy.get(key);
      if (!rec) {
        rec = { a: 0, v: 0 };
        this.floppy.set(key, rec);
      }
      const isEar = key.indexOf('ear') === 0;
      // SOFT limit on the target too, so the spring is never handed a wall.
      const L = spec.soft;
      let rawTgt = isEar ? -lay * drive * EAR_GAIN : -lax * drive * LIMB_GAIN;
      // R3d item 3: the ear fold, >= 65 deg back, so the helmet encloses them.
      if (isEar && this.suitFold) {
        rawTgt += this.suitFold * 0 * (key === 'earBaseL' ? 1 : -1); // reviewer: no ear fold under the helmet
      }
      // R3d item 4: thrust streams the limbs and ears down from the speed.
      if (this.thrustStream > 1 && !isEar) {
        rawTgt += Math.min(1.4, this.thrustStream * 0.032) * (key.endsWith('L') ? -1 : 1);
      } else if (this.thrustStream > 1 && isEar) {
        rawTgt += Math.min(1.1, this.thrustStream * 0.026);
      }
      const tgt = L * Math.tanh(rawTgt / L);
      rec.v += (-(rec.a - tgt) * spec.stiff - rec.v * 2 * Math.sqrt(spec.stiff) * spec.damp) * dt;
      rec.a += rec.v * dt;
      if (!Number.isFinite(rec.a)) {
        rec.a = 0;
        rec.v = 0;
      }
      // R2h: NO hard clamp on rec.a. The oscillator is free to overshoot (that IS
      // the wobble); the soft limit below is what the renderer sees.
      const node = this._floppyNodes.get(key);
      if (node) node.rotation.z = L * Math.tanh(rec.a / L);
    }
  }

  /**
   * R2i item 1: land him like a thrown plush toy. A velocity impulse into each
   * spring's VELOCITY (not its angle) so the overshoot is real: with k = 16 the
   * ears need a shove of this size to swing past 70 deg and keep ringing.
   * Left and right get opposite signs so the limbs splay instead of folding
   * together.
   */
  /**
   * R3d item 3: while the suit is on, fold the ears back along his back so they
   * sit behind the helmet instead of poking through it as a clipping mess.
   * @param {boolean} on
   */
  setSuitFold(on) {
    this.suitFold = on ? 1 : 0;
    // Reviewer fix 2026-10-05 (Agata: "bring his ears back, I'd rather see them
    // stick out than have a bald bunny"): the ears are NEVER hidden or folded for
    // the helmet. They stay in their normal pose, poking through the dome.
    for (const k of ['earL', 'earR']) if (this.pivots[k]) this.pivots[k].visible = true;
  }

  /**
   * R3d item 4: while thrusting, stream the arms, legs and ears DOWN from the
   * speed. This is a drive added to the springs, not a hard-set pose.
   * @param {number} v blast speed
   */
  setThrustStream(v) {
    this.thrustStream = Number.isFinite(v) ? v : 0;
  }

  kickRagdoll(strength = 1) {
    if (!Number.isFinite(strength)) return;
    const splay = { hipL: -1, hipR: 1, elbowL: -1, elbowR: 1, shoulderL: -1, shoulderR: 1 };
    for (const [key, rec] of this.floppy) {
      if (!rec) continue;
      const isEar = key.indexOf('ear') === 0;
      const gain = isEar ? 6.5 : key === 'neck' ? 4.0 : key === 'tailPivot' ? 3.0 : 3.5;
      rec.v += strength * gain * (splay[key] ?? 1);
    }
  }

  /**
   * R2j item 1: he is dizzy. 1.2 s from the LAST qualifying impact, so a tumble
   * down the glass re-arms it each time rather than expiring mid-sequence.
   */
  setDizzy(dur = 1.2) {
    this.dizzyT = Math.max(this.dizzyT || 0, dur);
    this.dizzyDur = dur;
  }

  /** R2j item 1: orbit the stars, sway the head, fade out over the last 0.2 s. */
  updateDizzy(dt) {
    const on = this.dizzyT > 0;
    if (on) this.dizzyT -= dt;
    // 0.2 s quick fade, as specified. Done by scaling the whole presentation to
    // zero rather than by an alpha ramp, so it needs no shader work and stays
    // inside the one InstancedMesh.
    const k = on ? clamp01(this.dizzyT / 0.2) : 0;
    for (const e of this.xEyes) {
      e.visible = on && k > 0.02;
      e.scale.setScalar(Math.max(0.0001, k));
    }
    for (const eye of this.eyes) eye.visible = !on;
    if (!on) {
      this.dizzyRing.visible = false;
      return;
    }
    this.dizzyRing.visible = true;
    this.dizzyRing.scale.setScalar(Math.max(0.0001, k));
    // about 2 turns/s
    this.dizzySpin.rotation.z = this.time * Math.PI * 4;
    const cols = [0xffe7a8, 0xf4c766, 0xffe7a8, 0xf4c766, 0xffe7a8, 0xf4c766];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const px = Math.cos(a) * this.dizzyStarR;
      const py = Math.sin(a) * this.dizzyStarR;
      // outer #FFE7A8 star, then a smaller #F4C766 core on top of it
      _dzP.set(px, py, 0);
      _dzQ.setFromAxisAngle(_dzZ, this.time * 1.6 + i * 2.1);
      _dzS.setScalar(1).multiplyScalar(k);
      _dzM.compose(_dzP, _dzQ, _dzS);
      this.dizzyStars.setMatrixAt(i * 2, _dzM);
      this.dizzyStars.setColorAt(i * 2, _dzC.setHex(cols[i * 2]));
      _dzS.setScalar(0.5).multiplyScalar(k);
      _dzM.compose(_dzP, _dzQ, _dzS);
      this.dizzyStars.setMatrixAt(i * 2 + 1, _dzM);
      this.dizzyStars.setColorAt(i * 2 + 1, _dzC.setHex(cols[i * 2 + 1]));
    }
    this.dizzyStars.instanceMatrix.needsUpdate = true;
    if (this.dizzyStars.instanceColor) this.dizzyStars.instanceColor.needsUpdate = true;
  }

  /** R2b: R1b's finding - every entry point that restarts him must clear ALL of it. */
  resetRagdoll() {
    this.squash = 1;
    this.squashVel = 0;
    // R2g: snap the tumble to the nearest upright, not to zero - otherwise a
    // bunny who has turned 1.5 turns unwinds all of them on the next reset.
    this.tumbleAngle = Math.round(this.tumbleAngle / (Math.PI * 2)) * Math.PI * 2;
    this.tumbleVel = 0;
    this.spin = 0;
    this.dizzyT = 0;
    this.floppy.clear();
    this.tumble.rotation.z = 0;
    this.root.scale.set(1, 1, 1);
  }

  applyScale() {
    this.group.scale.setScalar(this.scale);
    // the rig's soles live at its own y = 0, so this is all it takes to keep
    // them glued to the bottom of the collider circle at any world scale
    this.root.position.y = this.baseOffset;
  }

  setScale(s) {
    this.scale = s;
    this.baseOffset = -this.colliderRadius / s;
    this.applyScale();
  }

  setBlush(on) {
    this.blushEnabled = on;
    this.blushGroup.visible = on;
  }

  /** Called on star pickup. */
  onFed(intensity = 1) {
    this.glowTarget = clamp01(this.glowTarget + 0.34 * intensity);
    this.happyTimer = 0.85;
    this.squashVel -= 3.2 * intensity;
  }

  /** Pop used when landing on a node. */
  pop(strength = 1) {
    this.squashVel -= 6.5 * strength; // reviewer fix: a pop SQUASHES (height down) under the new meaning
    this.happyTimer = Math.max(this.happyTimer, 0.5);
  }

  // ---- per frame -----------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} s  { x, y, vx, ax, speed, airborne, aiming, aimingDir, pullPower, groundY }
   */
  update(dt, s) {
    this.time += dt;
    // R3d item 4: ease toward a requested yaw. The finale sets restYawTarget = 0
    // so he turns to FACE THE CAMERA and the helmet and face read.
    if (this.restYawTarget !== undefined) {
      this.yaw.rotation.y = damp(this.yaw.rotation.y, this.restYawTarget, 6, dt);
    }

    // ---- squash & stretch (REWRITTEN in R2b) --------------------------------
    // Three reviewer bugs, all three fixed here:
    //  (a) sign inverted - sy was 1 + squash, so a POSITIVE squash made him
    //      TALLER, airborne had a NEGATIVE target (short and fat in flight) and
    //      impacts added +squashVel (tall and thin on landing). `squash` now
    //      MEANS the height directly.
    //  (b) speedT divided by 11 while launch speeds now reach maxSpeed 38, so it
    //      was permanently saturated. Normalised by maxSpeed now.
    //  (c) sxz = 1 - 0.72*squash is not volume preserving. It is 1/sqrt(sy).
    // Resting target is exactly 1.0 - R2c left a permanent +0.06 offset, so he
    // was never quite his own shape even standing still.
    const maxSpeed = Math.max(1, this.maxSpeed || 38);
    const speedT = clamp01(s.speed / maxSpeed);
    let target;
    if (s.aiming) target = 1 - (0.1 + this.pullPower * 0.12);
    else if (s.airborne) target = 1 + speedT * 0.25;
    else target = 1;
    target = clamp(target, 0.75, 1.25);

    // Spring back to target. Damping stays comfortably above critical so a
    // dropped frame cannot push the solver unstable and blow up to NaN.
    const k = 170;
    const c = 2 * Math.sqrt(k) * 0.9;
    this.squashVel += (-(this.squash - target) * k - this.squashVel * c) * dt;
    this.squash += this.squashVel * dt;
    if (!Number.isFinite(this.squash)) {
      this.squash = target;
      this.squashVel = 0;
    }
    // Reviewer fix 2026-10-05: this was the OLD clamp (-0.5..0.55) left under the
    // new meaning (squash = height, 1 = normal), so he was pinned at 0.6 height.
    this.squash = clamp(this.squash, 0.75, 1.25); // R2b spec: squash ≥ 0.75, stretch ≤ 1.25

    const sy = clamp(Number.isFinite(this.squash) ? this.squash : 1, 0.75, 1.25);
    const sxz = 1 / Math.sqrt(Math.max(0.05, sy));
    this.root.scale.set(sxz, sy, sxz);
    this.root.position.y = this.baseOffset;

    // ---- R2b: the FAKE ragdoll ---------------------------------------------
    // R2g: updateFloppy reads s.accelX / s.accelY, but game.js only hands over
    // `ax` - a SCALAR that mixes vx and vy ((dvx)*0.02 + (dvy)*0.02). So both
    // components arrived as 0 on every frame since R2b and every floppy target
    // was exactly 0: the ears, shoulders, elbows and hips never moved at all.
    //
    // Rather than widen the game -> bunny contract I derive a real 2D
    // acceleration here, from successive positions, and hand IT to the springs.
    // Gravity is then subtracted, because a constant pull is not what makes
    // ears flop - only the jerk of a launch, an impact or a landing does.
    const kinDt = Math.max(1e-4, dt);
    if (!this._kin) this._kin = { x: s.x, y: s.y, vx: 0, vy: 0 };
    const kin = this._kin;
    const nvx = (s.x - kin.x) / kinDt;
    const nvy = (s.y - kin.y) / kinDt;
    // A long frame (tab was backgrounded) would make this enormous; skip it.
    const jump = Math.abs(nvx) > 400 || Math.abs(nvy) > 400;
    let accelX = jump ? 0 : (nvx - kin.vx) / kinDt;
    let accelY = jump ? 0 : (nvy - kin.vy) / kinDt + 36; // +36 cancels gravity
    kin.x = s.x;
    kin.y = s.y;
    kin.vx = nvx;
    kin.vy = nvy;
    if (!Number.isFinite(accelX)) accelX = 0;
    if (!Number.isFinite(accelY)) accelY = 0;
    // R2g item 2: the render state is the WRONG clock for the tumble. He is
    // only in FLYING for 0.50 s (he clears the top of the view that fast), then
    // hangs at the apex for 0.8 s in OFFSCREEN and falls in DROPPING - 2.31 s
    // of air time in total. So the ragdoll treats "in flight" as PHYSICS: off
    // the surface. At rest his collider bottom sits exactly on it (y - groundY
    // == colliderRadius), hence the radius + 0.35 tolerance.
    const aboveSurface = s.y - s.groundY > (this.colliderRadius || 1.19) + 0.35;
    // Ears and limbs are dragged by AIR, not pulled by gravity, so the sustained
    // drive is velocity - which is what the pre-existing trailing-ears block
    // already uses (-s.vx * 0.055). Acceleration ALONE peaked the ears at 2.6
    // degrees: it is a single-frame impulse at launch and a spring of stiffness
    // 42 cannot answer it in 1/180 s, and with gravity cancelled it is then ~0
    // for the whole flight. DRAG is what holds them back; the jerk term is
    // layered on top for the snap of the launch and the slap of a landing.
    const DRAG = 1.6;
    const ragdollS = {
      x: s.x,
      y: s.y,
      vx: nvx,
      // R2h: vy was MISSING from this object, so updateFloppy's rest deadzone
      // Math.hypot(s.vx, s.vy) was NaN - never true - and the ears sat parked
      // 1.27 deg off the authored tilt at rest instead of returning exactly.
      vy: nvy,
      ax: s.ax,
      speed: s.speed,
      airborne: s.airborne || aboveSurface,
      aiming: s.aiming,
      aimingDir: s.aimingDir,
      pullPower: s.pullPower,
      groundY: s.groundY,
      accelX: clamp(nvx * DRAG + accelX * 0.02, -70, 70),
      accelY: clamp(nvy * DRAG + accelY * 0.02, -70, 70)
    };
    this.updateTumble(dt, ragdollS);
    this.updateFloppy(dt, ragdollS);
    this.updateDizzy(dt);
    // R2j item 1, optional cute touch: the head sways gently while dizzy. It goes
    // on the neck spring group's X, which updateFloppy never writes (it owns Z
    // only), and on the spring group rather than the pivot so it cannot fight the
    // reviewer's neck.rotation.x squash line.
    const neckSpring = this._floppyNodes && this._floppyNodes.get('neck');
    if (neckSpring) {
      neckSpring.rotation.x = this.dizzyT > 0 ? Math.sin(this.time * Math.PI * 4) * 8 * DEG : 0;
    }

    // ---- body lean toward travel direction ---------------------------------
    let leanTarget = 0;
    if (s.aiming && s.aimingDir) {
      // lean back against the pull direction
      leanTarget = -s.aimingDir.x * 0.3;
    } else if (s.vx !== undefined) {
      leanTarget = clamp(s.vx / 14, -0.42, 0.42);
    }
    const leanK = 60;
    this.leanVel += (-(this.lean - leanTarget) * leanK - this.leanVel * 2 * Math.sqrt(leanK) * 0.7) * dt;
    this.lean += this.leanVel * dt;
    this.body.rotation.z = this.lean;

    // the head rides the neck pivot and squashes a touch less than the body:
    // reads as weight
    const neck = this.pivots.neck;
    neck.rotation.z = -this.lean * 0.35;
    neck.rotation.x = -(this.squash - 1) * 0.12; // reviewer fix: 0 at rest under the new meaning

    // ---- trailing ears -----------------------------------------------------
    // Angular spring with drag, driven by acceleration: the ears lag behind
    // the body and keep swinging briefly after a launch.
    const drive = -(s.ax || 0) * 0.035 - (s.vx || 0) * 0.055;
    const ek = 34;
    for (let i = 0; i < this.ears.length; i++) {
      const ear = this.ears[i];
      const target = ear.rest.z + drive * (ear.side === 'R' ? 1 : 0.86);
      this.earTrailVel[i] += (-(this.earTrail[i] - target) * ek - this.earTrailVel[i] * 2 * Math.sqrt(ek) * 0.24) * dt;
      this.earTrail[i] += this.earTrailVel[i] * dt;
      ear.pivot.rotation.z = this.earTrail[i];
    }
    // idle sway when nothing is happening
    const idle = s.aiming ? 0.5 : s.airborne ? 0.12 : 1;
    for (let i = 0; i < this.ears.length; i++) {
      const ear = this.ears[i];
      ear.pivot.rotation.x = ear.rest.x + Math.sin(this.time * 2.1 + ear.phase) * 0.045 * idle;
    }

    // ---- happy reaction ----------------------------------------------------
    if (this.happyTimer > 0) this.happyTimer -= dt;
    const happy = clamp01(this.happyTimer / 0.85);
    if (happy > 0) {
      const t = 1 - this.happyTimer / 0.85;
      const bounce = Math.sin(t * Math.PI * 2.4) * happy * 0.12;
      this.core.position.y = bounce;
      neck.rotation.z -= happy * 0.18;
      neck.rotation.x -= happy * 0.25;
    } else {
      this.core.position.y = damp(this.core.position.y, 0, 12, dt);
    }

    // ---- glow --------------------------------------------------------------
    this.glowTarget = damp(this.glowTarget, 0, 0.5, dt);
    this.glow = damp(this.glow, this.glowTarget + happy * 0.5, 9, dt);
    this.glowSprite.material.opacity = this.glow * 0.55;
    this.glowSprite.scale.setScalar(2.3 + this.glow * 1.4);

    // ---- blink -------------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.2 + Math.random() * 2.6;
      this.blink = 1;
    }
    if (this.blink > 0) {
      this.blink = Math.max(0, this.blink - dt * 7);
      const open = 1 - Math.sin(clamp01(this.blink) * Math.PI) * 0.92;
      for (const eye of this.eyes) eye.scale.y = open;
    } else {
      for (const eye of this.eyes) eye.scale.y = damp(eye.scale.y, 1, 20, dt);
    }

    // ---- contact shadow ----------------------------------------------------
    if (s.groundY !== undefined && Number.isFinite(s.groundY)) {
      const height = Math.max(0, s.y - s.groundY);
      const fade = clamp01(1 - height / 7);
      // sized in world units, so undo the rig scale
      // Round 1l item 1: a radius of about 0.5 H. sc scales a 1x1 PLANE, so it
      // is a local full width and the rig's uniform scale multiplies it again -
      // dividing by this.scale makes the number below a real world radius.
      // The old lerpN(1.5, 3.4) is kept as a grow multiplier so the shadow still
      // spreads and fades as he rises.
      const grow = lerpN(1, 2.27, 1 - fade);
      const worldR = num(LOOK.bunny.shadowRadius, 0.5) * this.H * grow * (s.airborne ? 1.18 : 1);
      const sc = (worldR * 2) / this.scale;
      this.contactShadow.visible = fade > 0.02;
      this.contactShadow.position.set(0, s.groundY - s.y + 0.012, 0);
      this.contactShadow.scale.set(sc, sc * 0.62, 1);
      this.contactShadow.material.opacity = num(LOOK.bunny.shadowOpacity, 0.28) * fade;
    } else {
      this.contactShadow.visible = false;
    }
  }

  /**
   * @param {number} x
   * @param {number} y  world position of the bunny's physics circle centre
   */
  setPosition(x, y) {
    this.group.position.set(x, y, 0);
  }
}

function lerpN(a, b, t) {
  return a + (b - a) * t;
}
