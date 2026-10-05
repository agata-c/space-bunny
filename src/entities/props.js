/**
 * Decor props: the faceted crystal leaves, the purple flower clusters and the
 * crescent moon inside the bowl, plus the gold constellation and sparkles
 * floating above the rim.
 *
 * The layout is fixed (SPEC 4.3) and every measurement is read from CONFIG, so
 * nothing here is a magic number the renderer and the solver can disagree
 * about. All of it grows out of the platform: each base is sunk 0.10 in, and
 * nothing in here has a collider.
 */

import * as THREE from 'three';
import { LOOK, onLook, onLookChange, changed, hex, num } from '../game/look.js';

/** LOOK.leafTones[name] with every stop already a number. */
function tone(name) {
  const t = LOOK.leafTones[name] || LOOK.leafTones.mint;
  return {
    lit: hex(t.lit),
    base: hex(t.base),
    shade: hex(t.shade),
    emissive: hex(t.emissive)
  };
}
import { PALETTE } from '../core/palette.js';
import { CONFIG } from '../game/config.js';
import {
  bladeGeometry,
  crescentGeometry,
  gemGeometry,
  mergeGeometries,
  hornGeometry,
  paintByNormal,
  paintGradient,
  jitterVertices,
  pastelTorus
} from '../render/facet.js';
import { softPlastic } from '../render/materials.js';
import { TAU, clamp01 } from '../core/math.js';

const DEG = Math.PI / 180;

/**
 * Round 1g: the direction the leaf facets are shaded against — the R1f key at
 * (-2, 12, 8), normalised. Painting by this rather than by a fixed axis is what
 * makes the crystals read as lit from the upper left, as in things.png.
 */
const LEAF_LIGHT = new THREE.Vector3(-2, 12, 8).normalize();
/** Every plant's base is pushed this far into the platform. */
const SINK = 0.1;
/** Seeded vertex jitter for the faceted decor, as a fraction of its size. */
const JITTER = 0.03;
/** Spheres per flower head. Round 1d: smaller spheres, more of them, so a head
 *  reads as a soft cluster rather than a handful of dots. */
/**
 * Round 1j item 5: petals r 0.055 -> 0.035 and 60 -> 140 per head. R1i's heads read
 * as coarse spheres next to the sheet's fine dense ones. Same head radius, still
 * ONE InstancedMesh. R1g: the heads are dense balls over a solid core, so there
 */
/** R1m: the petal count and radius live in LOOK so the panel can tune them. */
const petalCount = () => Math.max(1, Math.round(num(LOOK.petals.count, 140)));
/** The solid core inside every head. */
const CORE_R = 0.26;
const CORE_HEX = 0x9b4ff0;
/** lit / base / shade for the petals, painted by each sphere's own normal. */
const FLOWER_TONES = { lit: 0xe58cff, base: 0xb05ce8, shade: 0x7a2bd0 };
/** Radius of the ball of spheres that makes one flower head. */
const HEAD_R = 0.52;
const PETAL_R = () => num(LOOK.petals.radius, 0.035);

/**
 * Round 1d: three leaf tones, so the seven blades read as three distinct
 * materials as they do in plansza.png / obiekty3.png — mint for the two big
 * front leaves, teal for the narrow ones, blue for the two curved ones. Each is
 * a base -> tip ramp; the deep end is PALETTE.leafMid (#30B0C5).
 */
/**
 * Round 1g: one lit / base / shade TRIAD per leaf type, painted per face by
 * normal so every blade shows at least three clearly different tones. The old
 * two-stop base->tip ramps read as one flat wash per blade, which is most of why
 * they looked like crumpled paper rather than crystal.
 *
 * The emissive hue is per type too, so each crystal carries a glow of its own
 * colour (see `crystalMaterial`).
 */
/** R1m: leaf tones live in LOOK. 
(v) keeps the call sites readable. */
const LEAF_TONES = {
  mint: tone('mint'),
  teal: tone('teal'),
  blue: tone('blue')
};

