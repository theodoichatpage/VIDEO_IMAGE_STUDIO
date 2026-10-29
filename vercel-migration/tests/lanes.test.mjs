// Several ChatGPT tabs ("lanes") work on one project at once: each lane only gets its own job,
// results land on the right part/scene, and nothing is sent twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/studio-api/handler.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const id = 'lanes-session-20261029';
const PNG = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString('base64');

function harness() {
  process.env.SUPABASE_URL = 'https://database.test';
  process.env.SUPABASE_SECRET_KEY = 'server-test-key';
  const h = { stored: null, uploads: 0 };
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('/storage/v1/object/sign/')) return Response.json({ signedURL: '/object/sign/x?token=t' });
    if (url.includes('/storage/v1/')) { if (init?.method === 'POST' && url.includes('/object/')) h.uploads++; return Response.json({}); }
    if (url.includes('studio_separations')) return Response.json([]);
    if (url.includes('rpc/')) return Response.json(null);
    if (init?.method === 'PATCH') {
      if (!h.stored) return Response.json([]);
      const m = /record->>updatedAt=eq\.(\d+)/.exec(decodeURIComponent(url));
      if (m && Number(m[1]) !== h.stored.updatedAt) return Response.json([]);
      h.stored = JSON.parse(init.body).record; return Response.json([{ record: structuredClone(h.stored) }]);
    }
    if (init?.method === 'POST') { h.stored = JSON.parse(init.body).record; return new Response('', { status: 201 }); }
    return Response.json(h.stored ? [{ record: structuredClone(h.stored) }] : []);
  };
  h.call = async (method, path, body, expected = 200, query = {}) => {
    let status, data;
    await handler({ method, query: { path: path.split('/'), ...query }, body, headers: {} }, { setHeader() {}, status(code) { status = code; return { json(value) { data = value; } }; } });
    assert.equal(status, expected, path + ' ' + JSON.stringify(data));
    return data;
  };
  return h;
}
const scenes = n => JSON.stringify({ scenes: Array.from({ length: n }, (_, i) => ({ title: 'Cảnh ' + (i + 1), prompt: 'Scene ' + (i + 1) })) });

test('two lanes analyse different parts in parallel; a third lane makes images meanwhile', async () => {
  const h = harness();
  await h.call('POST', 'sessions', { id });
  let r = await h.call('POST', `sessions/${id}/analysis`, { script: 'Bốn sự kiện.' });
  await h.call('POST', `bridge/${id}/event`, { jobId: r.session.activeJob.id, state: 'completed', text: JSON.stringify({ parts: [1, 2, 3, 4].map(i => ({ title: 'Phần ' + i, content: 'Sự kiện ' + i })) }) });
  const [p1, p2, p3] = h.stored.parts.map(p => p.id);

  const a = await h.call('POST', `sessions/${id}/lanes/laneA01/parts/${p1}`, {});
  const b = await h.call('POST', `sessions/${id}/lanes/laneB01/parts/${p2}`, {});
  assert.equal(a.command.lane, 'laneA01'); assert.equal(b.command.lane, 'laneB01');
  assert.equal(h.stored.laneJobs.length, 2);
  // Same part twice, or a busy lane: refused without changing anything.
  await h.call('POST', `sessions/${id}/lanes/laneC01/parts/${p1}`, {}, 409);
  await h.call('POST', `sessions/${id}/lanes/laneA01/parts/${p3}`, {}, 409);
  // Re-sending the same command is idempotent.
  const again = await h.call('POST', `sessions/${id}/lanes/laneA01/parts/${p1}`, {});
  assert.equal(again.command.id, a.command.id);

  // Each Studio tab only receives its own lane's job.
  assert.equal((await h.call('GET', `bridge/${id}/next`, undefined, 200, { worker: 'laneA01' })).command.id, a.command.id);
  assert.equal((await h.call('GET', `bridge/${id}/next`, undefined, 200, { worker: 'laneB01' })).command.id, b.command.id);
  assert.equal((await h.call('GET', `bridge/${id}/next`, undefined, 200, { worker: 'laneC01' })).command, null);
  assert.equal((await h.call('GET', `bridge/${id}/next`)).command, null, 'old tabs without a lane never take lane jobs');

  await h.call('POST', `bridge/${id}/event`, { jobId: b.command.id, state: 'sent' });
  await h.call('POST', `bridge/${id}/event`, { jobId: b.command.id, state: 'progress', text: scenes(1) });
  assert.equal(h.stored.parts[1].scenes.length, 1);
  await h.call('POST', `bridge/${id}/event`, { jobId: b.command.id, state: 'completed', text: scenes(3) });
  assert.equal(h.stored.parts[1].status, 'complete'); assert.equal(h.stored.parts[1].scenes.length, 3);
  assert.equal(h.stored.laneLast.laneB01.status, 'completed');

  // Lane C makes an image for part 2 while lane A still analyses part 1.
  const img = await h.call('POST', `sessions/${id}/lanes/laneC01/images`, { sceneKey: p2 + ':0', stylePrompt: 'Style {{SCENE_PROMPT}}' });
  assert.equal(img.command.prompt, 'Style Scene 1');
  await h.call('POST', `sessions/${id}/lanes/laneB01/images`, { sceneKey: p2 + ':0', stylePrompt: 'S' }, 409);
  await h.call('POST', `bridge/${id}/event`, { jobId: img.command.id, state: 'completed', imageDataUrl: PNG });
  assert.equal(h.stored.parts[1].scenes[0].imageStatus, 'complete'); assert.equal(h.uploads, 1);

  // Lane A fails: only its part is marked error, nothing else changes.
  await h.call('POST', `bridge/${id}/event`, { jobId: a.command.id, state: 'error', text: 'ChatGPT lỗi' });
  assert.equal(h.stored.parts[0].status, 'error'); assert.equal(h.stored.laneLast.laneA01.error, 'ChatGPT lỗi');
  assert.equal(h.stored.parts[1].status, 'complete');
  // Late duplicate events are ignored.
  const late = await h.call('POST', `bridge/${id}/event`, { jobId: b.command.id, state: 'error', text: 'late' });
  assert.equal(late.ignored, true); assert.equal(h.stored.parts[1].status, 'complete');

  // Manager takes a job back from a dead lane; the part becomes free for another lane.
  const c = await h.call('POST', `sessions/${id}/lanes/laneA01/parts/${p3}`, {});
  await h.call('POST', `sessions/${id}/lanes/laneA01/release`, { jobId: c.command.id });
  assert.equal(h.stored.parts[2].status, 'stopped'); assert.equal(h.stored.laneJobs.length, 0);
  await h.call('POST', `sessions/${id}/lanes/laneB01/parts/${p3}`, {});

  // Stop all cancels every lane.
  await h.call('POST', `sessions/${id}/stop`, {});
  assert.equal(h.stored.laneJobs.length, 0);
});

test('a shared (non-lane) job goes to only one browser', async () => {
  const h = harness();
  await h.call('POST', 'sessions', { id });
  const r = await h.call('POST', `sessions/${id}/analysis`, { script: 'Một sự kiện.' });
  const first = await h.call('GET', `bridge/${id}/next`, undefined, 200, { worker: 'laneA01' });
  assert.equal(first.command.id, r.session.activeJob.id);
  assert.equal((await h.call('GET', `bridge/${id}/next`, undefined, 200, { worker: 'laneB01' })).command, null);
  assert.equal((await h.call('GET', `bridge/${id}/next`, undefined, 200, { worker: 'laneA01' })).command.id, first.command.id);
});
