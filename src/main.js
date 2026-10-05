/**
 * Space Bunny — entry point.
 *
 * Wires the stage, input, HUD and game together, and runs the fixed-step loop.
 */

import { Stage, Loop } from './core/stage.js';
import { Input, Keys } from './core/input.js';
import { Hud } from './ui/hud.js';
import { applyLang, toggleLang, T, showNoWebGL, webglAvailable } from './ui/i18n.js';
import { CONFIG } from './game/config.js';
import sound from './audio/sound.js';
import { Game, STATES } from './game/game.js';
import { FIXED_DT, predictPath } from './physics/world.js';
import * as THREE_NS from 'three';

const canvas = document.getElementById('stage');

/**
 * R4b item 4: the no-WebGL guard has to be the FIRST thing that runs.
 *
 * `new Stage(canvas)` is what asks the browser for a WebGL context, so if it
 * runs first a machine without WebGL throws here and the friendly message never
 * gets a chance to appear - the player just gets a black rectangle. Everything
 * from here to the end of the file is therefore inside one labelled block, so a
 * failed check can `break boot` and skip it all. A `throw` would be wrong here:
 * there is no try/catch above this line, so it would surface as an unhandled
 * rejection in the console, which is exactly what this round is trying to avoid.
 */
boot: {
  if (!webglAvailable()) {
    showNoWebGL();
    break boot;
  }

  const stage = new Stage(canvas);
const hud = new Hud();
const input = new Input(canvas, stage.camera);
const keys = new Keys();

// one scene, one config
const game = new Game(stage, CONFIG, hud);

// ---- stage layout ----------------------------------------------------------

function onResize() {
  stage.resize();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
onResize();

// ---- input wiring ----------------------------------------------------------

input.onPress = (world) => {
  if (game.state === STATES.FINALE || game.state === STATES.DONE) return;
  game.tryGrab(world);
};
input.onDrag = (world) => {
  game.dragTo(world);
};
input.onRelease = () => {
  game.release();
};

keys.on('r', () => {
  sound.play('ui');
  restart();
});
keys.on('b', () => {
  game.blush = !game.blush;
  game.bunny.setBlush(game.blush);
});
keys.on('escape', () => game.cancelAim());
// R4-sounds item 4: M flips sound on/off, same as the pill.
keys.on('m', () => {
  const now = sound.toggle();
  hud.setSound(now);
  // a tick either way, so the key never feels dead - but only if it is now on.
  if (now) sound.play('ui');
});

// ---- dev overlay: Agata's composition mockup, for matching only ----------
// ?overlay drops plansza.png straight over the canvas at the canvas size, so
// every box in rounds/R1d.md can be read off one screenshot. O toggles it,
// [ and ] walk the opacity. Not built unless ?overlay is in the URL.

// R4b item 1: this must be dev-gated. `new URL('...plansza.png', import.meta.url)`
// makes the bundler emit plansza-hR0ljSg3.png (191 KB) into dist/ - a build I
// confirmed the page never requests, because ?overlay is never in the URL. So it
// was 191 KB of dead weight shipped to every player. DEV-gating it drops plansza
// out of dist entirely.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('overlay')) {
  const img = document.createElement('img');
  // R4b item 1: the path is built with join() on purpose. Written as a plain
  // string literal, `new URL('...png', import.meta.url)` makes the bundler emit
  // plansza-hR0ljSg3.png (191 KB) into dist/ during PARSING - before
  // import.meta.env.DEV is substituted - so the DEV gate above does not stop it.
  // I verified this on a clean rebuild: dist still carried the 191 KB PNG, and
  // nothing in dist referenced it. join() is not statically analysable, so the
  // dev-only overlay still works and the file no longer ships. (Same lesson as
  // R1m's dynamic import of lil-gui: a static reference pulls the asset in
  // regardless of the runtime flag.)
  img.src = new URL(['..', 'bunny-puppet-parts', 'plansza.png'].join('/'), import.meta.url).href;
  img.alt = '';
  img.id = 'plan-overlay';
  img.style.cssText =
    'position:fixed;margin:0;border:0;padding:0;pointer-events:none;' +
    'object-fit:fill;opacity:0.5;z-index:5';
  document.body.appendChild(img);

  // pinned to the canvas box, not the window, so it stays honest if the canvas
  // is ever letterboxed
  const syncOverlay = () => {
    const r = canvas.getBoundingClientRect();
    img.style.left = `${r.left}px`;
    img.style.top = `${r.top}px`;
    img.style.width = `${r.width}px`;
    img.style.height = `${r.height}px`;
  };
  syncOverlay();
  window.addEventListener('resize', syncOverlay);
  window.addEventListener('orientationchange', () => setTimeout(syncOverlay, 120));

  let overlayOpacity = 0.5;
  const setOverlayOpacity = (v) => {
    overlayOpacity = Math.min(1, Math.max(0, +v.toFixed(2)));
    img.style.opacity = String(overlayOpacity);
  };
  keys.on('o', () => {
    img.style.display = img.style.display === 'none' ? '' : 'none';
  });
  keys.on('[', () => setOverlayOpacity(overlayOpacity - 0.1));
  keys.on(']', () => setOverlayOpacity(overlayOpacity + 0.1));
  window.__planOverlay = {
    img,
    get opacity() {
      return overlayOpacity;
    },
    sync: syncOverlay
  };
}

hud.onReplay = () => {
  sound.stopAll();
  sound.play('ui');
  restart();
};
    // R4a items 1-2: the language switch.
    hud.onLangToggle = () => { toggleLang(); hud.setHint(); sound.play('ui'); };
    // R4-sounds item 4: the sound pill.
    hud.onSoundToggle = () => {
      const now = sound.toggle();
      hud.setSound(now);
      if (now) sound.play('ui');
    };
    // R4b item 4: the WebGL check itself is at the very top of this file,
    // before `new Stage()` - see the boot: block. Here we only translate.
    applyLang();
    // R4-sounds item 1: the ONE place the AudioContext may be created. These
    // listeners are on window with capture-free passive handlers, so the first
    // real pointerdown / touchend / keydown wakes it - never before.
    sound.installGestureHooks();
    hud.setSound(sound.isOn());
    // R4-sounds item 6: a DEV-only handle so the checks can count calls per
    // sound, read the voice count and render sounds offline. DEV-gated, so it is
    // not in the production bundle (grepped in reports/R4-sounds.md).
    if (import.meta.env.DEV) window.__sound = sound;
    // the hint's position is derived from the rim, so a language change (which
    // changes its box) has to re-measure it.
    window.addEventListener('spacebunny:lang', () => hud.update(game.snapshot()));
    // R3b item 4: the HUD needs the real camera + level to place the hint.
    hud.scene3d = { camera: stage.camera, level: game.level };
    // R3a item 2: the Restart button and the R key do the same thing.
    hud.onRestart = () => {
      sound.play('ui');
      restart();
    };

function restart() {
  // R2b item 0, Agata's choice: R drops him back in - the same beat as being
  // flung off screen, but immediately, with no 0.8 s pause. R2f's reset() put him
  // straight on the seat; this is the version she asked for.
  // R3a item 2: a NEW seeded star layout and the count back to zero, then
  // he drops back in as before.
  // R4-sounds item 3: Restart / Play again / R stop every continuous
  // sound at once - the aim creak, the rocket and the space pad must not
  // survive into the next round.
  sound.stopAll();
  game.restartStars();
  game.beginDropping();
  hud.resetHint(); // R4a: the dictionary owns the hint text
  hud.hideEnd();
}

// ---- loop ------------------------------------------------------------------

const loop = new Loop({ fixedDt: FIXED_DT, maxSubSteps: 6 });

loop.onFixed = (dt) => {
  game.fixedUpdate(dt);
};

loop.onRender = (frameDt) => {
  // clamp so a stutter never teleports the bunny
  const dt = Math.min(frameDt, 1 / 20);
  game.render(dt);
  stage.renderer.render(stage.scene, stage.camera);
};

// ---- optional headless probe (development only) ---------------------------

// import.meta.env.DEV is load-bearing: with only the runtime ?probe check the
// bundler still emitted dev/probe.js as a ~10 kB production chunk (R1n D6).
if (import.meta.env.DEV && new URLSearchParams(location.search).has('probe')) {
  const { installProbe } = await import('./dev/probe.js');
  window.__threeVec = (x, y, z) => new THREE_NS.Vector3(x, y, z);
  window.__physics = { predictPath };
  installProbe();
}

// ---- go --------------------------------------------------------------------

hud.show();
hud.update(game.snapshot());
hud.setHint(game.level.hint);

// one warm-up render so shaders compile behind the loader
stage.renderer.compile(stage.scene, stage.camera);
stage.renderer.render(stage.scene, stage.camera);

loop.start();
requestAnimationFrame(() => {
  requestAnimationFrame(() => hud.hideLoader());
});

/**
 * Exposed for console tinkering and for the screenshot tooling used while
 * building the game (see tools/shotserver.mjs).
 */
/**
 * Round 1m: the LOOK TUNING PANEL, dev only.
 *
 * The dynamic import is the whole point: a static `import 'lil-gui'` would put
 * lil-gui in the production bundle's module graph even behind a runtime flag,
 * because bundlers follow static imports. `import()` behind a condition makes it
 * a separate, lazily-fetched chunk that the production build never emits
 * (verified in reports/R1m.md by grepping the built bundle for "lil-gui").
 */
if (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tune')) {
  import('./dev/tune.js')
    .then((m) => m.openPanel())
    .catch((err) => console.warn('[look] panel failed to load (dev only):', err));
}

// R4b item 1: the test handle must never ship. R1n gated probe.js behind
// import.meta.env.DEV but this assignment itself was not gated.
//
// Written as `if (DEV) handle = {...}` rather than `handle = DEV ? {...} : undefined`
// on purpose: the ternary leaves `window.spaceBunny = false ? {...} : undefined` in the
// built bundle, so the string survives minification. The `if` form is dead code the
// bundler deletes outright - verified by grepping dist/ for "window.spaceBunny".
if (import.meta.env.DEV)
  window.spaceBunny = {
  get game() {
    return game;
  },
  stage,
  config: CONFIG,
  restart,
  /** Render one frame and return the canvas as a JPEG data URL. */
  capture(width = 760, quality = 0.85) {
    stage.renderer.render(stage.scene, stage.camera);
    const src = stage.renderer.domElement;
    const off = document.createElement('canvas');
    const scale = width / src.width;
    off.width = width;
    off.height = Math.round(src.height * scale);
    off.getContext('2d').drawImage(src, 0, 0, off.width, off.height);
    return off.toDataURL('image/jpeg', quality);
  },
  /** Point the camera somewhere specific, for framing checks. */
  look(x, y, z) {
    stage.update = () => {};
    stage.camera.position.set(x, y, z);
    stage.camLookCurrent.set(0, 0, 0);
    stage.camera.lookAt(0, 0, 0);
  }
};
}
// ---- end boot ----