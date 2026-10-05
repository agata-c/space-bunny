/**
 * Headless gameplay harness.
 *
 * Drives the real game through simulated pointer input and physics steps, so
 * mechanics can be verified without a human at the mouse. Runs inside the page
 * (the game loop keeps ticking) and reports a JSON transcript.
 *
 * Open /?probe=1 and call window.__probe.<method>() from the console, or let
 * tools/probe.mjs drive it over CDP.
 */

import { Vector3 } from 'three';
import { CONFIG } from '../game/config.js';

/**
 * Traverse the scene and report any NaN / Infinity in a geometry attribute or
 * an object matrix. A NaN here shows up on screen as a flickering black square,
 * so it is worth asserting on every round.
 */
function nanScan() {
  const scene = window.spaceBunny.stage.scene;
  const bad = [];
  let meshes = 0;
  let verts = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((n) => {
    const geo = n.geometry;
    if (!geo) return;
    meshes++;
    for (const name of ['position', 'normal', 'color', 'uv']) {
      const attr = geo.attributes?.[name];
      if (!attr) continue;
      const a = attr.array;
      for (let i = 0; i < a.length; i++) {
        if (name === 'position') verts++;
        if (!Number.isFinite(a[i])) {
          bad.push({ object: n.name || n.type, attribute: name, index: i, value: String(a[i]) });
          break;
        }
      }
    }
    if (n.isInstancedMesh && n.instanceColor) {
      for (let i = 0; i < n.instanceColor.array.length; i++) {
        if (!Number.isFinite(n.instanceColor.array[i])) {
          bad.push({ object: n.name || n.type, attribute: 'instanceColor', index: i });
          break;
        }
      }
    }
    const e = n.matrixWorld.elements;
    for (let i = 0; i < 16; i++) {
      if (!Number.isFinite(e[i])) {
        bad.push({ object: n.name || n.type, attribute: 'matrixWorld', index: i });
        break;
      }
    }
  });
  return { meshes, verts, clean: bad.length === 0, bad };
}

/** How far the decor pokes out of the glass, and where the worst vertex is. */
function insideGlass() {
  const props = window.spaceBunny.game.props;
  const r = props.maxRadius();
  const limit = CONFIG.bowl.outerR - 0.2; // 3.30 in the round-1 brief
  return {
    worstRadius: r.worst,
    limit,
    inside: r.worst < limit,
    margin: +(limit - r.worst).toFixed(4),
    deepest: r.deepest
  };
}

/**
 * Convert a world point on the z=0 plane into client (CSS pixel) coordinates.
 * Mirrors core/input.js so simulated pointer events hit the same spots.
 */
function worldToClient(stage, wx, wy) {
  const cam = stage.camera;
  const rect = stage.renderer.domElement.getBoundingClientRect();
  const v = { x: wx, y: wy, z: 0 };
  // manual projection: reuse three via the camera's matrices
  const p = window.__threeVec(wx, wy, 0);
  p.project(cam);
  return {
    x: rect.left + ((p.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - p.y) / 2) * rect.height
  };
}

function makePointer(id = 1, type = 'mouse') {
  return new PointerEvent('pointerdown', { pointerId: id, pointerType: type, button: 0, buttons: 1, clientX: 0, clientY: 0, bubbles: true, cancelable: true });
}

/**
 * Simulate a full drag: press on the bunny, pull back to (tx,ty), release.
 * Runs over real time because the game advances on rAF.
 */
