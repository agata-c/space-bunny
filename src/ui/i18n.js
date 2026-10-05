/**
 * R4a item 1: EVERY visible string in the game, in both languages, and nowhere
 * else. index.html carries empty placeholders only; config.js and hud.js go
 * through T().
 *
 * The shape follows Szopka's implementation (diorama/index.html ~3700-3791):
 * a plain `I18N` dictionary, a `T(key)` accessor, an `applyLang()` that
 * rewrites everything already on screen, a `store` wrapper that survives
 * blocked storage, and the default taken from navigator.language.
 */

/** @type {{en: Record<string,string>, pl: Record<string,string>}} */
const I18N = {
  en: {
    loader: 'seeding stars…',
    hint: 'drag the bunny back and let go',
    legend: '<b>B</b> blush · <b>R</b> restart · <b>M</b> sound',
    restart: 'restart',
    endTitle: 'bunny in space',
    // {n} comes from the GOAL constant, not a literal, so the copy follows it.
    endLine: '{n} stars, 1 bunny, 0 regrets.',
    again: 'catch more stars',
    credits:
      'concept & art direction: Agata Poniatowska-Ormicka\nspecs & review: Claude · code: Space Bunny',
    langLabel: 'EN',
    langAlt: 'PL',
    soundOn: 'sound on',
    soundOff: 'sound off',
    noWebgl:
      "your browser can't run this little world. try another browser, or turn on hardware acceleration.",
    noscript:
      'this little world is drawn with WebGL, so it needs javascript switched on.'
  },
  pl: {
    loader: 'zasiewamy gwiazdy…',
    hint: 'pociągnij królika do tyłu i puść',
    legend: '<b>B</b> rumieńce · <b>R</b> od nowa · <b>M</b> dźwięk',
    restart: 'od nowa',
    endTitle: 'królik w kosmosie',
    endLine: '{n} gwiazd, 1 królik, 0 wyrzutów sumienia.',
    again: 'złap więcej gwiazd',
    credits:
      'koncepcja i kierunek artystyczny: Agata Poniatowska-Ormicka\nspecyfikacja i recenzja: Claude · kod: Space Bunny',
    langLabel: 'PL',
    langAlt: 'EN',
    soundOn: 'dźwięk włączony',
    soundOff: 'dźwięk wyłączony',
    noWebgl:
      'twoja przeglądarka nie uruchomi tego małego świata. spróbuj innej albo włącz akcelerację sprzętową.',
    noscript:
      'ten mały świat rysowany jest w WebGL, więc potrzebuje włączonej javascript.'
  }
};

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null; // private mode / storage blocked
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* storage blocked: the choice just will not persist */
    }
  }
};

const STORAGE_KEY = 'spacebunny.lang';

let lang = 'en';
{
  const saved = store.get(STORAGE_KEY);
  const nav = (navigator.language || 'en').toLowerCase();
  lang = saved === 'pl' || saved === 'en' ? saved : nav.indexOf('pl') === 0 ? 'pl' : 'en';
}

/** The one accessor every visible string goes through. */
export function T(key) {
  return (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
}

/** Fill {placeholders} from a plain object. */
export function Tn(key, vars) {
  let s = T(key);
  for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

/**
 * Rewrites every visible string from the dictionary. Run on load and on every
 * switch, so nothing can be left behind in the other language. Anything
 * already on screen (the hint's position, an OPEN end card) is re-rendered.
 */
export function applyLang() {
  const t = I18N[lang];
  document.documentElement.lang = lang;

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = text;
  };
  set('loaderText', t.loader);
  set('hintAbove', t.hint);
  set('legend', t.legend);
  set('btnRestart', t.restart);
  set('credits', t.credits);
  set('endTitle', t.endTitle);
  set('btnReplay', t.again);
  set('noWebglText', t.noWebgl);

  const btn = document.getElementById('btnLang');
  if (btn) {
    btn.textContent = t.langLabel;
    btn.title = t.langLabel + ' / ' + t.langAlt;
  }

  // R4-sounds item 4: the sound pill's accessible name follows the language.
  // Its on/off STATE does not - that is the engine's business, and it is right
  // before the first gesture (the context only wakes on the first drag).
  const snd = document.getElementById('btnSound');
  if (snd) {
    const label = snd.classList.contains('is-off') ? t.soundOff : t.soundOn;
    snd.title = label;
    snd.setAttribute('aria-label', label);
  }

  // R4-sounds item 4: refresh the sound pill's accessible name too.
  applySoundLabel();


  // an end card already open is re-rendered, not left in the old language
  const card = document.getElementById('endcard');
  if (card && !card.hidden) {
    const line = document.getElementById('endcardLine');
    // R4a: rebuild from the DICTIONARY, never from a cached string - caching
    // left the line in the old language while everything else switched.
    const n = window.__endGoal ?? 8;
    if (line) line.textContent = Tn('endLine', { n });
  }
  // the hint's box changes with the language, so anything positioned from it
  // has to re-measure
  window.dispatchEvent(new CustomEvent('spacebunny:lang'));
}

/**
 * R4b item 4: the friendly "no WebGL" message, in the page's own style and in
 * the saved/default language. Called when the renderer cannot be created.
 */
export function showNoWebGL() {
  document.getElementById('loader')?.classList.add('is-gone');
  // main.js breaks out of its boot block BEFORE applyLang() when WebGL is
  // missing, so nothing else would set this. Without it the page served the
  // Polish sentence with <html lang="en"> - wrong for screen readers and for
  // anything that checks the language.
  document.documentElement.lang = lang;
  const box = document.getElementById('noWebgl');
  if (!box) return;
  box.querySelector('#noWebglText').textContent = T('noWebgl');
  box.hidden = false;
}

/** Is a WebGL context actually obtainable? */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

/**
 * R4-sounds item 4: the sound pill's accessible name follows the LANGUAGE; its
 * on/off STATE does not - that is the engine's business, and it is correct
 * before the first gesture (the AudioContext only wakes on the first drag).
 * Split out of applyLang so hud.setSound() can refresh just this label.
 */
export function applySoundLabel() {
  const snd = document.getElementById('btnSound');
  if (!snd) return;
  const label = snd.classList.contains('is-off') ? T('soundOff') : T('soundOn');
  snd.title = label;
  snd.setAttribute('aria-label', label);
}

/** Toggle, persist, apply. Works with storage blocked. */
export function toggleLang() {
  lang = lang === 'en' ? 'pl' : 'en';
  store.set(STORAGE_KEY, lang);
  applyLang();
  return lang;
}
