// Run: node --test tests/extension_outbox.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../vercel-migration/extension/background.js'), 'utf8');
const start = source.indexOf('async function persistAndDeliver(');
const end = source.indexOf('\nchrome.runtime.onMessage.addListener', start);
assert.ok(start >= 0 && end > start, 'persistAndDeliver not found');
const make = new Function('chrome', 'deliverPending', 'broadcastToStudio', 'cancelledJobs', 'stopGeneration', 'stopDepth',
  source.slice(start, end) + '; return persistAndDeliver;');

function fixture() {
  const storage = { pairCode: 'test-session', pendingChatEvents: [] };
  const chrome = { storage: { local: {
    get: async () => structuredClone(storage),
    set: async (data) => Object.assign(storage, data)
  } } };
  const persist = make(chrome, async () => {}, async () => {}, new Set(), 0, 0);
  return { storage, persist };
}

test('offline outbox retains more than ten distinct completed jobs', async () => {
  const { storage, persist } = fixture();
  for (let i = 0; i < 12; i++) await persist({ jobId: 'job-' + i, state: 'completed', text: 'result-' + i }, 0);
  assert.equal(storage.pendingChatEvents.length, 12);
  assert.deepEqual(storage.pendingChatEvents.map(event => event.jobId), Array.from({ length: 12 }, (_, i) => 'job-' + i));
  assert.ok(storage.pendingChatEvents.every(event => event._sessionId === 'test-session'));
});

test('duplicate completed event does not overwrite stored receipt candidate', async () => {
  const { storage, persist } = fixture();
  await persist({ jobId: 'job-1', state: 'completed', text: 'original' }, 0);
  await persist({ jobId: 'job-1', state: 'completed', text: 'duplicate' }, 0);
  assert.equal(storage.pendingChatEvents.length, 1);
  assert.equal(storage.pendingChatEvents[0].text, 'original');
});