/**
 * Round 1h item 4c: the length gradient. The per-face triad stays, and on top of
 * it the base is taken 10 % darker and the tip 15 % lighter towards this, which
 * is the pale blue the sheet's leaf tips go.
 */
const LEAF_TIP_PULL = () => hex(LOOK.leafTipPull, 0x73d4f2);

/**
 * Round 1h item 4c: the length gradient. Runs after `paintByNormal`, so each face
 * keeps its lit/base/shade tone and then slides along one ramp — 10 % darker at
 * the base, 15 % lighter towards `pull` at the tip.
 */
function paintLengthRamp(geo, pull = LEAF_TIP_PULL()) {
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  if (!pos || !col) return geo;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < lo) lo = pos.getY(i);
    if (pos.getY(i) > hi) hi = pos.getY(i);
  }
  const target = new THREE.Color(pull);
  const out = new THREE.Color();
  const span = hi > lo ? hi - lo : 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - lo) / span;
    out.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    if (t < 0.5) out.multiplyScalar(1 - 0.1 * (1 - t * 2));
    else out.lerp(target, 0.15 * (t - 0.5) * 2);
    col.setXYZ(i, out.r, out.g, out.b);
  }
  return geo;
}
/** Crystal material for the leaves (round 1g, item 3). */
function crystalMaterial(tone) {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.0,
    flatShading: true,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    emissive: tone.emissive,
    emissiveIntensity: 0.08,
    envMapIntensity: 0.7
  });
}

/**
 * Round 1d's seven leaves, replacing R1c's a-h. Agata's target screen boxes are
 * listed in rounds/R1d.md item 2; the `x`/`z`/`len`/`lean` numbers below were
 * fitted to those boxes with the dev overlay up, so don't re-derive them by eye.
 *
 * `x`/`z` are platform-local, `len` the blade length, `lean` the tilt away from
 * the platform centre in degrees, `yaw` the twist about its own axis and `ratio`
 * the thickness : width : length stretch.
 */
const LEAVES = Object.keys(LOOK.leaves).map((id) => ({ id, ...LOOK.leaves[id] }));

/** The two flower clusters, platform-local, with a small rotation about y. */
const CLUSTERS = Object.keys(LOOK.clusters).map((id) => ({ id, seed: id === 'F2' ? 2027 : 2003, ...LOOK.clusters[id] }));

/**
 * TWO heads per cluster on short stems (round 1d: "Flowers F1 (2 heads)").
 * `y` is the head height above the cluster base. Fitted so each cluster reaches
 * the screen box in rounds/R1d.md item 2.
 */
const HEADS = LOOK.heads;


/** Crescent moon behind the bunny, back right, hollow turned towards him. */
/**
 * Round 1g: `height` is trimmed from R1d's 3.42 because the thicker crescent
 * (inner r 0.84 at (-0.36, 0.10), 0.45 deep, 0.10 bevel) is wider than the old
 * sliver at the same height - 137 px across against the 122 px box. 3.10 puts
 * the width back. See the report: the box's VERTICAL edges cannot be recovered
 * at all, because R1f lowered `platformTopY` by 0.58 (about 31 px on screen) and
 * the moon is planted on the platform.
 */
const MOON = { id: 'MOON', seed: 3001, ...LOOK.moon };

/** Round 1g: the moon's lit / base / shade, and the peach it warms to at the
 *  bottom horn. Emissive is set in the constructor (item 5: #F5D08A at 0.12). */
const MOON_TONES = { lit: 0xffe9a8, base: 0xf5d08a, shade: 0xe9a27a };
const MOON_PEACH = 0xf3bf86;
const MOON_EMISSIVE = 0xf5d08a;
const MOON_EMISSIVE_I = 0.12;

/**
 * Round 1d deleted the gold constellation table along with the decor it fed —
 * see `buildAboveRim`. Kept only as a reminder that this layer is now empty on
 * purpose; the drifting white dots come from `SkyBokeh` in game.js.
 */
const ABOVE_RIM = { balls: [], links: [], linkR: 0.04, sparkles: [], bob: 0.1 };

const _axis = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();

