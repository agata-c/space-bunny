/**
 * Faceted pastel geometry kit.
 *
 * Everything in the scene is built from low-poly icosahedra / low-segment
 * spheres with flat shading and a baked vertex-colour gradient. That single
 * trick is what gives the reference art its look: hard facet breaks, plus the
 * pink-from-the-left / periwinkle-from-the-right pastel split.
 */

import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { lerp, smoothstep, clamp01, makeRng, TAU } from '../core/math.js';

const _c = new THREE.Color();
const _a = new THREE.Color();
const _b = new THREE.Color();

/**
 * Bake a three-stop horizontal gradient plus a soft top lift into a geometry's
 * vertex colours.
 *
 * @param {THREE.BufferGeometry} geo
 * @param {object} o
 * @param {number} o.left   colour at the left of the local bounding box
 * @param {number} o.mid    colour in the middle
 * @param {number} o.right  colour at the right
 * @param {number} [o.top]  amount of white mixed in towards the top
 * @param {number} [o.axis] 'x' | 'y' | 'z'
 */
export function paintGradient(geo, o = {}) {
  const {
    left = PALETTE.pink,
    mid = PALETTE.lilac,
    right = PALETTE.periwinkle,
    top = 0,
    axis = 'x'
  } = o;

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const min = bb.min[axis];
  const max = bb.max[axis];
  const span = Math.max(1e-6, max - min);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  for (let i = 0; i < pos.count; i++) {
    const t = (pos.array[i * 3 + ai] - min) / span;
    if (t < 0.5) {
      _a.setHex(left);
      _b.setHex(mid);
      _c.copy(_a).lerp(_b, smoothstep(0, 0.5, t));
    } else {
      _a.setHex(mid);
      _b.setHex(right);
      _c.copy(_a).lerp(_b, smoothstep(0.5, 1, t));
    }
    if (top > 0) {
      const up = pos.array[i * 3 + 1] - bb.min.y;
      const k = Math.max(0, up / Math.max(1e-6, bb.max.y - bb.min.y));
      _c.lerp(WHITE, top * k * k);
    }
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const WHITE = new THREE.Color(0xffffff);

/**
 * Direction the bunny's facets are judged against (SPEC 4.1): upper left and a
 * little towards the camera, so faces leaning that way go pink and the far
 * side falls into periwinkle.
 */
const FACE_LIGHT = new THREE.Vector3(-0.6, 0.7, 0.4).normalize();

/**
 * Seeded vertex jitter, so low-poly forms read as hand-cut instead of CAD.
 *
 * The offset is keyed by the vertex's *position*, not by its index: three's
 * IcosahedronGeometry (and every seam in the hand-built blades) duplicates the
 * vertices it shares, so an index-keyed nudge would tear the surface open.
 * Identical positions therefore always get the identical nudge and the mesh
 * stays watertight.
 *
 * @param {THREE.BufferGeometry} geo
 * @param {number} amount  fraction of the part's largest dimension
 * @param {number} seed
 */
export function jitterVertices(geo, amount = 0.03, seed = 1) {
  const pos = geo.attributes.position;
  if (!pos || !(amount > 0)) return geo;

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  if (!(size > 1e-6)) return geo;

  const amp = amount * size;
  const rng = makeRng(seed);
  const seen = new Map();
  const a = pos.array;

  for (let i = 0; i < pos.count; i++) {
    // String(-0) is "0", so -0 and 0 collapse onto the same key: good.
    const key = `${a[i * 3]},${a[i * 3 + 1]},${a[i * 3 + 2]}`;
    let o = seen.get(key);
    if (o === undefined) {
      o = [(rng() - 0.5) * amp, (rng() - 0.5) * amp, (rng() - 0.5) * amp];
      seen.set(key, o);
    }
    a[i * 3] += o[0];
    a[i * 3 + 1] += o[1];
    a[i * 3 + 2] += o[2];
  }

  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * One flat colour per triangle, picked from how that triangle faces the key
 * light. Needs non-indexed geometry with freshly computed normals, otherwise
 * the per-face break disappears and the bunny turns into a smooth blob.
 *
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Vector3} [light]
 */
export function paintByNormal(geo, light = FACE_LIGHT, triad = null) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  if (!pos || !nrm) return geo;

  const colors = new Float32Array(pos.count * 3);
  // Round 1g: `triad` lets a caller supply its own lit / base / shade hexes.
  // The bunny passes nothing and keeps its palette; the leaves pass one triad
  // per leaf type so every blade shows at least three distinct facet tones.
  const tri = triad || [PALETTE.bunnyBase, PALETTE.bunnyLit, PALETTE.bunnyShade];
  const base = new THREE.Color(tri[0]);
  const lit = new THREE.Color(tri[1]);
  const shade = new THREE.Color(tri[2]);
  const out = new THREE.Color();
  const n = new THREE.Vector3();

  for (let f = 0; f + 2 < pos.count; f += 3) {
    n.set(
      nrm.array[f * 3] + nrm.array[(f + 1) * 3] + nrm.array[(f + 2) * 3],
      nrm.array[f * 3 + 1] + nrm.array[(f + 1) * 3 + 1] + nrm.array[(f + 2) * 3 + 1],
      nrm.array[f * 3 + 2] + nrm.array[(f + 1) * 3 + 2] + nrm.array[(f + 2) * 3 + 2]
    );
    if (n.lengthSq() < 1e-12) n.copy(light);
    else n.normalize();

    const t = n.dot(light);
    if (t > 0.35) out.copy(base).lerp(lit, clamp01((t - 0.35) / 0.65));
    else if (t < -0.1) out.copy(base).lerp(shade, clamp01((-0.1 - t) / 0.9));
    else out.copy(base);

    for (let k = 0; k < 3; k++) {
      const i = f + k;
      colors[i * 3] = out.r;
      colors[i * 3 + 1] = out.g;
      colors[i * 3 + 2] = out.b;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Merge non-indexed geometries that share the same attribute set.
 *
 * Round 1h item 5. The feather fronds used to be a stem mesh plus ten separate
 * leaflet meshes, which cost 60 draw calls plus their shadow passes. Baking the
 * leaflets into the stem's geometry makes each frond a single mesh. Only
 * position / normal / color are carried, which is all the leaves and fronds use;
 * anything else is dropped rather than silently mis-merged.
 */
export function mergeGeometries(list) {
  const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  if (geos.length === 1) return geos[0];
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const nAttr = g.attributes.normal;
    const cAttr = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i);
      pos[(o + i) * 3 + 1] = p.getY(i);
      pos[(o + i) * 3 + 2] = p.getZ(i);
      if (nAttr) {
        nrm[(o + i) * 3] = nAttr.getX(i);
        nrm[(o + i) * 3 + 1] = nAttr.getY(i);
        nrm[(o + i) * 3 + 2] = nAttr.getZ(i);
      }
      if (cAttr) {
        col[(o + i) * 3] = cAttr.getX(i);
        col[(o + i) * 3 + 1] = cAttr.getY(i);
        col[(o + i) * 3 + 2] = cAttr.getZ(i);
      }
    }
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
/**
 * Force a closed geometry's triangles to wind OUTWARD.
 *
 * Round 1h item 4a. Winding a gem's fans and bands by hand is easy to get
 * subtly wrong, and a single inverted fan is invisible in code review but shows
 * up as a hole once back-face culling bites. The signed volume of a closed mesh
 * is positive exactly when every face is wound counter-clockwise seen from
 * outside, so measuring it settles the question: if it comes out negative, every
 * triangle is reversed. That is a proof, not a guess, and it is not the same as
 * papering over the problem with DoubleSide.
 */
function ensureOutward(geo) {
  const pos = geo.attributes.position;
  let vol = 0;
  for (let f = 0; f + 2 < pos.count; f += 3) {
    const ax = pos.getX(f), ay = pos.getY(f), az = pos.getZ(f);
    const bx = pos.getX(f + 1), by = pos.getY(f + 1), bz = pos.getZ(f + 1);
    const cx = pos.getX(f + 2), cy = pos.getY(f + 2), cz = pos.getZ(f + 2);
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  if (vol >= 0) return geo;
  const arr = pos.array;
  for (let f = 0; f + 2 < pos.count; f += 3) {
    for (let k = 0; k < 3; k++) {
      const i = (f + 1) * 3 + k;
      const j = (f + 2) * 3 + k;
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
/** Ensure hard facets: no shared vertices, no smooth normals. */
export function facet(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

/** Low-segment sphere, flat shaded. */
export function facetedSphere(radius = 1, widthSeg = 12, heightSeg = 8, gradient = null) {
  const g = new THREE.SphereGeometry(radius, widthSeg, heightSeg);
  if (gradient) paintGradient(g, gradient);
  return facet(g);
}

/**
 * Rounded "pillow" disc — the pedestal / platform cushions.
 *
 * `rTop` / `rBottom` are the widest radius at the top and bottom halves and
 * `height` is the disc's true vertical extent, so callers can place it from its
 * nominal size alone. The top and bottom faces are inset by the edge radius, so
 * keep anything standing on it inside `radius - height * 0.3`.
 *
 * `opts.facet: false` keeps the lathe's own smooth normals, for the pieces the
 * reference draws glossy rather than faceted (rim, joints, platform, pedestal).
 *
 * The profile runs bottom-to-top on purpose: LatheGeometry derives both its
 * normals and its winding from the profile direction, and a top-to-bottom
 * profile comes out inside-out.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.facet=true] flat-shade the result
 */
export function cushionDisc(rTop, rBottom, height, segments = 20, gradient = null, opts = {}) {
  const h = height;
  const rim = Math.min(h * 0.3, Math.max(rTop, rBottom) * 0.5);
  const pts = [new THREE.Vector2(0, -h / 2)];

  // bottom edge: quarter round out from the flat bottom face to the widest radius
  for (let i = 1; i <= 3; i++) {
    const a = ((3 - i) / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(rBottom - rim + rim * Math.cos(a), -h / 2 + rim - rim * Math.sin(a)));
  }
  // side wall, tapering from rBottom to rTop
  pts.push(new THREE.Vector2(rTop, h / 2 - rim));
  // top edge: quarter round back in to the flat top face
  for (let i = 1; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(rTop - rim + rim * Math.cos(a), h / 2 - rim + rim * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0, h / 2));

  const g = new THREE.LatheGeometry(pts, segments);
  if (gradient) paintGradient(g, gradient);
  return opts.facet === false ? g : facet(g);
}

/**
 * Long faceted ear/blade: a tapered, slightly bent prism built from stacked
 * rings. Used for bunny ears and leaves.
 */
export function bladeGeometry({
  length = 1,
  width = 0.34,
  thickness = 0.16,
  bend = 0.18,
  tipSharp = 0.72,
  rings = 6,
  sides = 5,
  twist = 0.1
} = {}) {
  const pts = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // width profile: swells near the base, tapers to a point
    const w = width * Math.sin(Math.PI * (0.18 + t * 0.82)) * (1 - tipSharp * Math.pow(t, 2.1)) * 0.5 + width * 0.12;
    pts.push(new THREE.Vector2(Math.max(0.004, w), t * length));
  }
  // bend the spine sideways for a leaf / ear silhouette
  const ringsData = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const w = pts[i].x;
    const y = pts[i].y;
    const x = Math.sin(t * Math.PI * 0.5) * bend * length;
    const th = thickness * (1 - t * 0.75);
    const ring = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * TAU + twist * t;
      // wide axis on X (the flat face looks at the camera), thin axis on Z
      ring.push(new THREE.Vector3(x + Math.sin(a) * w, y, Math.cos(a) * th));
    }
    ringsData.push(ring);
  }
  // cap base and tip with a centre vertex
  const verts = [];
  const push = (v) => verts.push(v.x, v.y, v.z);
  const baseC = new THREE.Vector3(0, 0, 0);
  const tipC = new THREE.Vector3(Math.sin(Math.PI * 0.5) * bend * length, length, 0);
  for (let s = 0; s < sides; s++) {
    const a = ringsData[0][s];
    const b = ringsData[0][(s + 1) % sides];
    push(baseC); push(a); push(b);
  }
  for (let i = 0; i < rings; i++) {
    const lo = ringsData[i];
    const hi = ringsData[i + 1];
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      push(lo[s]); push(hi[s]); push(hi[s2]);
      push(lo[s]); push(hi[s2]); push(lo[s2]);
    }
  }
  const last = ringsData[rings];
  for (let s = 0; s < sides; s++) {
    const a = last[s];
    const b = last[(s + 1) % sides];
    push(tipC); push(b); push(a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  return g;
}

function latheFromRings(ringsData, sides, baseC, basePt, tipPt) {
  const verts = [];
  const push = (v) => verts.push(v.x, v.y, v.z);
  for (let s = 0; s < sides; s++) {
    const a = ringsData[0][s];
    const b = ringsData[0][(s + 1) % sides];
    push(basePt); push(a); push(b);
  }
  for (let i = 0; i < ringsData.length - 1; i++) {
    const lo = ringsData[i];
    const hi = ringsData[i + 1];
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      push(lo[s]); push(hi[s]); push(hi[s2]);
      push(lo[s]); push(hi[s2]); push(lo[s2]);
    }
  }
  const last = ringsData[ringsData.length - 1];
  for (let s = 0; s < sides; s++) {
    const a = last[s];
    const b = last[(s + 1) % sides];
    push(tipPt); push(b); push(a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  return g;
}

/**
 * Four-pointed sparkle star (the "star shape" from the element sheet),
 * extruded so it reads from the side too.
 */
export function sparkleGeometry(outer = 1, inner = 0.26, depth = 0.16, points = 4) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: outer * 0.07,
    bevelSize: outer * 0.07,
    bevelSegments: 1,
    curveSegments: 1
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * Crescent moon: a real crescent, not a ring with a bite taken out of it.
 *
 * The outer arc of circle 1 and the inner arc of circle 2 are joined at the two
 * points where the circles actually intersect, so the horns taper to a genuine
 * point and the hollow is the concave side of one continuous silhouette. The
 * hole sits towards -x, i.e. the crescent faces left.
 *
 * @param {number} outerR  outer circle radius (centre at the origin)
 * @param {number} innerR  inner circle radius
 * @param {number} bite    how far the inner circle's centre is offset (-x, +y)
 * @param {number} depth   extrusion depth
 */
/**
 * A CRYSTAL leaf: a solid, plump, straight-sided gem. NO HOLES.
 *
 * Round 1g built these from `bladeGeometry` replacements with an inward-wound
 * base fan and tip fan, so back-face culling let you see straight through the
 * blade (R1h item 4a). Every fan is now wound outward, which
 * `probe.windingCheck()` verifies: zero triangles may face the centroid.
 *
 * The section is two mirrored halves — three rings of `sides` vertices on a
 * `width` x `thickness` ellipse (thickness defaults to 0.42 * width, the sheet's
 * chunky almond section) at 0.25 L (0.70 scale), `widestAt` (full) and 0.72 L
 * (0.55) — then a pointed tip and a pointed base. `irregular` is 4 %: enough that
 * no two blades are identical, small enough that the facets stay big.
 *
 * @param {object} o
 * @param {number} o.length      base (y 0) to tip
 * @param {number} o.width       full width at the widest ring
 * @param {number} [o.thickness] full depth at the widest ring (default 0.42 x width)
 * @param {number} [o.widestAt]  where the full-width ring sits, 0..1 of length
 * @param {number} [o.sides]     vertices per ring (8 gives the sheet's 48 facets)
 * @param {number} [o.tipLean]   degrees the tip leans off-axis
 * @param {number} [o.seed]
 * @param {number} [o.irregular] per-vertex radius jitter, fraction
 */
export function gemGeometry({
  length = 1,
  width = 0.5,
  thickness = null,
  widestAt = 0.42,
  sides = 8,
  tipLean = 0,
  seed = 1,
  irregular = 0.04
} = {}) {
  const rnd = makeRng(seed);
  const hw = width / 2;
  const ht = (thickness === null ? width * 0.42 : thickness) / 2;
  const lean = (tipLean * Math.PI) / 180;

  // R1h item 4b: three rings, the lower one already 70 % out, so the gem swells
  // quickly off the base instead of tapering in from a thin stalk.
  const ringAt = (t, s) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      const k = 1 + (rnd() - 0.5) * 2 * irregular;
      pts.push(new THREE.Vector3(Math.cos(a) * hw * s * k, t * length, Math.sin(a) * ht * s * k));
    }
    return pts;
  };

  const base = new THREE.Vector3(0, 0, 0);
  const tip = new THREE.Vector3(Math.sin(lean) * length, length, 0);
  const r1 = ringAt(0.25, 0.7);
  const r2 = ringAt(widestAt, 1);
  const r3 = ringAt(0.72, 0.55);
  const rings = [r1, r2, r3];

  const pos = [];
  const push = (v) => pos.push(v.x, v.y, v.z);
  const tri = (a, b, c) => {
    push(a);
    push(b);
    push(c);
  };
  /*
   * The two apex fans need OPPOSITE winding, and this is the R1h bug the
   * reviewer caught numerically.
   *
   * A ring's vertices run counter-clockwise seen from above. Seen from OUTSIDE
   * the solid, the fan under a ring (apex BELOW it) wants (apex, p, q), while the
   * fan over a ring (apex ABOVE it) wants (apex, q, p). Using one `fan()` for
   * both leaves the tip fan inside-out, and `ensureOutward` cannot notice,
   * because flipping 8 of 56 triangles still leaves the total signed volume
   * positive. The low front leaves (L4/L7, leaning 52-56 deg) point their tips at
   * the camera, which is exactly where Agata saw the holes.
   */
  const fanUnder = (apex, ring) => {
    for (let i = 0; i < sides; i++) tri(apex, ring[i], ring[(i + 1) % sides]);
  };
  const fanOver = (apex, ring) => {
    for (let i = 0; i < sides; i++) tri(apex, ring[(i + 1) % sides], ring[i]);
  };
  // A band between two rings. r[i] and r[j] are on the same angular step, so this
  // pairs each quad as two triangles.
  const band = (lo, hi) => {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri(lo[i], hi[i], lo[j]);
      tri(lo[j], hi[i], hi[j]);
    }
  };

  const sections = [];
  sections.push({ name: 'base fan', start: 0, count: sides });
  fanUnder(base, r1);
  for (let r = 0; r + 1 < rings.length; r++) {
    sections.push({ name: 'band ' + (r + 1), start: pos.length / 9, count: sides * 2 });
    band(rings[r], rings[r + 1]);
  }
  sections.push({ name: 'tip fan', start: pos.length / 9, count: sides });
  fanOver(tip, rings[rings.length - 1]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  facet(g);
  ensureOutward(g);
  // the probe reads these to report winding per section, and the axis segment to
  // test each face against
  g.userData.sections = sections;
  g.userData.axis = { base: base.toArray(), tip: tip.toArray() };
  return g;
}

/**
 * A CRYSTAL horn: the sheet's "curved leaf", a thick tapered tube curling over
 * like a breaking wave.
 *
 * Round 1g, for the two blue curved blades (L1, L6). The centreline is a
 * circular arc of radius `arcRadius` swept through `arcDeg`, so the piece rises,
 * arcs outward (+x) and hooks back DOWN — away from the bunny. The cross-section
 * is a `sides`-gon shrinking from `baseRadius` to a point.
 */
export function hornGeometry({
  length = 1,
  baseRadius = 0.24,
  arcRadius = 0.45,
  arcDeg = 130,
  rings = 5,
  sides = 6,
  seed = 1,
  irregular = 0.04,
  /** R1h item 4b: 1 makes the cross-section round, 0.85 flattens it a little. */
  section = 1
} = {}) {
  const rnd = makeRng(seed);
  const R = arcRadius * length;
  const r0 = baseRadius * length;
  const arc = (arcDeg * Math.PI) / 180;

  // centreline: starts at the origin heading +y, ends heading outward and down
  const spine = (t) => {
    const th = arc * t;
    return new THREE.Vector3(R - R * Math.cos(th), R * Math.sin(th), 0);
  };
  // taper: full at the base, a point at the tip
  const taper = (t) => r0 * Math.pow(1 - t, 0.75);

  const ringPts = [];
  for (let r = 0; r < rings; r++) {
    const t = r / rings;
    const c = spine(t);
    // frame: tangent along the spine, and a stable side vector
    const t2 = Math.min(1, t + 1e-3);
    const tan = spine(t2).sub(c).normalize();
    const side = new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3().crossVectors(tan, side).normalize();
    const rad = taper(t);
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      const k = 1 + (rnd() - 0.5) * 2 * irregular;
      pts.push(
        new THREE.Vector3()
          .copy(c)
          .addScaledVector(up, Math.cos(a) * rad * k)
          .addScaledVector(side, Math.sin(a) * rad * k * section)
      );
    }
    ringPts.push(pts);
  }
  const tip = spine(1);

  const pos = [];
  const push = (v) => pos.push(v.x, v.y, v.z);
  const tri = (a, b, c) => {
    push(a);
    push(b);
    push(c);
  };
  // Same apex rule as gemGeometry: the cap UNDER the first ring and the fan OVER
  // the last ring need opposite winding. R1i: L1 was still showing 11 flagged
  // faces because both used one direction.
  const fanUnder = (apex, ring) => {
    for (let i = 0; i < sides; i++) tri(apex, ring[i], ring[(i + 1) % sides]);
  };
  const fanOver = (apex, ring) => {
    for (let i = 0; i < sides; i++) tri(apex, ring[(i + 1) % sides], ring[i]);
  };
  const band = (lo, hi) => {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri(lo[i], hi[i], lo[j]);
      tri(lo[j], hi[i], hi[j]);
    }
  };

  // closed at both ends: a fan over the base ring to a point just inside it, and
  // the same at the tip
  const baseC = spine(0).addScaledVector(spine(1).sub(spine(0)).normalize(), -r0 * 0.28);
  const sections = [];
  sections.push({ name: 'base cap', start: 0, count: sides });
  fanUnder(baseC, ringPts[0]);
  for (let r = 0; r + 1 < rings; r++) {
    sections.push({ name: 'band ' + (r + 1), start: pos.length / 9, count: sides * 2 });
    band(ringPts[r], ringPts[r + 1]);
  }
  sections.push({ name: 'tip fan', start: pos.length / 9, count: sides });
  fanOver(tip, ringPts[rings - 1]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  facet(g);
  ensureOutward(g);
  g.userData.sections = sections;
  // the spine is a 130 deg ARC, not the straight chord, so the probe tests each
  // face against the nearest point on the real curve
  g.userData.spine = [];
  for (let r = 0; r <= rings; r++) g.userData.spine.push(spine(r / rings).toArray());
  g.userData.axis = { base: baseC.toArray(), tip: tip.toArray() };
  return g;
}

export function crescentGeometry(outerR = 1, innerR = 0.88, bite = 0.3, depth = 0.35, steps = 48, opts = {}) {
  // Round 1g: `innerOffset` places the biting circle explicitly. The moon needs
  // it at (-0.36, 0.10) for a max thickness of ~0.5, which the old bite/3
  // relationship could not express.
  const cx = opts.innerOffset ? opts.innerOffset[0] : -bite;
  const cy = opts.innerOffset ? opts.innerOffset[1] : bite / 3;
  const d = Math.hypot(cx, cy);

  // the two circles intersect while d is between |r1 - r2| and r1 + r2
  const a = (d * d + outerR * outerR - innerR * innerR) / (2 * d);
  const h = Math.sqrt(Math.max(0, outerR * outerR - a * a));
  const ux = cx / d;
  const uy = cy / d;
  const px = a * ux;
  const py = a * uy;

  // intersection points, in the order the outline wants them
  const ax = px + h * -uy;
  const ay = py + h * ux;
  const bx = px - h * -uy;
  const by = py - h * ux;

  // outer arc: from A, counter-clockwise the long way round through (+1, 0), to B
  const t0 = Math.atan2(ay, ax);
  let t1 = Math.atan2(by, bx);
  while (t1 <= t0) t1 += TAU;
  // inner arc: back from B to A the short way, through the deepest part of the bite
  const s0 = Math.atan2(by - cy, bx - cx);
  let s1 = Math.atan2(ay - cy, ax - cx);
  while (s1 >= s0) s1 -= TAU;

  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const x = Math.cos(t) * outerR;
    const y = Math.sin(t) * outerR;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = 1; i <= steps; i++) {
    const t = s0 + ((s1 - s0) * i) / steps;
    shape.lineTo(cx + Math.cos(t) * innerR, cy + Math.sin(t) * innerR);
  }
  shape.closePath();

  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: opts.bevelThickness ?? 0.06,
    bevelSize: opts.bevelSize ?? 0.06,
    bevelSegments: opts.bevelSegments ?? 1,
    curveSegments: opts.curveSegments ?? 10
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/** A torus with a soft pastel sweep, used for the rim collar and pedestal. */
export function pastelTorus(radius, tube, radialSeg = 8, tubularSeg = 40, gradient = null) {
  const g = new THREE.TorusGeometry(radius, tube, radialSeg, tubularSeg);
  if (gradient) paintGradient(g, gradient);
  return facet(g);
}

/**
 * Soft radial-gradient texture used for contact shadows and glow sprites.
 */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', stops = null) {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (stops) stops.forEach(([o, c]) => g.addColorStop(o, c));
  else {
    g.addColorStop(0, inner);
    g.addColorStop(0.55, inner);
    g.addColorStop(1, outer);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Vertical pastel gradient used as the scene background and, mip-blurred down,
 * as a cheap environment map for the glass and gold.
 */
export function gradientEnvironment(top = 0xf6ecff, mid = 0xe3d0f8, bottom = 0xc2a7ec) {
  const w = 8;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  g.addColorStop(0.42, '#' + mid.toString(16).padStart(6, '0'));
  g.addColorStop(0.72, '#' + mid.toString(16).padStart(6, '0'));
  g.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/**
 * Round 1m: split a lathe-style geometry into TWO material groups by height, so
 * one watertight surface can carry two materials - the cushion's top disc and
 * its side band.
 *
 * Why groups and not two separate meshes: `cushionDisc` is a single LatheGeometry
 * whose profile runs bottom-centre -> bottom round -> side wall -> top round ->
 * top-centre. Two meshes would either leave an open seam at the split height or
 * need coincident caps that z-fight. Groups keep the surface closed and split
 * only the shading, which is what the panel needs (two independent emissives).
 *
 * @param {THREE.BufferGeometry} geo
 * @param {number} seamY world-ish local Y of the split; below -> group 0
 * @returns {THREE.BufferGeometry} the same geometry, with `.clearGroups()` then
 *   two groups: 0 = the side band, 1 = the top disc
 */
export function splitGroupsByHeight(geo, seamY) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  geo.clearGroups();
  if (!idx) {
    // non-indexed: group triangles by their centroid
    const low = [];
    const high = [];
    for (let t = 0; t < pos.count; t += 3) {
      const y = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      (y < seamY ? low : high).push(t, t + 1, t + 2);
    }
    geo.setIndex([...low, ...high]);
    geo.addGroup(0, low.length, 0);
    geo.addGroup(low.length, high.length, 1);
    return geo;
  }
  const low = [];
  const high = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    (y < seamY ? low : high).push(a, b, c);
  }
  geo.setIndex([...low, ...high]);
  geo.addGroup(0, low.length, 0);
  geo.addGroup(low.length, high.length, 1);
  return geo;
}