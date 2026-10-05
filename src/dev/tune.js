/**
 * Round 1m: the LOOK TUNING PANEL. Dev only.
 *
 * Loaded ONLY when the URL carries `?tune`, and only ever through a dynamic
 * import, so the production bundle never sees lil-gui:
 *
 *   if (new URLSearchParams(location.search).has('tune')) {
 *     import('./dev/tune.js').then((m) => m.openPanel());
 *   }
 *
 * A static `import 'lil-gui'` here would be pulled into the production chunk
 * graph by the bundler even though this file is only reachable behind the flag.
 *
 * What it does:
 *   - builds a control tree from LOOK's shape (folders mirror the object tree)
 *   - every control writes straight into LOOK and calls emitLook(), so the scene
 *     updates live with no reload
 *   - "Copy settings" exports ONLY what differs from the shipped defaults
 *   - tweaks persist in localStorage (dev only) and survive a reload
 *   - pointer events never reach the canvas, so drag-to-aim still works
 */

import GUI from 'lil-gui';
import { LOOK, DEFAULTS, emitLook, cloneLook, mergeLook, flatten, setPath, diffLook, hex } from '../game/look.js';

const STORE_KEY = 'spacebunny.look.tweaks';

/** Restore any saved tweaks into LOOK before the panel is built. */
function loadSaved() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const blob = JSON.parse(raw);
    mergeLook(LOOK, blob);
    return blob;
  } catch {
    return {};
  }
}

function saveTweaks() {
  try {
    const d = diffLook(LOOK, DEFAULTS);
    if (Object.keys(d).length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(d));
  } catch {
    /* private mode: tweaks just will not persist */
  }
}

function clearSaved() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** every 6-hex-digit string anywhere in the tree is a colour control */
function isHex(v) {
  return typeof v === 'string' && /^[0-9a-fA-F]{6}$/.test(v);
}

export function openPanel() {
  const saved = loadSaved();

  const gui = new GUI({ title: 'Space Bunny look', width: 320 });
  const folders = new Map();
  const holders = new Map();

  /**
   * Mirror LOOK's tree into folders. Walked rather than hand-written so a new
   * value in look.js shows up in the panel automatically.
   */
  function build(node, parent, path) {
    for (const key of Object.keys(node)) {
      const v = node[key];
      const p = path ? `${path}.${key}` : key;
      if (Array.isArray(v)) continue; // arrays (heads) are not panel-driven
      if (v && typeof v === 'object') {
        let f = folders.get(p);
        if (!f) {
          f = parent.addFolder(key);
          folders.set(p, f);
        }
        build(v, f, p);
        continue;
      }
      // lil-gui's add()/addColor() need an OBJECT plus a property name, never a
      // bare value - so every control gets its own one-property holder, kept in
      // `holders` so a control can also be driven from the console.
      const holder = { [key]: v };
      holders.set(p, holder);
      const on = (ctrl) => ctrl.onChange((nv) => {
        holder[key] = nv;
        commit(p, nv);
      });
      if (isHex(v)) on(parent.addColor(holder, key));
      else if (typeof v === 'number') {
        const step = Math.abs(v) >= 20 ? 0.5 : Math.abs(v) >= 2 ? 0.05 : 0.01;
        on(parent.add(holder, key, step));
      }
    }
  }

  function commit(path, value) {
    setPath(LOOK, path, value);
    emitLook();
    saveTweaks();
    refreshExport();
  }

  build(LOOK, gui, '');

  // ---- the export preview --------------------------------------------------
  const out = { text: '' };
  const pre = document.createElement('pre');
  pre.style.cssText =
    'max-height:120px;overflow:auto;background:#111;color:#9f9;font:11px monospace;padding:6px;margin:4px 0;white-space:pre-wrap;word-break:break-all';
  gui.add(out, 'text').name('changed values (JSON)').disable();   // out is a real object, this one is fine
  const holder = gui.controllersRecursive();
  void holder;
  // lil-gui renders controllers in order, so append the preview after the folders
  const root = gui.domElement;
  const foldersEl = root.querySelector('.children');
  if (foldersEl) foldersEl.appendChild(pre);

  function refreshExport() {
    const d = diffLook(LOOK, DEFAULTS);
    const s = JSON.stringify(d, null, 2);
    out.text = Object.keys(d).length ? s : '(nothing changed yet)';
    pre.textContent = out.text;
  }
  refreshExport();

  // ---- buttons -------------------------------------------------------------
  const actions = {
    'Copy settings': () => {
      const s = JSON.stringify(diffLook(LOOK, DEFAULTS), null, 2);
      console.log('[look] settings blob:\n' + s);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(
          () => console.log('[look] copied to clipboard'),
          () => console.log('[look] clipboard blocked - use the console log')
        );
      }
      saveTweaks();
    },
    'Reset all': () => {
      mergeLook(LOOK, cloneLook(DEFAULTS));
      // DEFAULTS is the pristine tree; rebuild LOOK from it field by field
      emitLook();
      saveTweaks();
      location.reload();
    },
    'Clear saved tweaks': () => {
      clearSaved();
      console.log('[look] saved tweaks cleared');
    }
  };
  // a function-valued property IS the button in lil-gui - no .onClick() on top
  for (const name of Object.keys(actions)) gui.add(actions, name);

  // per-folder reset
  for (const [path, folder] of folders) {
    const key = 'Reset this folder';
    folder.add({ [key]: () => resetFolder(path) }, key);
  }
  function resetFolder(path) {
    const d = cloneLook(DEFAULTS);
    const def = path.split('.').reduce((n, k) => (n ? n[k] : undefined), d);
    if (!def || typeof def !== 'object') return;
    setPath(LOOK, path, JSON.parse(JSON.stringify(def)));
    emitLook();
    saveTweaks();
    location.reload();
  }

  // ---- keep the panel off the canvas --------------------------------------
  // lil-gui already stops propagation on its own root, but the game also reads
  // pointer events on the canvas for drag-to-aim, so make it explicit and
  // swallow everything that starts inside the panel.
  const swallow = (ev) => {
    ev.stopPropagation();
    if (ev.target === gui.domElement || gui.domElement.contains(ev.target)) ev.preventDefault();
  };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'mousedown', 'mouseup', 'touchstart', 'touchmove']) {
    gui.domElement.addEventListener(type, swallow, { passive: false });
  }
  gui.domElement.style.pointerEvents = 'auto';

  // dev-only handle so the panel's exports can be driven from the console when
  // checking a control by hand. Not present in production (whole file is).
  window.__tune = { gui, LOOK, DEFAULTS, diffLook, folders, holders, refreshExport, commit };

  console.log('[look] panel ready. ' + Object.keys(flatten(LOOK)).length + ' values, ' +
    (Object.keys(saved).length ? Object.keys(diffLook(LOOK, DEFAULTS)).length + ' restored from localStorage' : 'no saved tweaks'));
  void hex;
  return gui;
}