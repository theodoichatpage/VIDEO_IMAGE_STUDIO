import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function bridge() {
  let turns = [], mode = null, listener;
  let stored = {};
  let failStorage = false;
  class TextArea {
    constructor() { this.value = ''; }
    focus() {}
    dispatchEvent() {}
    closest() { return root; }
  }
  Object.defineProperty(TextArea.prototype, 'value', { get() { return this.text || ''; }, set(value) { this.text = value; } });
  const root = { querySelectorAll: () => mode ? [mode] : [] };
  const box = new TextArea();
  const context = vm.createContext({
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    document: {
      querySelector: selector => selector === '#prompt-textarea' ? box : null,
      querySelectorAll: selector => selector.includes('data-message-author-role="assistant"') ? turns : [],
    },
    chrome: { storage: { local: { async get() { return structuredClone(stored); }, async set(value) { if (failStorage) throw new Error('Storage full'); stored = { ...stored, ...value }; } } }, runtime: { onMessage: { addListener(callback) { listener = callback; } } } },
    HTMLTextAreaElement: TextArea, HTMLInputElement: class {}, Event: class {},
    location: { href: 'https://chatgpt.com/c/regression-chat' },
    setTimeout, clearTimeout, console,
  });
  let source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
  vm.runInContext(readFileSync(new URL('../extension/reply-reader.js', import.meta.url), 'utf8'), context);
  source = source.replace('chrome.runtime.onMessage.addListener', 'globalThis.hooks = { jsonFromPage, clearImageMode, draftText, prepareDraft, restoreDraft, fillComposer, setBaseline: () => { replyContext = { before: VISReplyReader.snapshot(document) }; }, setActive: value => { currentJobId = value; }, current: () => currentJobId }; chrome.runtime.onMessage.addListener');
  vm.runInContext(source, context);
  return {
    hooks: context.hooks,
    box,
    stored: () => stored,
    failStorage: () => { failStorage = true; },
    turns: values => { turns = values.map(value => ({ innerText: typeof value === 'string' ? value : value.text, getAttribute: name => name === "data-message-author-role" ? (value.role || "assistant") : "", querySelectorAll: () => [] })); },
    imageMode: () => { mode = { innerText: 'Create image', getBoundingClientRect: () => ({ width: 20, height: 20 }), parentElement: { querySelector: () => null } }; },
    message: message => { let result; listener(message, {}, value => { result = value; }); return result; },
  };
}

test('only reads JSON from the latest assistant answer after this job began', () => {
  const page = bridge();
  page.turns(['{"scenes":[{"title":"Old scene"}]}']);
  page.hooks.setBaseline(1);
  assert.equal(page.hooks.jsonFromPage('part_analysis'), '');
  page.turns(['{"scenes":[{"title":"Old scene"}]}', '{"scenes":[{"title":"New scene"}]}']);
  assert.equal(JSON.parse(page.hooks.jsonFromPage('part_analysis')).scenes[0].title, 'New scene');
  page.turns(['{"scenes":[{"title":"Old scene"}]}', '{"parts":[{"title":"Wrong response type"}]}']);
  assert.equal(page.hooks.jsonFromPage('part_analysis'), '');
});

test('an empty editable area does not read invisible placeholder text as a draft', () => {
  const page = bridge();
  assert.equal(page.hooks.draftText({ innerText: '', textContent: 'Ask ChatGPT' }), '');
  assert.equal(page.hooks.draftText({ value: '', innerText: 'Ask ChatGPT' }), '');
  assert.equal(page.hooks.draftText({ innerText: '\u200b\u00a0' }), '');
});

test('leftover Studio prompt is backed up and replaced by the next part', async () => {
  const page = bridge();
  page.box.value = 'TEXT ANALYSIS ONLY. Old Studio prompt for part 2';
  await page.hooks.prepareDraft({ id: 'part-three-job' });
  await page.hooks.fillComposer('New Studio prompt for part 3');
  assert.equal(page.box.value, 'New Studio prompt for part 3');
  assert.equal(page.stored().studioDraftBackups[0].text, 'TEXT ANALYSIS ONLY. Old Studio prompt for part 2');
});

test('a personal draft can be restored without sending or overwriting another draft', async () => {
  const page = bridge();
  page.box.value = 'My personal unfinished draft';
  await page.hooks.prepareDraft({ id: 'part-three-job' });
  assert.equal(page.stored().studioDraftBackups[0].text, 'My personal unfinished draft');
  assert.equal(page.box.value, 'My personal unfinished draft');
  await assert.rejects(page.hooks.restoreDraft(), /chưa ghi đè/);
  page.box.value = '';
  await page.hooks.restoreDraft();
  assert.equal(page.box.value, 'My personal unfinished draft');
});

test('failed backup keeps the existing draft intact', async () => {
  const page = bridge();
  page.box.value = 'Important personal draft';
  page.failStorage();
  await assert.rejects(page.hooks.prepareDraft({ id: 'part-three-job' }), /Storage full/);
  assert.equal(page.box.value, 'Important personal draft');
});

test('does not send analysis when image mode cannot be disabled', async () => {
  const page = bridge(); page.imageMode();
  await assert.rejects(page.hooks.clearImageMode(), /Tạo ảnh/);
});

test('rejects a second job while busy and stop immediately releases the content script', () => {
  const page = bridge(); page.hooks.setActive('part-two-job');
  assert.equal(page.message({ type: 'vis-command', command: { id: 'part-three-job' } }).ok, false);
  assert.equal(page.message({ type: 'vis-stop' }).ok, true);
  assert.equal(page.hooks.current(), '');
});

test('manual sync recovers a completed part after the extension was reloaded', () => {
  const page = bridge();
  page.hooks.setActive('existing-part-3');
  page.turns([{ role: 'user', text: 'TEXT ANALYSIS ONLY. Analyze the original part 3' }, { role: 'assistant', text: '{"scenes":[{"title":"Part 3 result","prompt":"A cinematic shot"}]}' }]);
  const result = page.message({ type: 'vis-capture-result', jobId: 'existing-part-3', command: { id: 'existing-part-3', type: 'part_analysis', prompt: 'Analyze the original part 3' } });
  assert.equal(result.ok, true);
  assert.equal(result.payload.jobId, 'existing-part-3');
  assert.equal(JSON.parse(result.payload.text).scenes[0].title, 'Part 3 result');
  assert.equal(page.hooks.current(), '');
});
