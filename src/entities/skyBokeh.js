/**
 * R4b item 1: the decorative drifting white dots behind the scene.
 *
 * Moved out of constellation.js, which held it next to the deleted StarField /
 * Constellation node game. Those are gone (SPEC 4.4: stars are collected by
 * touch only, no nodes, no capture), and this file is the only part still used.
 */
import * as THREE from 'three';
import { radialTexture } from '../render/facet.js';

export class SkyBokeh {
  constructor(seed = 3) {
    const count = 160;
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 46;
      pos[i * 3 + 1] = rnd() * 34 - 6;
      pos[i * 3 + 2] = -6 - rnd() * 16;
      sizes[i] = 0.1 + rnd() * 0.34;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const tex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,246,255,0.7)'],
      [1, 'rgba(255,240,255,0)']
    ]);

    const mat = new THREE.PointsMaterial({
      map: tex,
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffffff
    });

    this.points = new THREE.Points(geo, mat);
    this.points.name = 'bokeh';
    this.base = pos.slice();
  }

  update(dt, time) {
    const arr = this.points.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = this.base[i] + Math.sin(time * 0.18 + i) * 0.4;
      arr[i + 1] = this.base[i + 1] + Math.cos(time * 0.14 + i * 0.7) * 0.3;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
