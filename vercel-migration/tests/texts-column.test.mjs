// Disk IO on the free plan: the project's unchanging text lives in its own `texts` column and is written only when
// it changed, so status updates and image results rewrite only the small rest of the row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/studio-api/handler.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { default: handler, splitTexts, mergeTexts, replyShape } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const id = 'texts-column-20261101';

// One studio_sessions row as Postgres keeps it: columns are written only when the request sends them.
function database({ hasTexts = true } = {}) {
  const db = { row: null, writes: [] };
  globalThis.fetch = async (url, init) => {
    url = decodeURIComponent(String(url));
    if (url.includes('studio_separations')) return Response.json([]);
    if (url.includes('rpc/')) return Response.json(null);
    const select = /select=([^&]*)/.exec(url)?.[1]?.split(',') || [];
    if (!hasTexts && (select.includes('texts') || (init?.body && JSON.parse(init.body).texts !== undefined)))
      return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'texts' column of 'studio_sessions' in the schema cache" }), { status: 400 });
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      const body = JSON.parse(init.body); db.writes.push(body);
      if (init.method === 'PATCH') {
        if (!db.row) return Response.json([]);
        const m = /record->>updatedAt=eq\.(\d+)/.exec(url);
        if (m && Number(m[1]) !== db.row.record.updatedAt) return Response.json([]);
      }
      db.row = { ...(db.row || {}), ...body };
      return init.method === 'POST' ? new Response('', { status: 201 }) : Response.json([{ id }]);
    }
    if (!db.row) return Response.json([]);
    if (select.includes('summary') && !select.includes('record')) return Response.json([{ summary: db.row.summary ?? null }]);
    const out = {}; for (const k of select) if (k in db.row || k === 'texts') out[k] = structuredClone(db.row[k] ?? null);
    return Response.json([out]);
  };
  db.call = async (method, path, body) => {
    let status, data;
    await handler({ method, query: { path: path.split('/') }, body, headers: {} }, { setHeader() {}, status(code) { status = code; return { json(value) { data = value; } }; } });
    assert.equal(status, 200, path + ' ' + JSON.stringify(data));
    return data;
  };
  process.env.SUPABASE_URL = 'https://database.test'; process.env.SUPABASE_SECRET_KEY = 'k';
  return db;
}

test('split and merge give back the same project', () => {
  const record = { id, script: 'Kịch bản', stylePrompt: 'xám đỏ', status: 'parts_ready', lastJob: { id: 'j', type: 'part_analysis', prompt: 'P', status: 'completed' },
    parts: [{ id: 'p1', title: 'Phần 1', content: 'nội dung', status: 'complete', scenes: [{ title: 'Cảnh 1', prompt: 'a door', imageStatus: 'complete', imageResults: [{ url: 'u' }] }] }] };
  const { lean, texts } = splitTexts(structuredClone(record));
  assert.equal(lean.script, undefined); assert.equal(lean.parts[0].content, undefined); assert.equal(lean.parts[0].scenes[0].prompt, undefined);
  assert.equal(lean.parts[0].scenes[0].imageStatus, 'complete', 'changing fields stay in the record');
  assert.deepEqual(mergeTexts(lean, texts), record);
  const image = splitTexts({ lastJob: { type: 'image_generation', prompt: 'long image prompt' } });
  assert.equal(image.texts.lastJobPrompt, undefined, 'an image prompt is not kept');
});

test('text is written once; later status writes carry only the small record', async () => {
  const db = database();
  await db.call('POST', 'sessions', { id });
  const script = 'Một kịch bản dài. '.repeat(2000).trim();
  await db.call('POST', `sessions/${id}/script`, { script });
  const withText = db.writes.filter(w => w.texts).length;
  assert.ok(withText >= 1, 'the script went to the texts column');
  assert.match(JSON.stringify(db.row.texts), /Một kịch bản dài/); assert.equal(db.row.record.script, undefined, 'not inside record');
  const before = db.writes.length;
  await db.call('POST', `sessions/${id}/stop`, {});
  const later = db.writes.slice(before);
  assert.ok(later.length >= 1); assert.ok(later.every(w => w.texts === undefined), 'unchanged text is not rewritten');
  const { session } = await db.call('GET', `sessions/${id}`);
  assert.ok(session.script === script, 'reads see the whole project');
  await db.call('POST', `sessions/${id}/script`, { script: 'Kịch bản mới' });
  assert.equal(db.writes.at(-1).texts.script, 'Kịch bản mới', 'changed text is written');
});

