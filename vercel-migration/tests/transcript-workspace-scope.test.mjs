// Each project keeps its own Get Transcript work; the old shared workspace goes to one project only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/transcriptWorkspace.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const ws = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('shared workspace is claimed once; other projects start empty; saves stay separate', () => {
  store.set('vis-transcript-workspace-default', JSON.stringify({ url: 'https://youtu.be/old', transcript: { text: 'Nguyễn Du', segments: [] } }));
  assert.equal(ws.loadTranscriptWorkspace('projA').url, 'https://youtu.be/old');
  assert.equal(ws.loadTranscriptWorkspace('projB').url, '', 'a second project never inherits the old work');
  ws.saveTranscriptWorkspace('projB', { ...ws.loadTranscriptWorkspace('projB'), url: 'https://youtu.be/new' });
  assert.equal(ws.loadTranscriptWorkspace('projA').url, 'https://youtu.be/old');
  assert.equal(ws.loadTranscriptWorkspace('projB').url, 'https://youtu.be/new');
});
