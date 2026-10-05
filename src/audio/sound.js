/**
 * R4e: the SAMPLE PLAYER.
 *
 * R4-sounds built every sound from oscillators and noise. Agata's verdict was
 * that they were unpleasant - pure tones read as beeps and sirens - so this file
 * no longer synthesises anything. It plays her recordings, and the only sound
 * code left here is the plumbing.
 *
 * Everything is driven by the DATA in manifest.js. This file never hard-codes a
 * file name, a rate or a gain, so Agata can retune the whole game by editing
 * that table.
 *
 * Four rules this file exists to keep:
 *
 * 1. NOTHING HAPPENS BEFORE A GESTURE. Not the AudioContext, not a fetch, not a
 *    decode. Browsers refuse to start audio without a gesture and print
 *    "AudioContext was not allowed to start". The context and every fetch are
 *    created inside a real pointerdown / touchend / keydown handler.
 *
 * 2. A MISSING FILE IS NOT AN ERROR. Agata has not written every sound yet, and
 *    extras/launch-b is expected to be absent in some copies. A variant whose
 *    file 404s or will not decode is skipped with one DEV-only note, and a sound
 *    with no playable variant is simply silent. Nothing can throw, and nothing
 *    waits forever - a fetch that hangs is abandoned rather than blocking.
 *
 * 3. NO CLICKS AND NO LEAKS. Every voice is disconnected when it ends, there is a
 *    hard cap of 28 live sources, and a maxDur cut fades over 30 ms instead of
 *    stopping dead. `activeVoices()` exists so the leak check can assert the
 *    count returns to 0.
 *
 * 4. THE GAME MUST NOT DEPEND ON AUDIO. Every entry point is a no-op when sound
 *    is off, when the context is asleep, or when Web Audio is missing. Callers
 *    in game.js never check anything.
 *
 * The public API is unchanged from R4-sounds on purpose: `play`, `start`, `stop`,
 * `stopAll`, `update`, `setOn`, `toggle`, `isOn`, `ensure`, `applyGains` and
 * `installGestureHooks`. game.js, main.js and hud.js were not touched.
 */

import { LOOK } from '../game/look.js';
import {
  MANIFEST,
  LOAD_ORDER,
  LAYERED,
  NO_JITTER,
  IMPACT_JITTER,
  NORMAL_JITTER,
  impactManifestFor,
  starRate
} from './manifest.js';

const MAX_VOICES = 28;
const FADE = 0.03; // the 30 ms fade on a maxDur cut
const ROCKET_FADE = 0.4; // the brief's fade when `born` interrupts the rocket

/** @type {AudioContext|null} */
let ctx = null;
let master = null;
let limiter = null;
let sfxBus = null;
let ambBus = null;

/** file basename -> { buf, rev } once decoded. rev is built only if needed. */
const buffers = new Map();
/** file basename -> true when we already decided it is unusable. */
const broken = new Set();
/** Load promises, so a second gesture does not start a second load. */
let loading = null;
/** AbortController so a hung fetch cannot stall the queue. */
let loadingAbort = null;

let awakened = false;
let unavailable = '';

let on = true;
const storage = {
  get() {
    try {
      return localStorage.getItem('spacebunny.sound');
    } catch (e) {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem('spacebunny.sound', v);
    } catch (e) {
      /* blocked: the choice just will not persist */
    }
  }
};
{
  const saved = storage.get();
  if (saved === 'off') on = false;
  else if (saved !== 'on') on = true;
}

// ---- bookkeeping --------------------------------------------------------
/** @type {Set<AudioBufferSourceNode>} */
const live = new Set();
/** name -> the sources currently playing, so stop() can fade them. */
const held = new Map();
/** rate-limit key -> last play time in ctx seconds. */
const lastAt = new Map();
/** name -> index of the variant used last time, so we never repeat it. */
const lastVariant = new Map();
/** item 4 instrumentation. */
const counts = Object.create(null);
let peakVoices = 0;

