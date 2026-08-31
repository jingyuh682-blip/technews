import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const appPath = path.join(root, 'public', 'app.js');
const themePath = path.join(root, 'public', 'theme-calm-graphite.css');

test('word cloud derives its contrast-safe palette from the active theme', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  const css = fs.readFileSync(themePath, 'utf8');
  const tokenNames = [
    '--cloud-word-primary',
    '--cloud-word-strong',
    '--cloud-word-soft',
    '--cloud-word-muted',
    '--cloud-word-accent'
  ];

  for (const selector of [
    ':root:not([data-theme])',
    ':root[data-theme="cool"]',
    ':root[data-theme="ink"]',
    ':root[data-theme="paper"]',
    ':root[data-theme="forest"]',
    ':root[data-theme="plum"]'
  ]) {
    const start = css.indexOf(selector);
    assert.notEqual(start, -1, 'missing theme selector: ' + selector);
    const block = css.slice(start, css.indexOf('}', start));
    for (const token of tokenNames) {
      assert.ok(block.includes(token), selector + ' must define ' + token);
    }
  }

  assert.ok(!app.includes('const colors = ['), 'fixed word-cloud palette must not remain');
  for (const token of tokenNames) {
    assert.ok(app.includes("getPropertyValue('" + token + "')"), 'canvas must read ' + token);
  }
  assert.ok(app.includes("document.addEventListener('technews:themechange', redraw)"), 'word cloud must redraw after a theme change');
});
