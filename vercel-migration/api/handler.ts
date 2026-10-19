type RequestLike = { method?: string; query: { path?: string | string[] }; body?: unknown; headers: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string): void; status(code: number): { json(value: unknown): void } };

type Scene = { title: string; backdrop: string; content: string; character: string; emotion: string; shot: string; image: string; prompt: string; imageStatus?: string; imageResults?: { url: string; prompt: string; createdAt: number }[]; imagePrompt?: string; imageError?: string };
type Part = { id: string; title: string; range: string; content: string; status: string; scenes: Scene[]; analysisText: string };
type Job = { id: string; type: 'script_structure' | 'part_analysis' | 'image_generation'; status: string; prompt: string; partId?: string; sceneKey?: string; protocol: 2 | 3 };
type Session = { id: string; script: string; status: string; activeJob: Job | null; parts: Part[]; imageJobs: Job[]; updatedAt: number; bridgeLastSeen?: number; finishedJobIds?: string[]; lastError?: string };

const idOk = (value: string) => /^[A-Za-z0-9-]{16,64}$/.test(value);
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const partId = () => 'part_' + Math.random().toString(36).slice(2, 9);
const sceneKey = (part: string, index: number) => part + ':' + index;
const send = (res: ResponseLike, code: number, value: unknown) => res.status(code).json(value);
const fail = (res: ResponseLike, message: string, code = 400) => send(res, code, { error: message });

function settings() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Thiếu cấu hình Supabase trên Vercel.');
  return { url: url.replace(/\/$/, ''), key };
}
async function database(path: string, init?: RequestInit) {
  const { url, key } = settings();
  const result = await fetch(url + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!result.ok) throw new Error(await result.text());
  return result.status === 204 ? null : result.json();
}
async function read(id: string): Promise<Session | null> {
  const rows = await database('studio_sessions?id=eq.' + encodeURIComponent(id) + '&select=record') as { record: Session }[];
  const value = rows?.[0]?.record;
  return value ? { ...value, parts: value.parts || [], imageJobs: value.imageJobs || [], finishedJobIds: value.finishedJobIds || [] } : null;
}
async function write(session: Session) {
  session.updatedAt = Date.now();
  await database('studio_sessions?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: session.id, record: session }) });
  return session;
}
function structurePrompt(script: string) {
  return 'Bạn là biên tập viên kịch bản. Hãy đọc TOÀN BỘ kịch bản và chia thành số phần HỢP LÝ theo mạch nội dung, không cố định 5 phần. Mục tiêu là mỗi phần đủ ngắn để bước sau phân tích thành phân cảnh chi tiết, nhưng tuyệt đối không cắt giữa một ý, sự kiện hoặc đoạn kể đang liền mạch. Chỉ trả MỘT JSON hợp lệ, không markdown, đúng dạng: {"parts":[{"title":"Phần 1 - tên ngắn","range":"mô tả phạm vi nội dung","content":"nguyên văn đầy đủ nội dung thuộc phần này"}]}. Phải bao phủ toàn bộ kịch bản theo đúng thứ tự, không bỏ sót, không viết lại nội dung. KỊCH BẢN:\n' + script;
}
function partPrompt(part: Part) {
  return 'Bạn là đạo diễn hình ảnh. Chỉ trả MỘT JSON hợp lệ, không markdown: {"scenes":[{"title":"Cảnh 1 - tên rất ngắn","backdrop":"bối cảnh riêng của cảnh","content":"hành động/sự kiện riêng của cảnh","character":"nhân vật xuất hiện, tư thế hoặc biểu cảm riêng","emotion":"cảm xúc riêng","shot":"góc máy, cỡ cảnh, hướng nhìn riêng","image":"mô tả hình ảnh ngắn bằng tiếng Việt","prompt":"English scene prompt only: subject/action + character details for this scene + setting + camera framing"}]}. Từ nội dung Phần này, tách thành các cảnh dùng tạo ảnh YouTube. Mỗi cảnh có góc máy điện ảnh khác nhau. PROMPT CẢNH chỉ chứa nội dung riêng của cảnh, nhân vật/bối cảnh và góc máy; không chứa phong cách chung, ánh sáng, chất liệu hoặc tỷ lệ. PHẦN: ' + part.title + '\nNỘI DUNG:\n' + part.content;
}
function current(job: Job | null | undefined) { return Boolean(job && ((job.protocol === 2 && job.type !== 'image_generation') || (job.protocol === 3 && job.type === 'image_generation'))); }
function findScene(session: Session, key: string) { const i = key.lastIndexOf(':'); const part = session.parts.find(item => item.id === key.slice(0, i)); const index = Number(key.slice(i + 1)); return { part, scene: Number.isInteger(index) ? part?.scenes[index] : undefined }; }
function nextImage(session: Session) { const job = session.imageJobs.find(item => item.status === 'queued'); if (!job) return false; const target = findScene(session, String(job.sceneKey)); if (!target.scene) { session.imageJobs = session.imageJobs.filter(item => item.id !== job.id); return nextImage(session); } session.activeJob = job; session.status = 'image_processing'; target.scene.imageStatus = 'queued'; return true; }
function finishImage(session: Session, state: string, url = '', message = '') {
  const job = session.activeJob; if (!job?.sceneKey) throw new Error('Không tìm thấy cảnh tạo ảnh.');
  const target = findScene(session, job.sceneKey); if (!target.scene) throw new Error('Không tìm thấy cảnh tạo ảnh.');
  target.scene.imageStatus = state; target.scene.imageError = message;
  if (url) target.scene.imageResults = [{ url, prompt: job.prompt, createdAt: Date.now() }];
  session.imageJobs = session.imageJobs.filter(item => item.id !== job.id); session.activeJob = null;
  if (!nextImage(session)) session.status = 'images_ready';
}
function jsonReply(text: string) { const fence = String.fromCharCode(96).repeat(3); return JSON.parse(text.replace(new RegExp(fence + 'json|' + fence, 'gi'), '').trim()) as Record<string, unknown>; }
function normalizeParts(value: unknown): Part[] {
  if (!Array.isArray(value) || !value.length) throw new Error('ChatGPT chưa trả về danh sách parts.');
  return value.slice(0, 30).map((item, index) => { const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}; const content = String(row.content || '').trim(); if (!content) throw new Error('Một phần kịch bản không có nội dung.'); return { id: partId(), title: String(row.title || 'Phần ' + (index + 1)), range: String(row.range || 'Phần ' + (index + 1)), content, status: 'ready', scenes: [], analysisText: '' }; });
}
function normalizeScenes(value: unknown): Scene[] {
  if (!Array.isArray(value) || !value.length) throw new Error('ChatGPT chưa trả về scenes.');
  return value.slice(0, 30).map((item, index) => { const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}; return { title: String(row.title || 'Cảnh ' + (index + 1)), backdrop: String(row.backdrop || 'Theo kịch bản'), content: String(row.content || ''), character: String(row.character || 'Theo kịch bản'), emotion: String(row.emotion || 'Theo ngữ cảnh'), shot: String(row.shot || 'Góc máy điện ảnh'), image: String(row.image || 'Theo nội dung cảnh'), prompt: String(row.prompt || ''), imageStatus: 'waiting', imageResults: [] }; });
}
function imagePrompt(style: string, scene: Scene, ratio: string) { return 'Generate exactly ONE standalone image for a YouTube video slide. Do not create a collage, contact sheet, split panel, text, logo, or watermark. Aspect ratio: ' + ratio + '.\n\nGLOBAL STYLE:\n' + style + '\n\nSCENE:\n' + scene.prompt; }

