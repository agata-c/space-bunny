/**
 * Minimal HUD: star count, constellation progress dots, a one-line hint and the
 * end card. Nothing more — the scene carries the information.
 */

import { T, Tn, applySoundLabel } from './i18n.js';

export class Hud {
  constructor() {
    this.el = document.getElementById('hud');
    this.loader = document.getElementById('loader');
    this.starCount = document.getElementById('starCount');
    this.starTotal = document.getElementById('starTotal');
    this.starCounter = document.getElementById('starCounter');
    // R3a item 2: progressPill/progressDots removed with the node game.
    this.btnRestart = document.getElementById('btnRestart');
    // R3b item 4: the bottom-centre hint is gone; this is the only one.
    this.hint = document.getElementById('hintAbove');
    this.scene3d = null; // set once from main.js: { camera, level }
    this.endcard = document.getElementById('endcard');
    this.endcardLine = document.getElementById('endcardLine');
    // R4a item 4: the "x x" row and the old title are gone.
    this.endTitle = document.getElementById('endTitle');
    this.btnReplay = document.getElementById('btnReplay');

    this.hintHidden = false;
    this.lastStars = -1;

    this.onReplay = null;
    this.onRestart = null;

    this.btnReplay.addEventListener('click', () => this.onReplay?.());
    // R4a item 2: the PL/EN pill, same soft style as the counter.
    this.btnLang = document.getElementById('btnLang');
    this.btnLang?.addEventListener('click', () => this.onLangToggle?.());
    // R4-sounds item 4: the sound pill, same soft style as the language pill.
    this.btnSound = document.getElementById('btnSound');
    this.btnSound?.addEventListener('click', () => this.onSoundToggle?.());
    // R3a item 2: the Restart button does the same thing as the R key.
    this.btnRestart?.addEventListener('click', () => this.onRestart?.());
  }

  show() {
    this.el.hidden = false;
  }

  /**
   * R4-sounds item 4: reflect the engine's state on the pill. `is-off` strikes the
   * note through (CSS, no image) and flips aria-pressed. Called on load, on M and
   * on the click, so the button is never out of step with what will be heard.
   */
  setSound(on) {
    const b = this.btnSound;
    if (!b) return;
    b.classList.toggle('is-off', !on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    applySoundLabel();
  }

  hideLoader() {
    this.loader?.classList.add('is-gone');
    setTimeout(() => this.loader?.remove(), 700);
  }

  setHint(text) {
    // R4a: no default copy here - the dictionary owns it.
    if (this.hint) this.hint.textContent = text ?? T('hint');
  }

  hideHint() {
    if (this.hintHidden) return;
    this.hintHidden = true;
    this.hint?.classList.add('is-hidden');
  }

  resetHint(text) {
    this.hintHidden = false;
    if (text) this.setHint(text);
    this.hint?.classList.remove('is-hidden');
  }

  update(snap) {
    if (!snap) return;
    // R4a: the end card's {n} follows the goal constant, not a literal.
    if (snap.goal != null) this.goal = snap.goal;
    // R3a item 2: the pill shows the GOAL (8), not the 12 on screen, and it is
    // shown again now that starTotal > 0. The dots loop is gone with the nodes.
    const hasStars = snap.starTotal > 0;
    this.starCounter.hidden = !hasStars;
    if (!hasStars) return;

    if (snap.stars !== this.lastStars) {
      this.lastStars = snap.stars;
      this.starCount.textContent = snap.stars;
      this.starCounter.classList.remove('is-pop');
      // restart the pop animation
      void this.starCounter.offsetWidth;
      this.starCounter.classList.add('is-pop');
    }
    this.starTotal.textContent = snap.goal ?? snap.starTotal;
    this.placeHint();
  }

  /**
   * R3b item 4: the hint sits just above the rim, centred on the bowl. The
   * position comes from projecting the rim point through the real camera, so it
   * accounts for the 12.381 deg tilt and is recomputed on every update.
   */
  placeHint() {
    if (!this.hint || !this.scene3d) return;
    const { camera, level } = this.scene3d;
    const b = level.bowl;
    const el = this.hint;
    const v = this._v || (this._v = new (camera.position.constructor)());
    v.set(b.x, b.y + (b.rimY ?? 2.52), 0);
    v.project(camera);
    const px = (v.x * 0.5 + 0.5) * window.innerWidth;
    const py = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = px + 'px';
    el.style.top = Math.max(8, py - 54) + 'px'; // just above the rim
    el.style.transform = 'translate(-50%, -100%)';
  }

  /**
   * R4a item 4: the card only ever appears after a WIN, so there is no
   * stars-vs-starTotal comparison any more - the old one compared the 12 stars
   * on screen with the count, so a win printed "8 of 12 stars. he will be back
   * for the rest."
   *
   * Agata 2026-10-05: the time line is gone ("it gives nothing").
   */
  showEnd() {
    const n = this.goal ?? 8;
    this.endTitle.textContent = T('endTitle');
    this.endcardLine.textContent = Tn('endLine', { n });
    // a language switch can find these on window
    window.__endGoal = n;
    this.endcard.hidden = false;
    // R4a item 4: focus the button so Enter/Space work straight away.
    this.btnReplay?.focus({ focusVisible: false }); // no ring on open; Tab/Enter still work
  }

  hideEnd() {
    this.endcard.hidden = true;
  }
}