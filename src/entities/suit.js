/**
 * The spacesuit transformation and the flight out of the terrarium.
 *
 * Piece order matches the round-2 design: helmet (1st constellation), boots
 * (2nd), jetpack (3rd). In round 1 all three arrive in one quick sequence.
 */

import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { facetedSphere, radialTexture, sparkleGeometry, paintGradient, facet, pastelTorus } from '../render/facet.js';
import { softPlastic, goldMaterial } from '../render/materials.js';
import { clamp01, easeOutBack, easeOutCubic, TAU } from '../core/math.js';

export class Spacesuit {
  constructor(bunny) {
    this.bunny = bunny;
    this.group = new THREE.Group();
    this.group.name = 'suit';
    // parented to the bunny body so it inherits lean and squash
    bunny.body.add(this.group);
    this.group.visible = false;

    this.matShell = softPlastic({ roughness: 0.34, metalness: 0.12, envMapIntensity: 1.05 });
    this.matGold = goldMaterial({ emissiveIntensity: 0.75, metalness: 0.72, roughness: 0.22 });
    this.matVisor = new THREE.MeshStandardMaterial({
      // Reviewer fix 2026-10-05 (Agata: "with the helmet his face is so blurry"):
      // the old MeshPhysicalMaterial had transmission 0.82, which renders the
      // head BEHIND it through the blurred, lower-resolution transmission buffer.
      // A plain light transparent dome keeps the face crisp.
      color: 0xf4eaff,
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      envMapIntensity: 1.2,
      side: THREE.FrontSide
    });

    this.pieces = {};
    this.pieceState = {};
    this.revealing = [];
    this.build();
  }

