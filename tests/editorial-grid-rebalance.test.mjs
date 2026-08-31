import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const layoutPath = path.join(root, 'public', 'layout-editorial-grid.css');

test('loads an isolated editorial grid stylesheet after the calm theme', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.equal(fs.existsSync(layoutPath), true, 'editorial grid stylesheet must be present');
  assert.ok(html.indexOf('theme-calm-graphite.css') < html.indexOf('layout-editorial-grid.css'));
});

test('uses the approved editorial dashboard grid', () => {
  assert.equal(fs.existsSync(layoutPath), true, 'editorial grid stylesheet must be present');
  const css = fs.readFileSync(layoutPath, 'utf8');
  assert.match(css, /grid-template-columns:\s*0\.86fr\s+1\.08fr\s+1\.08fr\s+1\.08fr;/);
  assert.match(css, /grid-template-areas:\s*"cloud news hot ghs"\s*"books papers hot ghr";/s);
});