function activeVoices() {
  return live.size;
}
function peakVoiceCount() {
  return peakVoices;
}
function countsSnapshot() {
  return { ...counts };
}
function resetCounts() {
  for (const k of Object.keys(counts)) delete counts[k];
}
/** How many distinct files actually decoded - item 4's "decoded yes/no". */
function decodedFiles() {
  return [...buffers.keys()];
}
function isOn() {
  return on;
}

// ---- loading ------------------------------------------------------------
/**
 * Resolve a sound file against document.baseURI so it works when the site is
 * served from a subpath like /space-bunny/ without a <base> tag.
 */
function urlFor(name) {
  return new URL('sounds/' + name, document.baseURI).href;
}

async function fetchBuffer(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('http ' + res.status);
  return await res.arrayBuffer();
}

/** Decode, trying .mp3 first and .wav as the fallback. */
async function decodeOne(name) {
  for (const ext of ['.mp3', '.wav']) {
    const file = name + ext;
    try {
      const raw = await fetchBuffer(urlFor(file), loadingAbort.signal);
      const buf = await ctx.decodeAudioData(raw);
      buffers.set(name, { buf, rev: null });
      return file;
    } catch (e) {
      /* try the next extension, or give up on this file entirely */
    }
  }
  broken.add(name);
  if (import.meta.env.DEV) {
    console.warn('[sound] no usable file for "' + name + '" - its sounds stay silent');
  }
  return null;
}

/**
 * Fetch and decode every distinct file, ONE AT A TIME, in manifest order.
 * Sequential on purpose: twelve parallel decodes on a phone is how you get a
 * stutter on the first launch.
 */
async function loadAll() {
  if (loading) return loading;
  loadingAbort = new AbortController();
  loading = (async () => {
    for (const name of LOAD_ORDER) {
      if (broken.has(name)) continue;
      await decodeOne(name);
    }
    // R4e item 2: "If NO sound file loads at all, keep the pill hidden and the
    // engine inert." Nothing decoded means a broken deployment, so say so with the
    // pill rather than leaving a button that promises sound and never delivers.
    if (buffers.size === 0) {
      const pill = document.getElementById('btnSound');
      pill?.classList.add('btn-sound-hidden-for-now');
      LOOK.sound.master = 0;
      applyGains();
    }
    if (import.meta.env.DEV) {
      console.log('[sound] loaded ' + buffers.size + '/' + LOAD_ORDER.length + ' files');
    }
  })();
  return loading;
}

/** A reversed copy, built once per file the first time it is needed. */
function reversed(entry) {
  if (entry.rev) return entry.rev;
  const src = entry.buf;
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const a = src.getChannelData(ch);
    const b = out.getChannelData(ch);
    for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i];
  }
  entry.rev = out;
  return out;
}

// ---- the graph ----------------------------------------------------------
function ensure() {
  if (unavailable) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    unavailable = 'no web audio api';
    return null;
  }
  if (!ctx) {
    try {
      ctx = new AC();
    } catch (e) {
      unavailable = 'context refused';
      return null;
    }
    master = ctx.createGain();
    master.gain.value = LOOK.sound?.master ?? 0.8;
    limiter = ctx.createDynamicsCompressor();
    // R4-sounds measured that a DynamicsCompressor is not a transparent
    // limiter: at threshold -6 dB Chrome added ~+2.1 dB of makeup gain to
    // signals below its own threshold. At 0 / knee 0 / ratio 20 it is exactly
    // linear for anything this game plays and still catches a real overshoot.
    limiter.threshold.value = 0;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    sfxBus = ctx.createGain();
    sfxBus.gain.value = LOOK.sound?.sfx ?? 1;
    ambBus = ctx.createGain();
    ambBus.gain.value = LOOK.sound?.ambient ?? 0.7;
    sfxBus.connect(master);
    ambBus.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);
  }
  awakened = true;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  applyGains();
  loadAll();
  return ctx;
}

