import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../supabase/functions/studio-api/handler.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { default: handler, mergeTexts, forgetCaches } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const id = 'april-checkpoint-20261106';
const rows = Array.from({ length: 14 }, (_, id) => ({ id, score: [0, 1, 8].includes(id) ? null : 8, reason: 'Đủ căn cứ' }));
test('project checkpoints persist repaired script and only approve passing complete reports, reject old epochs and concurrent work', async () => {
 const oldFetch = globalThis.fetch; const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
 process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SECRET_KEY = 'test-only';
 let stored = { id, script: 'Bản gốc', parts: [], activeJob: null, laneJobs: [], imageJobs: [], status: 'ready', updatedAt: 1, workEpoch: 0 }, texts;
 globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('studio_separations')) return Response.json([]);
  if (init.method === 'PATCH') {
   const body = JSON.parse(init.body); const stamp = /record->>updatedAt=eq\.(\d+)/.exec(String(url));
   if (stamp && +stamp[1] !== stored.updatedAt) return Response.json([]);
   if (body.texts) texts = body.texts;
   stored = mergeTexts(body.record, structuredClone(texts)); return Response.json([{ id }]);
  }
  return Response.json([{ record: structuredClone(stored), texts: structuredClone(texts), summary: null }]);
 };
 const call = async (body, expected = 200) => {
  forgetCaches(); let status, value;
  await handler({ method: 'POST', query: { path: ['sessions', id, 'analysis-review'] }, body, headers: {} }, { setHeader() {}, status(code) { status = code; return { json(v) { value = v; } }; } });
  assert.equal(status, expected, JSON.stringify(value)); return value;
 };
 const base = { runId: 'run-20261106', revision: 1, script: 'Kịch bản đã sửa', stage: 'reviewing', rows: [], rounds: 0, expectedWorkEpoch: 0 };
 try {
  await call(base); assert.equal(stored.script, base.script); assert.equal(stored.status, 'analysis_reviewing');
  await call({ ...base, revision: 2, stage: 'approved', rows: rows.slice(1) }, 422);
  await call({ ...base, revision: 2, stage: 'approved', rows: rows.map(r => r.id === 2 ? { ...r, score: 7 } : r) }, 422);
  await call({ ...base, revision: 2, stage: 'approved', rows }); assert.equal(stored.status, 'analysis_approved');
  await call(base, 409); // Old result cannot overwrite the approved draft.
  stored.activeJob = { id: 'another-job' }; await call({ ...base, revision: 3 }, 409); stored.activeJob = null;
  stored.laneJobs = [{ id: 'lane-job' }]; await call({ ...base, revision: 3 }, 409); stored.laneJobs = [];
  stored.workEpoch = 1; await call({ ...base, revision: 3 }, 409);
  assert.equal(stored.script, 'Kịch bản đã sửa');
 } finally { globalThis.fetch = oldFetch; process.env.SUPABASE_URL = env.url; process.env.SUPABASE_SECRET_KEY = env.key; forgetCaches(); }
});
