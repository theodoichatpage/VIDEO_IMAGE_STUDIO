import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function worker(tabs = [], activeJob = null, version = '0.4.17') {
  let listener, offline = false;
  let stored = { pairCode: 'session-three', studioOrigin: 'https://video-image-studio.vercel.app' };
  const received = [];
  const chrome = {
    storage: { local: { async get() { return structuredClone(stored); }, async set(value) { Object.assign(stored, structuredClone(value)); } } },
    tabs: { async query() { return tabs; }, async sendMessage(id, message) {
      if (message.type === 'vis-ping') return { ready: true, version };
      if (message.type === 'vis-capture-result') return id === 2 ? { ok: true, payload: { jobId: message.jobId, state: 'completed', text: '{"scenes":[{"prompt":"Correct part 3"}]}' } } : { ok: false, error: 'Wrong conversation' };
    } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
  };
  const context = vm.createContext({ chrome, URL, AbortSignal, fetch: async (url, options) => {
    if (offline) throw Error('Offline');
    if (!options?.body) return { ok: true, async json() { return { session: { activeJob } }; } };
    received.push({ url, body: JSON.parse(options.body) });
    return { ok: true, async json() { return { session: {} }; } };
  } });
  vm.runInContext(readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'), context);
  const message = (payload, sender = {}) => new Promise(resolve => listener(payload, sender, resolve));
  return { message, received, stored: () => stored, offline: value => { offline = value; } };
}

test('saves completed ChatGPT JSON to server even with no Studio tab open', async () => {
  const w = worker();
  const payload = { jobId: 'part-3-job', state: 'completed', text: '{"scenes":[{"prompt":"A shell necklace"}]}' };
  await w.message({ type: 'vis-chat-event', payload }, { tab: { url: 'https://chatgpt.com/c/part3' } });
  assert.equal(w.received.length, 1);
  assert.match(decodeURIComponent(w.received[0].url), /bridge\/session-three\/event/);
  assert.deepEqual(w.received[0].body, payload);
});

test('delivers intermediate scenes without marking the job completed', async () => {
  const w = worker();
  const payload = { jobId: 'part-3-job', state: 'progress', text: '{"scenes":[{"title":"First","prompt":"A shell"}]}' };
  await w.message({ type: 'vis-chat-event', payload }, { tab: { url: 'https://chatgpt.com/c/part3' } });
  assert.equal(w.received[0].body.state, 'progress');
  assert.deepEqual(w.received[0].body, payload);
});

test('a simultaneous stale progress event cannot replace a completed result in the queue', async () => {
  const w = worker();
  const completed = { jobId: 'part-3-job', state: 'completed', text: '{"scenes":[{"prompt":"Finished result"}]}' };
  const progress = { ...completed, state: 'progress' };
  await Promise.all([w.message({ type: 'vis-chat-event', payload: completed }, { tab: { url: 'https://chatgpt.com/c/part3' } }), w.message({ type: 'vis-chat-event', payload: progress }, { tab: { url: 'https://chatgpt.com/c/part3' } })]);
  assert.ok(w.received.some(item => item.body.state === 'completed'));
});

test('keeps unsaved result across network failure and retries on next status poll', async () => {
  const w = worker(); w.offline(true);
  const payload = { jobId: 'part-3-job', state: 'completed', text: '{"scenes":[{"prompt":"A cave"}]}' };
  await w.message({ type: 'vis-chat-event', payload }, { tab: { url: 'https://chatgpt.com/c/part3' } });
  assert.equal(w.stored().pendingChatEvents.length, 1);
  w.offline(false);
  await w.message({ type: 'vis-status' });
  assert.equal(w.received.length, 1);
  assert.equal(w.stored().pendingChatEvents.length, 0);
});

test('manual sync finds the matching response when another ChatGPT tab is selected', async () => {
  const w = worker([{ id: 1, active: true, url: 'https://chatgpt.com/c/other' }, { id: 2, url: 'https://chatgpt.com/c/part3' }]);
  const result = await w.message({ type: 'vis-capture-result', jobId: 'part-3-job', command: { id: 'part-3-job', type: 'part_analysis', prompt: 'Analyze part 3' } });
  assert.equal(result.ok, true);
  assert.equal(w.stored().chatTabId, 2);
  assert.equal(w.received[0].body.jobId, 'part-3-job');
});

test('status poll recovers an existing completed answer after ChatGPT F5 lost its waiter', async () => {
  const w = worker([{ id: 2, url: 'https://chatgpt.com/c/part5' }], { id: 'part-5-job', type: 'part_analysis', status: 'waiting', prompt: 'Analyze part 5' });
  await w.message({ type: 'vis-status' });
  await new Promise(setImmediate);
  assert.equal(w.received.length, 1);
  assert.equal(w.received[0].body.jobId, 'part-5-job');
  assert.equal(w.received[0].body.state, 'completed');
});

test('automatic recovery never captures an answer for an unsent queued job', async () => {
  const w = worker([{ id: 2, url: 'https://chatgpt.com/c/part5' }], { id: 'part-6-job', type: 'part_analysis', status: 'queued', prompt: 'Analyze part 6' });
  await w.message({ type: 'vis-status' });
  await new Promise(setImmediate);
  assert.equal(w.received.length, 0);
});

test('does not report connected while the ChatGPT tab still runs an old content script', async () => {
 const w = worker([{id:2,url:'https://chatgpt.com/c/existing'}],null,'0.4.14');
 const result = await w.message({type:'vis-status'});
 assert.equal(result.chatReady,false); assert.match(result.error,/F5/);
});