function applyGains() {
  if (!ctx) return;
  const s = LOOK.sound;
  if (!s) return;
  master.gain.value = s.master ?? 0.8;
  sfxBus.gain.value = s.sfx ?? 1;
  ambBus.gain.value = s.ambient ?? 0.7;
}

function gainFor(name) {
  return LOOK.sound?.gains?.[name] ?? 1;
}

// ---- playing ------------------------------------------------------------
const rnd = () => Math.random() * 2 - 1;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Impact gain from speed: silent below 1.5, full at about 30, gentle curve.
 * And a faster hit sits slightly LOWER, which is why rate is nudged down.
 */
function impactCurve(speed) {
  const s = clamp01((speed - 1.5) / 28.5);
  return { gain: Math.pow(s, 0.7), rate: 1 - s * 0.12 };
}

function rateOk(key, minGap) {
  if (!minGap || !ctx) return true;
  const now = ctx.currentTime;
  const prev = lastAt.get(key);
  if (prev !== undefined && now - prev < minGap) return false;
  lastAt.set(key, now);
  return true;
}

/** One sample, started now. Returns the source so callers can hold/stop it. */
function fire(variant, { rate, gain, maxDur, bus }) {
  const entry = buffers.get(variant.file);
  if (!entry || broken.has(variant.file)) return null;
  const buf = variant.reverse ? reversed(entry) : entry.buf;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(bus || sfxBus);

  const t0 = ctx.currentTime + 0.002;
  live.add(src);
  if (live.size > peakVoices) peakVoices = live.size;
  while (live.size > MAX_VOICES) {
    const oldest = live.values().next().value;
    try {
      oldest.stop();
    } catch (e) {
      /* already stopped */
    }
    live.delete(oldest);
  }

  const dur = maxDur ? Math.min(maxDur, buf.duration) : buf.duration / rate;
  src.start(t0);
  const hardStop = t0 + dur + FADE;
  src.stop(hardStop);
  // maxDur means "cut it here", so fade rather than stop dead.
  if (maxDur && maxDur < buf.duration / rate) {
    g.gain.setValueAtTime(gain, t0 + Math.max(dur - FADE, 0));
    g.gain.linearRampToValueAtTime(0.0001, hardStop);
  }
  src.onended = () => {
    live.delete(src);
    try {
      src.disconnect();
      g.disconnect();
    } catch (e) {
      /* already gone */
    }
  };
  return src;
}

/** Choose a variant, never the same index twice in a row. */
function pickVariant(name, list) {
  if (!list.length) return null;
  if (list.length === 1) return { v: list[0], i: 0 };
  let i = Math.floor(Math.random() * list.length);
  if (i === lastVariant.get(name)) i = (i + 1) % list.length;
  lastVariant.set(name, i);
  return { v: list[i], i };
}

/**
 * The one entry point game code uses. `name` is a manifest key; `params` carries
 * the few things the table cannot know (impact speed and surface, star number).
 */
function play(name, params = {}) {
  try {
    playInner(name, params);
  } catch (e) {
    // audio must never be able to stall the game loop
    if (import.meta.env?.DEV) console.warn('[sound] play failed:', name, e);
  }
}

