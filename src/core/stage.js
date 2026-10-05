/**
 * Renderer, scene, lighting and camera rig.
 *
 * Fixed camera for round 1 (the terrarium sits at the bottom centre with empty
 * play space above it), gentle vertical follow for round 2. Lighting matches the
 * reference: soft white key from the upper left, pink fill from the right, blue
 * rim from behind, soft bounce from below.
 */

import * as THREE from 'three';
import { PALETTE, RENDER } from './palette.js';
import { LOOK, onLook, changed, hex, num } from '../game/look.js';
import { gradientEnvironment, radialTexture } from '../render/facet.js';
import { damp, clamp, lerp } from './math.js';

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // scene read white - platform-top saturation measured S 0.107 against a
    // #E9C6F2 target's 0.63. NeutralToneMapping (three r186) keeps hue and
    // saturation; it renders darker, so exposure rises 1.06 -> 1.4 to hold the
    // lightness. Measured: pedestal front S 0.315 -> ~0.81, rim top S 0.379 ->
    // ~0.86, leaf mint lit S 0.256 -> ~0.78. The bunny also IMPROVES: its head
    // front lands within ~3 % of its authored #CCB7FB where ACES left it 10 % off.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = num(LOOK.exposure, 1.4);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();

    // --- environment: the reflection source. Round 1f made this NEUTRAL-COOL
    // (#F2F0FF top -> #E6DDF5 bottom) instead of the pink sky pair: with pink in
    // the environment every surface picked up rose in its reflections, which is
    // half of why the mints and violets read wrong through R1c-R1e.
    this.envTex = gradientEnvironment(hex(LOOK.env.top, 0xf2f0ff), mixHex(hex(LOOK.env.top, 0xf2f0ff), hex(LOOK.env.bottom, 0xe6ddf5), 0.5), hex(LOOK.env.bottom, 0xe6ddf5));
    this.scene.environment = this.envTex;
    this._envBuilt = true;
    this.scene.environmentIntensity = 0.45;

    // --- background dome ---
    // Round 1d dropped scene.fog: Agata wants a VISIBLE, soft-edged floor disc,
    // not a horizonless cove. The dome stays a flat MeshBasicMaterial with
    // `toneMapped: false` so the sky gradient displays exactly as authored.
    this.bgTex = gradientEnvironment(hex(LOOK.sky.top, 0xcfabe0), hex(LOOK.sky.bottom, 0xd4ade1), hex(LOOK.sky.bottom, 0xd4ade1));
    this.bgDome = new THREE.Mesh(
      new THREE.SphereGeometry(70, 48, 32),
      new THREE.MeshBasicMaterial({
        map: this.bgTex,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        // ACES tone mapping was pulling the sky down to #d5c7dd against the
        // authored #d4ade1, which put a visible seam where the floor disc ended
        toneMapped: false
      })
    );
    this.bgDome.name = 'sky';
    this.bgDome.renderOrder = -1;
    this._skyBuilt = true;
    this.scene.add(this.bgDome);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 160);
    this.camLook = new THREE.Vector3(0, 0.6, 0);
    this.camBase = new THREE.Vector3(0, 1.1, 11.6);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);

    // framing: the world region that must always be on screen
    this.frame = { y: 6.74, height: 22, width: 12 };
    this.fov = 44;
    /** how far above the look-target the camera sits: tan(tilt) * distance */
    this.tiltDeg = 20;
    this.followEnabled = false;
    this.followSmooth = 1.6;
    this.followHeight = 0;
    this.followTarget = 0;
    this.shake = 0;

    this.buildLights();
    this.applyLights();
    this.applyEnvironment();
    onLook(() => { this.applyLights(); this.applyEnvironment(); });
    this.applyFrame();
    this.resize();
  }

  /**
   * Round 1f light rig. R1d's diagnosis was right: four pink lights are what
   * killed the mint, gold and violet. Agata's mockup is lit NEUTRALLY with
   * colour coming in from the sides — pedestal pink on the viewer's left, the
   * bunny's pink facets on the left, a blue edge on the right — so:
   *
   *   key      near-white #FFF8F4, high and slightly left, the only shadow
   *   pink L   #F7A8D8 from the left, the warm side
   *   blue R   #9FC2FF from the right, the cool side
   *   rim      the right-back blue that catches the glass edge (kept)
   *   hemi     cool sky #E8F0FF over a lilac-pink bounce #F3D9F5
   *
   * The pink floor bounce and the pink point light inside the bowl are GONE:
   * between them they were the reason everything inside the glass read rose.
   */
  buildLights() {
    const hemi = new THREE.HemisphereLight(hex(LOOK.lights.hemi.sky, 0xe8f0ff), hex(LOOK.lights.hemi.ground, 0xf3d9f5), num(LOOK.lights.hemi.intensity, 0.35));
    this.scene.add(hemi);
    this.hemi = hemi;

    // key: near-white, high and a little left of centre
    const key = new THREE.DirectionalLight(hex(LOOK.lights.key.color, 0xfff8f4), num(LOOK.lights.key.intensity, 2.3));
    key.position.set(-2, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    const s = 12;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 6; // soft: PCF samples a wider kernel
    this.scene.add(key);
    this.key = key;

    // warm pink from the LEFT — this is what makes the left facets sing
    const fill = new THREE.DirectionalLight(hex(LOOK.lights.pinkLeft.color, 0xf7a8d8), num(LOOK.lights.pinkLeft.intensity, 1.3));
    fill.position.set(-8, 3, 5);
    this.scene.add(fill);
    this.fill = fill;

    // cool blue from the RIGHT, so the right side goes periwinkle instead of pink
    const edge = new THREE.DirectionalLight(hex(LOOK.lights.blueRight.color, 0x9fc2ff), num(LOOK.lights.blueRight.intensity, 1.0));
    edge.position.set(8, 3, 3);
    this.scene.add(edge);
    this.edge = edge;

    // the right-back blue rim that catches the glass edges (kept from R1c)
    const rim = new THREE.DirectionalLight(hex(LOOK.lights.blueRim.color, 0x9fc2ff), num(LOOK.lights.blueRim.intensity, 1.0));
    rim.position.set(2.5, 6, -9);
    this.scene.add(rim);
    this.rim = rim;

    // Round 1f: no pink floor bounce, and no point light inside the bowl. Both
    // are kept as explicit zero-intensity handles so anything that still looks
    // them up gets a light instead of `undefined`.
    const bounce = new THREE.DirectionalLight(hex(LOOK.lights.bounce.color, 0xffd2ec), num(LOOK.lights.bounce.intensity, 0));
    bounce.position.set(-1.5, -5, 3);
    this.scene.add(bounce);
    this.bounce = bounce;

    const inner = new THREE.PointLight(hex(LOOK.lights.inner.color, 0xffc6e8), num(LOOK.lights.inner.intensity, 0), 9, 2);
    inner.position.set(0, -0.4, 1.4);

    // Round 1m item 2: a RIGHT fill, default intensity 0 so the scene is
    // unchanged until Agata raises it. R1l D5 showed the pedestal's right flank
    // could not be lifted by albedo OR emissive - nothing in the rig lit it from
    // the right, and the lights were protected that round. This is that lever.
    const rightFill = new THREE.DirectionalLight(
      hex(LOOK.lights.rightFill.color, 0xe8d4ff),
      num(LOOK.lights.rightFill.intensity, 0)
    );
    rightFill.position.set(9, 2.5, 4);
    this.scene.add(inner);
    this.innerLight = inner;
    // the right fill is deliberately NOT in the scene yet (R1n item 2 / R1m D4)
    this.rightFill = rightFill;
    this.rightFillLight = null;
    this.lightHandles = { hemi, key, fill, edge, rim, bounce, inner, rightFill: null };
  }

  /**
   * Round 1m: the ?tune panel drives the light rig live. Each entry names the
   * LOOK path it follows, so the panel can build colour + intensity controls
   * without this module knowing anything about lil-gui.
   */
  /**
   * Round 1n item 1: the sky and env controls were DEAD. bgTex and envTex were
   * gradient textures built ONCE in the constructor from LOOK.sky / LOOK.env, and
   * nothing rebuilt them - so Agata moved the sky slider and the picture did not
   * change. Both are now regenerated on change, disposing the old texture so the
   * GPU copy is not leaked.
   */
  applyEnvironment() {
    if (changed('env.top') || changed('env.bottom')) {
      const top = hex(LOOK.env.top, 0xf2f0ff);
      const bot = hex(LOOK.env.bottom, 0xe6ddf5);
      const tex = gradientEnvironment(top, mixHex(top, bot, 0.5), bot);
      if (this.envTex) this.envTex.dispose();
      this.envTex = tex;
      this.scene.environment = tex;
    }
    if (changed('sky.top') || changed('sky.bottom')) {
      const top = hex(LOOK.sky.top, 0xcfabe0);
      const bot = hex(LOOK.sky.bottom, 0xd4ade1);
      const tex = gradientEnvironment(top, bot, bot);
      if (this.bgTex) this.bgTex.dispose();
      this.bgTex = tex;
      if (this.bgDome && this.bgDome.material.map !== tex) {
        this.bgDome.material.map = tex;
        this.bgDome.material.needsUpdate = true;
      }
    }
  }

  /** Create the right fill light on first real use (see buildLights). */
  ensureRightFill() {
    const want = num(LOOK.lights.rightFill.intensity, 0);
    if (want <= 0 && !this.rightFillLight) return null;
    if (!this.rightFillLight) {
      const l = new THREE.DirectionalLight(
        hex(LOOK.lights.rightFill.color, 0xe8d4ff),
        want
      );
      l.position.set(9, 2.5, 4);
      this.scene.add(l);
      this.rightFillLight = l;
      this.lightHandles.rightFill = l;
      if (import.meta.env.DEV) console.log('[look] right fill created (intensity ' + want + ')');
    }
    return this.rightFillLight;
  }

  applyLights() {
    const h = this.lightHandles;
    if (!h) return;
    const L = LOOK.lights;
    const set = (light, spec, fallbackColor, fallbackI) => {
      if (!light) return;
      light.color.setHex(hex(spec.color, fallbackColor));
      light.intensity = num(spec.intensity, fallbackI);
    };
    set(h.hemi, L.hemi, 0xe8f0ff, 0.35);
    if (h.hemi) {
      h.hemi.color.setHex(hex(L.hemi.sky, 0xe8f0ff));
      h.hemi.groundColor.setHex(hex(L.hemi.ground, 0xf3d9f5));
      h.hemi.intensity = num(L.hemi.intensity, 0.35);
    }
    set(h.key, L.key, 0xfff8f4, 2.3);
    set(h.fill, L.pinkLeft, 0xf7a8d8, 1.3);
    set(h.edge, L.blueRight, 0x9fc2ff, 1.0);
    set(h.rim, L.blueRim, 0x9fc2ff, 1.0);
    set(h.bounce, L.bounce, 0xffd2ec, 0);
    set(h.inner, L.inner, 0xffc6e8, 0);
    const rf = this.ensureRightFill();
    if (rf) {
      rf.color.setHex(hex(L.rightFill.color, 0xe8d4ff));
      rf.intensity = num(L.rightFill.intensity, 0);
    }
    this.renderer.toneMappingExposure = num(LOOK.exposure, 1.4);
  }

  configure(config) {
    if (config.frame) this.frame = { ...this.frame, ...config.frame };
    const cam = config.camera;
    if (cam.position) this.camBase.set(cam.position[0], cam.position[1], cam.position[2]);
    if (cam.target) this.camLook.set(cam.target[0], cam.target[1], cam.target[2]);
    this.fov = cam.fov ?? this.fov;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.tiltDeg = cam.tiltDeg ?? this.tiltDeg;
    this.followEnabled = !!cam.follow;
    this.followSmooth = cam.followSmooth ?? 1.6;
    this.followHeight = cam.followHeight ?? 3.5;
    this.camLookCurrent = this.camLook.clone();
    this.applyFrame();
  }

  /**
   * Derive the camera distance so a given world region fills the viewport, and
   * lift it by the tilt so the lens looks down on the scene.
   * Called on configure and on resize, so a tall phone window pulls back
   * instead of cropping the bowl.
   */
  applyFrame() {
    const f = this.frame;
    const aspect = Math.max(0.35, this.camera.aspect || 1.6);
    const halfV = Math.tan((this.fov * Math.PI) / 360);
    const distH = f.height / 2 / halfV;
    const distW = f.width / 2 / halfV / aspect;
    // exactly enough to fit, plus a hair of margin so nothing kisses the edge
    const raw = Math.max(distH, distW) * 1.04;
    // a NaN distance would throw the whole rig off screen, so fall back
    const dist = Number.isFinite(raw) ? raw : 28;
    this.camBase.z = Math.min(dist, 42);
    this.camLook.y = f.y;
    // tilting the camera up by dist * tan(tilt) makes it look down by `tilt`
    this.camBase.y = f.y + dist * Math.tan((this.tiltDeg * Math.PI) / 180);
    if (this.followCurrent !== undefined) {
      this.camLookCurrent.set(this.camLook.x, this.camLookCurrent.y, 0);
    } else {
      this.camLookCurrent = this.camLook.clone();
    }
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLookCurrent);
  }

  /**
   * Round 2 item 5: CALM. addShake() is now a NO-OP.
   *
   * SPEC: no screen shake. Every call site is left in place and simply does
   * nothing, which is deliberate - removing ~8 call sites scattered through
   * game.js risks a typo in code that is otherwise untouched this round, and an
   * inert no-op documents the decision where the calls are made.
   *
   * @param {number} amount ignored
   */
  addShake(amount) {
    void amount;
    // this.shake = Math.min(1.4, this.shake + amount);
  }

  /**
   * @param {number} dt
   * @param {number} lookY  world y the frame should centre on
   */
  /**
   * @param {number} dt
   * @param {number} [lookY] world y the frame should centre on. Omit to hold
   *   the level's fixed framing.
   */
  update(dt, lookY = null) {
    const targetLook = lookY === null ? this.camLook.y : lookY;
    const smooth = this.followFast ? this.followFastSmooth : this.followSmooth;
    this.camLookCurrent.y = damp(this.camLookCurrent.y, targetLook, smooth, dt);
    this.camLookCurrent.x = damp(this.camLookCurrent.x, this.camLook.x, 3, dt);

    // the camera keeps its distance and only the look-target climbs
    this.camera.position.set(
      this.camBase.x,
      this.camLookCurrent.y + (this.camBase.y - this.camLook.y),
      this.camBase.z
    );

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.4);
      const a = this.shake * this.shake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }

    this.camera.lookAt(this.camLookCurrent);
    // Reviewer fix 2026-10-05 (Agata: "a curved blue horizon, then he flies on a
    // white sky and vanishes"): the sky dome is a sphere of radius 70 around the
    // bowl, but the finale camera climbs past y 150. Beyond y ~70 the camera left
    // the sphere: first its curved limb showed, then the canvas was fully
    // transparent (alpha 0) and the page's pale CSS background showed through.
    // The sky now travels with the camera, so it always surrounds the view.
    if (this.bgDome) this.bgDome.position.copy(this.camera.position);
  }

  /**
   * R2f: the visible region of the gameplay plane (z = 0) in world units.
   *
   * The four NDC corners are UNPROJECTED onto z = 0 rather than derived from
   * fov and distance, because the camera is tilted 12.381 degrees (R1d). An
   * untilted approximation puts visBottom ~0.9 above the floor and reports
   * "off the bottom of the screen" on every single launch - I hit exactly that
   * in R2c. Recomputed whenever we resize.
   */
  computeVisibleBounds() {
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    const pts = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const v = new THREE.Vector3(nx, ny, 0.5);
      v.unproject(cam);
      v.sub(cam.position);
      if (Math.abs(v.z) < 1e-6) continue;
      const hit = (0 - cam.position.z) / v.z;
      if (hit <= 0) continue;
      pts.push(cam.position.x + v.x * hit, cam.position.y + v.y * hit);
    }
    if (!pts.length) {
      this._visBounds = { left: -10, right: 10, top: 10, bottom: -10 };
      return this._visBounds;
    }
    let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      left = Math.min(left, pts[i]);
      right = Math.max(right, pts[i]);
      top = Math.max(top, pts[i + 1]);
      bottom = Math.min(bottom, pts[i + 1]);
    }
    this._visBounds = { left, right, top, bottom };
    return this._visBounds;
  }

  /** Cached bounds; call computeVisibleBounds() (or resize()) to refresh. */
  visibleBounds() {
    return this._visBounds || this.computeVisibleBounds();
  }

  resize() {
    // Round 2 item 6: a zero-size canvas makes WebGL log
    // GL_INVALID_FRAMEBUFFER / "attachment has zero size" on every frame. It
    // happens for real at load (a hidden/zero-height window) and on some
    // minimise/restore transitions, so clamp rather than trust the layout.
    const w = Math.max(1, window.innerWidth | 0);
    const h = Math.max(1, window.innerHeight | 0);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyFrame();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // R2f: the OFFSCREEN test reads these, so they must track the viewport.
    this.computeVisibleBounds();
  }
}