/** Tilt a +Y-up blade away from the platform centre. */
function leanQuat(out, x, z, deg) {
  const d = Math.hypot(x, z);
  if (!(d > 1e-6) || !(deg > 0)) return out.identity();
  // tipping +Y towards (x, 0, z) is a rotation about the axis (z, 0, -x)
  _axis.set(z / d, 0, -x / d);
  return out.setFromAxisAngle(_axis, deg * DEG);
}

/** Frame a blade so its local +z (the curved leaf's curl) points outward. */
function outwardQuat(out, x, z) {
  const d = Math.hypot(x, z) || 1;
  const dx = x / d;
  const dz = z / d;
  _basis.makeBasis(
    new THREE.Vector3(dz, 0, -dx),
    _yAxis,
    new THREE.Vector3(dx, 0, dz)
  );
  return out.setFromRotationMatrix(_basis);
}

/** Faceted blade with seeded jitter and the base->tip leaf gradient. */
function leafGeometry({ len, width, thickness, bend, tipSharp, rings, sides, twist, seed, base, tip }) {
  const geo = bladeGeometry({ length: len, width, thickness, bend, tipSharp, rings, sides, twist });
  jitterVertices(geo, JITTER, seed);
  geo.computeVertexNormals();
  paintGradient(geo, {
    left: base,
    mid: mixHex(base, tip, 0.5),
    right: tip,
    axis: 'y',
    top: 0
  });
  return geo;
}

const _mixCache = new Map();
function mixHex(a, b, t) {
  const key = `${a}|${b}|${t}`;
  let v = _mixCache.get(key);
  if (v === undefined) {
    v = new THREE.Color()
      .lerpColors(new THREE.Color(a), new THREE.Color(b), t)
      .getHex();
    _mixCache.set(key, v);
  }
  return v;
}

