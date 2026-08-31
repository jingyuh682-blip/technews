import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const themePath = path.join(root, 'public', 'theme-calm-graphite.css');
const indexPath = path.join(root, 'public', 'index.html');

test('uses a paper-slate newsroom palette for long-form reading', () => {
  const css = fs.readFileSync(themePath, 'utf8');
  assert.match(css, /Newsroom palette revision/);
  for (const token of [
    '--void: #F3F5F4',
    '--void-2: #EDF1EF',
    '--panel: #FFFFFF',
    '--panel-2: #F7F9F8',
    '--ink: #26343B',
    '--ink-soft: #5A6970',
    '--muted: #7A888D',
    '--accent: #4D7888',
    '--gutter: #DEE5E1'
  ]) {
    assert.ok(css.includes(token), 'missing paper-slate token: ' + token);
  }
});

test('desaturates source logos for a calmer visual hierarchy', () => {
  const css = fs.readFileSync(themePath, 'utf8');
  assert.match(css, /\.thumb\.source-logo img[\s\S]*filter:\s*grayscale\(1\)/);
  assert.match(css, /\.source-monogram[\s\S]*color:\s*var\(\-\-ink-soft\)/);
});
test('keeps alternate themes in the same readable editorial family', () => {
  const css = fs.readFileSync(themePath, 'utf8');
  for (const [theme, accent] of [
    ['cool', '#527A89'],
    ['ink', '#91B6B6'],
    ['paper', '#9A6A52'],
    ['forest', '#5F7E6D'],
    ['plum', '#826C79']
  ]) {
    const pattern = ':root\\[data-theme="' + theme + '"\\][\\s\\S]*?--accent: ' + accent;
    assert.match(css, new RegExp(pattern));
  }
});

test('applies a complete editorial color system beyond the page background', () => {
  const css = fs.readFileSync(themePath, 'utf8');
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(css, /Complete editorial color system/);
  for (const token of [
    '--on-accent: #FFFFFF',
    '--section: #EEF3F2',
    '--cloud-surface: #E9F0EE',
    '--overlay: rgba(38, 52, 59, 0.34)'
  ]) {
    assert.ok(css.includes(token), 'missing semantic color token: ' + token);
  }
  assert.match(css, /\.pane-h[\s\S]*background:\s*var\(--section\)/);
  assert.match(css, /\.cloud-stage[\s\S]*background:\s*var\(--cloud-surface\)/);
  assert.match(css, /\.wx-overlay[\s\S]*background:\s*var\(--overlay\)/);
  assert.match(css, /\.book-plan-btn,[\s\S]*color:\s*var\(--on-accent\)/);
  assert.match(html, /<meta name="theme-color" content="#F3F5F4"/);
});