  build() {
    const G = this.group;

    // ---------------- helmet: glass dome over the head ----------------
    const helmet = new THREE.Group();
    helmet.position.set(0, 1.36, 0.02);
    G.add(helmet);

    const dome = new THREE.Mesh(facetedSphere(0.95, 20, 14), this.matVisor);
    dome.renderOrder = 6;
    helmet.add(dome);

    // gold collar ring at the neck
    const collar = new THREE.Mesh(pastelTorus(0.62, 0.075, 8, 36), this.matGold);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.66;
    helmet.add(collar);

    // (Agata 2026-10-05: "a curved white line" beside the helmet. The white highlight
    // streak that used to be here was never resized with the dome in anchorToRig, so
    // it floated next to the helmet as a stray arc. Removed; the dome keeps its
    // fresnel glass edge.)

    // antenna with a gold bead: reads instantly as "space"
    const antenna = new THREE.Group();
    antenna.position.set(0.3, 0.82, -0.1);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.34, 6), this.matGold);
    stalk.position.y = 0.17;
    antenna.add(stalk);
    const bead = new THREE.Mesh(facetedSphere(0.08, 10, 8), this.matGold);
    bead.position.y = 0.37;
    antenna.add(bead);
    helmet.add(antenna);

    this.pieces.helmet = helmet;

    // ---------------- boots ----------------
    const boots = new THREE.Group();
    G.add(boots);
    for (const sx of [-1, 1]) {
      const boot = new THREE.Group();
      const shaftGeo = facetedSphere(0.34, 12, 9);
      paintGradient(shaftGeo, { left: 0xffffff, mid: 0xf2f6ff, right: 0xcdd8f2 });
      const shaft = new THREE.Mesh(shaftGeo, this.matShell);
      shaft.scale.set(0.86, 1.05, 0.86);
      shaft.position.y = 0.16;
      boot.add(shaft);

      const soleGeo = facetedSphere(0.36, 12, 8);
      paintGradient(soleGeo, { left: 0xfff0fa, mid: 0xe6ecfb, right: 0xb9c6ee });
      const sole = new THREE.Mesh(soleGeo, this.matGold);
      sole.scale.set(1.0, 0.42, 1.15);
      sole.position.y = -0.1;
      boot.add(sole);

      boot.position.set(sx * 0.36, -0.05, 0.34);
      boot.rotation.y = sx * 0.3;
      boots.add(boot);
    }
    this.pieces.boots = boots;

    // ---------------- jetpack ----------------
    const pack = new THREE.Group();
    pack.position.set(0, 0.82, -0.78);
    G.add(pack);

    const shellGeo = facetedSphere(0.52, 14, 10);
    paintGradient(shellGeo, { left: 0xffffff, mid: 0xeef2ff, right: 0xc3cff4 });
    const shell = new THREE.Mesh(shellGeo, this.matShell);
    shell.scale.set(0.82, 1.15, 0.62);
    pack.add(shell);

    const trim = new THREE.Mesh(pastelTorus(0.42, 0.05, 6, 26), this.matGold);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.16;
    pack.add(trim);

    // two thruster nozzles + flame cones
    this.flames = [];
    for (const sx of [-1, 1]) {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.28, 10, 1, true), this.matGold);
      noz.position.set(sx * 0.24, -0.56, 0);
      pack.add(noz);

      // Soft cone of light plus a warm inner core: additive alpha alone reads as a
      // hard white shape, so the flame is built from a gradient texture.
      const flameTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', [
        [0, 'rgba(255,255,255,0.95)'],
        [0.4, 'rgba(255,236,255,0.5)'],
        [1, 'rgba(255,200,240,0)']
      ]);
      const flameGeo = new THREE.ConeGeometry(0.19, 1.0, 12, 1, true);
      flameGeo.translate(0, -0.5, 0);
      const flame = new THREE.Mesh(
        flameGeo,
        new THREE.MeshBasicMaterial({
          map: flameTex,
          color: 0xffe6ff,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        })
      );
      flame.position.set(sx * 0.24, -0.66, 0);
      flame.visible = false;
      pack.add(flame);
      this.flames.push(flame);
    }

    // pack glow so the bunny lights up as he launches
    const glowTex = radialTexture();
    this.packGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffe6ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    // a tight flare right at the nozzles, not a halo around the whole bunny
    this.packGlow.scale.set(1.1, 1.1, 1);
    this.packGlow.position.set(0, -0.75, 0);
    pack.add(this.packGlow);

    this.pieces.jetpack = pack;
    this.pieces.antenna = antenna;

    // ---------------- gloves on the arms ----------------
    const gloves = new THREE.Group();
    G.add(gloves);
    for (const sx of [-1, 1]) {
      const geo = facetedSphere(0.24, 10, 8);
      paintGradient(geo, { left: 0xffffff, mid: 0xf0f4ff, right: 0xc6d1f4 });
      const g = new THREE.Mesh(geo, this.matShell);
      g.position.set(sx * 0.7, 0.36, 0.2);
      gloves.add(g);
    }
    this.pieces.gloves = gloves;

    // ---------------- chest control panel ----------------
    const panel = new THREE.Group();
    panel.position.set(0, 0.86, 0.52);
    const panelGeo = facetedSphere(0.24, 10, 8);
    const panelMesh = new THREE.Mesh(panelGeo, this.matShell);
    panelMesh.scale.set(1, 0.72, 0.32);
    panel.add(panelMesh);
    for (let i = 0; i < 3; i++) {
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 8, 6),
        new THREE.MeshStandardMaterial({
          color: i === 1 ? PALETTE.blushPink : PALETTE.goldPale,
          emissive: i === 1 ? PALETTE.blushPink : PALETTE.gold,
          emissiveIntensity: 1.4,
          roughness: 0.3
        })
      );
      led.position.set((i - 1) * 0.1, 0.03, 0.1);
      panel.add(led);
    }
    G.add(panel);
    this.pieces.panel = panel;

    for (const key of Object.keys(this.pieces)) {
      this.pieces[key].visible = false;
      this.pieceState[key] = 0;
    }
  }

  /** @param {string[]} order piece keys to reveal, in sequence */
  reveal(order = ['helmet', 'boots', 'jetpack']) {
    this.group.visible = true;
    this.revealing = [];
    for (const key of order) {
      if (!this.pieces[key]) continue;
      this.pieces[key].visible = true;
      this.pieceState[key] = 0.0001;
      this.revealing.push({ key, t: 0 });
    }
  }

  get allRevealed() {
    return this.revealing.length === 0;
  }

  setThrust(on, dt) {
    for (const f of this.flames) f.visible = on;
    this.packGlow.material.opacity = on ? 0.3 + Math.random() * 0.15 : 0;
    if (on) {
      for (const f of this.flames) {
        f.scale.set(1 + Math.random() * 0.3, 0.8 + Math.random() * 0.6, 1 + Math.random() * 0.3);
        f.rotation.z = (Math.random() - 0.5) * 0.25;
      }
    }
    void dt;
  }

  update(dt, time) {
    // piece pop-in animations
    for (let i = this.revealing.length - 1; i >= 0; i--) {
      const item = this.revealing[i];
      item.t += dt * 2.6;
      const k = clamp01(item.t);
      this.pieceState[item.key] = k;
      const piece = this.pieces[item.key];
      const e = easeOutBack(k);
      piece.scale.setScalar(0.01 + e * 0.99);
      if (k >= 1) this.revealing.splice(i, 1);
    }

    // gentle idle float on the helmet antenna
    if (this.pieces.antenna.visible) {
      this.pieces.antenna.rotation.z = Math.sin(time * 2.2) * 0.14;
    }
    // panel LEDs blink
    if (this.pieces.panel.visible) {
      const s = 0.85 + Math.sin(time * 3.4) * 0.15;
      this.pieces.panel.children.forEach((c) => {
        if (c.material?.emissiveIntensity !== undefined) c.material.emissiveIntensity = 1.1 * s;
      });
    }
  }
}

