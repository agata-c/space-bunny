/**
 * R4e item 1: the sound manifest - DATA ONLY.
 *
 * This file is the whole tuning surface for Agata. The player in sound.js reads
 * this table and nothing else, so retuning a sound means editing numbers here,
 * never touching code.
 *
 * Each game sound maps to a list of VARIANTS. One variant is picked at random per
 * play, never the same one twice in a row. A variant is:
 *
 *   file    the basename under public/sounds/ (the player tries .mp3 then .wav)
 *   rate    playbackRate multiplier, applied before the per-play jitter
 *   gain    linear multiplier, before the per-surface speed scaling
 *   reverse play the decoded buffer backwards (the buffer is built once, lazily)
 *   maxDur  stop after N seconds with a 30 ms fade-out, so a long file used as a
 *           short sound does not ring on
 *
 * A variant whose file is missing or undecodable is silently skipped (one
 * DEV-only note). A sound with no playable variant is simply silent. Nothing here
 * can make the game error or stall.
 *
 * The sounds Agata has not made yet are DERIVED from the files above, which is
 * what the `// derived` lines say. There is no music and no ambience.
 */

/**
 * Load order matters: the first sounds a player hears are the common ones, so
 * they decode first. Sequential, one at a time, after the first gesture.
 */
export const LOAD_ORDER = [
  'launch-1',
  'thud-1',
  'thud-2',
  'star-note',
  'star-tinkle',
  'whoosh-away',
  'helmet-pop',
  'rocket',
  'star-born',
  'dizzy',
  'end-chime',
  'extras/launch-b'
];

/**
 * star-note.mp3 has ROOT PITCH E5 (659.26 Hz). The pentatonic scale the brief
 * asks for is C5 D5 E5 G5 A5 C6 D6 E6, i.e. semitone offsets from E5 of
 * -4 -2 0 +3 +5 +8 +10 +12. rate = 2^(semitones/12).
 */
const STAR_SEMITONES = [-4, -2, 0, 3, 5, 8, 10, 12];

/** Never jitter star-note: its pitch is the melody. */
export const NO_JITTER = new Set(['star-note']);

/** Impacts jitter more, so repeated bumps of the same file never sound identical. */
export const IMPACT_JITTER = 0.08; // +/- 8 %
export const NORMAL_JITTER = 0.04; // +/- 4 %

/** Sounds whose variants all play together rather than one being chosen. */
export const LAYERED = new Set(['star']);

/**
 * Impact families. game.js already maps the solver's surface tags onto four
 * names; this is the second half of that mapping, from family to variants.
 */
const IMPACT_FAMILIES = ['glass', 'rim', 'cushion', 'floor'];

export const MANIFEST = {
  // ---- the launch: the funniest moment, so three variants ----
  launch: [
    { file: 'launch-1', rate: 1.0, gain: 1 },
    { file: 'launch-1', rate: 0.88, gain: 1 },
    { file: 'extras/launch-b', rate: 1.0, gain: 0.9 }
  ],

  // ---- leaving the screen. Then silence for the 0.8 s beat ----
  whoosh: [{ file: 'whoosh-away', rate: 1.0, gain: 1 }],

  // ---- dropping back in: the same file reversed, quieter and lower, so it
  //      swells as he comes down. Derived: there is no drop-in file yet. ----
  drop: [{ file: 'whoosh-away', rate: 0.85, gain: 0.45, reverse: true }],

  // ---- the cushion landing (also called "plop") ----
  land: [
    { file: 'thud-2', rate: 1.25, gain: 0.9 },
    { file: 'thud-1', rate: 1.3, gain: 0.8 }
  ],

  // ---- impacts, by family ----
  // soft: cushion, pad, platform, floor, pedestal, ledge, table
  impact_soft: [
    { file: 'thud-1', rate: 1.0, gain: 1 },
    { file: 'thud-2', rate: 1.0, gain: 1 }
  ],
  // derived: the glassy "tink" is the star tinkle, cut very short
  impact_glass: [{ file: 'star-tinkle', rate: 1.7, gain: 0.3, maxDur: 0.18 }],
  // derived: the rim "bonk" is a thud, pitched up and cut short
  impact_rim: [
    { file: 'thud-1', rate: 1.7, gain: 0.7, maxDur: 0.12 },
    { file: 'thud-2', rate: 1.8, gain: 0.7, maxDur: 0.12 }
  ],
  // derived: the squeak is the launch blip, pitched up and cut very short
  squeak: [
    { file: 'extras/launch-b', rate: 1.5, gain: 0.5, maxDur: 0.15 },
    { file: 'launch-1', rate: 2.0, gain: 0.4, maxDur: 0.12 }
  ],

  // ---- a star shatters: the pitched note plus a tinkle. `star` is in LAYERED,
  //      so the player plays EVERY entry rather than picking one - the brief's
  //      row is note AND tinkle together.
  // star-note's rate is computed per star number, so it carries no rate here.
  star: [
    { file: 'star-note', rate: null, gain: 1, pitched: true },
    { file: 'star-tinkle', rate: 1.0, gain: 0.6 }
  ],

  // ---- the finale ----
  helmet: [{ file: 'helmet-pop', rate: 1, gain: 1 }],
  rocket: [{ file: 'rocket', rate: 1, gain: 1 }],
  born: [{ file: 'star-born', rate: 1, gain: 1 }],
  endcard: [{ file: 'end-chime', rate: 1, gain: 1 }],

  // ---- the floor poof: the whoosh, higher, quieter and cut short (derived) ----
  poof: [{ file: 'whoosh-away', rate: 1.4, gain: 0.3, maxDur: 0.45 }],

  dizzy: [{ file: 'dizzy', rate: 1, gain: 1 }],

  // ---- buttons: a thud so high it is a tick (derived) ----
  ui: [{ file: 'thud-2', rate: 2.4, gain: 0.25, maxDur: 0.06 }],

  // ---- NOT EXISTING, and that is deliberate. The code path for a loop file
  //      (2.5 s fade in, fade out on stop) is kept and stays inert. ----
  space: [],
  music: []
};

/**
 * How the four impact families map onto the names game.js asks for.
 * `impact_soft` covers cushion, pad, platform, floor, pedestal, ledge, table.
 */
export function impactManifestFor(surface) {
  if (surface === 'glass') return MANIFEST.impact_glass;
  if (surface === 'rim') return MANIFEST.impact_rim;
  // cushion and everything dull share the soft family
  return MANIFEST.impact_soft;
}

/** The star semitone for star number n (1-based), clamped to the top note. */
function starSemitone(n) {
  const i = Math.max(1, Math.round(n || 1)) - 1;
  return STAR_SEMITONES[Math.min(i, STAR_SEMITONES.length - 1)];
}

/** rate multiplier for star number n: 2^(semitones/12). */
export function starRate(n) {
  return Math.pow(2, starSemitone(n) / 12);
}