export default async function handler(req: RequestLike, res: ResponseLike) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  try {
    const path = (Array.isArray(req.query.path) ? req.query.path : [req.query.path]).filter(Boolean) as string[];
    const body = (req.body || {}) as Record<string, unknown>;
    if (path[0] === 'sessions' && !path[1] && req.method === 'POST') {
      const id = String(body.id || ''); if (!idOk(id)) return fail(res, 'Mã phiên không hợp lệ.');
      const found = await read(id); if (found) return send(res, 200, { session: found });
      const session: Session = { id, script: '', status: 'ready', activeJob: null, parts: [], imageJobs: [], updatedAt: Date.now(), bridgeLastSeen: 0, finishedJobIds: [] };
      return send(res, 200, { session: await write(session) });
    }
    if (path[0] === 'sessions' && path[1]) {
      const session = await read(path[1]); if (!session) return fail(res, 'Không tìm thấy phiên làm việc.', 404);
      if (path.length === 2 && req.method === 'GET') return send(res, 200, { session });
      if (path[2] === 'analysis' && req.method === 'POST') {
        if (session.activeJob && !['completed','error','stopped'].includes(session.activeJob.status)) return fail(res, 'Một tác vụ đang chờ ChatGPT.', 409);
        const script = String(body.script || '').trim(); if (!script) return fail(res, 'Kịch bản không được để trống.');
        session.script = script; session.parts = []; session.lastError = ''; session.status = 'structure_processing'; session.activeJob = { id: newId(), type: 'script_structure', status: 'queued', prompt: structurePrompt(script), protocol: 2 };
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'parts' && path[3] && path[4] === 'analysis' && req.method === 'POST') {
        if (session.activeJob) return fail(res, 'Một tác vụ đang chờ ChatGPT.', 409);
        const part = session.parts.find(item => item.id === path[3]); if (!part) return fail(res, 'Không tìm thấy phần kịch bản.', 404);
        part.status = 'processing'; part.scenes = []; part.analysisText = ''; session.lastError = ''; session.status = 'part_processing'; session.activeJob = { id: newId(), type: 'part_analysis', status: 'queued', prompt: partPrompt(part), partId: part.id, protocol: 2 };
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'images' && req.method === 'POST') {
        if (session.activeJob) return fail(res, 'Hãy hoàn tất hoặc dừng tác vụ đang chạy trước.', 409);
        const style = String(body.stylePrompt || '').trim(); const keys = [...new Set(((body.sceneKeys as unknown[]) || []).map(String))]; if (!style || !keys.length) return fail(res, 'Cần chọn cảnh và nhập prompt phong cách chung.');
        const jobs: Job[] = [];
        for (const key of keys) { const target = findScene(session, key); if (!target.scene?.prompt) continue; const prompt = imagePrompt(style, target.scene, String(body.ratio || '16:9')); target.scene.imageStatus = 'queued'; target.scene.imagePrompt = prompt; target.scene.imageError = ''; jobs.push({ id: newId(), type: 'image_generation', status: 'queued', prompt, partId: target.part?.id, sceneKey: key, protocol: 3 }); }
        if (!jobs.length) return fail(res, 'Các cảnh được chọn chưa có prompt ảnh.');
        session.imageJobs.push(...jobs); nextImage(session); return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'stop' && req.method === 'POST') {
        if (session.activeJob?.type === 'image_generation') { const target = session.activeJob.sceneKey ? findScene(session, session.activeJob.sceneKey) : undefined; if (target?.scene) target.scene.imageStatus = 'stopped'; session.imageJobs = []; }
        else if (session.activeJob?.partId) { const part = session.parts.find(item => item.id === session.activeJob?.partId); if (part) part.status = 'stopped'; }
        session.activeJob = null; session.status = 'stopped'; return send(res, 200, { session: await write(session) });
      }
    }
    if (path[0] === 'bridge' && path[1]) {
      const session = await read(path[1]); if (!session) return fail(res, 'Mã ghép không đúng.', 404);
      if (path[2] === 'ping' && req.method === 'POST') { session.bridgeLastSeen = Date.now(); return send(res, 200, { session: await write(session) }); }
      if (path[2] === 'next' && req.method === 'GET') { const job = session.activeJob; if (!job || !['queued','sending'].includes(job.status)) return send(res, 200, { command: null }); if (!current(job)) { session.activeJob = null; session.status = 'parts_ready'; await write(session); return send(res, 200, { command: null, discarded: true }); } if (job.status === 'queued') { job.status = 'sending'; await write(session); } return send(res, 200, { command: job }); }
      if (path[2] === 'event' && req.method === 'POST') {
        const job = session.activeJob; if (!job) return fail(res, 'Không có tác vụ đang hoạt động.', 404); if (String(body.jobId || '') !== job.id) return fail(res, 'Tác vụ không khớp.', 409);
        const state = String(body.state || ''); const message = String(body.text || '').trim();
        if (state === 'sent') { job.status = 'waiting'; if (job.type === 'image_generation' && job.sceneKey) { const target = findScene(session, job.sceneKey); if (target.scene) target.scene.imageStatus = 'generating'; } return send(res, 200, { session: await write(session) }); }
        if (state === 'error') { if (job.type === 'image_generation') finishImage(session, 'error', '', message || 'ChatGPT không tạo được ảnh.'); else { if (job.partId) { const part = session.parts.find(item => item.id === job.partId); if (part) part.status = 'error'; } session.activeJob = null; session.status = 'error'; session.lastError = message || 'ChatGPT không thể hoàn tất tác vụ.'; } return send(res, 200, { session: await write(session) }); }
        if (state === 'completed' && job.type === 'image_generation') { const url = String(body.imageUrl || ''); if (!/^https?:\/\//.test(url)) return fail(res, 'Không đọc được URL ảnh từ ChatGPT.', 422); finishImage(session, 'complete', url); return send(res, 200, { session: await write(session) }); }
        if (state === 'completed') { try { const parsed = jsonReply(message); if (job.type === 'script_structure') { session.parts = normalizeParts(parsed.parts); session.activeJob = null; session.status = 'parts_ready'; } else { const part = session.parts.find(item => item.id === job.partId); if (!part) throw new Error('Không tìm thấy phần kịch bản.'); part.scenes = normalizeScenes(parsed.scenes); part.analysisText = message; part.status = 'complete'; session.activeJob = null; session.status = 'part_complete'; } return send(res, 200, { session: await write(session) }); } catch (caught) { if (job.partId) { const part = session.parts.find(item => item.id === job.partId); if (part) part.status = 'error'; } session.activeJob = null; session.status = 'error'; session.lastError = caught instanceof Error ? caught.message : 'Không đọc được JSON ChatGPT.'; await write(session); return fail(res, session.lastError, 422); } }
      }
    }
    return fail(res, 'Không tìm thấy API.', 404);
  } catch (caught) { return fail(res, caught instanceof Error ? caught.message : 'Máy chủ gặp lỗi.', 500); }
}

