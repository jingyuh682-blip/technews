import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const themePath = path.join(root, 'public', 'theme-calm-graphite.css');

test('loads the calm graphite theme after the base stylesheet', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.equal(fs.existsSync(themePath), true, 'calm theme stylesheet must be present');
  assert.ok(html.indexOf('styles.css') < html.indexOf('theme-calm-graphite.css'));
});

test('defines the approved calm palette and removes page grain', () => {
  assert.equal(fs.existsSync(themePath), true, 'calm theme stylesheet must be present');
  const css = fs.readFileSync(themePath, 'utf8');
  for (const token of ['--void: #151B20', '--panel: #202A31', '--ink: #E8F0F2', '--accent: #4FA88C']) {
    assert.ok(css.includes(token), `missing token: ${token}`);
  }
  assert.match(css, /body::before\s*\{[^}]*opacity:\s*0/s);
});