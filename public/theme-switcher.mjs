export const STORAGE_KEY = 'technews_theme';
export const DEFAULT_THEME = 'mist';

export const THEMES = Object.freeze({
  mist: Object.freeze({ label: '\u96fe\u767d', browserColor: '#DCE7E9' }),
  cool: Object.freeze({ label: '\u51b7\u84dd', browserColor: '#CFDDE4' }),
  ink: Object.freeze({ label: '\u6df1\u58a8', browserColor: '#242F35' }),
  paper: Object.freeze({ label: '\u5976\u6cb9\u7eb8', browserColor: '#F2E9DF' }),
  forest: Object.freeze({ label: '\u68ee\u6797\u7eff', browserColor: '#DDE6E0' }),
  plum: Object.freeze({ label: '\u8393\u679c\u7d2b', browserColor: '#E7DFEA' })
});

function hasTheme(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEMES, value);
}

export function normalizeTheme(value) {
  return hasTheme(value) ? value : DEFAULT_THEME;
}

export function readStoredTheme(storage) {
  try {
    return normalizeTheme(storage && storage.getItem(STORAGE_KEY));
  } catch (_) {
    return DEFAULT_THEME;
  }
}

function persistTheme(storage, theme) {
  try {
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(STORAGE_KEY, theme);
    }
  } catch (_) {
    // Private browsing or blocked storage should not stop the dashboard.
  }
}

export function applyTheme(documentRef, storage, value) {
  const theme = normalizeTheme(value);
  if (documentRef && documentRef.documentElement) {
    documentRef.documentElement.dataset.theme = theme;
    const meta = documentRef.querySelector && documentRef.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEMES[theme].browserColor;
  }
  persistTheme(storage, theme);
      if (documentRef && typeof documentRef.dispatchEvent === 'function') {
    const view = documentRef.defaultView || (typeof window !== 'undefined' ? window : null);
    const ThemeEvent = view && typeof view.CustomEvent === 'function' ? view.CustomEvent : null;
    const detail = { theme };
    documentRef.dispatchEvent(ThemeEvent
      ? new ThemeEvent('technews:themechange', { detail })
      : { type: 'technews:themechange', detail });
  }
  return theme;
}

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

export function ensureThemeControl(documentRef, storage) {
  if (!documentRef || typeof documentRef.querySelector !== 'function') return null;
  const controls = documentRef.querySelector('.controls');
  if (!controls) return null;

  const existing = documentRef.getElementById && documentRef.getElementById('themeSelect');
  if (existing) {
    existing.value = readStoredTheme(storage);
    return existing;
  }

  const label = documentRef.createElement('label');
  label.className = 'field theme-control';
  label.textContent = '\u4e3b\u9898';

  const select = documentRef.createElement('select');
  select.id = 'themeSelect';
  select.setAttribute('aria-label', '\u9009\u62e9\u9875\u9762\u4e3b\u9898');

  Object.entries(THEMES).forEach(([value, info]) => {
    const option = documentRef.createElement('option');
    option.value = value;
    option.textContent = info.label;
    select.appendChild(option);
  });

  select.value = readStoredTheme(storage);
  select.addEventListener('change', () => {
    applyTheme(documentRef, storage, select.value);
  });
  label.appendChild(select);
  controls.insertBefore(label, controls.firstChild);
  return select;
}

export function bootstrapThemeSwitcher(documentRef, storage = getStorage()) {
  if (!documentRef) return null;
  const activeStorage = storage || getStorage();
  applyTheme(documentRef, activeStorage, readStoredTheme(activeStorage));

  const sync = () => ensureThemeControl(documentRef, activeStorage);
  sync();

  const app = documentRef.querySelector && documentRef.querySelector('#app');
  if (app && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(sync);
    observer.observe(app, { childList: true, subtree: true });
    return observer;
  }
  return null;
}

if (typeof document !== 'undefined') {
  const start = () => bootstrapThemeSwitcher(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
