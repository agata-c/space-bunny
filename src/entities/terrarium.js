/**
 * The glass terrarium: bowl, rim collar, pedestal base, interior platform.
 *
 * Every number comes from CONFIG, so the renderer and the physics solver can
 * never drift apart. This module only draws; the collider half of the geometry
 * lives in physics/world.js and reads the same object.
 */

import * as THREE from 'three';
import { PALETTE, RENDER } from '../core/palette.js';
import { cushionDisc, paintGradient, radialTexture, splitGroupsByHeight } from '../render/facet.js';
import { LOOK, onLook, hex, num } from '../game/look.js';
import { glassMaterial, glassSheenMaterial, shellMaterial } from '../render/materials.js';

/**
 * Pedestal step sizes. `terrain.ledgeR / ledgeY` are the shared (physics-read)
 * numbers for the lower step; the upper step's radius and height are terrarium
 * locals.
 */
const PEDESTAL = { lowerR: 2.87, lowerH: 0.42, upperR: 2.52, upperH: 0.42, overlap: 0.02 };
/**
 * Platform cushion. Round 1d made it a THICK rounded cushion (obiekty3.png's
 * flat lilac pad) with its top face reading as an ellipse from the tilted
 * camera. `terrain.platformR / platformTopY` carry the shared numbers; the
 * cushion's own underside radius and height live here.
 */
const PLATFORM = { rBottom: 2.32, height: 0.42 };
/** Additive back-side sheen over the glass, per glass flavour. */


/**
 * Round 1d floor. `r` is the disc radius: Agata wants the far edge visible but
 * soft, sitting at screen y ~588 at x = 750 and curving down to ~650 at the
 * screen sides, so the disc is deliberately NOT fogged away any more.
 */
const FLOOR = { r: 34, contactR: 3.6, contactAlpha: 0.3, contactY: -3.392, z: -7 };
/** The pink pool on the floor under the pedestal's front-left. */
const FLOOR_SPOT = { r: 6.4, alpha: 0.62, x: -2.6, y: -3.388, z: 1.6 };

/**
 * Round 1d shell gradients, sampled off Agata's mockup. The pedestal sweeps pink
 * on the viewer's left to lilac on the right; the platform cushion is a
 * separate, more violet ramp because in plansza.png / obiekty3.png it reads as
 * its own object (a thick lilac pad), not another pink pedestal step.
 */

/**
 * Round 1l item 2: the pedestal's own emissive, a SATURATED pink. The default
 * 0xe7c6f5 is only S 0.44, and at the intensity the unlit front and right flanks
 * need it left them at S 0.38 - the gate wants S >= 0.6 on every visible face.
 * The key and fill both come from the left, so the left flank is lit and passes
 * on its own; the front and right only ever see this emissive.
 */
const PED_EMIT = 0xc98ac2;

/** Round 1k item 3: pink on the left silhouette, violet on the right. */


/**
 * Round 1k item 1: the platform's own emissive, LILAC (h~272) rather than
 * shellMaterial's default pale pink 0xe7c6f5 (h~294). At intensity 0.5 that pink
 * would have dragged the top face out of its H260-280 gate while lifting it.
 *
 * The side wall is the reason the emissive is high: nothing lights it (the key is
 * up and to the left, and R1f removed the floor bounce), so its lightness is
 * almost entirely emissive. Emissive sets a FLOOR for both faces, and
 * PLAT_TOP is darkened to keep the lit top under the L0.80 ceiling.
 */


/** Cached mid stop so each sweep is a clean two-colour lerp. */
const _midCache = new Map();
function sweep(left, right, axis = 'x', top = 0) {
  const key = `${left}|${right}|${axis}|${top}`;
  let mid = _midCache.get(key);
  if (mid === undefined) {
    mid = new THREE.Color().lerpColors(new THREE.Color(left), new THREE.Color(right), 0.5).getHex();
    _midCache.set(key, mid);
  }
  return { left, mid, right, axis, top };
}

/** The rim ring and its joints keep the R1 SPEC 3 pink-to-lilac sweep. */
function rimGradient() {
  return sweep(hex(LOOK.rim.a, 0xecacfd), hex(LOOK.rim.b, 0xa88cf8));
}