/** How long the bunny climbs before the end card appears. */
const FLIGHT_TIME = 3.45;
// R3e: the thrust timeline, in real seconds.
const SPACE_TIME = 2.5;    // the sky finishes fading to deep space
const SHRINK_AT = 2.0;     // he starts shrinking relative to the camera
const SHRINK_TIME = 1.2;
// R3d item 2: all REAL seconds. The old numbers were scaled game time: freeze
// `t > 0.25` at 0.1x cost 2.5 s of real nothing, then a 1.5 s five-piece reveal -
// about 4 s from the last star to blast-off. Agata wants about 0.8 s.
const FREEZE_TIME = 0.2;
const FREEZE_SCALE = 0.25;
const POP_TIME = 0.25;
const BLAST_DELAY = 0.3; // hit -> thrust = 0.2 + 0.55 = 0.75 s
/** Seconds between star-trail samples. */
const TRAIL_INTERVAL = 0.045;

/**
 * Ending sequence: suit-up beat, then the bunny rises out of the terrarium and
 * flies into the starfield.
 *
 * The game drives this with plain timed steps (see game.js).
 */
export class Finale {
  constructor(scene, camera, bunny, suit, sparks, terrarium, level) {
    this.scene = scene;
    this.camera = camera;
    this.bunny = bunny;
    this.suit = suit;
    this.sparks = sparks;
    this.terrarium = terrarium;
    this.level = level;

    // speed lines that streak past during the flight out
    const count = 140;
    const pos = new Float32Array(count * 3);
    this.streakSeed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 2] = -Math.random() * 30 - 2;
      this.streakSeed[i * 2] = 6 + Math.random() * 16;
      this.streakSeed[i * 2 + 1] = Math.random() * TAU;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', [
      [0, 'rgba(255,255,255,1)'],
      [0.3, 'rgba(255,240,255,0.7)'],
      [1, 'rgba(255,235,255,0)']
    ]);
    this.streaks = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: tex,
        size: 0.26,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xfff4ff
      })
    );
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    scene.add(this.streaks);

    // travelling star trail behind the bunny
    this.trailLen = 46;
    this.trail = [];
    /** ring buffer of recorded positions, newest first */
    this.trailSlots = [];
    this.trailHead = { x: 0, y: 0 };
    // R3d item 1: the bowl shatter is GONE. Agata played R3c and "did not see the
    // bowl shatter, so when the user is focused on the bunny it's probably
    // unnecessary to break it". The glass now stays exactly as it is.
    // camera-facing sprites: soft gold puffs that read as a comet tail
    this.trailMat = new THREE.SpriteMaterial({
      map: null,
      color: PALETTE.goldPale,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < this.trailLen; i++) {
      const m = new THREE.Sprite(this.trailMat.clone());
      m.visible = false;
      m.scale.setScalar(0.42);
      scene.add(m);
      this.trail.push(m);
    }

    // Soft gold puffs, so the trail reads as a comet tail rather than beads.
    this.puffTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,220,150,0)', [
      [0, 'rgba(255,255,255,1)'],
      [0.28, 'rgba(255,240,200,0.55)'],
      [1, 'rgba(255,220,150,0)']
    ]);
    for (const m of this.trail) m.material.map = this.puffTex;

    this.reset();
  }

  reset() {
    // Reviewer fix 2026-10-05 (Agata: "after I won and played again the bunny got
    // stuck in this pose"): the finale switched on the ear fold, the thrust
    // streaming of the limbs and a yaw target of 0, and nothing ever switched
    // them off, so the ears stayed folded, the arms streamed and he faced the
    // camera forever.
    // R3e lesson: every state the finale turns on gets reset here.
    this.space?.reset();
    this.starShrunk = false;
    if (this.bunny) {
      if (this.bunny.setSuitFold) this.bunny.setSuitFold(false);
      if (this.bunny.setThrustStream) this.bunny.setThrustStream(0);
      this.bunny.restYawTarget = undefined;
      if (this.bunny.yaw) this.bunny.yaw.rotation.y = this.bunny.restYaw ?? this.bunny.yaw.rotation.y;
    }
    // R3d item 1: no shards or cracks to clear any more.
    this.blastV = 0;
    this.shatterStarted = false;
    this._popped = false;
    this.active = false;
    this.phase = 'idle';
    this.t = 0;
    this._popped = false;
    this.suit.revealing.length = 0;
    for (const key of Object.keys(this.suit.pieces)) this.suit.pieceState[key] = 0;
    this.streaks.visible = false;
    this.streaks.material.opacity = 0;
    this.suit.setThrust(false);
    this.trailSlots.length = 0;
    this.trailAccum = 0;
    for (const m of this.trail) m.visible = false;
    this.terrarium.setGlassOpacity(1);
  }

  start() {
    this.active = true;
    // R3d item 2: the freeze beat comes first and its timer runs on REAL dt.
    this.phase = 'freeze';
    this.t = 0;
    // R3d item 2: "NOT a slow reveal". Helmet + jetpack only, shown at once, and
    // the scale pop is driven by POP_TIME below instead of the five-piece
    // staggered reveal that made Agata wait ~4 s for blast-off.
    this.suit.pieces.helmet.visible = true;
    this.suit.pieces.jetpack.visible = true;
    this.suit.pieceState.helmet = 1;
    this.suit.pieceState.jetpack = 1;
    this.suit.revealing.length = 0;
    this.suit.group.visible = true;
    this._popped = false;
    // R3d item 3: re-anchor before the pop so the helmet lands on the head.
    this.anchorToRig();
  }

  /**
   * @param {number} dt
   * @param {number} time
   * @param {Function} [onBeat]
   * @param {object} body  physics body; the finale writes x/y straight into it
   *                        so the bunny rig, camera and shadow stay in sync
   * @returns {'suit'|'thrust'|'done'|null} current beat, null when not running
   */
  update(dt, time, onBeat, body = null) {
    if (!this.active) return null;
    this.t += dt;
    const rig = body ?? this.bunny.group.position;

    // R3d item 4: at the freeze beat, ease the tumble to 0 and turn him to face
    // the camera, so the helmet and face read. The old code left the R2 tumble
    // running, so he could still be rotated when the helmet appeared.
    if (this.phase === 'freeze' || (this.phase === 'suit' && this.t < 0.3)) {
      this.bunny.tumbleVel = 0;
      this.bunny.tumbleAngle *= Math.max(0, 1 - 14 * dt);
      this.bunny.tumble.rotation.z = this.bunny.tumbleAngle;
      this.bunny.spin *= Math.max(0, 1 - 10 * dt);
      this.bunny.dizzyT = 0;
      this.bunny.restYawTarget = 0;
    }

    // ---- R3c item 2: the freeze beat, about 0.25 s, gravity off --------------
    // R3d item 2: the freeze beat. FREEZE_TIME is REAL seconds; the sim is
    // held at 0.25x so it reads as a quick hit-stop, not a pause.
    if (this.phase === 'freeze') {
      this.suit.update(dt * FREEZE_SCALE, time);
      this.setPopScale(0);
      if (this.t > FREEZE_TIME) {
        this.phase = 'suit';
        this.t = 0;
        onBeat?.('suitStart');
      }
      return this.phase;
    }

    if (this.phase === 'suit') {
      this.suit.setThrust(false);
      const t = this.t;
      this.suit.update(dt, time);
      // R3d item 2: one beat of about 0.25 s. The poof is at his HEAD, not his
      // middle, and the helmet scales 0 -> 1.15 -> 1 with a tiny bounce.
      if (t > POP_TIME && !this._popped) {
        this._popped = true;
        this.bunny.pop(1.4);
        // Reviewer fix 2026-10-05 (Agata: the cloud puff is the same colour as the
        // bunny and reads as hair/an error): STARS only (the poof's sparkle burst), no cloud.
        this.poof?.burst(rig.x, rig.y + this.headY(), 1.1);
        this.sparks.burst(rig.x, rig.y + this.headY(), {
          n: 34,
          spread: TAU,
          speed: 3.4,
          life: 0.9,
          color: new THREE.Color(PALETTE.goldPale), // reviewer: cream sparkles, not pink blobs
          size: 0.8
        });
        onBeat?.('suitPop');
      }
      this.setPopScale(Math.min(1, t / POP_TIME));
      if (t > POP_TIME + BLAST_DELAY) {
        this.phase = 'thrust';
        this.t = 0;
        this.setPopScale(1);
        onBeat?.('launch');
      }
      return this.phase;
    }

    if (this.phase === 'thrust') {
      this.suit.setThrust(true);
      this.suit.update(dt, time);

      const k = clamp01(this.t / FLIGHT_TIME);
      // R3c item 4: a real rocket - about +60 units/s^2, capped near 45. The old
      // 2.4 -> 7.8 cruise read as "floating away", not blasting off.
      this.blastV = Math.min(45, (this.blastV ?? 2.4) + 60 * dt);
      // R3e item 1: the sky turns into deep space over about 2.5 s.
      this.space?.updateSky(clamp01(this.t / SPACE_TIME), time);
      // R3e item 2: after about 2 s he slows relative to the camera and shrinks,
      // then cross-fades into a twinkling star.
      if (this.t > SHRINK_AT && !this.space?.starShown) {
        const u = clamp01((this.t - SHRINK_AT) / SHRINK_TIME);
        const e = 1 - Math.pow(1 - u, 3); // ease-out
        const sc = Math.max(0.02, 1 - 0.85 * e);
        this.bunny.root.scale.setScalar(sc);
        this.bunny.group.scale.setScalar(sc);
        this.starShrunk = true;
        if (u >= 1) {
          this.bunny.group.visible = false;
          if (this.space?.showStar(rig.x, rig.y)) onBeat?.('becomeStar');
        }
      }
      this.space?.twinkle(time);
      rig.y += this.blastV * dt;
      rig.x += Math.sin(this.t * 1.1) * 0.5 * dt;
      this.bunny.setPosition(rig.x, rig.y);

      // R3d item 4: the static pose hack (fixed root scale, lean -0.1, body
      // rotation -0.12) is GONE. One smooth stretch value instead, and the
      // arms/legs/ears are streamed by the ragdoll drive from the speed.
      const stretch = 1 + Math.min(0.15, this.blastV * 0.0033);
      this.bunny.root.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
      this.bunny.lean = 0;
      this.bunny.setThrustStream(this.blastV);
      const p = this.bunny.group.position;

      // thruster sparks
      if (Math.random() < dt * 55) {
        this.sparks.burst(p.x, p.y - 0.1, {
          n: 2,
          spread: 1.1,
          speed: 3.2,
          life: 0.5,
          color: new THREE.Color(PALETTE.goldPale),
          size: 0.9,
          dir: -Math.PI / 2
        });
      }

      // Star trail.
      // Sampled on a fixed interval rather than per frame, so the tail covers a
      // predictable *distance* instead of shrinking on faster frames.
      this.trailAccum = (this.trailAccum ?? 0) + dt;
      if (this.trailAccum >= TRAIL_INTERVAL) {
        this.trailAccum = 0;
        this.trailSlots.push({ x: p.x, y: p.y - 0.55 });
        while (this.trailSlots.length > this.trailLen) this.trailSlots.shift();
      }

      for (let i = 0; i < this.trail.length; i++) {
        const m = this.trail[i];
        const slot = this.trailSlots[i];
        if (!slot) {
          m.visible = false;
          continue;
        }
        m.visible = true;
        m.position.set(slot.x, slot.y, 0);
        const age = i / this.trailLen;
        m.material.opacity = (1 - age) * 0.55;
        m.scale.setScalar(0.36 * (1 - age * 0.55));
      }

      // streaks fade in
      this.streaks.visible = true;
      this.streaks.material.opacity = clamp01(this.t / 1.1) * 0.9;
      const arr = this.streaks.geometry.attributes.position.array;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3 + 1] -= this.streakSeed[i * 2] * dt;
        if (arr[i * 3 + 1] < p.y - 22) arr[i * 3 + 1] = p.y + 14;
      }
      this.streaks.geometry.attributes.position.needsUpdate = true;
      this.streaks.position.set(0, 0, 0);

      // R3d item 1: the bowl is LEFT ALONE - not faded, not hidden, not broken.
      if (this.terrarium.dots) this.terrarium.dots.visible = true;

      if (this.t > FLIGHT_TIME + 0.35) {
        this.phase = 'done';
        return 'done';
      }
      return this.phase;
    }

    return this.phase;
  }

  /**
   * R3d item 3: RE-ANCHOR the suit to the CURRENT rig. The pieces sat at
   * hard-coded coordinates from the old 2.1 H bunny (R1b/R1c/R3c D5), which is
   * the "off" look Agata saw.
   *
   * The helmet is re-parented to the HEAD pivot and centred on it, with the dome
   * about 1.15x the head's largest radius (HEAD.rz = 0.30 H), a collar ring at
   * the neck, and the highlight kept on the dome. The jetpack goes on the body
   * at the back. Everything is expressed in the rig's own units (H = 3.14), so
   * it scales with the bunny instead of being a magic number.
   */
  anchorToRig() {
    const bunny = this.bunny;
    const H = bunny.H;
    const head = bunny.findByName('head');
    const helmet = this.suit.pieces.helmet;
    const pack = this.suit.pieces.jetpack;
    if (head && helmet) {
      head.add(helmet);
      helmet.position.set(0, 0, 0);
      helmet.rotation.set(0, 0, 0);
      // the dome encloses the head and the ear bases
      const domeR = 0.3 * H * 1.15;
      const dome = helmet.children.find((c) => c.isMesh && c.geometry?.type === 'SphereGeometry') || helmet.children[0];
      if (dome) dome.scale.setScalar(domeR / 0.95);
      const collar = helmet.children.find((c) => c.isMesh && c.geometry?.type === 'TorusGeometry');
      if (collar) {
        collar.position.set(0, -domeR * 0.72, 0);
        const base = collar.geometry.parameters?.radius ?? 0.62;
        collar.scale.setScalar((domeR * 0.66) / base);
      }
      const antenna = helmet.children.find((c) => c.isGroup);
      if (antenna) antenna.position.set(domeR * 0.3, domeR * 0.85, -domeR * 0.1);
    }
    if (pack) {
      bunny.body.add(pack);
      pack.position.set(0, 0.42 * H, -0.3 * H);
      pack.rotation.set(0, 0, 0);
      const sh = pack.children.find((c) => c.isMesh);
      if (sh) sh.scale.setScalar((0.17 * H) / 0.52);
    }
    // R3d item 3: fold the ears back while the suit is on, so they sit behind
    // the helmet instead of poking through it.
    // Reviewer fix 2026-10-05: no ear fold and no ear scaling (Agata: ears stay normal).
    bunny.setSuitFold(false);
    // R3e item 4: "the folded ears currently show as two lumps along the top of
    // the head". Flatten them: a little further back, and their length scaled
    // 0.85 while the suit is on, so the silhouette is a clean dome. The scale is
    // on the SPRING group, which updateFloppy never scales.
    const earLen = bunny._floppyNodes?.get('earBaseL')?.scale;
    if (earLen) earLen.set(1, 1, 1);
    const earLenR = bunny._floppyNodes?.get('earBaseR')?.scale;
    if (earLenR) earLenR.set(1, 1, 1);

    // R3e item 4: a definite glass EDGE so the near-invisible dome still reads as
    // a helmet, without blurring the face. A light fresnel in the material,
    // the same onBeforeCompile shape the bowl's rim uses.
    const domeMat = this.suit.matVisor;
    if (domeMat && !domeMat.userData.__r3eRim) {
      domeMat.userData.__r3eRim = true;
      domeMat.transparent = true;
      domeMat.opacity = 0.22; // "about 0.22 in the middle"
      domeMat.needsUpdate = true;
      const rimA = new THREE.Color(0xf4eaff);
      const rimB = new THREE.Color(0xd7b8f5);
      const prev = domeMat.onBeforeCompile;
      domeMat.onBeforeCompile = (sh, renderer) => {
        prev?.(sh, renderer);
        sh.uniforms.rimA = { value: rimA };
        sh.uniforms.rimB = { value: rimB };
        sh.fragmentShader =
          'uniform vec3 rimA;\nuniform vec3 rimB;\n' +
          sh.fragmentShader.replace(
            '#include <dithering_fragment>',
            'float rimF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.6);\n' +
              'gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(rimB, rimA, rimF), rimF * 0.85);\n' +
              'gl_FragColor.a = clamp(gl_FragColor.a + rimF * 0.5, 0.0, 1.0);\n' +
              '#include <dithering_fragment>'
          );
      };
      domeMat.customProgramCacheKey = () => 'r3e-helmet-rim';
    }
  }

  /** Where his head is, in world units - the helmet poof goes here. */
  headY() {
    const head = this.bunny.findByName('head');
    if (!head) return 1.2;
    const p = new THREE.Vector3();
    head.getWorldPosition(p);
    return p.y - this.bunny.group.position.y;
  }

  /** R3d item 2: the helmet pop, 0 -> 1.15 -> 1 over one beat. */
  setPopScale(k) {
    const h = this.suit.pieces.helmet;
    const j = this.suit.pieces.jetpack;
    if (!h) return;
    const e = k <= 0 ? 0 : k < 0.62 ? (k / 0.62) * 1.15 : 1.15 - ((k - 0.62) / 0.38) * 0.15;
    const s = Math.max(0.0001, e);
    h.scale.setScalar(s);
    if (j) j.scale.setScalar(Math.max(0.0001, s));
  }

  /** Camera rig offset for the finale: follow the bunny upward. */
  cameraTarget(out) {
    const p = this.bunny.group.position;
    // R3e item 2: once he has become the star the camera STOPS following.
    if (this.space?.starShown && this.space.starAt) {
      out.set(this.space.starAt.x * 0.4, this.space.starAt.y + 1.4, 0);
      return out;
    }
    out.set(p.x * 0.4, p.y + 1.4, 0);
    return out;
  }
}