test('a read does not fetch the ~1 MB text again while its fingerprint is unchanged', async () => {
  const db = database(); const seen = []; const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(decodeURIComponent(String(url))); return inner(url, init); };
  const sid = id + '-egress';
  await db.call('POST', 'sessions', { id: sid });
  await db.call('POST', `sessions/${sid}/script`, { script: 'Kịch bản dài. '.repeat(500) });
  await db.call('GET', `sessions/${sid}`);
  seen.length = 0;
  const { session } = await db.call('GET', `sessions/${sid}`);
  assert.match(session.script, /Kịch bản dài/, 'the project is still whole');
  assert.equal(session.textsFp, undefined, 'the stored fingerprint is not shown');
  assert.equal(seen.filter(u => /select=[^&]*texts/.test(u)).length, 0, 'texts was not read again');
  assert.equal(seen.filter(u => /select=[^&]*record/.test(u)).length, 0, 'the record was not read again either: only the small summary');
  db.row.texts = { ...db.row.texts, script: 'Đổi ở nơi khác' }; db.row.record.textsFp = 'other:1';
  db.row.record.updatedAt += 1; db.row.summary = { ...db.row.summary, updatedAt: db.row.record.updatedAt }; // any real writer bumps updatedAt
  const changed = await db.call('GET', `sessions/${sid}`);
  assert.equal(changed.session.script, 'Đổi ở nơi khác', 'a changed fingerprint reads the text again');
});

test('without the texts column everything stays in record, as before', async () => {
  const db = database({ hasTexts: false });
  await db.call('POST', 'sessions', { id: id + '-old' });
  await db.call('POST', `sessions/${id}-old/script`, { script: 'Kịch bản cũ' });
  assert.equal(db.row.record.script, 'Kịch bản cũ');
  const { session } = await db.call('GET', `sessions/${id}-old`);
  assert.equal(session.script, 'Kịch bản cũ');
});

test('image prompts are stored as a short reference and rebuilt exactly', () => {
  const style = 'STYLE '.repeat(500) + '{{SCENE_PROMPT}} END';
  const scene = { title: 'C1', prompt: 'a door opens', imageStatus: 'complete' };
  const full = style.trim().replace('{{SCENE_PROMPT}}', 'a door opens');
  const record = { stylePrompt: style, parts: [{ id: 'p', scenes: [{ ...scene, imagePrompt: full, imageResults: [{ url: 'u', prompt: full }] }, { title: 'C2', prompt: 'x', imagePrompt: 'made with an older style' }] }] };
  const { lean, texts } = splitTexts(structuredClone(record));
  const s = lean.parts[0].scenes[0];
  assert.equal(s.imagePrompt, undefined); assert.ok(s.imagePromptRef); assert.equal(s.imageResults[0].prompt, undefined);
  assert.ok(JSON.stringify(lean).length < 1000, 'the row no longer carries the long prompt');
  assert.equal(lean.parts[0].scenes[1].imagePrompt, 'made with an older style', 'a prompt that cannot be rebuilt stays as it is');
  assert.deepEqual(mergeTexts(structuredClone(lean), texts), record);
  const changed = mergeTexts(structuredClone(lean), structuredClone(texts)); // same row, the scene prompt was edited later
  const edited = structuredClone(lean); const t2 = structuredClone(texts); t2.parts.p.scenes[0].prompt = 'a different scene';
  const merged = mergeTexts(edited, t2);
  assert.equal(merged.parts[0].scenes[0].imagePrompt, undefined, 'never rebuilt from a prompt the picture was not made from');
  assert.equal(changed.parts[0].scenes[0].imagePrompt, full);
});

test('lean replies carry only the changing part and the text fingerprint', () => {
  const session = { id, script: 'S'.repeat(5000), parts: [{ id: 'p', content: 'C'.repeat(5000), scenes: [{ title: 'T', prompt: 'P'.repeat(3000), imageStatus: 'complete' }] }] };
  const lean = replyShape({ session, ok: 1 }, 'lean'); const full = replyShape({ session }, 'fp');
  assert.equal(lean.lean, true); assert.equal(lean.ok, 1); assert.equal(lean.textsFp, full.textsFp);
  assert.ok(JSON.stringify(lean).length < 600); assert.equal(full.session.script.length, 5000);
  const other = replyShape({ session: { ...session, script: 'changed' } }, 'lean');
  assert.notEqual(other.textsFp, lean.textsFp, 'changed text gives another fingerprint');
  assert.deepEqual(replyShape({ error: 'x' }, 'lean'), { error: 'x' });
});