/** Pedestal: pink on the left, lilac on the right. */
function pedGradient() {
  return sweep(hex(LOOK.pedestal.left, 0xd878c8), hex(LOOK.pedestal.right, 0xb060c8));
}

/**
 * Paint a disc's vertex colours as a radial ramp from `near` at the centre to
 * `far` at the rim, so the floor's colour gradient lives in the same geometry as
 * the alpha ramp in its map.
 */
const _radA = new THREE.Color();
const _radB = new THREE.Color();
const _radC = new THREE.Color();
function paintRadial(geo, near, far) {
  const pos = geo.attributes.position;
  let col = geo.getAttribute('color');
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    geo.setAttribute('color', col);
  }
  _radA.setHex(near);
  _radB.setHex(far);
  for (let i = 0; i < pos.count; i++) {
    // CircleGeometry lies in XY before it is rotated flat, so radius = |xy|
    const t = Math.min(1, Math.hypot(pos.getX(i), pos.getY(i)) / FLOOR.r);
    _radC.copy(_radA).lerp(_radB, t);
    col.setXYZ(i, _radC.r, _radC.g, _radC.b);
  }
  col.needsUpdate = true;
}

/**
 * White radial alpha ramp, so a floor decal can be tinted by `material.color`
 * instead of baking its colour into the canvas.
 */
function alphaDisc(alpha) {
  return radialTexture('', '', [
    [0, `rgba(255,255,255,${alpha})`],
    [0.42, `rgba(255,255,255,${(alpha * 0.58).toFixed(4)})`],
    [0.75, `rgba(255,255,255,${(alpha * 0.16).toFixed(4)})`],
    [1, 'rgba(255,255,255,0)']
  ]);
}

export class Terrarium {
  constructor(config) {
    const b = config.bowl;
    const t = config.terrain;

    this.config = config;
    this.group = new THREE.Group();
    this.group.name = 'terrarium';

    // Round 1h item 1: the pedestal gets its OWN material with the pre-R1f
    // values - glossy, clearcoat 1, the pale-pink emissive. R1f had flattened
    // both shells to clearcoat 0.3 / emissive 0.12 to stop the PLATFORM washing
    // out, and Agata's verdict was that the bowl got worse: the pedestal was
    // better before. The platform keeps the R1f values.
    // Round 1i item 3: the pedestal's DOWNWARD and side faces were 22-28 % short
    // because R1f removed the pink floor bounce, so nothing lights them from
    // below. Emissive is the only lever that lifts a shadowed face without
    // touching the light rig (which the brief forbids).
    this.pedMat = shellMaterial({
      roughness: num(LOOK.pedestal.roughness, 0.25),
      envMapIntensity: num(LOOK.pedestal.envMapIntensity, 0.85),
      emissive: hex(LOOK.pedestal.emissive, 0xc98ac2),
      emissiveIntensity: num(LOOK.pedestal.emissiveIntensity, 0.7),
      clearcoat: num(LOOK.pedestal.clearcoat, 1)
    });
    this.shellMat = shellMaterial({ roughness: 0.25, envMapIntensity: 0.5, emissiveIntensity: 0.12, clearcoat: 0 });
    // Round 1k item 1: the platform gets its OWN material so it can go matte
    // without taking the glossy rim joints (which share shellMat) with it.
    this.platMat = shellMaterial({
      roughness: num(LOOK.cushion.roughness, 0.9),
      envMapIntensity: num(LOOK.cushion.envMapIntensity, 0.15),
      emissive: hex(LOOK.cushion.topEmissive, 0xe88fd8),
      emissiveIntensity: num(LOOK.cushion.topEmissiveIntensity, 0.46),
      clearcoat: 0
    });
    // the rim ring sits above every light, so its underside goes black without
    // an emissive of its own
    // the cushion's side band: same shape, its own emissive so the panel can
    // lift the unlit wall without dragging the lit top with it (R1l D2)
    this.platSideMat = shellMaterial({
      roughness: num(LOOK.cushion.roughness, 0.9),
      envMapIntensity: num(LOOK.cushion.envMapIntensity, 0.15),
      emissive: hex(LOOK.cushion.sideEmissive, 0xe88fd8),
      emissiveIntensity: num(LOOK.cushion.sideEmissiveIntensity, 0.46),
      clearcoat: 0
    });
    this.rimMat = shellMaterial({ roughness: num(LOOK.rim.roughness, 0.25), envMapIntensity: num(LOOK.rim.envMapIntensity, 0.85), emissiveIntensity: num(LOOK.rim.emissiveIntensity, 0.6), clearcoat: 0 });

    this.buildTable(t);
    onLook(() => this.applyLook());
    this.buildPedestal(t);
    this.buildPlatform(t);
    this.buildBowl(b);
    this.buildCollar(b);
  }

