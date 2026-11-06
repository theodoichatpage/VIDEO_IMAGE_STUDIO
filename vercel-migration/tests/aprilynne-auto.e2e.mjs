import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.VIS_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const server = spawn('node', [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4187'], { cwd: root, stdio: 'pipe' });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); });
const browser = await chromium.launch({ executablePath: process.env.VIS_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const id = 'aprilynne-auto-test-20261106';
const source = 'Lời mở đầu theo phong cách.\n\nNội dung phần hai.';
let checks = 0;
async function setup({ connected = true, busy = false, managed = false, ready = true, rejectSave = false, menu = 1, legacy = null } = {}) {
 const context = await browser.newContext(); const page = await context.newPage();
 let session = { id, script: '', status: 'ready', parts: [], activeJob: null, imageJobs: [], laneJobs: [], updatedAt: 1, workEpoch: 0 };
 const saves = []; const events = [];
 await page.route('**/functions/v1/studio-api?**', async route => {
  const req = route.request(), path = new URL(req.url()).searchParams.get('path');
  if (path === 'sessions/' + id + '/analysis-review') {
   if (rejectSave) { await route.fulfill({ status: 500, json: { error: 'Fixture save failure' } }); return; }
   const body = req.postDataJSON(); saves.push(body);
   session = { ...session, script: body.script, status: 'analysis_' + body.stage, analysisReview: { ...body }, updatedAt: session.updatedAt + 1 };
  }
  if (path?.endsWith('/analysis') && req.method() === 'POST') { session.activeJob = { id: 'split-fixture', type: 'script_structure', status: 'waiting', prompt: 'split' }; }
  if (path?.endsWith('/version')) await route.fulfill({ json: { version: { updatedAt: session.updatedAt, activeJob: session.activeJob, laneJobs: [] } } });
  else await route.fulfill({ json: { session } });
 });
 await page.route('http://127.0.0.1:8765/**', async route => {
  if (route.request().postData()) { try { events.push(route.request().postDataJSON()); } catch {} }
  await route.fulfill({ json: {} });
 });
 await page.addInitScript(({ id, source, connected, busy, managed, ready, menu, legacy }) => {
  localStorage.setItem('vis-session', id); localStorage.setItem('vis-active-menu', String(menu));
  localStorage.setItem('vis-manager-watch', '1');
  const sections = source.split('\n\n').map((text, i) => ({ id: String(i + 1), branchId: String(i + 1), title: 'Phần ' + (i + 1), summary: '', sourceText: text, status: ready ? 'done' : 'waiting', rewrittenText: ready ? text : '' }));
  localStorage.setItem('vis-transcript-workspace-' + id, JSON.stringify({ url: '', language: 'vi', transcript: { videoId: 'fixture123', text: source, segments: [] }, branches: [], sections, stylePrompt: 'Giọng kể dự án', selectedBranchId: '', updatedAt: 1 }));
  if (legacy) localStorage.setItem('vis-automatic-analysis-v2-' + id, JSON.stringify({ input: '', source, style: 'Giọng kể dự án', limit: 3, rounds: 0, mode: legacy, phase: 'review', index: 0, repairParts: [], notice: '', parts: sections.map(s => ({ title: s.title, source: s.sourceText, text: s.sourceText })), rows: Array.from({ length: 14 }, (_, n) => ({ id: n, score: [0,1,8].includes(n) ? null : 8, part: [0,1,8].includes(n) ? null : 1, evidence: [0,1,8].includes(n) ? '' : sections[0].sourceText, reason: 'Đối chiếu', fix: '' })) }));
  if (managed) { localStorage.setItem('vis-manager-transcript', JSON.stringify({ id: 'manager-pipeline-123', sessionId: id, rewrite: true, url: 'https://youtu.be/fixture123' })); localStorage.setItem('vis-manager-transcript-state', JSON.stringify({ id: 'manager-pipeline-123', stage: 'analysis' })); }
  window.pageBoot = crypto.randomUUID(); window.commands = []; window.connection = connected; window.foreignJob = busy ? 'foreign-job' : '';
  window.reportStatus = () => window.postMessage({ source: 'vis-extension', type: 'studio-status', pairCode: id, chatReady: window.connection, version: '0.5.16', activeJobId: window.foreignJob, pendingEvents: [], transcriptEvents: [] }, '*');
  window.addEventListener('message', event => {
   const d = event.data; if (d?.source !== 'vis-web') return;
   if (d.type === 'studio-status') window.reportStatus();
   if (d.type === 'studio-transcript-ai') { window.commands.push(d.command); window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', jobId: d.command.id, kind: 'rewrite', sectionId: d.command.sectionId, state: 'sent' }, '*'); }
  });
 }, { id, source, connected, busy, managed, ready, menu, legacy });
 await page.goto('http://127.0.0.1:4187');
 return { context, page, saves, events, session: () => session };
}
async function command(page, count) { await page.waitForFunction(n => window.commands.length >= n, count, { timeout: 12000 }); return page.evaluate(n => window.commands[n - 1], count); }
async function answer(page, text) { await page.evaluate(text => { const c = window.commands.at(-1); window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', jobId: c.id, kind: c.kind, sectionId: c.sectionId, state: 'completed', text: typeof text === 'string' ? text : JSON.stringify(text) }, '*'); }, text); }
async function report(page, low = true) {
 const run = await page.evaluate(id => JSON.parse(localStorage.getItem('vis-automatic-analysis-v2-' + id)), id);
 return { rows: Array.from({ length: 14 }, (_, n) => [0, 1, 8].includes(n) ? { id: n, score: null, part: null, evidence: '', reason: 'Chưa áp dụng tài sản hình ảnh/tiêu đề', fix: '' } : { id: n, score: low && n === 2 ? 7 : 8, part: 1, evidence: run.parts[0].text, reason: 'Đối chiếu kịch bản', fix: low && n === 2 ? 'Làm rõ bối cảnh phần đầu' : '' }) };
}
try {
 const flow = await setup({ managed: true });
 const boot = await flow.page.evaluate(() => window.pageBoot);
 await flow.page.locator('.auto-analysis').waitFor();
 assert.equal(await flow.page.getByRole('button', { name: 'Đối chiếu theo Aprilynne', exact: true }).count(), 0, 'No manual start');
 await command(flow.page, 1); // No clicks.
 assert.equal(await flow.page.evaluate(() => JSON.parse(localStorage.getItem('vis-manager-transcript-state')).stage), 'analysis', 'Manager must wait for the entire review loop');
 assert.match(await flow.page.evaluate(() => window.commands[0].sectionId), /:review:/);
 await answer(flow.page, await report(flow.page));
 await command(flow.page, 2);
 assert.equal(await flow.page.locator('.auto-review-columns table').count(), 2);
 await answer(flow.page, { text: 'Bối cảnh phần đầu đã được sửa.' });
 await command(flow.page, 3);
 assert.ok(flow.saves.some(s => s.script.includes('Bối cảnh phần đầu đã được sửa.')), 'Updated project before next review');
 await answer(flow.page, await report(flow.page, false));
 await flow.page.waitForFunction(() => localStorage.getItem('vis-active-menu') === '2');
 assert.equal(flow.session().analysisReview.stage, 'approved');
 assert.ok(flow.session().script.includes('Bối cảnh phần đầu đã được sửa.'));
 assert.equal(await flow.page.evaluate(() => window.commands.length), 3);
 assert.equal(await flow.page.evaluate(() => window.pageBoot), boot, 'No page reload during review/repair');
 await flow.page.waitForFunction(() => JSON.parse(localStorage.getItem('vis-manager-transcript-state')).stage === 'done');
 checks++;
 const rewrite = await setup({ ready: false, menu: 0 });
 await rewrite.page.getByRole('button', { name: /Viết lại toàn bộ/ }).click();
 await command(rewrite.page, 1); await answer(rewrite.page, 'Lời mở đầu đã viết lại.');
 await command(rewrite.page, 2); await answer(rewrite.page, 'Kết thúc đã viết lại.');
 await command(rewrite.page, 3);
 assert.match(await rewrite.page.evaluate(() => window.commands[2].sectionId), /:review:/);
 await answer(rewrite.page, await report(rewrite.page)); await command(rewrite.page, 4);
 await answer(rewrite.page, { text: 'Lời mở đầu đã cải thiện theo Aprilynne.' }); await command(rewrite.page, 5);
 await answer(rewrite.page, await report(rewrite.page, false));
 await rewrite.page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent.includes('Phân tách'));
 assert.equal(rewrite.session().analysisReview.stage, 'approved'); checks++;
 const queued = await setup({ connected: false, busy: true });
 await queued.page.waitForTimeout(1200); assert.equal(await queued.page.evaluate(() => window.commands.length), 0);
 assert.match(await queued.page.locator('.auto-analysis [role=status]').innerText(), /chờ/i);
 await queued.page.evaluate(() => { window.connection = true; window.reportStatus(); });
 await queued.page.waitForTimeout(1200); assert.equal(await queued.page.evaluate(() => window.commands.length), 0, 'Wait for another job');
 await queued.page.evaluate(() => { window.foreignJob = ''; window.reportStatus(); });
 await command(queued.page, 1);
 await queued.page.evaluate(() => { window.connection = false; window.reportStatus(); });
 await answer(queued.page, await report(queued.page));
 await queued.page.waitForTimeout(800); assert.equal(await queued.page.evaluate(() => window.commands.length), 1);
 await queued.page.evaluate(() => { window.connection = true; window.reportStatus(); });
 await command(queued.page, 2); checks++;
 const limit = await setup(); await command(limit.page, 1); await answer(limit.page, await report(limit.page));
 for (let i = 0; i < 3; i++) { await command(limit.page, i * 2 + 2); await answer(limit.page, { text: 'Bản sửa ' + i }); await command(limit.page, i * 2 + 3); await answer(limit.page, await report(limit.page)); }
 await limit.page.waitForFunction(id => JSON.parse(localStorage.getItem('vis-automatic-analysis-v2-' + id)).mode === 'limited', id);
 assert.ok(await limit.page.getByRole('button', { name: '2. Phân tích', exact: true }).evaluate(el => el.classList.contains('active')));
 assert.ok(await limit.page.getByRole('button', { name: 'Viết lại tất cả phần chưa đạt', exact: true }).isEnabled());
 assert.ok(await limit.page.getByRole('button', { name: /^Viết lại tiêu chí/ }).count());
 await limit.page.getByRole('button', { name: /^Viết lại tiêu chí/ }).first().click();
 await command(limit.page, 8); await answer(limit.page, { text: 'Bản can thiệp thủ công.' });
 await command(limit.page, 9); await answer(limit.page, await report(limit.page, false));
 await limit.page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent.includes('Phân tách')); checks++;
 const failed = await setup({ rejectSave: true }); await failed.page.waitForTimeout(1500);
 assert.equal(await failed.page.evaluate(() => window.commands.length), 0, 'Do not send review before saving its input');
 assert.ok(await failed.page.getByRole('button', { name: '2. Phân tích', exact: true }).evaluate(el => el.classList.contains('active'))); checks++;
 const invalid = await setup(); await command(invalid.page, 1); await answer(invalid.page, { rows: [] });
 await invalid.page.waitForFunction(id => JSON.parse(localStorage.getItem('vis-automatic-analysis-v2-' + id)).mode === 'error', id);
 assert.equal(await invalid.page.evaluate(() => window.commands.length), 1); checks++;
 const stop = await setup(); await command(stop.page, 1); await stop.page.locator('.auto-analysis').getByRole('button', { name: 'Dừng', exact: true }).click();
 await answer(stop.page, await report(stop.page, false)); await stop.page.waitForTimeout(1000);
 assert.equal(await stop.page.evaluate(id => JSON.parse(localStorage.getItem('vis-automatic-analysis-v2-' + id)).mode, id), 'stopped'); checks++;
 for (const legacy of ['running', 'passed', 'transferred']) {
  const migrated = await setup({ legacy });
  if (legacy === 'running') await command(migrated.page, 1);
  else await migrated.page.waitForFunction(id => { const r=JSON.parse(localStorage.getItem('vis-automatic-analysis-v2-' + id)); return r.mode === 'transferred' && r.needsSave === false && r.runId; }, id);
  assert.ok(migrated.saves.length > 0, 'Legacy ' + legacy + ' must save before it can continue');
  checks++;
 }
 console.log('PASS: ' + checks + ' automatic Aprilynne browser flows');
} finally { await browser.close(); server.kill(); }