async function drag(tx, ty, { holdMs = 90, steps = 6, stepMs = 22 } = {}) {
  const sb = window.spaceBunny;
  const canvas = sb.stage.renderer.domElement;
  const g = sb.game;

  const from = worldToClient(sb.stage, g.body.x, g.body.y);
  const to = worldToClient(sb.stage, tx, ty);

  const fire = (type, x, y, buttons) => {
    const ev = new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true
    });
    (type === 'pointerdown' ? canvas : window).dispatchEvent(ev);
  };

  fire('pointerdown', from.x, from.y, 1);
  await sleep(holdMs);

  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    fire('pointermove', x, y, 1);
    await sleep(stepMs);
  }
  await sleep(40);
  fire('pointerup', to.x, to.y, 0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hold the pointer down at (tx,ty) without releasing. */
async function grabAndHold(tx, ty, ms = 200) {
  const sb = window.spaceBunny;
  const canvas = sb.stage.renderer.domElement;
  const g = sb.game;
  const from = worldToClient(sb.stage, g.body.x, g.body.y);
  const to = worldToClient(sb.stage, tx, ty);

  const fire = (type, x, y, buttons) => {
    const ev = new PointerEvent(type, {
      pointerId: 2, pointerType: 'mouse', button: 0, buttons,
      clientX: x, clientY: y, bubbles: true, cancelable: true
    });
    (type === 'pointerdown' ? canvas : window).dispatchEvent(ev);
  };
  fire('pointerdown', from.x, from.y, 1);
  await sleep(30);
  for (let i = 1; i <= 5; i++) {
    fire('pointermove', from.x + ((to.x - from.x) * i) / 5, from.y + ((to.y - from.y) * i) / 5, 1);
    await sleep(20);
  }
  await sleep(ms);
}

async function releaseHeld() {
  const sb = window.spaceBunny;
  const g = sb.game;
  const p = sb.stage.renderer.domElement.getBoundingClientRect();
  const at = worldToClient(sb.stage, g.pull.x, g.pull.y);
  window.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 2, pointerType: 'mouse', button: 0, buttons: 0,
    clientX: at.x, clientY: at.y, bubbles: true, cancelable: true
  }));
  void p;
}


/** Wait until predicate() is true or timeoutMs elapses. */
async function waitFor(predicate, timeoutMs = 4000, label = 'condition') {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (predicate()) return true;
    await sleep(30);
  }
  throw new Error(`waitFor timed out: ${label}`);
}


function state() {
  const sb = window.spaceBunny;
  const g = sb.game;
  return {
    state: g.state,
    body: { x: +g.body.x.toFixed(2), y: +g.body.y.toFixed(2), vx: +g.body.vx.toFixed(2), vy: +g.body.vy.toFixed(2) },
    stars: g.stars.broken,
    misses: g.misses,
    launches: g.launches,
  };
}

/**
 * Winding audit for the decor solids.
 *
 * R1i item 1. The R1h version of this test asked whether a face normal points at
 * the mesh's CENTROID, and that is the wrong question for these shapes: the gem's
 * lower ring already sits at 70 % width, so the base is a flared cone whose
 * outward normal tilts UP while the vector to the centroid points DOWN. It
 * produced false positives, and I wrongly explained them away instead of fixing
 * the geometry. Agata's screenshot had real holes.
 *
 * The correct test: a face is outward when its normal points away from the solid's
 * own SPINE at that face's height. `gemGeometry` and `hornGeometry` record that
 * spine as `geometry.userData.axis` (base apex -> tip apex) together with the
 * triangle range of each section, so this can walk face by face and report
 * per-section counts. Everything must be 0.
 *
 * Note the total signed volume is NOT sufficient: flipping one 8-triangle fan of a
 * 56-triangle gem still leaves it positive.
 */
