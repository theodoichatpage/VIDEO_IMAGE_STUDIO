// Get Transcript takes any video link: YouTube captions as before; Facebook/TikTok/... and
// YouTube videos without captions go to the local engine's speech-to-text job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/transcriptProvider.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const provider = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const speechResult = { video_id: 'facebook:1415564201644332', title: 'Mẹ không hề dữ', duration: 79, language: 'vi', is_generated: true, source: 'speech', segments: [{ text: 'Xin chào', start: 0, duration: 1.5 }], text: 'Xin chào' };
function engine({ features = ['youtube_captions', 'media_link'], youtube, jobs = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    if (url.endsWith('/health')) return reply(200, { status: 'ok', features });
    if (url.endsWith('/transcript')) return youtube ? youtube() : reply(200, { video_id: 'abc', segments: [], text: 'phụ đề' });
    if (url.endsWith('/media/jobs')) return reply(202, jobs.shift());
    if (url.includes('/media/jobs/') && init.method === 'DELETE') return reply(200, {});
    if (url.includes('/media/jobs/')) return reply(200, jobs.shift());
    if (url === '/api/transcript') return reply(500, { error: 'vercel' });
    throw new Error('unexpected ' + url);
  };
  return calls;
}
const fast = { sleep: async () => {} };

test('a Facebook link becomes a speech job, reports progress and returns the transcript', async () => {
  const calls = engine({ jobs: [
    { id: 'j1', status: 'downloading', progress: 0.05, message: 'Đang tải âm thanh từ link' },
    { id: 'j1', status: 'transcribing', progress: 0.5, message: 'Đang nhận giọng nói' },
    { id: 'j1', status: 'done', progress: 1, result: speechResult },
  ] });
  const seen = [];
  const t = await provider.fetchTranscript({ url: 'https://www.facebook.com/reel/1415564201644332', language: 'vi' }, { ...fast, onStatus: s => seen.push(s) });
  assert.equal(t.text, 'Xin chào');
  assert.equal(t.captionType, 'speech');
  assert.equal(t.title, 'Mẹ không hề dữ');
  assert.deepEqual(seen, ['Đang tải âm thanh từ link · 5%', 'Đang nhận giọng nói · 50%']);
  assert.ok(!calls.some(c => c.endsWith('/transcript')), 'never asks YouTube captions for a Facebook link');
});

test('a YouTube link with captions works as before', async () => {
  const calls = engine();
  const t = await provider.fetchTranscript({ url: 'https://youtu.be/yTwvX2RJ80Q' }, fast);
  assert.equal(t.text, 'phụ đề');
  assert.ok(!calls.some(c => c.includes('/media/jobs')));
});

test('a YouTube video without captions falls back to speech', async () => {
  engine({ youtube: () => reply(404, { error: { code: 'NO_TRANSCRIPT_FOUND', message: 'Không tìm thấy' } }), jobs: [{ id: 'j2', status: 'done', progress: 1, result: speechResult }] });
  const seen = [];
  const t = await provider.fetchTranscript({ url: 'https://www.youtube.com/watch?v=yTwvX2RJ80Q' }, { ...fast, onStatus: s => seen.push(s) });
  assert.equal(t.captionType, 'speech');
  assert.match(seen[0], /không có phụ đề/);
});

test('an old engine without speech says to update it', async () => {
  engine({ features: ['youtube_captions'] });
  await assert.rejects(provider.fetchTranscript({ url: 'https://www.tiktok.com/@a/video/1' }, fast), /bản cũ/);
});

test('a failed job shows the engine reason', async () => {
  engine({ jobs: [{ id: 'j3', status: 'error', error: { code: 'MEDIA_LOGIN_REQUIRED', message: 'Video này cần đăng nhập' } }] });
  await assert.rejects(provider.fetchTranscript({ url: 'https://www.facebook.com/x/videos/1' }, fast), /cần đăng nhập/);
});

test('Stop ends the polling', async () => {
  const calls = engine({ jobs: [{ id: 'j4', status: 'transcribing', progress: 0.2, message: 'Đang nhận giọng nói' }] });
  let stop = false;
  await assert.rejects(provider.fetchTranscript({ url: 'https://www.facebook.com/reel/9' }, { sleep: async () => { stop = true; }, cancelled: () => stop }), new RegExp(provider.CANCELLED));
  assert.ok(calls.includes('DELETE http://127.0.0.1:8000/media/jobs/j4'), 'the engine job is stopped too');
});

test('engine not running gives a clear message', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(provider.fetchTranscript({ url: 'https://www.facebook.com/reel/9' }, fast), /chưa chạy/);
});

test('isYouTubeUrl', () => {
  assert.ok(provider.isYouTubeUrl('https://m.youtube.com/shorts/abc'));
  assert.ok(provider.isYouTubeUrl('yTwvX2RJ80Q'));
  assert.ok(!provider.isYouTubeUrl('https://www.facebook.com/reel/1'));
});
