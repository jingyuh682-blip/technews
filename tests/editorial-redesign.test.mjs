import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const stylePath = path.join(root, 'public', 'editorial-news.css');

test('loads the editorial news stylesheet and drops external display fonts', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.equal(fs.existsSync(stylePath), true, 'editorial stylesheet must be present');
  assert.match(html, /<link rel="stylesheet" href="\/technews\/editorial-news\.css[^"]*" \/>/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
});

test('uses a readable Chinese news typography system', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  assert.match(css, /--font-ui:\s*["']?Noto Sans SC/);
  assert.match(css, /--font-display:\s*["']?Noto Sans SC/);
  assert.doesNotMatch(css, /Bricolage|Fraunces|Instrument_Serif/);
  assert.match(css, /font-size:\s*clamp\(13px, 1\.05vw, 16px\)/);
});

test('organizes the dashboard as a main editorial column and a focused sidebar', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1\.65fr\)\s+minmax\(18rem, 0\.9fr\)/);
  assert.match(css, /"news cloud"\s*"news hot"\s*"papers books"\s*"ghs ghr"/);
  assert.match(css, /@media\s*\(max-width:\s*960px\)/);
  assert.match(css, /min-width:\s*0/);
});

test('sets a calm editorial palette with one blue accent and restrained surfaces', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  for (const token of [
    '--page: #F4F6F7',
    '--surface: #FFFFFF',
    '--text: #1E2A33',
    '--accent: #2F6F8F',
    'border-radius: 14px',
    '--shadow: 0 10px 28px'
  ]) {
    assert.ok(css.includes(token), `missing editorial token: ${token}`);
  }
});
