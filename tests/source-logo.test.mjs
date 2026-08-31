import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const appPath = path.join(root, 'public', 'app.js');

test('defines source logo mappings for technology hotspot providers', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  assert.match(app, /const SOURCE_LOGOS = Object\.freeze\(/);
  for (const id of [
    'baidu-hot',
    'weibo-hot',
    'zhihu-hot',
    'jiqizhixin-hot',
    'qbitai-hot',
    'leiphone-hot',
    'ifanr-hot',
    'sspai-hot',
    'jiemian-hot',
    'infoq-cn-hot',
    'kr36-video',
    'ithome'
  ]) {
    assert.match(app, new RegExp(`['"]${id}['"]\\s*:`), `missing logo mapping: ${id}`);
  }
});

test('renders source logos for every technology hotspot card', () => {
  const app = fs.readFileSync(appPath, 'utf8');
  assert.match(app, /function sourceLogoThumbHtml\(item\)/);
  assert.match(app, /cardsHtml\(hot\.items, date, \{ sourceLogo: true \}\)/);
  const start = app.indexOf('function sourceLogoThumbHtml');
  const end = app.indexOf('function thumbHtml', start);
  assert.ok(start >= 0 && end > start, 'source logo helper must be isolated');
  const helper = app.slice(start, end);
  assert.doesNotMatch(helper, />SIGNAL</);
  assert.match(helper, /sourceMonogram/);
});