  /**
   * Round 1d: Agata's ground. A large floor disc whose FAR EDGE is visible but
   * soft — the alpha falls to 0 across the outer 15 % of the radius, which is
   * roughly 30 px of blur on screen at the default framing. The disc is a
   * radial gradient from `RENDER.floorNear` at the centre to `RENDER.floorFar`
   * at the rim, so the far edge reads lighter than the floor underfoot.
   *
   * No shadow map on the floor (round 1c's key shadow left a hard ring here,
   * which is not in the mockup): the grounding comes from the contact-occlusion
   * decal instead.
   */
  buildTable(t) {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(num(LOOK.floor.radius, FLOOR.r), 128),
      new THREE.MeshBasicMaterial({
        map: radialTexture('', '', [
          [0, 'rgba(255,255,255,1)'],
          [0.62, 'rgba(255,255,255,0.97)'],
          // the soft far edge: ~7 % of the radius, which is roughly the 30 px
          // of blur Agata's mockup shows (the outer 15 % read as a 150 px fade)
          [0.93, 'rgba(255,255,255,1)'],
          [0.97, 'rgba(255,255,255,0.4)'],
          [1, 'rgba(255,255,255,0)']
        ]),
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        // the disc must not be tone-mapped: the mockup's floor colours are
        // picked straight off the screen, so the gradient has to land exactly
        toneMapped: false,
        fog: false
      })
    );
    // the same texture cannot carry both the alpha ramp and the colour ramp,
    // so the colour gradient is a vertex-colour attribute on the same disc
    paintRadial(floor.geometry, hex(LOOK.floor.near, 0xd591f5), hex(LOOK.floor.far, 0xeaafe4));
    floor.material.vertexColors = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, t.tableY, num(LOOK.floor.z, FLOOR.z));
    floor.receiveShadow = false;
    floor.name = 'floor';
    this.floorMesh = floor;
    floor.renderOrder = -2;
    this.group.add(floor);

    /**
     * Flat decals, each at its own height so they can never z-fight, with an
     * explicit renderOrder so the overlap is deterministic too.
     */
    const decal = (radius, colour, alpha, y, cx, cz, order) => {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 72),
        new THREE.MeshBasicMaterial({
          map: alphaDisc(alpha),
          color: colour,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          fog: false
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, y, cz);
      m.renderOrder = order;
      this.group.add(m);
      return m;
    };

    // The hero's pink pool on the floor, front-left of the pedestal. Placed in
    // FLOOR_SPOT, tuned in round 1d to land at screen (700, 785) at 1500x844.
    this.floorSpotMesh = decal(FLOOR_SPOT.r, hex(LOOK.floor.spotColor, 0xe07fc5), num(LOOK.floor.spotOpacity, FLOOR_SPOT.alpha), FLOOR_SPOT.y, FLOOR_SPOT.x, FLOOR_SPOT.z, -1);

    // soft contact occlusion right under the pedestal
    decal(FLOOR.contactR, 0x9a6fc4, FLOOR.contactAlpha, FLOOR.contactY, 0, 0, 0);
  }

  /**
   * Two stacked rounded discs, the lower one wider. The upper step is built
   * `overlap` taller than it looks and dropped that far deeper, so its base is
   * buried inside the lower disc instead of sitting flush against it: two
   * coplanar faces would flicker.
   */
  buildPedestal(t) {
    const ped = new THREE.Group();
    ped.name = 'pedestal';

    // lower step: top at ledgeY, bottom at ledgeY - 0.42, 0.02 above the floor
    const lowerH = PEDESTAL.lowerH;
    const lower = new THREE.Mesh(
      cushionDisc(t.ledgeR, t.ledgeR, lowerH, 52, pedGradient(), { facet: false }),
      this.pedMat
    );
    lower.position.y = t.ledgeY - lowerH / 2;
    lower.castShadow = true;
    lower.receiveShadow = true;
    ped.add(lower);
    this.ledge = lower;

    // upper step: 0.42 of visible height (top at ledgeY + 0.42 = -2.54, bottom
    // at ledgeY = -2.96), sunk a further 0.02 into the lower disc
    const upperH = PEDESTAL.upperH + PEDESTAL.overlap;
    const upperTop = t.ledgeY + PEDESTAL.upperH;
    const upper = new THREE.Mesh(
      cushionDisc(PEDESTAL.upperR, PEDESTAL.upperR, upperH, 48, pedGradient(), { facet: false }),
      this.pedMat
    );
    upper.position.y = upperTop - upperH / 2;
    upper.castShadow = true;
    upper.receiveShadow = true;
    ped.add(upper);
    this.step = upper;
    // both pedestal geometries, so the panel can re-paint the pink-to-lilac ramp
    this.pedGeos = [lower.geometry, upper.geometry];

    this.group.add(ped);
  }

  buildPlatform(t) {
    // A THICK cushion, and a gradient of its own: violet on top (#C390FB)
    // easing to a paler violet on the side (#BEA1F9), which is how it reads in
    // plansza.png / obiekty3.png — a lilac pad, not another pink pedestal step.
    // Round 1k item 1: 	op: 1 was the R1j D3 ROOT CAUSE. In paintGradient the
    // 	op argument MIXES WHITE IN (_c.lerp(WHITE, top*k*k)); it does not
    // select which end colour lands on the upper face. At top:1 the entire
    // visible top was lerped to pure white, so PLAT_TOP could never show -
    // retuning the albedo three times only moved #E2E0E6 -> #ECE4F8. top:0
    // lets PLAT_TOP BE the top face; platMat below kills the specular
    // whitening that Agata reads as the pad still being WHITE.
    // The goal is plansza's top #C390FB (L 0.77) beside a background at L 0.78.

    const geo = cushionDisc(t.platformR, PLATFORM.rBottom, PLATFORM.height, 44, sweep(hex(LOOK.cushion.side, 0x6b2870), hex(LOOK.cushion.top, 0x76307c), 'y', 0), {
      facet: false
    });
    // Round 1m item 2: SPLIT the cushion into a top disc and a side band, each
    // with its own material. R1l D2 showed one flat emissive cannot put the top
    // at L 0.65 AND the side 0.03 below it, because the side wall receives no
    // key light and its lightness IS the emissive - raising it lifts both faces
    // toward the same asymptote. Two materials give each face its own emissive.
    // The split is two material GROUPS on the one watertight lathe, not two
    // meshes: two meshes would leave an open seam at the split height.
    splitGroupsByHeight(geo, PLATFORM.height * 0.16);
    const platform = new THREE.Mesh(geo, [this.platSideMat, this.platMat]);
    // glass bottom cut. No decal on top: a coplanar disc would z-fight.
    platform.position.set(t.platformX, t.platformTopY - PLATFORM.height / 2, 0);
    platform.castShadow = true;
    platform.receiveShadow = true;
    platform.name = 'platform';
    this.group.add(platform);
    this.platform = platform;
    this.cushionGeo = platform.geometry;
  }

  buildBowl(b) {
    // sphere cut open at BOTH ends: the mouth at the top, a flat base at the
    // bottom, so the bowl is a real bubble standing on the pedestal
    const thetaLen = Math.PI - b.glassTopAngle * 2;
    const geo = new THREE.SphereGeometry(b.outerR, 72, 48, 0, Math.PI * 2, b.glassTopAngle, thetaLen);
    this.glass = new THREE.Mesh(geo, glassMaterial());
    this.glass.position.set(b.x, b.y, 0);
    this.glass.renderOrder = 4;
    this.group.add(this.glass);

    const ud = this.glass.material.userData;
    this.sheenOpacity = ud.lite ? num(LOOK.glass.sheenOpacityLite, 0.3) : num(LOOK.glass.sheenOpacity, 0.32);

    // Reviewer fix 2026-10-05: the full glass is FrontSide (DoubleSide stacked a
    // dark band at the silhouette), which left the INSIDE of the back wall
    // undrawn, so looking down through the mouth read as an empty hole. This is
    // a light, plain inner wall (no transmission, so no band): back faces only.
    this.backWallOpacity = num(LOOK.glass.backWallOpacity, 0.2);
    if (!ud.lite) {
      const back = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: hex(LOOK.glass.backWallColor, 0xe7c4f4),
          transparent: true,
          opacity: this.backWallOpacity,
          side: THREE.BackSide,
          depthWrite: false,
          roughness: 0.15,
          metalness: 0,
          envMapIntensity: 0.6
        })
      );
      back.position.set(b.x, b.y, 0);
      back.renderOrder = 2;
      back.name = 'glass-backwall';
      this.group.add(back);
      this.glassBack = back;
    }

    // back-side sheen gives the thick handmade-glass read
    const sheen = new THREE.Mesh(
      paintGradient(
        new THREE.SphereGeometry(b.outerR * 0.985, 48, 32, 0, Math.PI * 2, b.glassTopAngle, thetaLen),
        // Round 1k item 3: the pink lives on the EDGES only. The sheen carries a
        // vertex ramp - pink on the viewer's left, violet on the right - so the
        // silhouette reads pink/violet while the interior stays clear for the
        // glass colour to do its work.
        {
          left: hex(LOOK.glass.edgeL),
          mid: hex(LOOK.glass.edgeM),
          right: hex(LOOK.glass.edgeR),
          axis: 'x'
        }
      ),
      glassSheenMaterial(0xffffff)
    );
    sheen.material.opacity = this.sheenOpacity;
    sheen.position.set(b.x, b.y, 0);
    sheen.renderOrder = 3;
    this.group.add(sheen);
    this.glassSheen = sheen;
    this.sheenGeo = sheen.geometry;

    // The separate additive highlight arc that used to live here is GONE. Even at
    // 0.18 opacity it read as a hard-edged white ellipse filling the mouth of
    // the bowl rather than as a reflection (removing it dropped the blown-out
    // pixels in that region from 1596 to 7). The back-side sheen above already
    // gives the glass its inner glow, so nothing is lost.
  }

  /** The rim ring plus its five "segment joints". */
  buildCollar(b) {
    const rim = new THREE.Group();
    rim.name = 'rim';
    const y = b.y + b.rimY;

    const ringGeo = new THREE.TorusGeometry(b.rimRadius, b.rimTube, 12, 64);
    // vertexColors needs a colour attribute, so the gradient has to be baked in
    paintGradient(ringGeo, rimGradient());
    const ring = new THREE.Mesh(ringGeo, this.rimMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    ring.castShadow = true;
    rim.add(ring);
    this.collar = ring;
    this.rimGeos = [ring.geometry];

    // 5 slightly thicker bands around the tube, each aligned with the ring's
    // tangent at that angle — the segmented rim from the element sheet.
    const jointR = b.rimTube * 1.12;
    const jointLen = 0.16;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const geo = new THREE.CylinderGeometry(jointR, jointR, jointLen, 20, 1, false);
      // Bake the orientation into the geometry instead of the mesh, so the
      // pink-to-lilac gradient (baked along x) stays world-aligned on every
      // joint — a per-mesh rotation would swing the gradient round with it.
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, tangent));
      paintGradient(geo, rimGradient());
    this.rimGeos.push(geo);

      const joint = new THREE.Mesh(geo, this.shellMat);
      joint.position.set(b.x + Math.cos(a) * b.rimRadius, y, Math.sin(a) * b.rimRadius);
      joint.castShadow = true;
      rim.add(joint);
    }

    this.group.add(rim);
  }

  /** Fade the glass out as the bunny launches into space. */
  /**
   * Round 1m: re-read LOOK and push it into every material and every baked
   * gradient. Called once at build and again on every panel change, so the
   * ?tune panel updates the live scene with no reload.
   */
  applyLook() {
    const P = LOOK.pedestal;
    const C = LOOK.cushion;
    const R = LOOK.rim;

    // baked vertex-colour gradients have to be re-painted, not just re-read
    for (const geo of this.pedGeos || []) paintGradient(geo, pedGradient());
    if (this.cushionGeo) {
      paintGradient(this.cushionGeo, sweep(hex(C.side, 0x6b2870), hex(C.top, 0x76307c), 'y', 0));
    }
    for (const geo of this.rimGeos || []) paintGradient(geo, rimGradient());
    if (this.sheenGeo) {
      paintGradient(this.sheenGeo, {
        left: hex(LOOK.glass.edgeL, 0xff66cc),
        mid: hex(LOOK.glass.edgeM, 0xcf8fe4),
        right: hex(LOOK.glass.edgeR, 0xc49cf2),
        axis: 'x'
      });
    }

    const ped = this.pedMat;
    ped.roughness = num(P.roughness, 0.25);
    ped.envMapIntensity = num(P.envMapIntensity, 0.85);
    ped.clearcoat = num(P.clearcoat, 1);
    ped.emissive.setHex(hex(P.emissive, 0xc98ac2));
    ped.emissiveIntensity = num(P.emissiveIntensity, 0.7);

    for (const [mat, side] of [[this.platMat, false], [this.platSideMat, true]]) {
      if (!mat) continue;
      mat.roughness = num(C.roughness, 0.9);
      mat.envMapIntensity = num(C.envMapIntensity, 0.15);
      mat.emissive.setHex(hex(side ? C.sideEmissive : C.topEmissive, 0xe88fd8));
      mat.emissiveIntensity = num(side ? C.sideEmissiveIntensity : C.topEmissiveIntensity, 0.46);
    }

    if (this.rimMat) {
      this.rimMat.roughness = num(R.roughness, 0.25);
      this.rimMat.envMapIntensity = num(R.envMapIntensity, 0.85);
      this.rimMat.emissiveIntensity = num(R.emissiveIntensity, 0.6);
    }

    if (this.glassSheen) {
      const ud = this.glass.material.userData;
      const lit = num(LOOK.glass.sheenOpacityLite, 0.3);
      const full = num(LOOK.glass.sheenOpacity, 0.32);
      this.glassSheen.material.opacity = ud.lite ? lit : full;
    }
    if (this.floorMesh) {
      paintRadial(this.floorMesh.geometry, hex(LOOK.floor.near, 0xd591f5), hex(LOOK.floor.far, 0xeaafe4));
      this.floorMesh.position.z = num(LOOK.floor.z, FLOOR.z);
      this.floorMesh.scale.setScalar(num(LOOK.floor.radius, FLOOR.r) / FLOOR.r);
    }
    if (this.floorSpotMesh && this.floorSpotMesh.material) {
      this.floorSpotMesh.material.color.setHex(hex(LOOK.floor.spotColor, 0xe07fc5));
      this.floorSpotMesh.material.opacity = num(LOOK.floor.spotOpacity, FLOOR_SPOT.alpha);
    }
  }

  setGlassOpacity(k) {
    const t = clamp01(k);
    const g = this.glass.material;
    const ud = g.userData;
    g.opacity = ud.baseOpacity * t;
    g.transmission = ud.baseTransmission * t;
    g.depthWrite = ud.lite ? false : t > 0.6;
    this.glass.visible = t > 0.02;
    if (this.glassSheen) {
      this.glassSheen.material.opacity = this.sheenOpacity * t;
      this.glassSheen.visible = t > 0.02;
    }
    if (this.glassBack) {
      this.glassBack.material.opacity = this.backWallOpacity * t;
      this.glassBack.visible = t > 0.02;
    }
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
