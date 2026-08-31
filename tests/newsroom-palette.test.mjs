import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const themePath = path.join(root, 'public', 'theme-calm-graphite.css');

test('uses a newsroom-friendly light default palette', () => {
  const css = fs.readFileSync(themePath, 'utf8');
  assert.match(css, /Newsroom palette revision/);
  for (const token of [
    '--void: #F4F6F7',
    '--panel: #FFFFFF',
    '--panel-2: #F8FAFB',
    '--ink: #1E2A33',
    '--ink-soft: #52636D',
    '--muted: #71818A',
    '--accent: #2F6F8F',
    '--gutter: #E7ECEF'
  ]) {
    assert.ok(css.includes(token), `missing newsroom token: ${token}`);
  }
});

test('keeps alternate themes in the same readable editorial family', () => {
  const css = fs.readFileSync(themePath, 'utf8');
  for (const [theme, accent] of [
    ['cool', '#2B7896'],
    ['ink', '#75B7A7'],
    ['paper', '#B15F46'],
    ['forest', '#3F7D61'],
    ['plum', '#865777']
  ]) {
    const pattern = ':root\\[data-theme="' + theme + '"\\][\\s\\S]*?--accent: ' + accent;
    assert.match(css, new RegExp(pattern));
  }
});