export class Props {
  constructor(config = CONFIG) {
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = 'props';
    /** @type {Array<{mesh:THREE.Object3D, base:number, period:number, phase:number, amp:number}>} */
    this.bobbers = [];
    this.links = [];
    this.geoCache = new Map();

    // The leaves keep only a whisper of self-illumination. Round 1d measured them
    // at #9FC7CD against a #5ADCCE target — every light in the bowl is pink, so
    // any real emissive just bleaches the teal towards white. The saturated
    // albedo has to do the work; this only stops the glass veil greying it.
    // Round 1g: one CRYSTAL material per leaf type, so each carries its own hue's
    // emissive. Three draw calls for seven blades; the R1f shared `leafMat` is
    // still used by the flower feathers.
    this.leafMats = {
      mint: crystalMaterial(LEAF_TONES.mint),
      teal: crystalMaterial(LEAF_TONES.teal),
      blue: crystalMaterial(LEAF_TONES.blue)
    };
    this.leafMat = this.leafMats.mint;
    this.flowerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0,
      flatShading: true,
      envMapIntensity: 0.5
    });
    this.stemMat = softPlastic({ roughness: 0.75, envMapIntensity: 0.4 });
    // The moon needs its own gold: under four pink lights a #E0B88B albedo
    // measured #DAB8D5, i.e. the crescent read as pink stone. A warm emissive
    // is the only thing in this scene that can make it read gold.
    this.moonMat = softPlastic({
      roughness: 0.6,
      envMapIntensity: 0.6,
      emissive: MOON_EMISSIVE,
      emissiveIntensity: MOON_EMISSIVE_I
    });

    this.buildDecor();
    this.buildAboveRim();
  }

  geo(key, build) {
    if (!this.geoCache.has(key)) this.geoCache.set(key, build());
    return this.geoCache.get(key);
  }

  /** SPEC 4.3: everything inside the bubble, growing out of the platform. */
  buildDecor() {
    const top = this.config.terrain.platformTopY;
    const inside = new THREE.Group();
    inside.name = 'decor';
    this.group.add(inside);

    for (const def of LEAVES) this.addLeaf(inside, def, top - SINK);
    onLookChange(() => this.applyLook());

    this.flowerMesh = this.addFlowers(inside, top - SINK);
    this.addMoon(inside, MOON, top - SINK);

    this.inside = inside;
  }

  /**
   * Round 1g: every blade is now a CRYSTAL.
   *
   * The two blue curved blades (L1, L6) use `hornGeometry` — a thick tapered
   * tube curling over like the sheet's wave. The other five use `gemGeometry`:
   * a base point, one wide ring, an optional narrower ring at 72 % of the
   * length and a tip. No bend, no twist, no crumpled rings.
   *
   * `def.len` stays the finished blade length so the R1d screen boxes hold; the
   * crystal proportions come from the brief per kind.
   */
  /**
   * Round 1m: push LOOK's placement values into the live scene. Leaves, clusters
   * and the moon are all transforms, so this is cheap and needs no rebuild.
   */
  applyLook() {
    // Round 1n: `changed()` gating was WRONG after the first call. It exists only
    // so the initial build is never disturbed - but on a later emit, a value that
    // has just been restored to its default fails `changed()` and the applier
    // SKIPS, leaving the prop where the panel last dragged it. So: gate only the
    // first invocation, then always apply.
    if (!this._lookAppliedOnce) {
      this._lookAppliedOnce = true;
      const skipAll = !changed('leaves.L1') && !changed('clusters.F1') && !changed('moon');
      if (skipAll) return;
    }
    for (const id of Object.keys(this.leafNodes || {})) {
      const d = LOOK.leaves[id];
      const rec = this.leafNodes[id];
      if (!d) continue;

      rec.node.position.set(num(d.x, 0), rec.y, num(d.z, 0));
      const q = new THREE.Quaternion().setFromAxisAngle(_yAxis, num(d.yaw, 0) * DEG);
      rec.node.quaternion.copy(leanQuat(new THREE.Quaternion(), num(d.x, 0), num(d.z, 0), num(d.lean, 0)).multiply(q));
    }
    for (const id of Object.keys(this.clusterNodes || {})) {
      const d = LOOK.clusters[id];
      const rec = this.clusterNodes[id];
      if (!d) continue;

      rec.node.position.set(num(d.x, 0), rec.y, num(d.z, 0));
      rec.node.rotation.y = num(d.yaw, 0) * DEG;
      rec.node.rotation.z = num(d.leanZ, 0) * DEG;
    }
    if (this.moonNode && LOOK.moon) {
      const m = LOOK.moon;
      this.moonNode.position.set(num(m.x, 0), this.moonY ?? this.moonNode.position.y, num(m.z, 0));
      this.moonNode.rotation.z = num(m.leanDeg, 0) * DEG;
    }
  }

  addLeaf(parent, def, y) {
    if (!this.leafNodes) this.leafNodes = {};
    const g = new THREE.Group();
    // named for the round-1d leaf id (L1..L7) so the fit report and the probe
    // can point at one blade
    g.name = `${def.id}-${def.kind}-${def.x.toFixed(2)}-${def.z.toFixed(2)}`;
    g.position.set(def.x, y, def.z);
    const tone = LEAF_TONES[def.tone] ?? LEAF_TONES.mint;
    const mat = this.leafMats[def.tone] ?? this.leafMats.mint;

    if (def.kind === 'curved') {
      const geo = this.geo(`leaf-curved-${def.seed}`, () => {
        const c = hornGeometry({
          length: def.len,
          baseRadius: 0.24,
          arcRadius: 0.45,
          arcDeg: 130,
          rings: 5,
          sides: 6,
          section: 0.85,
          seed: def.seed
        });
        paintByNormal(c, LEAF_LIGHT, [tone.base, tone.lit, tone.shade]);
        paintLengthRamp(c);
        return c;
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      g.add(m);
      // the horn's own +x is its outward curl, so frame that axis outward, then
      // lean the whole piece out from the base like the rest (item 4d)
      g.quaternion.copy(outwardQuat(new THREE.Quaternion(), def.x, def.z));
      g.rotateY(def.yaw * DEG);
      if (def.lean) {
        g.quaternion.premultiply(leanQuat(new THREE.Quaternion(), def.x, def.z, def.lean));
      }
    } else {
      // Round 1h item 4b: plump solids, not spikes. sides 8 and a 0.42 x width
      // section come from gemGeometry's own defaults; only the width and the
      // widest ring differ per kind.
      const spec =
        def.kind === 'narrow'
          ? { sides: 8, widestAt: 0.45, wf: 0.38, tipLean: 0 }
          : def.kind === 'pointed'
            ? { sides: 8, widestAt: 0.42, wf: 0.62, tipLean: 8 }
            : { sides: 8, widestAt: 0.4, wf: 0.55, tipLean: 0 };
      const geo = this.geo(`leaf-gem-${def.kind}-${def.len}-${def.seed}`, () => {
        const c = gemGeometry({
          length: def.len,
          width: def.len * spec.wf,
          widestAt: spec.widestAt,
          sides: spec.sides,
          tipLean: spec.tipLean,
          seed: def.seed
        });
        paintByNormal(c, LEAF_LIGHT, [tone.base, tone.lit, tone.shade]);
        paintLengthRamp(c);
        return c;
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      g.add(m);
      const q = new THREE.Quaternion().setFromAxisAngle(_yAxis, def.yaw * DEG);
      g.quaternion.copy(leanQuat(new THREE.Quaternion(), def.x, def.z, def.lean).multiply(q));
    }

    g.name = def.id;
    parent.add(g);
    if (this.leafNodes) this.leafNodes[def.id] = { node: g, y };
  }

  /**
   * Two clusters of three heads. Every flower sphere in the scene ends up in a
   * single InstancedMesh, so 144 little balls still cost one draw call.
   */
  addFlowers(parent, y) {
    const instances = [];
    const colours = [];
    const coreMatrices = [];
    const litC = new THREE.Color(FLOWER_TONES.lit);
    const shadeC = new THREE.Color(FLOWER_TONES.shade);
    const tmp = new THREE.Color();
    const m = new THREE.Matrix4();
    /** which instance indices belong to which cluster, so the round-1d fit
     *  report can measure F1 and F2 separately */
    this.flowerRanges = [];

    for (const c of CLUSTERS) {
      const base = new THREE.Group();
      base.name = c.id;
      base.position.set(c.x, y, c.z);
      base.rotation.y = c.yaw * DEG;
      // Round 1l item 3: the LEFT cluster leaned RIGHT into the bunny. Agata:
      // "tilt it left to make space around him". A positive rotation about z
      // maps +y toward -x, so leanZ > 0 leans the whole cluster - stems AND
      // heads - to the viewer's left. Euler order is the default XYZ, so this
      // lean is applied AFTER the yaw.
      if (c.leanZ) base.rotation.z = c.leanZ * DEG;
      parent.add(base);
      if (!this.clusterNodes) this.clusterNodes = {};
      this.clusterNodes[c.id] = { node: base, y };

      const first = instances.length;
      // Round 1j item 1: THE FEATHER FRONDS ARE DELETED. Agata on the R1i
      // screenshot: "I have no idea what it is, let's delete it. - the small dark
      // feathery thing lying on the platform front. The stems and heads stay.

      for (let hi = 0; hi < HEADS.length; hi++) {
        const h = HEADS[hi];

        // Round 1m item 3: the stem springs from ONE point on the cushion, just
        // left of the bunny front foot, between him and the big front-left leaf
        // (L4), then runs up-left to heads that stay exactly where they are. So
        // the stem ORIGIN and the heads ANCHOR are different points, and the
        // stem is a child of parent (platform-local) rather than of base
        // (cluster-local, and turned by the yaw and the left lean).
        const headLocal = new THREE.Vector3(h.x, h.y, h.z);
        const anchor = new THREE.Vector3(c.x, y, c.z);
        const stemAt = new THREE.Vector3(num(c.stemX, c.x), y, num(c.stemZ, c.z));
        const headWorld = headLocal.clone().applyEuler(base.rotation).add(anchor);
        const stemVec = headWorld.clone().sub(stemAt);
        const len = stemVec.length();
        const sgeo = this.geo("stem-" + len.toFixed(2), () => {
          const b = bladeGeometry({
            length: len,
            width: 0.1,
            thickness: 0.07,
            bend: 0.05,
            tipSharp: 0.15,
            rings: 3,
            sides: 4
          });
          jitterVertices(b, JITTER, c.seed + hi * 13);
          b.computeVertexNormals();
          const tt = LEAF_TONES.teal.shade;
          const tb = LEAF_TONES.teal.base;
          paintGradient(b, { left: tb, mid: mixHex(tb, tt, 0.5), right: tt, axis: "y", top: 0 });
          return b;
        });
        const stem = new THREE.Mesh(sgeo, this.stemMat);
        stem.castShadow = true;
        stem.position.copy(stemAt);
        stem.quaternion.setFromUnitVectors(_yAxis, stemVec.clone().normalize());
        stem.name = c.id + '-stem-' + hi;
        parent.add(stem);

        // Round 1g head: a SOLID CORE sphere (so there are no dark holes) plus
        // 60 small spheres on a Fibonacci spread, each pushed 0.02 further out

        coreMatrices.push(new THREE.Matrix4().makeTranslation(headWorld.x, headWorld.y, headWorld.z));

        const petals = petalCount();
        for (let i = 0; i < petals; i++) {
          const t = (i + 0.5) / petals;
          const phi = Math.acos(1 - 2 * t);
          const theta = i * 2.39996;
          const rr = HEAD_R * (0.9 + 0.14 * frac(i * 0.37 + hi + c.seed * 0.01)) + 0.02;
          const dir = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.cos(phi) * 0.94,
            Math.sin(phi) * Math.sin(theta)
          ).normalize();
          const p = dir.clone().multiplyScalar(rr);
          m.makeTranslation(headWorld.x + p.x, headWorld.y + p.y, headWorld.z + p.z);
          instances.push(m.clone());

          // colour by this sphere's own normal towards the key light, so the
          // balls read as lit on top and shaded underneath
          const d = dir.dot(LEAF_LIGHT);
          if (d > 0.35) colours.push(tmp.setHex(FLOWER_TONES.base).lerp(litC, clamp01((d - 0.35) / 0.65)).clone());
          else if (d < -0.1) colours.push(tmp.setHex(FLOWER_TONES.base).lerp(shadeC, clamp01((-0.1 - d) / 0.9)).clone());
          else colours.push(tmp.setHex(FLOWER_TONES.base).clone());
        }
      }

      this.flowerRanges.push({ id: c.id, start: first, count: instances.length - first, group: base });
    }

    // Round 1g: every small sphere in the scene is ONE InstancedMesh with
    // instanceColor...
    const geo = new THREE.IcosahedronGeometry(PETAL_R(), 0);
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, this.flowerMat, instances.length);
    inst.name = 'flower-sphere';
    for (let i = 0; i < instances.length; i++) inst.setMatrixAt(i, instances[i]);
    for (let i = 0; i < colours.length; i++) inst.setColorAt(i, colours[i]);
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = true;
    this.group.add(inst);

    // ...and the solid cores are a second InstancedMesh, so the heads read as
    // dense balls instead of loose dots with holes between them
    const coreGeo = new THREE.IcosahedronGeometry(CORE_R, 1);
    coreGeo.computeVertexNormals();
    const coreMat = new THREE.MeshStandardMaterial({
      color: CORE_HEX,
      roughness: 0.8,
      metalness: 0,
      flatShading: true,
      envMapIntensity: 0.5
    });
    const cores = new THREE.InstancedMesh(coreGeo, coreMat, coreMatrices.length);
    cores.name = 'flower-core';
    for (let i = 0; i < coreMatrices.length; i++) cores.setMatrixAt(i, coreMatrices[i]);
    cores.instanceMatrix.needsUpdate = true;
    cores.castShadow = true;
    this.group.add(cores);
    this.flowerCores = cores;
    return inst;
  }

  addMoon(parent, def, y) {
    const geo = this.geo('moon', () => {
      // Round 1g: a CHUNKY crescent. The inner circle is r 0.84 centred
      // (-0.36, 0.10), which leaves a maximum thickness of about 0.5 - twice
      // what the old r 0.88 / bite 0.3 sliver had, so the moon is a solid object
      // rather than a lilac crescent behind the bunny. The 0.45 extrude with a
      // 0.10 bevel and two bevel segments gives the toy-like rounded edges in
      // things.png.
      const c = crescentGeometry(1, 0.84, 0.3, 0.45, 48, {
        innerOffset: [-0.36, 0.1],
        bevelSize: 0.1,
        bevelThickness: 0.1,
        bevelSegments: 2,
        curveSegments: 12
      });
      // scale off the real bounds so `height` means the finished moon, bevel
      // and all, then plant the base at local y = 0
      c.computeBoundingBox();
      const bb = c.boundingBox;
      const s = def.height / (bb.max.y - bb.min.y);
      c.scale(s, s, s);
      c.computeBoundingBox();
      c.translate(0, -c.boundingBox.min.y, 0);
      // Round 1h item 3: NO 180 deg flip.
      // crescentGeometry already places the biting circle at innerOffset x = -0.36,
      // so the hollow and BOTH horn tips point -x (screen LEFT, towards the bunny) and
      // the thickest part is +x (screen RIGHT). The old Math.PI rotation is what has
      paintByNormal(c, LEAF_LIGHT, [MOON_TONES.base, MOON_TONES.lit, MOON_TONES.shade]);
      const pos = c.attributes.position;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < lo) lo = pos.getY(i);
        if (pos.getY(i) > hi) hi = pos.getY(i);
      }
      const col = c.attributes.color;
      const peach = new THREE.Color(MOON_PEACH);
      const out = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = hi > lo ? (pos.getY(i) - lo) / (hi - lo) : 0;
        // the bottom horn (t ~ 0) warms towards peach
        out.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(peach, Math.max(0, 1 - t * 2.2) * 0.55);
        col.setXYZ(i, out.r, out.g, out.b);
      }
      c.computeVertexNormals();
      return c;
    });
    const m = new THREE.Mesh(geo, this.moonMat);
    m.castShadow = true;

    const g = new THREE.Group();
    g.name = def.id ?? 'moon';
    g.position.set(def.x, y, def.z);
    g.add(m);
    m.rotation.z = def.leanDeg * DEG;
    parent.add(g);
    return g;
  }

  /**
   * Round 1d removed the gold constellation and the two sparkle stars above the
   * rim: Agata's mockup has neither, and Round 3's real stars would read as a
   * clash. The group is kept (still flagged `outsideGlass`) so anything added
   * here later is excluded from the inside-glass check, and `applyGold` still
   * runs harmlessly over the empty lists.
   *
   * The drifting white dots are NOT here — they are `SkyBokeh` in game.js, and
   * the brief keeps those.
   */
  buildAboveRim() {
    const g = new THREE.Group();
    g.name = 'above-rim';
    g.userData.outsideGlass = true;
    this.group.add(g);
    this.aboveRim = g;
  }

  /** Gold decor bobbing plus the link cylinders that follow the balls. */
  applyGold(time) {
    for (const b of this.bobbers) {
      const w = (TAU / b.period) * time + b.phase;
      b.mesh.position.set(b.base.x, b.base.y + Math.sin(w) * b.amp, b.base.z);
      b.mesh.rotation.z = time * 0.18 + b.phase;
    }
    const up = _yAxis;
    for (const link of this.links) {
      const A = this.balls[link.a].position;
      const B = this.balls[link.b].position;
      const dir = new THREE.Vector3().subVectors(B, A);
      const len = Math.max(1e-4, dir.length());
      link.mesh.position.copy(A).addScaledVector(dir, 0.5);
      link.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
      link.mesh.scale.set(1, len, 1);
    }
  }

  update(dt, time) {
    this.applyGold(time);
    void dt;
  }

  /**
   * Worst distance from the bowl centre over every decor vertex, in world
   * space (instanced spheres included). Anything above `outerR` has poked
   * through the glass.
   */
  maxRadius() {
    const limit = this.config.bowl.outerR;
    let worst = 0;
    let who = '';
    let at = new THREE.Vector3();
    const im = new THREE.Matrix4();
    const comb = new THREE.Matrix4();
    const e = new THREE.Vector3();

    const check = (x, y, z, name) => {
      const r = Math.hypot(x, y, z);
      if (r > worst) {
        worst = r;
        who = name;
        at.set(x, y, z);
      }
    };

    this.group.updateWorldMatrix(true, true);
    this.group.traverse((n) => {
      if (!n.geometry?.attributes?.position) return;
      // anything under the above-rim group is deliberately outside the glass
      for (let p = n; p; p = p.parent) if (p.userData?.outsideGlass) return;

      const pos = n.geometry.attributes.position;
      const name = n.name ? n.name : parentName(n);
      if (n.isInstancedMesh) {
        for (let i = 0; i < n.count; i++) {
          n.getMatrixAt(i, im);
          comb.multiplyMatrices(n.matrixWorld, im);
          for (let v = 0; v < pos.count; v++) {
            e.fromBufferAttribute(pos, v).applyMatrix4(comb);
            check(e.x, e.y, e.z, `${name}#${i}`);
          }
        }
      } else {
        for (let v = 0; v < pos.count; v++) {
          e.fromBufferAttribute(pos, v).applyMatrix4(n.matrixWorld);
          check(e.x, e.y, e.z, name);
        }
      }
    });

    return {
      worst: +worst.toFixed(4),
      limit,
      margin: +(limit - 0.2 - worst).toFixed(4),
      deepest: who,
      at: [+at.x.toFixed(3), +at.y.toFixed(3), +at.z.toFixed(3)]
    };
  }
}