/**
 * Fixed-step accumulator: physics runs at a constant rate no matter the display
 * refresh, and rendering interpolates. Keeps launches identical on 60Hz and
 * 144Hz screens.
 */
export class Loop {
  constructor({ fixedDt = 1 / 120, maxSubSteps = 8 } = {}) {
    this.fixedDt = fixedDt;
    this.maxSubSteps = maxSubSteps;
    this.accum = 0;
    this.last = 0;
    this.time = 0;
    this.running = false;
    this.onFixed = null;
    this.onRender = null;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  _tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);

    let frame = (now - this.last) / 1000;
    this.last = now;
    // clamp big gaps (tab switch) so nothing explodes
    if (frame > 0.25) frame = 0.25;

    this.accum += frame;
    let steps = 0;
    while (this.accum >= this.fixedDt && steps < this.maxSubSteps) {
      this.time += this.fixedDt;
      this.onFixed?.(this.fixedDt, this.time);
      this.accum -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSubSteps) this.accum = 0;

    this.onRender?.(frame, this.time);
  }
}

export { PALETTE, RENDER, radialTexture, lerp };

/** Middle stop of a two-colour vertical gradient. */
function mixHex(a, b, t) {
  return new THREE.Color().lerpColors(new THREE.Color(a), new THREE.Color(b), t).getHex();
}
