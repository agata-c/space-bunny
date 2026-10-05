/**
 * Space Bunny — game orchestration.
 *
 * Round 1 states: READY (in the bowl) -> AIMING -> FLYING -> SETTLED (on a
 * node, ready to launch again) or RETURNING (miss -> quick arc back home) ->
 * FINALE (suit up, fly out).
 *
 * All layout numbers come from a level file; all motion comes from the physics
 * world. This file is the state machine that ties them together.
 */

import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { createBody, PhysicsWorld, predictPath, FIXED_DT } from '../physics/world.js';
import { Bunny } from '../entities/bunny.js';
import { Terrarium } from '../entities/terrarium.js';
import { Props, LeafPads } from '../entities/props.js';
import { SkyBokeh } from '../entities/skyBokeh.js';
import { Stars, GOAL } from '../entities/stars.js';
import sound from '../audio/sound.js';

/**
 * R4-sounds: the solver's surface tags -> the four impact recipes.
 * The solver knows about pads, ledges and tables; the ear only needs glass,
 * rim, cushion and a dull everything-else.
 */
function surfaceOf(tag) {
  if (tag === 'glass') return 'glass';
  if (tag === 'rim') return 'rim';
  if (tag === 'cushion') return 'cushion';
  return 'floor';
}
import { AimIndicator, SparkleBurst } from '../entities/aim.js';
import { Poof } from '../entities/poof.js';
import { Spacesuit, Finale } from '../entities/suit.js';
import { SpaceTransition } from '../entities/space.js';
import { clamp, clamp01, damp, TAU, lerp } from '../core/math.js';

/** R2a: handed to bindPhysics while the node game is gone. Round 3 removes it. */


/**
 * R2f: RETURNING and SETTLED are GONE, along with beginReturn/updateReturn and
 * the reviewer's stand-in hotfixes. They were a scripted swoop that moved the
 * body without physics, so velocity and inBowl went stale - which is why a
 * second launch did nothing. Now he always travels under real physics, and the
 * only way home is DROPPING.
 */
const STATES = {
  READY: 'ready',
  AIMING: 'aiming',
  FLYING: 'flying',
  OFFSCREEN: 'offscreen',
  DROPPING: 'dropping',
  FINALE: 'finale',
  DONE: 'done'
};

/** R2f item 1: how long he is gone before we drop him back in. */
const OFFSCREEN_BEAT = 0.8;
/** Resting OUTSIDE the bowl for this long is a miss, not a landing. */
const OUTSIDE_REST_LIMIT = 0.6;
/** R2h item 1: the poof's shrink-into-the-cloud beat before DROPPING starts. */
const POOF_SHRINK = 0.15;
/** Resting anywhere else (the rim, say) for this long is stuck. */
const STUCK_LIMIT = 2.5;
/** R2f: ease him upright over this long when he becomes READY. Never snap. */
const UPRIGHT_TIME = 0.3;

const GOLD = new THREE.Color(PALETTE.gold);
const PINK = new THREE.Color(PALETTE.blushPink);
const WHITE = new THREE.Color(0xffffff);
const LILAC = new THREE.Color(PALETTE.lilac);

export class Game {
  /**
   * @param {import('../core/stage.js').Stage} stage
   * @param {object} level
   */
  constructor(stage, level, hud) {
    this.stage = stage;
    this.level = level;
    this.hud = hud;

    this.state = STATES.READY;
    this.time = 0;
    this.stateTime = 0;
    this.prevVelocity = { x: 0, y: 0 };
    this.accel = 0;
    this.misses = 0;
    this.launches = 0;
    this.maxCombo = 0;
    this.combo = 0;
    this.hintShown = true;
    this.restTimer = 0;
    this.poofShrink = 0; // R2h item 1: >0 while the poof is eating him
    this.finaleDelay = 0;

    this.buildWorld();
    this.buildScene();

    this.body = createBody(level.seat.x, level.seat.y, level.physics.radius);
    this.anchor = new THREE.Vector2(level.seat.x, level.seat.y);
    this.pull = new THREE.Vector2(level.seat.x, level.seat.y);
    this.power = 0;
    this.aiming = false;

    this.bunny.setPosition(this.body.x, this.body.y);
    this.camLookY = 0;
    this._tmp = new THREE.Vector2();
  }

  // ---- construction --------------------------------------------------------

  buildWorld() {
    const lv = this.level;
    this.world = new PhysicsWorld({
      gravity: lv.physics.gravity,
      radius: lv.physics.radius,
      bowl: lv.bowl,
      terrain: lv.terrain,
      bounds: lv.physics.bounds
    });

    // R2a item 1: the node game is gone - no addNode, no gravityZones, no pads.
    // CONFIG.constellations is [] for this round, so nothing was being pushed
    // in here anyway; Round 3 owns the stars. See reports/R2a.md.
  }