function windingCheck() {
  const props = window.spaceBunny.game.props;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const n = new Vector3();
  const mid = new Vector3();
  const axisA = new Vector3();
  const axisB = new Vector3();
  const abT = new Vector3();
  const apT = new Vector3();

  const _s0 = new Vector3();
  const _s1 = new Vector3();
  const _seg = new Vector3();
  const _ap = new Vector3();

  /** nearest point on the solid's SPINE to `p`: the polyline for a horn's arc,
   *  or the single axis segment for a straight gem */
  function spineAt(p, poly) {
    if (poly && poly.length > 1) {
      let best = Infinity;
      let bx = 0, by = 0, bz = 0;
      for (let i = 0; i + 1 < poly.length; i++) {
        _s0.set(poly[i][0], poly[i][1], poly[i][2]);
        _s1.set(poly[i + 1][0], poly[i + 1][1], poly[i + 1][2]);
        _seg.subVectors(_s1, _s0);
        const len2 = _seg.lengthSq();
        let t = 0;
        if (len2 > 1e-12) t = Math.max(0, Math.min(1, _ap.subVectors(p, _s0).dot(_seg) / len2));
        const cx = _s0.x + _seg.x * t, cy = _s0.y + _seg.y * t, cz = _s0.z + _seg.z * t;
        const d = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
        if (d < best) { best = d; bx = cx; by = cy; bz = cz; }
      }
      return { x: bx, y: by, z: bz };
    }
    abT.subVectors(axisB, axisA);
    const len2 = abT.lengthSq();
    let t = 0;
    if (len2 > 1e-12) t = Math.max(0, Math.min(1, apT.subVectors(p, axisA).dot(abT) / len2));
    return { x: axisA.x + abT.x * t, y: axisA.y + abT.y * t, z: axisA.z + abT.z * t };
  }

  const rows = [];
  props.group.traverse((node) => {
    if (!/^L\d-/.test(node.name || '')) return;
    node.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      if (!pos || pos.count < 3) return;
      const axis = geo.userData.axis;
      if (!axis) return;
      axisA.set(axis.base[0], axis.base[1], axis.base[2]);
      axisB.set(axis.tip[0], axis.tip[1], axis.tip[2]);

      const nTri = Math.floor(pos.count / 3);
      const inward = new Array(nTri).fill(0);
      for (let f = 0; f < nTri; f++) {
        a.fromBufferAttribute(pos, f * 3);
        b.fromBufferAttribute(pos, f * 3 + 1);
        c.fromBufferAttribute(pos, f * 3 + 2);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        n.crossVectors(ab, ac);
        if (n.lengthSq() < 1e-18) continue;
        n.normalize();
        mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        const s = spineAt(mid, geo.userData.spine);
        const d = n.x * (mid.x - s.x) + n.y * (mid.y - s.y) + n.z * (mid.z - s.z);
        if (d < 0) inward[f] = 1;
      }

      const sections = (geo.userData.sections || []).map((s) => {
        let bad = 0;
        for (let f = s.start; f < s.start + s.count && f < nTri; f++) bad += inward[f];
        return { section: s.name, tris: s.count, inward: bad };
      });
      const totalInward = inward.reduce((x, y) => x + y, 0);
      rows.push({
        mesh: node.name,
        tris: nTri,
        totalInward,
        clean: totalInward === 0,
        sections,
        signedVolume: (() => {
          let v = 0;
          for (let f = 0; f < nTri; f++) {
            a.fromBufferAttribute(pos, f * 3);
            b.fromBufferAttribute(pos, f * 3 + 1);
            c.fromBufferAttribute(pos, f * 3 + 2);
            v += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x);
          }
          return +(v / 6).toFixed(5);
        })()
      });
    });
  });

  const bad = rows.filter((r) => !r.clean);
  return {
    clean: bad.length === 0,
    leaves: rows.length,
    totalInward: rows.reduce((s, r) => s + r.totalInward, 0),
    bad,
    rows
  };
}
/**
 * Round 1n item 3: a per-object reach table, so `insideGlass` regressions can be
 * attributed to a NAMED object instead of '?'. Reach is the object's bounding
 * sphere measured the way insideGlass measures: the sphere centre in world space
 * plus its radius, which is what actually has to fit inside the bowl.
 */
function reachTable() {
  const rows = [];
  const scene = window.spaceBunny.stage.scene;
  const props = window.spaceBunny.game.props;
  if (!props) return { rows: [], err: 'no props' };
  props.group.updateWorldMatrix(true, true);
  props.group.traverse((n) => {
    if (!n.isMesh || !n.geometry) return;
    if (!n.geometry.boundingSphere) n.geometry.computeBoundingSphere();
    const bs = n.geometry.boundingSphere;
    const c = bs.center.clone().applyMatrix4(n.matrixWorld);
    // name: own name, else the nearest named ancestor (cluster group, leaf group)
    let label = n.name || '';
    if (!label) {
      for (let q = n.parent; q; q = q.parent) {
        if (q.name) { label = q.name; break; }
      }
    }
    if (!label) label = n.geometry.name || '(unnamed)';
    rows.push({
      name: label,
      radius: +bs.radius.toFixed(3),
      centre: c.toArray().map((v) => +v.toFixed(3)),
      reach: +Math.hypot(c.x, c.y, c.z).toFixed(3),
      total: +(Math.hypot(c.x, c.y, c.z) + bs.radius).toFixed(3)
    });
  });
  rows.sort((a, b) => b.total - a.total);
  return { rows, count: rows.length };
}