/** Springy leaf pads for round 2 — visual + physical pairing. */
export class LeafPads {
  constructor(pads) {
    this.group = new THREE.Group();
    this.group.name = 'pads';
    this.pads = [];
    const mat = softPlastic({ roughness: 0.5, envMapIntensity: 0.8 });
    const veinMat = new THREE.MeshStandardMaterial({
      color: PALETTE.leafDeep,
      roughness: 0.6,
      metalness: 0
    });

    for (const p of pads ?? []) {
      const g = new THREE.Group();
      const geo = bladeGeometry({
        length: 1,
        width: p.halfWidth * 2.1,
        thickness: 0.16,
        bend: 0.3,
        tipSharp: 0.62,
        rings: 6,
        sides: 5
      });
      paintGradient(geo, { left: 0x8ff2e0, mid: 0x5fe0cb, right: 0x2fb9a8, axis: 'x', top: 0.2 });
      const leaf = new THREE.Mesh(geo, mat);
      leaf.rotation.z = Math.PI / 2;
      leaf.rotation.y = Math.PI / 2;
      leaf.castShadow = true;
      g.add(leaf);

      const vein = new THREE.Mesh(new THREE.TorusGeometry(p.halfWidth * 0.95, 0.035, 5, 20), veinMat);
      vein.rotation.y = Math.PI / 2;
      vein.scale.set(1, 0.42, 1);
      g.add(vein);

      g.position.set(p.x, p.y, 0);
      this.group.add(g);
      this.pads.push({ g, def: p, compress: 0, phase: p.x * 2.1 });
    }
  }

  update(dt, time) {
    for (const item of this.pads) {
      if (item.compress > 0) item.compress = Math.max(0, item.compress - dt * 3.4);
      const idle = Math.sin(time * 1.1 + item.phase) * 0.05;
      const squash = item.compress * 0.4;
      item.g.scale.set(1 - squash * 0.5, 1 + idle * 0.3 - squash, 1 - squash * 0.5);
      item.g.rotation.z = idle * 0.14;
    }
  }

  hit(pad) {
    const item = this.pads.find((i) => i.def === pad);
    if (item) item.compress = 1;
  }
}

/** Deterministic 0..1 wobble so the flower balls never look cloned. */
function frac(v) {
  const s = Math.sin(v * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Fall back to the nearest named ancestor, so the report says *what* poked out. */
function parentName(n) {
  for (let p = n.parent; p; p = p.parent) if (p.name) return `${p.name}/${n.type}`;
  return n.type;
}

export { pastelTorus };