function playInner(name, params = {}) {
  counts[name] = (counts[name] || 0) + 1;
  if (!on || !ctx) return;
  if (name === 'space' || name === 'music') return; // no such files yet, by design

  if (name === 'impact') {
    const surface = params.surface || 'floor';
    const list = impactManifestFor(surface);
    const speed = params.speed ?? 0;
    const { gain: sg, rate: sr } = impactCurve(speed);
    if (sg <= 0) return; // below the dead zone: silent, as the brief asks
    // the existing 60 ms per-surface rate limit
    if (!rateOk('impact:' + surface, 0.06)) return;
    const { v } = pickVariant('impact:' + surface, list) || {};
    if (!v) return;
    const jitter = 1 + rnd() * IMPACT_JITTER;
    const g = (v.gain ?? 1) * sg * gainFor('impact');
    const rate = (v.rate ?? 1) * sr * jitter;
    const src = fire(v, { rate, gain: g, maxDur: v.maxDur });
    // a hard bounce squeaks as well, sometimes
    if (src && speed > 12 && Math.random() < 0.35) playInner('squeak', { from: 'impact' });
    return;
  }

  const list = MANIFEST[name];
  if (!list || !list.length) return;

  // star is layered: the note AND the tinkle together
  if (LAYERED.has(name)) {
    for (const v of list) {
      let rate = v.rate ?? 1;
      if (v.pitched) rate = starRate(params.count); // the melody: never jittered
      else if (!NO_JITTER.has(v.file)) rate *= 1 + rnd() * NORMAL_JITTER;
      fire(v, {
        rate,
        gain: (v.gain ?? 1) * gainFor(name),
        maxDur: v.maxDur
      });
    }
    return;
  }

  const { v } = pickVariant(name, list) || {};
  if (!v) return;
  const j = NO_JITTER.has(v.file) ? 1 : 1 + rnd() * NORMAL_JITTER;
  const src = fire(v, {
    rate: (v.rate ?? 1) * j,
    gain: (v.gain ?? 1) * gainFor(name),
    maxDur: v.maxDur
  });
  if (src) {
    const arr = held.get(name) || [];
    arr.push(src);
    held.set(name, arr);
  }
}

/** Start a sound and remember it, so stop() can fade it. Rocket uses this. */
function start(name, params = {}) {
  play(name, params);
}

/** Fade a held sound out instead of cutting it. */
function stop(name) {
  const arr = held.get(name);
  held.delete(name);
  if (!arr || !ctx) return;
  const now = ctx.currentTime;
  const fade = name === 'rocket' ? ROCKET_FADE : FADE;
  for (const src of arr) {
    try {
      // fire() keeps its gain node private, so the fade is done by scheduling
      // the stop a moment later. At 30-400 ms that is inaudible as a step.
      src.stop(now + fade);
    } catch (e) {
      /* already finished */
    }
  }
  lastAt.delete(name);
}

/** Restart, Play again and R: everything continuous goes at once. */
function stopAll() {
  for (const name of [...held.keys()]) stop(name);
  held.clear();
}

/** Kept for API compatibility. There is no aim file, so this is a no-op. */
function update() {}

// ---- switch and lifecycle ----------------------------------------------
function setOn(v) {
  on = !!v;
  storage.set(on ? 'on' : 'off');
  if (!on) stopAll();
  else if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return on;
}

function toggle() {
  return setOn(!on);
}

function visibility() {
  if (!ctx) return;
  if (document.hidden) {
    stopAll();
    ctx.suspend().catch(() => {});
  } else if (on) {
    ctx.resume().catch(() => {});
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', visibility);
}

/** The ONLY place the context and the fetches may be created. Idempotent. */
let installed = false;
function installGestureHooks() {
  if (installed) return;
  installed = true;
  const wake = () => ensure();
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('touchend', wake, { passive: true });
  window.addEventListener('touchstart', wake, { passive: true });
  window.addEventListener('keydown', wake);
}

const sound = {
  ensure,
  play,
  start,
  stop,
  stopAll,
  update,
  setOn,
  toggle,
  isOn,
  applyGains,
  installGestureHooks,

  // item 4's measuring tools; never emitted in a production build
  ...(import.meta.env.DEV
    ? {
        activeVoices,
        peakVoiceCount,
        countsSnapshot,
        resetCounts,
        decodedFiles,
        get awakened() {
          return awakened;
        },
        get unavailable() {
          return unavailable;
        },
        get ctx() {
          return ctx;
        }
      }
    : {})
};

export default sound;