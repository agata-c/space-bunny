/**
 * Pointer input: drag backwards from the bunny to aim, release to launch.
 *
 * Handles mouse, touch and pen through Pointer Events, so one code path covers
 * everything. Screen coords are projected onto the z = 0 gameplay plane with
 * the same camera the player is looking at.
 */

import * as THREE from 'three';

export class Input {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;

    /** @type {{active:boolean,id:number,world:THREE.Vector2,screen:THREE.Vector2,startWorld:THREE.Vector2,startScreen:THREE.Vector2}} */
    this.pointer = {
      active: false,
      id: -1,
      world: new THREE.Vector2(),
      screen: new THREE.Vector2(),
      startWorld: new THREE.Vector2(),
      startScreen: new THREE.Vector2()
    };

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.hit = new THREE.Vector3();
    this.ndc = new THREE.Vector2();

    /** callbacks wired by the game */
    this.onPress = null;
    this.onDrag = null;
    this.onRelease = null;
    this.onCancel = null;

    this.enabled = true;

    this.bind();
  }

  bind() {
    const opts = { passive: false };
    this.canvas.addEventListener('pointerdown', this.handleDown, opts);
    window.addEventListener('pointermove', this.handleMove, opts);
    window.addEventListener('pointerup', this.handleUp, opts);
    window.addEventListener('pointercancel', this.handleUp, opts);
    // stop the page from scrolling / zooming under the canvas
    this.canvas.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    this.canvas.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toWorld(clientX, clientY, out) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
      out.set(this.hit.x, this.hit.y);
      return true;
    }
    return false;
  }

  handleDown = (e) => {
    if (!this.enabled || this.pointer.active) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();

    const p = this.pointer;
    p.active = true;
    p.id = e.pointerId;
    this.toWorld(e.clientX, e.clientY, p.world);
    p.startWorld.copy(p.world);
    p.screen.set(e.clientX, e.clientY);
    p.startScreen.copy(p.screen);

    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.onPress?.(p.world, p);
  };

  handleMove = (e) => {
    const p = this.pointer;
    if (!p.active || e.pointerId !== p.id) return;
    e.preventDefault();
    this.toWorld(e.clientX, e.clientY, p.world);
    p.screen.set(e.clientX, e.clientY);
    this.onDrag?.(p.world, p);
  };

  handleUp = (e) => {
    const p = this.pointer;
    if (!p.active || e.pointerId !== p.id) return;
    e.preventDefault();
    this.toWorld(e.clientX, e.clientY, p.world);
    p.active = false;
    p.id = -1;
    try {
      this.canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    this.onRelease?.(p.world, p);
  };
}

/** Keyboard shortcuts: blush toggle, stage cycle, restart. */
export class Keys {
  constructor() {
    this.handlers = new Map();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const list = this.handlers.get(e.key.toLowerCase());
      if (list) {
        list.forEach((fn) => fn());
        e.preventDefault();
      }
    });
  }

  on(key, fn) {
    const k = key.toLowerCase();
    if (!this.handlers.has(k)) this.handlers.set(k, []);
    this.handlers.get(k).push(fn);
  }
}