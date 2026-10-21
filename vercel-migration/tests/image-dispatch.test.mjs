import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');

test('image queue response is dispatched immediately to the ChatGPT bridge', () => {
  assert.match(source, /activeJob\?\.type === 'image_generation'/);
  assert.match(source, /type: 'studio-send'/);
  assert.match(source, /pairCode: session\.id/);
  assert.match(source, /command: session\.activeJob/);
});
