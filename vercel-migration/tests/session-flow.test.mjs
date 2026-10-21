import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/studio-api/handler.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const id = 'regression-session-20261021';

test('analysis results, repeated delivery, late error, stop and next part remain consistent', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = 'https://database.test';
  process.env.SUPABASE_SECRET_KEY = 'server-test-key';
  let stored;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      stored = JSON.parse(init.body).record;
      // PostgREST return=minimal may return 201 with an empty body.
      return new Response('', { status: 201 });
    }
    return Response.json(stored ? [{ record: structuredClone(stored) }] : []);
  };
  const call = async (method, path, body, expectedStatus = 200) => {
    let status, data;
    await handler({ method, query: { path: path.split('/') }, body, headers: {} }, {
      setHeader() {}, status(code) { status = code; return { json(value) { data = value; } }; },
    });
    assert.equal(status, expectedStatus, JSON.stringify(data));
    return data;
  };
  try {
    await call('POST', 'sessions', { id });
    let response = await call('POST', `sessions/${id}/analysis`, { script: 'Một câu chuyện gồm hai sự kiện.' });
    let job = response.session.activeJob.id;
    await call('POST', `bridge/${id}/event`, { jobId: job, state: 'completed', text: JSON.stringify({ parts: [{ title: 'Phần 1', content: 'Sự kiện một.' }, { title: 'Phần 2', content: 'Sự kiện hai.' }] }) });
    const first = stored.parts[0].id, second = stored.parts[1].id;
    response = await call('POST', `sessions/${id}/parts/${first}/analysis`);
    job = response.session.activeJob.id;
    const completed = { jobId: job, state: 'completed', text: JSON.stringify({ scenes: [{ title: 'Cảnh 1', content: 'Nội dung', prompt: 'Scene one' }] }) };
    await call('POST', `bridge/${id}/event`, { ...completed, state: 'progress' });
    assert.equal(stored.parts[0].scenes.length, 1);
    assert.equal(stored.parts[0].status, 'processing');
    assert.equal(stored.activeJob.id, job);
    await call('POST', `bridge/${id}/event`, { jobId: job, state: 'progress', text: '{"scenes":[]}' });
    assert.equal(stored.parts[0].scenes.length, 1);
    await call('POST', `bridge/${id}/event`, completed);
    assert.equal(stored.parts[0].status, 'complete');
    await call('POST', `bridge/${id}/event`, completed);
    await call('POST', `bridge/${id}/event`, { jobId: job, state: 'error', text: 'Late error' });
    assert.equal(stored.parts[0].status, 'complete');
    response = await call('POST', `sessions/${id}/parts/${second}/analysis`);
    const secondJob = response.session.activeJob.id;
    await call('POST', `bridge/${id}/event`, completed);
    assert.equal(stored.activeJob.id, secondJob);
    await call('POST', `bridge/${id}/event`, { jobId: secondJob, state: 'error', text: 'Timed out reading the page' });
    assert.equal(stored.activeJob, null);
    assert.equal(stored.lastJob.id, secondJob);
    await call('POST', `bridge/${id}/event`, { jobId: secondJob, state: 'completed', text: JSON.stringify({ scenes: [{ title: 'Recovered result', prompt: 'A garden' }] }) });
    assert.equal(stored.parts[1].status, 'complete');
    assert.equal(stored.parts[0].scenes[0].prompt, 'Scene one');
    response = await call('POST', `sessions/${id}/parts/${second}/analysis`);
    const stoppedJobId = response.session.activeJob.id;
    await call('POST', `sessions/${id}/stop`);
    assert.equal(stored.activeJob, null);
    assert.equal(stored.parts[1].status, 'stopped');
    await call('POST', `bridge/${id}/event`, { jobId: stoppedJobId, state: 'completed', text: JSON.stringify({ scenes: [{ title: 'Stopped reply' }] }) });
    assert.equal(stored.parts[1].status, 'stopped');
    response = await call('POST', `sessions/${id}/parts/${second}/analysis`);
    assert.equal(response.session.activeJob.type, 'part_analysis');
    assert.match(response.session.activeJob.prompt, /KHÔNG TẠO ẢNH/);
    stored.parts[0].status = 'error';
    stored.lastError = 'Ô ChatGPT còn nội dung chưa gửi.';
    response = await call('GET', `sessions/${id}`);
    assert.equal(response.session.parts[0].status, 'complete');
    assert.equal(response.session.parts[0].scenes[0].prompt, 'Scene one');
    stored.activeJob = null;
    stored.lastJob = undefined;
    stored.parts[1].status = 'error';
    const savedFirstPart = JSON.stringify(response.session.parts[0]);
    response = await call('POST', `sessions/${id}/parts/${second}/recover`);
    assert.equal(response.session.activeJob.status, 'waiting');
    const recoverId = response.session.activeJob.id;
    response = await call('GET', `bridge/${id}/next`);
    assert.equal(response.command, null);
    await call('POST', `bridge/${id}/event`, { jobId: recoverId, state: 'completed', text: JSON.stringify({ scenes: [{ title: 'Recovered legacy part', prompt: 'The existing result' }] }) });
    assert.equal(stored.parts[1].status, 'complete');
    assert.equal(JSON.stringify(stored.parts[0]), savedFirstPart);
    stored.parts[1].status = 'error'; stored.parts[1].scenes = []; stored.parts[1].analysisText = '';
    response = await call('POST', `sessions/${id}/parts/${second}/recover`);
    const importJobId = response.session.activeJob.id;
    stored.parts[0].status = 'error';
    await call('POST', `sessions/${id}/parts/${first}/reset`, {}, 409);
    stored.parts[0].status = 'complete';
    await call('POST', `sessions/${id}/parts/${second}/reset`, {}, 409);
    stored.parts.push({ id: 'old-failed-part', title: 'Old failure', content: 'Future part', status: 'error', scenes: [], analysisText: '' });
    response = await call('POST', `sessions/${id}/parts/old-failed-part/reset`, {});
    assert.equal(response.session.parts[2].status, 'ready');
    assert.equal(response.session.activeJob.id, importJobId);
    const beforeImport = JSON.stringify(stored);
    await call('POST', `sessions/${id}/parts/${second}/result`, { text: '{"scenes":[', expectedJobId: importJobId }, 422);
    assert.equal(JSON.stringify(stored), beforeImport);
    await call('POST', `sessions/${id}/parts/${second}/result`, { text: completed.text, expectedJobId: 'wrong-job' }, 409);
    assert.equal(JSON.stringify(stored), beforeImport);
    await call('POST', `sessions/${id}/parts/${first}/result`, { text: completed.text, expectedJobId: importJobId }, 409);
    const imported = { scenes: Array.from({ length: 12 }, (_, i) => ({ title: 'Imported scene ' + (i + 1), prompt: 'Cinematic shot ' + (i + 1) })) };
    response = await call('POST', `sessions/${id}/parts/${second}/result`, { text: '```json\n' + JSON.stringify(imported) + '\n```', expectedJobId: importJobId });
    assert.equal(response.session.activeJob, null);
    assert.equal(response.session.parts[1].status, 'complete');
    assert.equal(response.session.parts[1].scenes.length, 12);
    assert.equal(JSON.stringify(stored.parts[0]), savedFirstPart);
    await call('POST', `bridge/${id}/event`, { jobId: importJobId, state: 'error', text: 'Late extension timeout' });
    assert.equal(stored.parts[1].status, 'complete');
    response = await call('POST', `sessions/${id}/parts/${second}/analysis`);
    assert.equal(response.session.activeJob.type, 'part_analysis');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['SUPABASE_URL', originalEnv.url], ['SUPABASE_SECRET_KEY', originalEnv.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