/**
 * Round 1n item 1: prove EVERY panel control is alive.
 *
 * For each lil-gui controller this calls `controller.setValue(newValue)` - which
 * DOES fire onChange, unlike writing the holder object as R1m's check did -
 * renders, and counts the pixels that changed against the frame before. Then it
 * restores the value. Any control with 0 changed pixels is either a bug or has to
 * be explained (e.g. sheenOpacityLite only applies under ?lite).
 *
 * @param {object} [opt]
 * @param {number} [opt.threshold] per-channel sum that counts as "changed"
 * @returns {{total:number, dead:object[], rows:object[]}}
 */
function panelLiveTest(opt = {}) {
  const threshold = opt.threshold === undefined ? 8 : opt.threshold;
  const tune = window.__tune;
  if (!tune || !tune.gui) return { err: 'no panel: open the page with ?tune' };
  const sb = window.spaceBunny;
  const st = sb.stage;
  const g = sb.game;
  const gl = st.renderer.getContext();
  const W = 600;
  const H = 338;
  const live = import('../game/look.js');

  st.renderer.setPixelRatio(1);
  st.camera.aspect = W / H;
  st.camera.updateProjectionMatrix();
  st.renderer.setSize(W, H, false);

  const frame = new Uint8Array(W * H * 4);
  function grab() {
    st.scene.updateMatrixWorld(true);
    st.renderer.render(st.scene, st.camera);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    return frame.slice();
  }
  function countDiff(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > threshold) n++;
    }
    return n;
  }
  /** a colour's complement, or null if this is not a 6-hex string */
  function complement(v) {
    if (typeof v !== 'string' || !/^[0-9a-fA-F]{6}$/.test(v)) return null;
    const n = parseInt(v, 16);
    const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    const f = (x) => (255 - x).toString(16).padStart(2, '0');
    return f(r) + f(gg) + f(b);
  }

  const controllers = tune.gui.controllersRecursive();
  const rows = [];
  return live.then((mod) => {
    for (const ctrl of controllers) {
      const path = ctrl.propertyPath || ctrl.property;
      const before = ctrl.getValue();
      let target = null;
      let kind = null;
      const comp = complement(before);
      if (comp !== null) { target = comp; kind = 'colour'; }
      else if (typeof before === 'number') { target = before * 1.3 + 0.01; kind = 'number'; }
      if (target === null) {
        rows.push({ path, skipped: 'not a colour or number (' + typeof before + ')' });
        continue;
      }
      const f0 = grab();
      ctrl.setValue(target);
      mod.emitLook();
      for (let i = 0; i < 3; i++) g.render(1 / 60);
      const f1 = grab();
      const changed = countDiff(f0, f1);
      // restore
      ctrl.setValue(before);
      mod.emitLook();
      for (let i = 0; i < 3; i++) g.render(1 / 60);
      rows.push({ path, kind, before, target, changed });
    }
    st.renderer.setSize(window.innerWidth, window.innerHeight, false);
    void emit;
    return {
      total: rows.length,
      tested: rows.filter((r) => r.changed !== undefined).length,
      dead: rows.filter((r) => r.changed === 0),
      skipped: rows.filter((r) => r.skipped),
      rows
    };
    function emit() {}
  });
}

export function installProbe() {
  window.__probe = {
    sleep, waitFor, drag, grabAndHold, releaseHeld, worldToClient,
    state,
    nanScan, insideGlass, windingCheck, reachTable, panelLiveTest, config: CONFIG,
    snapshot: () => window.spaceBunny.capture(760, 0.85)
  };
}