  buildScene() {
    const scene = this.stage.scene;

    this.terrarium = new Terrarium(this.level);
    scene.add(this.terrarium.group);

    this.props = new Props(this.level);
    scene.add(this.props.group);

    this.pads = new LeafPads(this.level.pads);
    scene.add(this.pads.group);

    this.bokeh = new SkyBokeh(11);
    scene.add(this.bokeh.points);

    // R3a item 1: the real breakable stars. This retires StarField and the
    // whole Constellation node game - SPEC 4.4 says stars are "collected by touch
    // only ... no capture, no gravity assist".
    this.stars = new Stars(scene, {
      world: this.world,
      level: this.level,
      bounds: () => this.stage.visibleBounds(),
      time: () => this.time
    });
    this.goal = GOAL;

    // R3a item 1: the Constellation list, the nodes, the links and the whole
    // capture game are GONE from here (SPEC 4.4). The stars above replace them.

    this.blush = !new URLSearchParams(location.search).has('noblush');
    // The bunny is drawn a touch larger than his collision circle so he reads
    // as the hero of the scene; `baseOffset` keeps his feet on the ground.
    this.bunny = new Bunny({
      blush: this.blush,
      scale: this.level.bunnyScale ?? 1.35,
      colliderRadius: this.level.physics.radius
    });
    scene.add(this.bunny.group);


    this.aim = new AimIndicator(scene);
    this.sparks = new SparkleBurst(scene);
    // R2h item 1: two draw calls total, whatever the poof count (see poof.js).
    this.poof = new Poof(scene);
    this.suit = new Spacesuit(this.bunny);
    this.finale = new Finale(scene, this.stage.camera, this.bunny, this.suit, this.sparks, this.terrarium, this.level);
    // R3e items 1-2: the space transition and the twinkling star, built ONCE.
    // Building it per finale leaked 4 nebula sprites + 2 star meshes into the
    // scene on every win.
    this.finale.space = new SpaceTransition(this.stage, this.bokeh, this.terrarium, scene);

    this.stage.configure(this.level);
  }

  // ---- lifecycle -----------------------------------------------------------

  reset() {
    // R2b: reset() is also a ragdoll entry point (R1b's finding).
    this.bunny.resetRagdoll();
    // rebuild physics + nodes from scratch
    if (this.world.nodes) this.world.nodes.length = 0;
    this.buildWorld();

    // R3a item 1: the constellation reset (nodes, pulses, links) is gone, and
    // StarField's per-item reset with it. Restart gives a NEW star layout.
    this.restartStars();

    this.misses = 0;
    this.launches = 0;
    this.combo = 0;
    this.time = 0;
    this.accel = 0;
    this.restTimer = 0;
    this.finaleDelay = 0;
    this.prevVelocity = { x: 0, y: 0 };

    this.finale.reset();
    this.suit.group.visible = false;
    for (const key of Object.keys(this.suit.pieces)) this.suit.pieces[key].visible = false;

    this.body = createBody(this.level.seat.x, this.level.seat.y, this.level.physics.radius);
    this.anchor.set(this.level.seat.x, this.level.seat.y);
    this.pull.copy(this.anchor);
    this.power = 0;
    this.aiming = false;
    this.bunny.setPosition(this.body.x, this.body.y);
    this.bunny.setBlush(this.blush);
    this.bunny.glow = 0;
    this.bunny.glowTarget = 0;

    this.setState(STATES.READY);
    this.aim.hide();
    this.hud.update(this.snapshot());
  }

  setState(next) {
    this.state = next;
    this.stateTime = 0;
  }

  get canAim() {
    // R2f: SETTLED is gone, so READY is the only aimable state.
    return this.state === STATES.READY;
  }

  // ---- input ---------------------------------------------------------------

  /**
   * @param {THREE.Vector2} world pointer position on the gameplay plane
   * @returns {boolean} whether the press grabbed the bunny
   */
  tryGrab(world) {
    if (!this.canAim) return false;
    const r = this.level.launch.grabRadius;
    const d = Math.hypot(world.x - this.body.x, world.y - this.body.y);
    if (d > r) return false;
    this.aiming = true;
    this.setState(STATES.AIMING);
    // R4-sounds: the elastic creak starts on grab and is re-pitched while
    // dragging (see dragTo). It stops in release() and cancelAim().
    sound.start('aim', { power: 0 });
    this.pull.set(this.body.x, this.body.y);
    this.hud.hideHint();
    return true;
  }

  dragTo(world) {
    if (!this.aiming) return;
    // pull vector: from bunny back towards the pointer, capped
    const dx = world.x - this.body.x;
    const dy = world.y - this.body.y;
    const len = Math.hypot(dx, dy);
    const maxPull = this.level.launch.maxPull;
    const clamped = Math.min(len, maxPull);
    const nx = len > 1e-5 ? dx / len : 0;
    const ny = len > 1e-5 ? dy / len : 0;
    this.pull.set(this.body.x + nx * clamped, this.body.y + ny * clamped);
    this.power = clamped / maxPull;
    // R4-sounds: the creak's pitch rises with the pull (180 -> 420 Hz).
    if (this.power > 0.02) sound.update('aim', { power: this.power });
  }

  release() {
    // R2b: the LAUNCH is where the tumble gets its angular velocity - the sign
    // from which way he was thrown and the magnitude from the power. Done here
    // rather than in bunny.updateTumble because only the game knows the throw.
    {
      const dx = this.body.x - this.pull.x;
      const dy = this.body.y - this.pull.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        const dirX = dx / len;
        const power = clamp01(this.power);
        // R2g: was (3.5 + power * 7.5). Measured on a full-power 15 deg throw
        // that gave only 2.83 rad/s, because spin scales with the LATERAL part
        // of the throw (|dirX| = 0.259) - and integrated over the 0.50 s he
        // spends in FLYING it produced 0.21 turns, i.e. no visible turn-over at
        // all. Raised so a normal shot genuinely turns him over (item 2).
        this.bunny.spin = -dirX * (6.5 + power * 15);
      }
    }
    if (!this.aiming) return;
    this.aiming = false;
    this.aim.hide();

