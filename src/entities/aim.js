/**
 * Aim UI: the slingshot band, the power arc, the dotted trajectory preview and
 * the sparkle bursts for collection / landing.
 *
 * The trajectory dots come straight from the physics solver, so what you see is
 * exactly what happens.
 */

import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { radialTexture } from '../render/facet.js';
import { clamp01, TAU } from '../core/math.js';

export class AimIndicator {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'aim';
    this.group.renderOrder = 6;
    scene.add(this.group);

    const dotTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', [
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.75)'],
      [1, 'rgba(255,255,255,0)']
    ]);

    // --- trajectory dots (pooled) ---
    const dotGeo = new THREE.PlaneGeometry(0.2, 0.2);
    this.dotMat = new THREE.MeshBasicMaterial({
      map: dotTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    this.dots = [];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(dotGeo, this.dotMat.clone());
      m.visible = false;
      m.renderOrder = 6;
      this.group.add(m);
      this.dots.push(m);
    }

    // --- slingshot band: two lines from the anchor to the pull point ---
    const bandMat = new THREE.MeshBasicMaterial({
      color: PALETTE.blushPink,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: false
    });
    this.band = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bandMat);
    this.band.visible = false;
    this.band.renderOrder = 6;
    this.group.add(this.band);

    // --- power ring around the bunny ---
    this.powerRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.045, 6, 48),
      new THREE.MeshBasicMaterial({
        color: PALETTE.goldPale,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.powerRing.visible = false;
    this.powerRing.renderOrder = 6;
    this.group.add(this.powerRing);

    // --- pull handle at the pointer ---
    this.handle = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.24, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.handle.visible = false;
    this.handle.renderOrder = 6;
    this.group.add(this.handle);

    this.active = false;
    this.time = 0;
  }

  hide() {
    this.active = false;
    for (const d of this.dots) d.visible = false;
    this.band.visible = false;
    this.powerRing.visible = false;
    this.handle.visible = false;
  }

  /**
   * @param {object} o
   * @param {Array<{x:number,y:number,capture?:boolean,land?:boolean}>} o.points
   * @param {{x:number,y:number}} o.pull      current pull-back point
   * @param {{x:number,y:number}} o.anchor    bunny position
   * @param {number} o.power  0..1
   */
  show(o) {
    this.active = true;
    const { points, pull, anchor, power } = o;

    // trajectory dots, fading along their length
    let i = 0;
    const n = Math.min(points.length, this.dots.length);
    for (; i < n; i++) {
      const p = points[i];
      const d = this.dots[i];
      d.visible = true;
      d.position.set(p.x, p.y, 0.2);
      const t = i / Math.max(1, n - 1);
      const fade = (1 - t) * (1 - t * 0.35);
      const size = lerpN(0.26, 0.1, t) * (p.capture ? 1.35 : 1);
      d.scale.setScalar(size);
      if (p.capture) d.material.color.set(PALETTE.gold);
      else d.material.color.set(0xffffff);
      d.material.opacity = 0.2 + fade * 0.72;
    }
    for (; i < this.dots.length; i++) this.dots[i].visible = false;

    // slingshot band, drawn as a quad between the anchor and the pull point
    const dx = anchor.x - pull.x;
    const dy = anchor.y - pull.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.05) {
      this.band.visible = true;
      this.band.position.set((anchor.x + pull.x) / 2, (anchor.y + pull.y) / 2, 0.15);
      this.band.rotation.z = Math.atan2(dy, dx);
      this.band.scale.set(len, 0.055 + power * 0.05, 1);
      this.band.material.opacity = 0.28 + power * 0.4;
    } else {
      this.band.visible = false;
    }

    // power ring around the bunny
    this.powerRing.visible = true;
    this.powerRing.position.set(anchor.x, anchor.y, 0.16);
    const r = 0.72 + power * 0.14;
    this.powerRing.scale.set(r, r, 1);
    this.powerRing.material.opacity = 0.35 + power * 0.5;
    this.powerRing.material.color.setHSL(0.12 - power * 0.08, 0.85, 0.62 + power * 0.1);

    this.handle.visible = true;
    this.handle.position.set(pull.x, pull.y, 0.18);
    this.handle.scale.setScalar(1 + power * 0.4);
    this.handle.material.opacity = 0.55 + power * 0.35;
  }

  update(dt) {
    this.time += dt;
    if (!this.active) return;
    const p = 0.9 + Math.sin(this.time * 9) * 0.06;
    this.handle.scale.multiplyScalar(p / (this.handle.scale.x || 1));
  }
}

function lerpN(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Pooled sparkle bursts: gold on star pickup, white on landing, pink for the
 * suit-up moment.
 */
export class SparkleBurst {
  constructor(scene, { count = 260 } = {}) {
    this.count = count;
    this.cursor = 0;
    this.pool = [];

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setDrawRange(0, count);

    const tex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0)']
    ]);

    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: tex,
        size: 0.3,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);

    for (let i = 0; i < count; i++) {
      this.pool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        r: 1,
        g: 1,
        b: 1,
        size: 1
      });
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -999;
      pos[i * 3 + 2] = 0;
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {object} o { n, spread, speed, life, color: THREE.Color, size, gravity, z }
   */
  burst(x, y, o = {}) {
    const n = o.n ?? 22;
    const spread = o.spread ?? TAU;
    const speed = o.speed ?? 2.4;
    const life = o.life ?? 0.7;
    const color = o.color ?? new THREE.Color(PALETTE.gold);
    const size = o.size ?? 1;
    const gravity = o.gravity ?? -1.6;
    const dir = o.dir ?? 0;

    const pos = this.points.geometry.attributes.position.array;
    const col = this.points.geometry.attributes.color.array;

    for (let i = 0; i < n; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.count;
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.45 + Math.random() * 0.85);
      p.x = x + (Math.random() - 0.5) * 0.12;
      p.y = y + (Math.random() - 0.5) * 0.12;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = life * (0.65 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.gravity = gravity;
      p.size = size * (0.6 + Math.random() * 0.7);
      p.r = color.r;
      p.g = color.g;
      p.b = color.b;
    }
    this.points.material.size = 0.3;
    void pos;
    void col;
  }

  update(dt) {
    const pos = this.points.geometry.attributes.position.array;
    const col = this.points.geometry.attributes.color.array;
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      if (p.life <= 0) {
        pos[i * 3 + 1] = -999;
        continue;
      }
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 0.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = clamp01(p.life / p.maxLife);
      const fade = k * k;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = 0.2;
      col[i * 3] = p.r * fade;
      col[i * 3 + 1] = p.g * fade;
      col[i * 3 + 2] = p.b * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}