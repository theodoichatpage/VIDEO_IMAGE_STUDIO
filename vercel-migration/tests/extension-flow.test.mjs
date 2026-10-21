import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function bridge() {
  let turns = [], mode = null, listener;
  const root = { querySelectorAll: () => mode ? [mode] : [] };
  const box = { closest: () => root };
  const context = vm.createContext({
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    document: {
      querySelector: selector => selector === '#prompt-textarea' ? box : null,
      querySelectorAll: selector => selector.includes('data-message-author-role="assistant"') ? turns : [],
    },
    chrome: { runtime: { onMessage: { addListener(callback) { listener = callback; } } } },
    setTimeout, clearTimeout, console,
  });
  let source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
  source = source.replace('chrome.runtime.onMessage.addListener', 'globalThis.hooks = { jsonFromPage, clearImageMode, setBaseline: value => { baseline = value; }, setActive: value => { currentJobId = value; }, current: () => currentJobId }; chrome.runtime.onMessage.addListener');
  vm.runInContext(source, context);
  return {
    hooks: context.hooks,
    turns: values => { turns = values.map(innerText => ({ innerText })); },
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
