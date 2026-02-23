// ── i18n.js ──────────────────────────────────────────────────
// Reads locale data from pre-loaded globals (__locale_es / __locale_en).
// Supports {key} placeholder interpolation for dynamic strings.

const i18n = (() => {
  let _lang    = 'es';
  let _strings = {};

  // Replace {key} placeholders with values from params object
  function _interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
  }

  // Return the translated string for key, optionally interpolating params
  function t(key, params) {
    return _interpolate(_strings[key] ?? key, params);
  }

  // Update all DOM elements that carry a data-i18n attribute
  function _applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
  }

  // Switch language using the pre-loaded global object
  function setLang(lang) {
    const data = window[`__locale_${lang}`];
    if (!data) {
      console.warn(`i18n: locale "${lang}" not loaded.`);
      return;
    }
    _strings = data;
    _lang = lang;

    _applyToDOM();
    try { localStorage.setItem('muertito_lang', lang); } catch (_) {}

    // Update the toggle button label
    const btn = document.getElementById('btn-lang');
    if (btn) btn.textContent = t('label_lang_toggle');

    // Re-render the live game state if available
    if (typeof renderGame === 'function' && typeof Game !== 'undefined' && Game.state) {
      renderGame(Game.state);
    }
  }

  // Load saved (or default) locale synchronously from pre-loaded globals
  function init() {
    let lang = 'es';
    try { lang = localStorage.getItem('muertito_lang') || 'es'; } catch (_) {}
    setLang(lang);
  }

  return { t, setLang, init, get lang() { return _lang; } };
})();

// Global shortcut used throughout the codebase
function t(key, params) { return i18n.t(key, params); }
