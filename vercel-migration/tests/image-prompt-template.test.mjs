import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const handler = fs.readFileSync(new URL('../supabase/functions/studio-api/handler.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('image prompt uses the configured style template and injects scene content at SCENE_PROMPT', () => {
  assert.match(handler, /SCENE_PROMPT/);
  assert.match(handler, /template\.replace\(placeholder, scenePrompt\)/);
  assert.doesNotMatch(handler, /Generate exactly ONE standalone image for a YouTube video slide/);
  assert.doesNotMatch(handler, /GLOBAL STYLE:/);
});

test('web installer and extension are published as v0.4.16', () => {
  assert.equal(manifest.version, '0.4.16');
  assert.match(app, /0\.4\.16/);
  assert.match(app, /VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v0\.4\.16\.zip/);
  assert.match(app, /Tải Extension v0\.4\.16/);
});
