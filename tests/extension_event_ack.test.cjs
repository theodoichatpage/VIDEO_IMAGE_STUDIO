// Run with: node --test tests/extension_event_ack.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../vercel-migration/extension/background.js'), 'utf8');
const start = source.indexOf("    if (message?.type === 'vis-event-ack') {");
const end = source.indexOf("    sendResponse({ ok: false });", start);
assert.ok(start >= 0 && end > start, 'ACK handler not found');
const handler = source.slice(start, end);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('message', 'chrome', 'sendResponse', 'token', 'stopGeneration', 'stopDepth', 'cancelledJobs', handler);

async function scenario(message, { stopDepth = 0, cancelled = [] } = {}) {
  const store = {
    pendingChatEvents: [{ jobId: 'A', state: 'completed' }, { jobId: 'B', state: 'completed' }],
    activeJobId: 'A',
    activeJobType: 'image_generation',
    activeCommand: { id: 'A' }
  };
  let response;
  let writes = 0;
  const chrome = { storage: { local: {
    get: async () => structuredClone(store),
    set: async (value) => { writes++; Object.assign(store, value); },
    remove: async (keys) => { writes++; for (const key of keys) delete store[key]; }
  } } };
  await execute(message, chrome, (value) => { response = value; }, 0, 0, stopDepth, new Set(cancelled));
  return { store, response, writes };
}

test('ACK clears only acknowledged job and active command', async () => {
  const { store, response } = await scenario({ type: 'vis-event-ack', jobId: 'A' });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(store.pendingChatEvents.map((item) => item.jobId), ['B']);
  assert.equal(store.activeJobId, undefined);
});

test('missing jobId never clears outbox', async () => {
  const result = await scenario({ type: 'vis-event-ack' });
  assert.equal(result.response.ok, false);
  assert.equal(result.writes, 0);
});

test('stop guard never clears outbox', async () => {
  const result = await scenario({ type: 'vis-event-ack', jobId: 'A' }, { stopDepth: 1 });
  assert.equal(result.response.ok, false);
  assert.equal(result.writes, 0);
});

test('cancelled job never clears outbox', async () => {
  const result = await scenario({ type: 'vis-event-ack', jobId: 'A' }, { cancelled: ['A'] });
  assert.equal(result.response.ok, false);
  assert.equal(result.writes, 0);
});
