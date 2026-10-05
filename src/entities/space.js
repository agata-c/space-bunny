import * as THREE from 'three';
import { radialTexture, sparkleGeometry } from '../render/facet.js';

/**
 * R3e item 1 (the space transition, never built in R3c) and item 2 (the bunny
 * becomes a twinkling star).
 *
 * The R3e lesson is explicit and this class is written for it: EVERY value this
 * writes is recorded in the constructor and put back in reset(). The report has
 * to print an assertion table proving it.
 */

// R4b item 1: SPACE_NAVY was unused; SKY_FROM below is the colour the sky
// actually lerps from. SKY_TO is used inside this file, so it is no longer
// exported.
/** #1A1440 as a MULTIPLY over the authored lilac #D4ADE1, per the brief. */
// Reviewer fix 2026-10-05: the old (0.12, 0.12, 0.29) is LINEAR and rendered the sky
// as #4F3F81, much lighter than the spec's deep navy #1A1440. This is sRGB #22234A,
// which multiplies the lilac dome down to about #1A1440.
const SKY_TO = new THREE.Color('#22234a');
const NEBULA_COLS = [0xc9a0ee, 0xf7a8d8, 0x9fc2ff, 0xc9a0ee];

export class SpaceTransition {
  constructor(stage, bokeh, terrarium, scene) {
    this.stage = stage;
    this.bokeh = bokeh;
    this.terrarium = terrarium;
    this.k = 0;

    // ---- record everything we are about to overwrite ----------------------
    this.baseSky = stage.bgDome.material.color.clone();
    this.baseBokeh = {
      size: bokeh.points.material.size,
      opacity: bokeh.points.material.opacity,
      color: bokeh.points.material.color.clone()
    };
    // Reviewer fix 2026-10-05 (Agata: "a curved white line behind him when he flies
    // into space"): that arc is the far EDGE of the pale floor disc, seen from above
    // as the camera climbs, still bright against the navy sky. The old handle
    // `terrarium.floor` never existed (it is `floorMesh`), so the fade was dead code.
    // Collect the floor and its decals (everything lying on the table plane) and
    // fade them out over the first part of the ascent.
    this.floorParts = [];
    const tableY = terrarium.floorMesh ? terrarium.floorMesh.position.y : -3.4;
    terrarium.group.traverse((o) => {
      if (o.isMesh && o.material && o.position.y <= tableY + 0.03 && o.geometry && o.geometry.type === 'CircleGeometry') {
        this.floorParts.push({ mesh: o, mat: o.material, baseOpacity: o.material.opacity, baseTransparent: o.material.transparent, baseVisible: o.visible });
      }
    });

    // ---- the faint nebula: 4 pooled soft sprites, +4 draw calls, always ----
    this.nebula = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.SpriteMaterial({
        map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', [
          [0, 'rgba(255,255,255,0.9)'],
          [0.4, 'rgba(255,255,255,0.28)'],
          [1, 'rgba(255,255,255,0)']
        ]),
        color: NEBULA_COLS[i],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const sp = new THREE.Sprite(m);
      sp.name = 'nebula' + i;
      sp.renderOrder = -0.5; // in front of the dome, behind everything else
      sp.scale.setScalar(24 + i * 9);
      const x = -16 + i * 11;
      const y = 4 + (i % 2) * 9;
      sp.position.set(x, y, -22 - i * 3);
      sp.visible = false;
      scene.add(sp);
      this.nebula.push({ sp, x, y, z: sp.position.z, phase: i * 1.7 });
    }

    // ---- item 2: the twinkling star he cross-fades into --------------------
    this.star = new THREE.Mesh(
      sparkleGeometry(0.5, 0.17, 0.13, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false })
    );
    this.star.name = 'twinkleStar';
    this.star.visible = false;
    this.star.renderOrder = 9;
    scene.add(this.star);
    this.starCore = new THREE.Mesh(
      sparkleGeometry(0.5, 0.17, 0.13, 4),
      new THREE.MeshBasicMaterial({ color: 0xf5d08a, toneMapped: false })
    );
    this.starCore.scale.setScalar(0.55);
    this.starCore.visible = false;
    this.starCore.renderOrder = 10;
    scene.add(this.starCore);
    this.starShown = false;
    this.starAt = null;
  }

  /** k = 0..1 progress of the pastel-to-space fade. */
  updateSky(k, time) {
    this.k = k;
    this.stage.bgDome.material.color.copy(this.baseSky).lerp(SKY_TO, k);
    const m = this.bokeh.points.material;
    // about 3x at the end, in size and in brightness
    m.size = this.baseBokeh.size * (1 + k * 2);
    m.opacity = this.baseBokeh.opacity * (1 + k * 2);
    for (const n of this.nebula) {
      n.sp.visible = k > 0.01;
      n.sp.material.opacity = 0.1 * k; // 6-10% alpha
      n.sp.position.x = n.x + Math.sin(time * 0.07 + n.phase) * 2.4;
      n.sp.position.y = n.y + Math.cos(time * 0.05 + n.phase) * 1.4;
    }
    // fade the floor and its decals out over the first 30% of the sky fade, then hide
    const ff = Math.min(1, k / 0.3);
    for (const p of this.floorParts) {
      p.mat.transparent = true;
      p.mat.opacity = p.baseOpacity * (1 - ff);
      p.mesh.visible = p.baseVisible && ff < 1;
    }
  }

  /** Item 2: swap the bunny for the twinkling star. */
  showStar(x, y) {
    if (this.starShown) return false;
    this.starShown = true;
    this.star.position.set(x, y, 0);
    this.starCore.position.set(x, y, 0);
    this.star.visible = true;
    this.starCore.visible = true;
    this.starAt = { x, y };
    return true;
  }

  /** Item 2: keep twinkling, scale 0.85-1.1 at about 3 Hz. */
  twinkle(time) {
    if (!this.starShown) return;
    const s = 0.975 + 0.125 * Math.sin(time * Math.PI * 2 * 3);
    this.star.scale.setScalar(s);
    this.starCore.scale.setScalar(0.55 * s);
    this.star.rotation.z = time * 0.4;
  }

  reset() {
    this.stage.bgDome.material.color.copy(this.baseSky);
    const m = this.bokeh.points.material;
    m.size = this.baseBokeh.size;
    m.opacity = this.baseBokeh.opacity;
    m.color.copy(this.baseBokeh.color);
    for (const n of this.nebula) {
      n.sp.visible = false;
      n.sp.material.opacity = 0;
      n.sp.position.set(n.x, n.y, n.z);
    }
    for (const p of this.floorParts) {
      p.mat.opacity = p.baseOpacity;
      p.mat.transparent = p.baseTransparent;
      p.mesh.visible = p.baseVisible;
    }
    this.star.visible = false;
    this.starCore.visible = false;
    this.starShown = false;
    this.starAt = null;
    this.k = 0;
  }
}