    // R4-sounds: the aim creak ends here, and the launch fires on a real
    // release only - a too-weak pull settles back in silence, which is right,
    // because nothing was thrown.
    sound.stop('aim');

    if (this.power < 0.06) {
      // too weak to be a real launch: settle back
      this.setState(this.state === STATES.AIMING ? STATES.READY : STATES.READY);
      this.pull.set(this.body.x, this.body.y);
      this.power = 0;
      // R2f: SETTLED is gone.
      return;
    }

    const v = this.launchVelocity();
    this.body.vx = v.x;
    this.body.vy = v.y;
    this.prevVelocity = { x: v.x, y: v.y };
    // R4-sounds: louder and longer with more power, by the brief's recipe.
    sound.play('launch', { power: clamp01(this.power) });
    this.accel = 0;
    this.launches++;
    this.setState(STATES.FLYING);
    this.power = 0;

    // launch juice
    const dir = Math.atan2(v.y, v.x);
    this.sparks.burst(this.body.x, this.body.y, {
      n: 16,
      spread: 1.5,
      speed: 2.6,
      life: 0.5,
      color: new THREE.Color(PALETTE.blushPink),
      size: 1,
      dir: dir + Math.PI
    });
    this.stage.addShake(0.28);
    this.bunny.squashVel += 4; // reviewer fix: launch STRETCHES (height up) under the new meaning
  }

  cancelAim() {
    if (!this.aiming) return;
    sound.stop('aim'); // R4-sounds: Escape must not leave the creak running.
    this.aiming = false;
    this.aim.hide();
    this.power = 0;
    this.pull.set(this.body.x, this.body.y);
    this.toReady();
  }

  /** Velocity implied by the current pull. Capped by level config. */
  launchVelocity() {
    const dx = this.body.x - this.pull.x;
    const dy = this.body.y - this.pull.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) return { x: 0, y: 0 };
    const maxSpeed = this.level.launch.maxSpeed;
    const maxPull = this.level.launch.maxPull;
    const speed = Math.min(maxSpeed, (len / maxPull) * maxSpeed);
    return { x: (dx / len) * speed, y: (dy / len) * speed };
  }

  // ---- fixed update --------------------------------------------------------

  fixedUpdate(dt) {
    this.time += dt;
    this.stateTime += dt;

    // drifting anchors keep the physics nodes in sync with the visuals
    // R3a item 1: constellation motion + syncNodePositions() removed.

    switch (this.state) {
      case STATES.AIMING:
        this.updateAim(dt);
        break;

      case STATES.FLYING:
        this.updateFlight(dt);
        break;

      case STATES.OFFSCREEN:
        // The joke: 0.8 s of nothing at all, then he drops back in.
        this.body.vx = 0;
        this.body.vy = 0;
        // R2g item 0: freeze the physics was not enough. His MESH is much
        // bigger than his collider (H 3.14, ears up, feet forward in z, camera
        // tilted), so the circle cleared the top edge while his legs were still
        // on screen - Agata's "his legs can still be seen at the top edge".
        // Hide the whole group for the beat.
        this.bunny.group.visible = false;
        if (this.stateTime >= OFFSCREEN_BEAT) this.beginDropping();
        break;

      case STATES.DROPPING:
        this.updateDropping(dt);
        break;

      case STATES.FINALE:
        this.updateFinale(dt);
        break;

      case STATES.DONE:
        // the flight is over; freeze the body where the finale left it
        this.body.vx = 0;
        this.body.vy = 0;
        break;

      case STATES.READY:
      default:
        this.body.vx = 0;
        this.body.vy = 0;
        this.body.x = damp(this.body.x, this.anchor.x, 12, dt);
        this.body.y = damp(this.body.y, this.anchor.y, 12, dt);
        break;
    }

    // R2f: ease him upright and back to restYaw once he is READY. Damped, so
    // he never snaps - the ragdoll (R2b) will drive this properly later.
    if (this.state === STATES.READY) {
      this.upright = Math.min(1, (this.upright ?? 0) + dt / UPRIGHT_TIME);
      this.bunny.yaw.rotation.y = damp(this.bunny.yaw.rotation.y, this.bunny.restYaw, 14, dt);
    }

    this.accel = 0;
    // During the finale the bunny rig is driven directly by Finale, so do not
    // snap it back onto the (now unused) physics body.
    if (this.state !== STATES.FINALE && this.state !== STATES.DONE) {
      // R2h item 1: during the poof beat the body has ALREADY been teleported to
      // the top of the screen, but the mesh must stay at the cloud while it
      // shrinks - otherwise he vanishes in mid-air 17 units above the poof. This
      // line runs AFTER the state switch, so pinning inside updateDropping was
      // not enough; the pin has to be here.
      const px = this.poofShrink > 0 && this.poofAt ? this.poofAt.x : this.body.x;
      const py = this.poofShrink > 0 && this.poofAt ? this.poofAt.y : this.body.y;
      this.bunny.setPosition(px, py);
    }

    // connection-lighting beat, then the suit-up finale
    if (this.finaleDelay > 0) {
      this.finaleDelay -= dt;
      if (this.finaleDelay <= 0) {
        this.finaleDelay = 0;
        this.startFinale();
      }
    }
  }

  /** R3a item 1: syncNodePositions() is gone - there are no physics nodes. */
  syncNodePositions() {
    /* intentionally empty */
  }

  updateAim(dt) {
    this.body.vx = 0;
    this.body.vy = 0;

    // The pull is visual: the bunny crouches and leans away from the drag.
    this.bunny.pullPower = this.power;
    // reviewer fix: the crouch is now handled by bunny.update (s.aiming target);
    // this line wrote the OLD meaning (0.14..0.4) and squashed him to the clamp floor.
    this.bunny.lean = damp(this.bunny.lean, -this.aimingDir().x * 0.3, 14, dt);

    const v = this.launchVelocity();
    // Same solver the live flight uses, so the preview never lies.
    this.aimTrajectory = predictPath(this.world, { x: this.body.x, y: this.body.y, vx: v.x, vy: v.y }, {
      time: 1.5,
      sampleEvery: 4
    });
    const preview = this.aimTrajectory;
    this.aim.show({
      points: preview.points,
      pull: this.pull,
      anchor: { x: this.body.x, y: this.body.y },
      power: this.power
    });
  }

  aimingDir() {
    const dx = this.body.x - this.pull.x;
    const dy = this.body.y - this.pull.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  updateFlight(dt) {
    const before = { x: this.body.x, y: this.body.y };
    const events = { bounces: [] };

    // R2f: the node/capture game is gone (R2a deleted it from the solver);
    // Round 3 re-adds whatever it needs alongside the stars.
    this.world.step(this.body, dt, events);

    // acceleration drives the ear trailing
    this.accel = ((this.body.vx - this.prevVelocity.x) / dt) * 0.02 + ((this.body.vy - this.prevVelocity.y) / dt) * 0.02;
    this.prevVelocity = { x: this.body.vx, y: this.body.vy };

    // bounce feedback
    for (const b of events.bounces) {
      const strength = clamp01(b.speed / 9);
      this.onImpact(b.speed, b.tag); // R2j item 1, + R4-sounds surface tag
      if (b.tag === 'pad') {
        this.pads.hit(b.pad);
        this.bunny.squashVel -= 7 * strength;
        this.stage.addShake(0.4 * strength);
      } else if (b.tag === 'platform' || b.tag === 'ledge' || b.tag === 'table') {
        // soft landing bounce
        this.bunny.squashVel -= Math.min(6.5, 2.5 + b.speed * 0.9); // reviewer fix: impact squashes
        this.stage.addShake(0.16 * strength);
      } else if (b.tag === 'rim') {
        this.bunny.squashVel -= 2.4 * strength; // reviewer fix: impact squashes
        this.stage.addShake(0.3 * strength);
      }
      if (strength > 0.18) {
        this.sparks.burst(b.x, b.y - 0.1, {
          n: Math.round(4 + strength * 10),
          spread: 2.2,
          speed: 1.6 + strength * 2.2,
          life: 0.42,
          color: strength > 0.55 ? WHITE : LILAC,
          size: 0.7,
          dir: Math.atan2(-this.body.vy, -this.body.vx) || -Math.PI / 2
        });
      }
    }

    // R3a item 1: a star is broken by TOUCH - the bunny's CORE circle against
    // the star's radius (SPEC 5.4b). Stars are not platforms.
    const hitIdx = this.stars.hitTest(this.body.x, this.body.y, this.level.physics.coreRadius);
    if (hitIdx >= 0) this.onStarBroken(hitIdx);

    // R2f: the launch's end conditions, all of them real physics now.
    //   - fully outside the visible bounds on any side -> OFFSCREEN
    //   - resting on the cushion inside the bowl        -> READY
    //   - resting outside, or stuck on the rim, too long -> DROPPING
    if (this.fullyOutsideBounds()) {
      // R4-sounds: the whoosh, and then the 0.8 s OFFSCREEN beat is SILENT on
      // purpose. Nothing else may fire in there - the silence is the joke.
      sound.play('whoosh');
      this.setState(STATES.OFFSCREEN);
      return;
    }
    if (this.body.resting) {
      if (this.body.inBowl && this.onCushion()) {
        this.toReady();
        return;
      }
      if (this.isStuck(dt)) this.beginDropping();
    } else {
      this.restTimer = 0;
    }

    void before;
  }

  /**
   * R2g item 0: OFFSCREEN means his MESH is fully out of the viewport, not his
   * collider. The old test used the physics circle (r 1.19) while the visible
   * bunny is H 3.14 tall with the ears up, the feet forward in z and a tilted
   * camera - so the circle left the view while the mesh was still on screen.
   *
   * Box3.setFromObject for the world AABB, then project its eight corners and
   * demand that ALL eight are past the SAME edge. A box behind the camera counts
   * as out (its NDC projection would otherwise fold back into view).
   */
  fullyOutsideBounds() {
    const b = this.stage.visibleBounds();
    const r = this.body.r;
    // Cheap reject first. The mesh is strictly bigger than the circle, so mesh-out
    // implies circle-out; and setFromObject over ~200 objects must not run at
    // 180 Hz for every launch.
    const circleOut =
      this.body.x - r > b.right ||
      this.body.x + r < b.left ||
      this.body.y - r > b.top ||
      this.body.y + r < b.bottom;
    if (!circleOut) return false;

    const box = this._meshBox || (this._meshBox = new THREE.Box3());
    box.setFromObject(this.bunny.group);
    if (box.isEmpty()) return false;
    const cam = this.stage.camera;
    cam.updateMatrixWorld();
    const camSpace = this._camBox || (this._camBox = new THREE.Box3());
    camSpace.copy(box).applyMatrix4(cam.matrixWorldInverse);
    if (camSpace.max.z < 0) return true; // entirely behind the camera

    const v = this._cornerV || (this._cornerV = new THREE.Vector3());
    let left = true;
    let right = true;
    let top = true;
    let bottom = true;
    for (let i = 0; i < 8; i++) {
      v.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      );
      v.project(cam);
      if (v.x >= -1) left = false;
      if (v.x <= 1) right = false;
      if (v.y <= 1) top = false;
      if (v.y >= -1) bottom = false;
    }
    return left || right || top || bottom;
  }

  /**
   * R2j item 1: any impact faster than 7 while FLYING or DROPPING makes him
   * dizzy for 1.2 s from the LAST qualifying hit. Every bounce goes through here,
   * so it covers glass, rim, cushion, pedestal and floor without listing tags -
   * and a tumble down the glass re-arms it each bounce instead of expiring.
   */
  onImpact(speed, tag = 'floor') {
    // R4-sounds: the impact sound is fired BEFORE the FLYING-only guard below,
    // because a DROPPING landing on the cushion is a real impact too - it is
    // just the `land` variant rather than a scored bounce.
    sound.play('impact', { speed, tag, surface: surfaceOf(tag) });
    // R3a item 0: FLYING only. The routine DROPPING landing on the cushion
    // never makes him dizzy any more - it fired on 27/27 launches otherwise.
    if (this.state !== STATES.FLYING) return;
    // R3b item 1 (reviewer's decision): threshold 12, which is ABOVE the
    // fallCap of 9, so an ordinary fall can never trigger it. R3a measured the
    // FLYING impact maxima as 26.6 21.8 17.7 17.1 14.4 9.5, then nineteen at
    // exactly 9.0 (the cap, not a real hit), then 8.97 7.29 5.4 and four zeros -
    // so >12 selects the five genuinely hard ones.
    if (speed > 12) {
      sound.play('dizzy'); // R4-sounds
      this.bunny.setDizzy(1.2);
    }
  }

  /** Resting on the cushion pad, not merely somewhere inside the bowl. */
  onCushion() {
    const t = this.level.terrain;
    return (
      Math.abs(this.body.x - (t.platformX ?? 0)) <= t.platformR + 0.05 &&
      Math.abs(this.body.y - (t.platformTopY + this.body.r)) < 0.12
    );
  }

  /** READY: anchor and pull follow wherever he actually is, so aiming always starts from him. */
  toReady() {
    // R2h item 1: "he's back!" - a small sparkle twinkle when he lands on the
    // cushion after a DROPPING. No cloud, and no shake: calm and cute.
    if (this.state === STATES.DROPPING) this.poof.twinkle(this.body.x, this.body.y);
    this.anchor.set(this.body.x, this.body.y);
    this.pull.copy(this.anchor);
    this.restTimer = 0;
    this.upright = 0;
    this.poofShrink = 0;
    this.world.dropping = false;
    this.setState(STATES.READY);
    this.hud.update(this.snapshot());
  }

  /**
   * R2f: put him back above the top edge and let him FALL in under real physics.
   * inBowl starts false so the mouth flip is exercised on the way down.
   */
  beginDropping() {
    if (this.state === STATES.DROPPING || this.state === STATES.FINALE) return;
    const b = this.stage.visibleBounds();
    // R2h item 1: Agata - landing outside the bowl made him "just vanish and
    // reappear in the bowl: mechanically OK, but it looks like a glitch". Both
    // miss paths land here (OUTSIDE_REST_LIMIT 0.6 s and STUCK_LIMIT 2.5 s, via
    // isStuck), so one hook covers both. Poof plays at where he ACTUALLY is,
    // before the teleport below moves him. NOT for the OFFSCREEN case - he is
    // hidden and frozen there, so a poof would pop in empty air.
    // R2i item 1: arm the drop-impact kick for EVERY drop, including the
    // offscreen ones - he is hidden there but he still lands, and the landing is
    // what the player is waiting for.
    this.dropKickArmed = true;
    this.dropKick = { impactSpeed: null };
    sound.play('drop'); // R4-sounds: the descending whistle as he falls in.
    const wasVisible = this.bunny.group.visible && this.state !== STATES.OFFSCREEN;
    if (wasVisible) {
      // Remember where he actually was. beginDropping teleports the BODY to the
      // top of the screen right now, so without this he shrank to nothing in
      // mid-air 17 units above the cloud - measured, and it is exactly the
      // glitch this poof exists to remove. updateDropping holds the mesh at
      // poofAt for the length of the beat instead; he reappears at the top at
      // scale 1, which the cloud covers.
      this.poofAt = { x: this.body.x, y: this.body.y };
      this.poof.play(this.body.x, this.body.y);
      sound.play('poof');
      this.poofShrink = POOF_SHRINK;
    } else {
      this.poofAt = null;
      this.poofShrink = 0;
    }
    this.body.x = this.level.seat.x + (Math.random() - 0.5) * 0.6;
    // R2g item 0: the old spawn was b.top + r + 0.6, which put his collider
    // just past the top edge - and therefore his FEET just inside it, so he
    // arrived with his legs already on screen. Spawn above the whole mesh.
    this.body.y = b.top + (this.bunny.H || 3.14) + 0.5;
    this.bunny.group.visible = true;
    this.body.vx = 0;
    this.body.vy = 0;
    this.body.inBowl = false;
    this.body._prevY = this.body.y;
    this.body.contactLog.length = 0;
    this.body.resting = false;
    this.world.dropping = true;
    this.restTimer = 0;
    // R2b: every DROPPING start clears the ragdoll (R1b's finding) - squash, the
    // tumble, all ten springs and the dizzy state - or he arrives already
    // tumbling and stays deformed after landing.
    this.bunny.resetRagdoll();
    // R2i item 1: "he can flop more" - a little spin so he tumbles on the way
    // down instead of arriving like a landing. Random sign and magnitude per
    // drop, so it never looks scripted.
    this.bunny.spin = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 2);
    this.misses = (this.misses ?? 0) + (this.state === STATES.FLYING ? 1 : 0);
    this.combo = 0;
    this.setState(STATES.DROPPING);
    this.hud.update(this.snapshot());
  }

  /** DROPPING: normal physics, capped fall, and READY once he is on the cushion. */
  updateDropping(dt) {
    // R2h item 1: the poof beat. He shrinks to nothing inside the cloud over
    // 0.15 s (ease-in, as specified) before any physics runs - the state is
    // already DROPPING, so the state machine and its timings are untouched; this
    // is a pre-roll that only gates world.step.
    if (this.poofShrink > 0) {
      this.poofShrink -= dt;
      const u = clamp01(1 - this.poofShrink / POOF_SHRINK);
      this.bunny.group.scale.setScalar(this.bunny.scale * (1 - u * u));
      this.bunny.group.visible = u < 0.995;
      if (this.poofAt) this.bunny.setPosition(this.poofAt.x, this.poofAt.y);
      if (this.poofShrink <= 0) {
        this.poofShrink = 0;
        this.bunny.group.scale.setScalar(this.bunny.scale);
        this.bunny.group.visible = true;
      }
      return;
    }
    const events = { bounces: [] };
    this.world.step(this.body, dt, events);
    this.accel = ((this.body.vx - this.prevVelocity.x) / dt) * 0.02 + ((this.body.vy - this.prevVelocity.y) / dt) * 0.02;
    this.prevVelocity = { x: this.body.vx, y: this.body.vy };
    for (const bo of events.bounces) {
      this.onImpact(bo.speed); // R2j item 1
      if (bo.tag === 'cushion') {
        const strength = clamp01(bo.speed / 9);
        this.bunny.squashVel -= Math.min(6.5, 2.5 + bo.speed * 0.9); // reviewer fix: impact squashes
        this.stage.addShake(0.16 * strength);
        // R2i item 1: the drop lands at up to 30, so squashVel alone is not
        // enough - he has to flail. Ears >= 70 deg and >= 3 visible wobbles
        // after the bounce are the measured targets. Armed once per drop, and
        // only for a real drop-speed impact.
    if (this.dropKickArmed && bo.speed > 6) {
      this.dropKickArmed = false;
      sound.play('land'); // R4-sounds: the cushion landing's bwip.
          this.bunny.kickRagdoll(clamp01((bo.speed - 6) / 18) * 1.15);
          if (this.dropKick) this.dropKick.impactSpeed = +bo.speed.toFixed(2);
        }
      }
    }
    if (this.body.resting && this.body.inBowl && this.onCushion()) this.toReady();
  }

  /**
   * Decide the launch is a miss.
   *
   * Speed alone is not enough — a bunny at the top of a lob is momentarily
   * slow. So he has to stay genuinely slow (near zero, not just the apex) for
   * a short while, and no anchor may have grabbed him, before we call it.
   */
  isStuck(dt = 0) {
    // R2f: the solver's own contact-based resting test is the input now - it is
    // the R1b hotfix, and it cannot fire at the apex of a lob the way a speed
    // threshold could. surfaceBelow() is gone.
    if (!this.body.resting) {
      this.restTimer = 0;
      return false;
    }
    // resting on the cushion: fine, the player can aim again
    if (this.body.inBowl && this.onCushion()) {
      this.restTimer = 0;
      return false;
    }
    this.restTimer = (this.restTimer ?? 0) + dt;
    // Outside the bowl (pedestal, floor) it only takes a moment before we give
    // up on him; anywhere else - the rim, say - he gets the full 2.5 s.
    const limit = this.body.inBowl ? STUCK_LIMIT : OUTSIDE_REST_LIMIT;
    return this.restTimer > limit;
  }


  /**
   * R3a item 1: he broke a star. The star SHATTERS, and his flight ENDS -
   * horizontal speed x 0.15, upward speed to 0 (SPEC 5.4b) - so he drops under
   * gravity from wherever he is. What happens next is the existing state machine:
   * into the bowl -> READY, floor -> poof -> DROPPING, off-screen -> the beat.
   * Passing through another star on the way down counts too, because the hit test
   * runs every fixed step.
   */
  onStarBroken(idx) {
    const s = this.stars.shatter(idx);
    if (!s) return;
    // R3c item 1: the 8th star does NOT run the normal drop - it enters the
    // FINALE right there, mid-air, wherever he is (SPEC 6, Agata's rewrite:
    // "he gets the helmet exactly in the place he got the last star").
    // R4-sounds: the chime RISES with the star count, and the 8th is the high
    // resolving note - so this is fired after shatter() has counted it.
    sound.play('star', { count: this.stars.broken });
    if (this.stars.goalReached) {
      this.startFinale();
      this.finaleStartTime = this.firstLaunchTime ?? this.time;
      this.hud.update(this.snapshot());
      return;
    }
    // the small sparkle burst, reusing poof.js
    this.poof.burst(s.x, s.y, 0.9);
    // R3b item 5: Agata - "when the bunny hits a star he glows. That's not
    // necessary; the stars are enough." The onFed() calls that lit him are gone;
    // the shatter, the sparkle burst and the drop all stay.
    this.stage.addShake(0.12);
    this.body.vx *= 0.15;
    if (this.body.vy > 0) this.body.vy = 0;
    // a little "oof" spin and the floppy parts flying up
    this.bunny.spin = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2);
    this.bunny.kickRagdoll(0.8);
    this.hud.update(this.snapshot());
  }

  /** R3a item 1: a NEW seeded layout, the count back to zero, shards cleared. */
  restartStars() {
    // R3c item 7: Play again must leave NO leftovers - glass back, sky, camera,
    // helmet gone, no shards still falling.
    this.finale.reset();
    this.suit.group.visible = false;
    for (const key of Object.keys(this.suit.pieces)) this.suit.pieces[key].visible = false;
    // R3e lesson: the finale shrinks him to 0.15 and hides the group to become
    // the twinkling star. The reset assertion table caught that leaking - after
    // Play again he was left at 15% size for good.
    this.bunny.group.visible = true;
    this.bunny.group.scale.setScalar(1);
    this.bunny.root.scale.setScalar(1);
    // R3d item 1: nothing to restore - the bowl was never touched.
    this.inputLocked = false;
    this.goalReached = false;
    this.finaleStartTime = null;
    // R3c item 7: pull the state machine out of FINALE/DONE too, or "Play again"
    // leaves the game in `done` with no way to launch again.
    if (this.state === STATES.FINALE || this.state === STATES.DONE) this.setState(STATES.READY);
    const info = this.stars.rebuild((Math.random() * 0xffffffff) >>> 0);
    this.stars.clearShards();
    this.stars.goalReached = false;
    // R3a item 2: the flag R3b will build the finale on.
    this.goalReached = false;
    this.hud.update(this.snapshot());
    if (import.meta.env.DEV) console.log('STAR LAYOUT seed=' + info.seed + ' placed=' + info.placed);
    return info;
  }

  onStarCollected(star) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.stage.addShake(0.12);

    const p = star.g.position;
    this.sparks.burst(p.x, p.y, {
      n: 26,
      spread: TAU,
      speed: 3,
      life: 0.75,
      color: GOLD,
      size: 1.1
    });
    this.sparks.burst(p.x, p.y, {
      n: 10,
      spread: 1.4,
      speed: 5.2,
      life: 0.5,
      color: WHITE,
      size: 0.8
    });
    this.hud.update(this.snapshot());
  }

  /** Missed: arc him quickly back to the bowl, keeping all progress. */
  // R2f: beginReturn() and updateReturn() are DELETED. They moved the body
  // along a scripted bezier WITHOUT physics, so velocity and inBowl went stale -
  // which is why a second launch after a return did nothing. The only way home is
  // now DROPPING, which is real physics the whole way.

  // ---- finale --------------------------------------------------------------

  startFinale() {
    if (this.state === STATES.FINALE || this.state === STATES.DONE) return;
    // R3c: the goal flag on the GAME, which R3a asked for and R3b deferred to
    // here. Stars keeps its own copy; this is the one the rest of the code reads.
    this.goalReached = true;
    this.setState(STATES.FINALE);
    this.aiming = false;
    this.aim.hide();
    this.body.vx = 0;
    this.body.vy = 0;
    this.anchor.set(this.body.x, this.body.y);
    // hand the bunny's current position over to the finale rig
    this.bunny.setPosition(this.body.x, this.body.y);
    // R3d item 2: the finale needs the palette poof for the helmet beat.
    this.finale.poof = this.poof;
    this.finale.start();
    // R3c item 1: input is off until the end card - no aiming, no R.
    this.inputLocked = true;
    this.finaleStartTime = this.firstLaunchTime ?? this.time;
    this.hud.hideHint();
    this.hud.update(this.snapshot());
  }

  updateFinale(dt) {
    // drive the physics body so camera follow, shadows and the rig stay together
    // R3d item 2: the finale runs on REAL dt so its phase timers are real
    // seconds; the freeze's 0.25x is applied inside Finale.update.
    const beat = this.finale.update(dt, this.time, (b) => {
      if (b === 'suitStart') {
        sound.play('helmet'); // R4-sounds: freeze thump + pop + shimmer
      }
      if (b === 'launch') {
        sound.start('rocket');
        sound.start('space'); // the pad only ever appears in the finale
      }
      if (b === 'becomeStar') {
        sound.play('born');
        sound.stop('rocket');
      }
      if (b === 'done') {
        sound.play('endcard');
      }
      if (b === 'suitPop') {
        // R3c item 5: "No screen shake."
        this.stage.addShake(0);
        this.sparks.burst(this.body.x, this.body.y + 1.3, {
          n: 26,
          spread: TAU,
          speed: 4,
          life: 1,
          color: WHITE,
          size: 1.4
        });
      }
      if (b === 'launch') {
        this.stage.addShake(0);
        this.sparks.burst(this.body.x, this.body.y, {
          n: 40,
          spread: 2.4,
          speed: 5,
          life: 0.9,
          color: new THREE.Color(PALETTE.goldPale),
          size: 1.3
        });
      }
      if (b === 'becomeStar') {
        // R3e item 2: one quick sparkle burst at the swap.
        this.sparks.burst(this.body.x, this.body.y, {
          n: 30,
          spread: TAU,
          speed: 3.6,
          life: 0.8,
          color: new THREE.Color(PALETTE.goldPale),
          size: 1.1
        });
      }
      if (b === 'done') {
        this.setState(STATES.DONE);
        this.hud.showEnd();
      }
    }, this.body);
    if (beat === 'done' && this.state !== STATES.DONE) {
      this.setState(STATES.DONE);
      this.hud.showEnd(this);
    }
  }

  /**
   * Tell each unlit node whether the current aim would actually catch it, so the
   * halo can brighten and the ring can pulse. Returns the node that will be
   * caught, if any.
   */
  updateAimHighlight() {
    // R3a item 1: the aim dots do not need to show stars (the brief says so), and
    // the per-node aim glow is gone with the node game.
    void 0;
  }

  // ---- per-frame (visuals only) -------------------------------------------

  render(dt) {
    this.frameDt = dt;
    if (this.state === STATES.AIMING) this.updateAimHighlight();
    // bokeh + props
    this.bokeh.update(dt, this.time);
    this.props.update(dt, this.time);
    this.pads.update(dt, this.time);
    this.stars.update(dt); // R3a item 1
    this.aim.update(dt);
    this.sparks.update(dt);
    this.poof.update(dt);
    this.suit.update(dt, this.time);

    const speed = Math.hypot(this.body.vx, this.body.vy);
    // R2f: surfaceBelow() is gone. The contact shadow only needs to know which
    // surface he is over: the cushion when he is on it, otherwise the floor.
    const groundY =
      this.state === STATES.FINALE
        ? -99
        : this.onCushion()
          ? this.level.terrain.platformTopY
          : this.level.terrain.tableY;

    this.bunny.update(dt, {
      x: this.body.x,
      y: this.body.y,
      vx: this.body.vx,
      ax: this.accel,
      speed,
      // R2g: this expression was INVERTED. `groundY > body.y - 0.7` is only
      // true while he is within 0.7 of the surface - so the flag was TRUE when
      // he sat on the ground and FALSE while he was actually flying. Every
      // consumer wants the opposite: the flight stretch (bunny.js:913), the ear
      // idle sway (972) and the contact shadow growing (1022). The whole flight
      // ragdoll was therefore dead, which is why the tumble read 0.00 turns,
      // the ear springs 0.0 degrees and the flight stretch exactly 1.000.
      // Airborne now means: FLYING and his collider clear of the surface.
      // `+ 0.35` keeps a graze or a rest on the cushion from counting.
      airborne: this.state === STATES.FLYING && this.body.y - this.body.r > groundY + 0.35,
      aiming: this.aiming,
      aimingDir: this.aiming ? this.aimingDir() : null,
      pullPower: this.power,
      groundY
    });

    // Camera framing.
    // - round 1: fixed on the bowl and its constellation
    // - round 2: climbs with the highest lit anchor
    // - finale: follows the bunny out of the terrarium
    let lookY = this.level.frame?.y ?? 0;
    const finale = this.state === STATES.FINALE || this.state === STATES.DONE;
    if (finale) {
      if (this.finale.phase === 'thrust') {
        // Sit him about a third up the frame: track fast (he is moving fast)
        // and bias the look-target below him so there is sky ahead.
        this.stage.followFast = true;
        this.stage.followFastSmooth = 9;
        lookY = this.body.y - (this.level.frame?.height ?? 10.6) * 0.14;
      } else {
        // still suiting up on the spot: hold the normal framing
        this.stage.followFast = false;
        lookY = null;
      }
    } else if (this.level.camera.follow) {
      this.stage.followFast = false;
      // R3a item 1: no lit anchors to climb to any more - follow the bunny.
      lookY = this.body.y;
    }
    this.stage.update(dt, lookY);
  }

  /** Blueprint for the HUD. */
  snapshot() {
    // R3a item 1: nodeTotal/dots are gone with the node game.
    return {
      stars: this.stars.broken,
      starTotal: this.stars.total,
      goal: this.stars.goal,
      goalReached: this.stars.goalReached,

      done: this.state === STATES.DONE
    };
  }
}

export { STATES, clamp01, FIXED_DT };
