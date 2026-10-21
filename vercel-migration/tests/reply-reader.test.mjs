import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../extension/reply-reader.js', import.meta.url), 'utf8'), context);
const reader = context.VISReplyReader;
const scene = title => JSON.stringify({ scenes: [{ title, content: 'A {scene} with "quoted text"', prompt: 'A cinematic shot' }] });
function turn(role, value, { article = false, code = '' } = {}) {
  return {
    innerText: value, textContent: value,
    getAttribute: name => name === (article ? 'data-turn' : 'data-message-author-role') ? role : '',
    querySelector: () => null,
    querySelectorAll: () => code ? [{ textContent: code }] : [],
  };
}
function page(messages, articles = false) {
  return { querySelectorAll: selector => selector.startsWith('article') ? articles ? messages : [] : messages };
}

test('finds part 3 when old messages disappear and the total count no longer increases', () => {
  const before = page([turn('assistant', scene('Part 1')), turn('assistant', scene('Part 2'))]);
  const job = { id: 'job-3', type: 'part_analysis', prompt: 'Analyze part 3', before: reader.snapshot(before) };
  const after = page([turn('user', '[VIS_JOB_ID:job-3] Analyze part 3'), turn('assistant', scene('Part 3'))]);
  assert.equal(JSON.parse(reader.read(after, job).text).scenes[0].title, 'Part 3');
});

test('recovers existing v0.4.9 response from matching prompt without runtime counters or job marker', () => {
  const job = { id: 'existing-job-3', type: 'part_analysis', prompt: 'Analyze part 3 with original content' };
  const after = page([turn('user', 'TEXT ANALYSIS ONLY.\nAnalyze part 3 with original content'), turn('assistant', scene('Existing 12 scenes'))]);
  assert.equal(JSON.parse(reader.read(after, job).text).scenes[0].title, 'Existing 12 scenes');
});

test('supports ChatGPT conversation article markup and JSON in a code block', () => {
  const after = page([turn('user', 'Analyze part 3', { article: true }), turn('assistant', 'Code Copy JSON', { article: true, code: '```json\n' + scene('Article reply') + '\n```' })], true);
  assert.equal(JSON.parse(reader.read(after, { id: 'job-3', type: 'part_analysis', prompt: 'Analyze part 3' }).text).scenes[0].title, 'Article reply');
});

test('does not take old part 2 JSON, echoed user templates or a reply to another prompt', () => {
  const job = { id: 'job-3', type: 'part_analysis', prompt: 'Analyze part 3' };
  assert.equal(reader.read(page([turn('assistant', scene('Old Part 2')), turn('user', 'Analyze part 3 ' + scene('Template'))]), job).text, '');
  assert.equal(reader.read(page([turn('user', 'Analyze part 4'), turn('assistant', scene('Part 4'))]), job).text, '');
});

test('rejects partial JSON and wrong response schema', () => {
  assert.equal(reader.extract('{"scenes":[{"title":"unfinished"', 'part_analysis'), '');
  assert.equal(reader.extract('{"parts":[{"content":"wrong schema"}]}', 'part_analysis'), '');
});
