import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const themePath = path.join(root, 'public', 'theme-calm-graphite.css');
const scriptPath = path.join(root, 'public', 'theme-switcher.mjs');

test('loads the theme switcher after the app shell', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.equal(fs.existsSync(scriptPath), true, 'theme switcher module must be present');
  assert.ok(html.indexOf('app.js') < html.indexOf('theme-switcher.mjs'));
  assert.match(html, /<script type="module" src="\/technews\/theme-switcher\.mjs"><\/script>/);
});

test('defines a soft default and five alternate theme palettes', async () => {
  assert.equal(fs.existsSync(themePath), true, 'theme stylesheet must be present');
  assert.equal(fs.existsSync(scriptPath), true, 'theme switcher module must be present');
  const css = fs.readFileSync(themePath, 'utf8');
  for (const token of [
    ':root:not([data-theme])',
    ':root[data-theme="mist"]',
    ':root[data-theme="cool"]',
    ':root[data-theme="ink"]',
    ':root[data-theme="paper"]',
    ':root[data-theme="forest"]',
    ':root[data-theme="plum"]',
    '--void: #DCE7E9',
    '--panel: #EAF1F2',
    '--accent: #2F856F'
  ]) {
    assert.ok(css.includes(token), `missing theme token: ${token}`);
  }
  const themes = await import(pathToFileURL(scriptPath).href + '?theme-test=1');
  assert.deepEqual(Object.keys(themes.THEMES), ['mist', 'cool', 'ink', 'paper', 'forest', 'plum']);
  assert.equal(themes.DEFAULT_THEME, 'mist');
});

test('normalizes and persists a visitor theme choice', async () => {
  const themes = await import(pathToFileURL(scriptPath).href + '?theme-test=2');
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const documentRef = { documentElement: { dataset: {} } };
  assert.equal(themes.readStoredTheme(storage), 'mist');
  assert.equal(themes.applyTheme(documentRef, storage, 'paper'), 'paper');
  assert.equal(documentRef.documentElement.dataset.theme, 'paper');
  assert.equal(storage.getItem(themes.STORAGE_KEY), 'paper');
  assert.equal(themes.normalizeTheme('unknown'), 'mist');
});


test('emits a theme change event after applying a visitor choice', async () => {
  const themes = await import(pathToFileURL(scriptPath).href + '?theme-test=event');
  const events = [];
  const documentRef = {
    documentElement: { dataset: {} },
    dispatchEvent: (event) => events.push({ type: event.type, detail: event.detail })
  };

  themes.applyTheme(documentRef, null, 'forest');

  assert.deepEqual(events, [{ type: 'technews:themechange', detail: { theme: 'forest' } }]);
});
