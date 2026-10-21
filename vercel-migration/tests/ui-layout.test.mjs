import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

test('analysis parts UI has batch scene button and pager below list', () => {
  assert.match(app, /Phân cảnh toàn bộ/);
  const list = app.indexOf('parts-list');
  const pager = app.indexOf('className="pager parts-pager-bottom"');
  assert.ok(list >= 0 && pager > list, 'pager must render after parts list');
});

test('part rows prevent text and action overlap', () => {
  assert.match(css, /\.part-copy\{[^}]*min-width:0/);
  assert.match(css, /\.part-summary\{[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.part-status\{[^}]*white-space:nowrap/);
  assert.match(css, /\.part-actions\{[^}]*min-width/);
});
