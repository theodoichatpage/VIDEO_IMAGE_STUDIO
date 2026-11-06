import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const { chromium } = await import(process.env.VIS_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const port = '4187';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', port], { cwd: root });
await once(server.stdout, 'data');
const browser = await chromium.launch({
  executablePath: process.env.VIS_CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const source = 'Nguồn về hai cách tiếp cận cùng một vấn đề.';
const revised = 'Mở đầu mới. Hai góc nhìn gặp nhau ở kết luận.';
const rubricIds = 'hook idea structure tracks contrast curiosity pace transitions escalation climax logic accuracy style retention ending'.split(' ');
const draft = script => ({ script, tracks: ['Góc nhìn thứ nhất', 'Góc nhìn thứ hai'] });
const review = hook => ({ rows: rubricIds.map(id => ({
  id, score: id === 'hook' ? hook : 8, reason: 'Nhận xét kiểm thử', location: 'Đoạn 1', fix: 'Làm rõ câu hỏi mở đầu',
})) });

try {
  const setup = async ({ existing = false } = {}) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const queued = [];
    let session = { id: 'analysis-fixture', script: existing ? 'Kịch bản cũ' : '', parts: existing ? [{ id: 'old-part', title: 'Phần cũ', status: 'ready', content: 'Cũ', scenes: [] }] : [] };
    await page.route('**/functions/v1/studio-api?**', async route => {
      const path = new URL(route.request().url()).searchParams.get('path');
      if (path.endsWith('/analysis') && route.request().method() === 'POST') {
        const { script } = route.request().postDataJSON();
        queued.push(script);
        session = { ...session, script, activeJob: { id: 'split-job', type: 'script_structure', status: 'queued' } };
      }
      await route.fulfill({ json: { session, command: null } });
    });
    await page.addInitScript(({ source }) => {
      localStorage.setItem('vis-session', 'analysis-fixture');
      localStorage.setItem('vis-transcript-workspace-default', JSON.stringify({
        transcript: { text: source, segments: [] }, stylePrompt: 'Phong cách thử nghiệm',
      }));
      window.commands = [];
      window.addEventListener('message', ({ data }) => {
        if (data?.source !== 'vis-web') return;
        if (data.type === 'studio-status') window.postMessage({ source: 'vis-extension', type: data.type, pairCode: 'analysis-fixture', version: '0.4.23', chatReady: true }, '*');
        if (data.type === 'studio-transcript-ai') {
          const { command } = data;
          window.commands.push(command);
          window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', jobId: command.id, kind: command.kind, sectionId: command.sectionId, state: 'sent' }, '*');
        }
      });
    }, { source });
    await page.goto('http://127.0.0.1:' + port);
    await page.getByText('● Đã kết nối', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Đưa transcript sang Phân tích' }).click();
    assert.equal(await page.getByLabel('Nội dung đầu vào').inputValue(), source);
    return { page, queued };
  };
  const reply = async (page, commandCount, value) => {
    await page.waitForFunction(count => window.commands.length === count, commandCount);
    await page.evaluate(value => {
      const command = window.commands.at(-1);
      window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', jobId: command.id, kind: command.kind, sectionId: command.sectionId, state: 'completed', text: JSON.stringify(value) }, '*');
    }, value);
  };
  const start = page => page.getByRole('button', { name: 'Bắt đầu phân tích tự động' }).click();
  const { page, queued } = await setup();
  await start(page);
  await reply(page, 1, draft('Bản thảo một.'));
  assert.match(await page.evaluate(() => window.commands[0].prompt), /Phong cách thử nghiệm/);
  await reply(page, 2, review(7));
  await reply(page, 3, draft(revised));
  assert.match(await page.evaluate(() => window.commands[2].prompt), /Làm rõ câu hỏi mở đầu/);
  await reply(page, 4, review(8));
  await page.getByRole('heading', { name: 'Toàn bộ kịch bản' }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vis-automatic-analysis-analysis-fixture')).mode === 'transferred');
  assert.deepEqual(queued, [revised]);
  await page.reload();
  assert.equal(await page.locator('.screenplay').inputValue(), revised);
  assert.deepEqual(queued, [revised]);

  const stopped = await setup();
  await start(stopped.page);
  await stopped.page.waitForFunction(() => window.commands.length === 1);
  await stopped.page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
  await reply(stopped.page, 1, draft('Bản giữ khi tạm dừng.'));
  await stopped.page.waitForFunction(() => JSON.parse(localStorage.getItem('vis-automatic-analysis-analysis-fixture')).draft?.script);
  assert.equal(await stopped.page.evaluate(() => window.commands.length), 1);
  await stopped.page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await stopped.page.waitForFunction(() => window.commands.length === 2);
  await stopped.page.getByRole('button', { name: 'Dừng', exact: true }).click();
  await reply(stopped.page, 2, review(8));
  await stopped.page.waitForTimeout(600);
  assert.equal(await stopped.page.evaluate(() => window.commands.length), 2);
  assert.deepEqual(stopped.queued, []);

  const preserved = await setup({ existing: true });
  await preserved.page.getByLabel('Giới hạn lượt sửa').selectOption('0');
  await start(preserved.page);
  await reply(preserved.page, 1, draft(revised));
  await reply(preserved.page, 2, review(7));
  await preserved.page.getByText(/Đã hết lượt sửa tự động/).waitFor();
  assert.deepEqual(preserved.queued, []);
  preserved.page.once('dialog', dialog => dialog.accept());
  await preserved.page.getByRole('button', { name: /Duyệt thủ công/ }).click();
  assert.equal(await preserved.page.getByLabel('Kịch bản từ Phân tích').inputValue(), revised);
  assert.equal(await preserved.page.locator('textarea.screenplay').last().inputValue(), 'Kịch bản cũ');
  assert.deepEqual(preserved.queued, []);

  const invalid = await setup();
  await start(invalid.page);
  await reply(invalid.page, 1, draft(revised));
  await reply(invalid.page, 2, { rows: review(8).rows.slice(1) });
  await invalid.page.getByText(/Báo cáo thiếu hoặc thừa tiêu chí/).waitFor();
  assert.deepEqual(invalid.queued, []);
  console.log('PASS: transcript and style → write → review → repair → review → split; reload, pause, stop, incomplete review, and existing scenes.');
} finally {
  await browser.close();
  server.kill();
}
