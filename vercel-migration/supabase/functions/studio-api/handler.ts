type RequestLike = { method?: string; query: { path?: string | string[] }; body?: unknown; headers: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string): void; status(code: number): { json(value: unknown): void } };

type Scene = { title: string; backdrop: string; content: string; character: string; emotion: string; shot: string; image: string; prompt: string; imageStatus?: string; imageResults?: { url: string; prompt: string; createdAt: number; storagePath?: string; expiresAt?: number; jobId?: string }[]; imagePrompt?: string; imageError?: string };
type Part = { id: string; title: string; range: string; content: string; status: string; scenes: Scene[]; analysisText: string; receivedAt?: number };
type Job = { id: string; type: 'script_structure' | 'part_analysis' | 'image_generation'; status: string; prompt: string; partId?: string; sceneKey?: string; protocol: 2 | 3; expiresAt?: number };
type Session = { id: string; script: string; status: string; activeJob: Job | null; lastJob?: Job; parts: Part[]; imageJobs: Job[]; imageCaptures?: Job[]; updatedAt: number; bridgeLastSeen?: number; finishedJobIds?: string[]; lastError?: string; analysisQueue?: string[]; batchAnalysis?: boolean; stylePrompt?: string; separations?: Record<string, unknown>[]; analysisBackup?: { script: string; parts: Part[]; savedAt: number } };

const idOk = (value: string) => /^[A-Za-z0-9-]{16,64}$/.test(value);
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const partId = () => 'part_' + Math.random().toString(36).slice(2, 9);
const sceneKey = (part: string, index: number) => part + ':' + index;
const send = (res: ResponseLike, code: number, value: unknown) => res.status(code).json(value);
const fail = (res: ResponseLike, message: string, code = 400) => send(res, code, { error: message });

function settings() {
  const runtime = globalThis as { Deno?: { env: { get(name: string): string | undefined } }; process?: { env?: Record<string, string | undefined> } };
  const get = (name: string) => runtime.Deno?.env.get(name) || runtime.process?.env?.[name];
  const secrets = get('SUPABASE_SECRET_KEYS');
  let defaultSecret = '';
  try { defaultSecret = secrets ? String(JSON.parse(secrets).default || '') : ''; } catch { defaultSecret = ''; }
  const url = get('SUPABASE_URL');
  const key = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY') || defaultSecret;
  if (!url || !key) throw new Error('Thiếu cấu hình Supabase.');
  return { url: url.replace(/\/$/, ''), key };
}
async function database(path: string, init?: RequestInit) {
  const { url, key } = settings();
  const result = await fetch(url + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!result.ok) throw new Error(await result.text());
  const text = await result.text();
  return text.trim() ? JSON.parse(text) : null;
}

async function storage(path: string, init: RequestInit = {}) {
  const { url, key } = settings();
  const response = await fetch(url + '/storage/v1/' + path, { ...init, headers: { apikey: key, Authorization: 'Bearer ' + key, ...(init.headers || {}) } });
  if (!response.ok) throw new Error('Không lưu được tệp ảnh: ' + await response.text());
  return response.json();
}
async function signImage(path: string) {
  const signed = await storage('object/sign/studio-images/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 604800 }) });
  return { url: settings().url + '/storage/v1' + signed.signedURL, expiresAt: Date.now() + 604800000 };
}
async function saveImage(session: Session, job: Job, value: unknown) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match || match[2].length > 11200000) throw new Error('Cần Extension 0.4.16 để chuyển tệp ảnh thật về web. Hãy cập nhật rồi Đồng bộ lại ảnh.');
  const raw = atob(match[2]); const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const valid = match[1] === 'png' ? bytes[0] === 137 && raw.slice(1, 4) === 'PNG' : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 : raw.startsWith('RIFF') && raw.slice(8,12) === 'WEBP';
  if (!valid) throw new Error('Tệp ảnh nhận được không hợp lệ.');
  try { await storage('bucket/studio-images'); } catch {
    try { await storage('bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'studio-images', name: 'studio-images', public: false, file_size_limit: 8388608, allowed_mime_types: ['image/png','image/jpeg','image/webp'] }) }); }
    catch { await storage('bucket/studio-images'); }
  }
  const path = session.id + '/' + job.id + '.' + match[1];
  await storage('object/studio-images/' + path, { method: 'POST', headers: { 'Content-Type': 'image/' + match[1], 'x-upsert': 'true' }, body: bytes });
  return { ...await signImage(path), storagePath: path, prompt: job.prompt, createdAt: Date.now(), jobId: job.id };
}

async function read(id: string): Promise<Session | null> {
  const rows = await database('studio_sessions?id=eq.' + encodeURIComponent(id) + '&select=record') as { record: Session }[];
  const value = rows?.[0]?.record;
  if (!value) return null;
  const parts = (value.parts || []).map(part => {
    if (part.status !== 'error' || !part.scenes?.length || !part.analysisText) return part;
    try {
      const parsed = jsonReply(part.analysisText);
      return Array.isArray(parsed.scenes) && parsed.scenes.length === part.scenes.length ? { ...part, status: 'complete' } : part;
    } catch { return part; }
  });
  for (const part of parts) for (const scene of part.scenes || []) for (const image of scene.imageResults || []) {
    if (!image.storagePath && /^https:\/\/chatgpt\.com\/backend-api\//.test(image.url)) { scene.imageStatus = 'error'; scene.imageError = 'Ảnh cũ là liên kết ChatGPT cần đăng nhập. Bấm Đồng bộ lại ảnh để lưu tệp về web.'; }
    if (image.storagePath && (!image.expiresAt || image.expiresAt < Date.now() + 3600000)) Object.assign(image, await signImage(image.storagePath));
  }
  const savedLayers = await database('studio_separations?session_id=eq.' + encodeURIComponent(id) + '&select=entry,updated_at&order=updated_at.asc') as { entry?: Record<string, unknown>; updated_at?: number }[];
  const separations = (savedLayers || []).flatMap(item => item.entry ? [item.entry] : []);
  const updatedAt = Math.max(value.updatedAt || 0, ...(savedLayers || []).map(item => Number(item.updated_at) || 0));
  return { ...value, updatedAt, separations, parts, imageJobs: value.imageJobs || [], finishedJobIds: value.finishedJobIds || [] };
}
async function write(session: Session) {
  session.updatedAt = Date.now();
  await database('studio_sessions?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: session.id, record: session }) });
  return session;
}
// Capturing an existing image must not replace a different running job.
// Commit only onto a fresh record; retry if another task updated it during upload.
async function commitImageCapture(id: string, job: Job, image: Awaited<ReturnType<typeof saveImage>>) {
  for (let attempt=0;attempt<5;attempt++) {
    const rows=await database('studio_sessions?id=eq.'+encodeURIComponent(id)+'&select=record') as {record:Session}[];
    const fresh=rows?.[0]?.record;if(!fresh)throw new Error('Không tìm thấy dự án nhận ảnh.');
    const ticket=fresh.imageCaptures?.find(item=>item.id===job.id);
    const target=findScene(fresh,String(job.sceneKey));
    if(!ticket||!target.scene||ticket.prompt!==(target.scene.imagePrompt||target.scene.imageResults?.[0]?.prompt))return {session:await read(id),ignored:true};
    const previous=fresh.updatedAt;
    target.scene.imageResults=[image];target.scene.imageStatus='complete';target.scene.imageError='';
    fresh.imageCaptures=(fresh.imageCaptures||[]).filter(item=>item.id!==job.id);
    fresh.finishedJobIds=[...(fresh.finishedJobIds||[]),job.id].slice(-200);
    fresh.updatedAt=Math.max(Date.now(),previous+1);
    const saved=await database('studio_sessions?id=eq.'+encodeURIComponent(id)+'&record->>updatedAt=eq.'+encodeURIComponent(String(previous)),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({record:fresh})}) as unknown[];
    if(saved?.length)return {session:await read(id)};
  }
  throw new Error('Dự án vừa được cập nhật bởi tác vụ khác. Tệp ảnh vẫn được tiện ích giữ và sẽ gửi lại.');
}

function structurePrompt(script: string) {
  return 'Bạn là biên tập viên kịch bản. Hãy đọc TOÀN BỘ kịch bản và chia thành số phần HỢP LÝ theo mạch nội dung, không cố định 5 phần. Mục tiêu là mỗi phần đủ ngắn để bước sau phân tích thành phân cảnh chi tiết, nhưng tuyệt đối không cắt giữa một ý, sự kiện hoặc đoạn kể đang liền mạch. Chỉ trả MỘT JSON hợp lệ, không markdown, đúng dạng: {"parts":[{"title":"Phần 1 - tên ngắn","range":"mô tả phạm vi nội dung","content":"nguyên văn đầy đủ nội dung thuộc phần này"}]}. Phải bao phủ toàn bộ kịch bản theo đúng thứ tự, không bỏ sót, không viết lại nội dung. KỊCH BẢN:\n' + script;
}
function partPrompt(part: Part) {
  return 'CHẾ ĐỘ PHÂN TÍCH VĂN BẢN. KHÔNG TẠO ẢNH, không gọi công cụ tạo ảnh. Chỉ viết JSON, các prompt là dữ liệu văn bản để dùng ở bước sau.\n' + sceneAnalysisPrompt(part);
}
function sceneAnalysisPrompt(part: Part) {
  return 'Bạn là đạo diễn hình ảnh. Chỉ trả MỘT JSON hợp lệ, không markdown: {"scenes":[{"title":"Cảnh 1 - tên rất ngắn","backdrop":"bối cảnh riêng của cảnh","content":"hành động/sự kiện riêng của cảnh","character":"nhân vật xuất hiện, tư thế hoặc biểu cảm riêng","emotion":"cảm xúc riêng","shot":"góc máy, cỡ cảnh, hướng nhìn riêng","image":"mô tả hình ảnh ngắn bằng tiếng Việt","prompt":"English scene prompt only: subject/action + character details for this scene + setting + camera framing"}]}. Từ nội dung Phần này, tách thành các cảnh dùng tạo ảnh YouTube. Mỗi cảnh có góc máy điện ảnh khác nhau. PROMPT CẢNH chỉ chứa nội dung riêng của cảnh, nhân vật/bối cảnh và góc máy; không chứa phong cách chung, ánh sáng, chất liệu hoặc tỷ lệ. PHẦN: ' + part.title + '\nNỘI DUNG:\n' + part.content;
}
function current(job: Job | null | undefined) { return Boolean(job && ((job.protocol === 2 && job.type !== 'image_generation') || (job.protocol === 3 && job.type === 'image_generation'))); }
function beginPart(session: Session, part: Part) {
  part.status = 'processing'; part.scenes = []; part.analysisText = ''; delete part.receivedAt;
  session.lastError = ''; session.status = 'part_processing';
  session.activeJob = { id: newId(), type: 'part_analysis', status: 'queued', prompt: partPrompt(part), partId: part.id, protocol: 2 };
}
function nextAnalysis(session: Session) {
  if (!session.batchAnalysis || session.activeJob) return;
  while (session.analysisQueue?.length) {
    const id = session.analysisQueue.shift();
    const part = session.parts.find(item => item.id === id);
    if (part && part.status !== 'complete') { beginPart(session, part); return; }
  }
  session.batchAnalysis = false; session.analysisQueue = [];
}
function pauseAnalysis(session: Session) { session.batchAnalysis = false; session.analysisQueue = []; }
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
function jsonReply(text: string): Record<string, unknown> {
  const source = String(text || '').replace(/[\u200B\uFEFF]/g, '');
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < source.length; end += 1) {
      const char = source[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(source.slice(start, end + 1));
        if (parsed && (Array.isArray(parsed.parts) || Array.isArray(parsed.scenes))) return parsed;
      } catch {}
      break;
    }
  }
  throw new Error('JSON chưa đầy đủ hoặc không hợp lệ. Hãy sao chép toàn bộ câu trả lời từ dấu { đầu đến dấu } cuối.');
}
function normalizeParts(value: unknown): Part[] {
  if (!Array.isArray(value) || !value.length) throw new Error('ChatGPT chưa trả về danh sách parts.');
  return value.slice(0, 30).map((item, index) => { const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}; const content = String(row.content || '').trim(); if (!content) throw new Error('Một phần kịch bản không có nội dung.'); return { id: partId(), title: String(row.title || 'Phần ' + (index + 1)), range: String(row.range || 'Phần ' + (index + 1)), content, status: 'ready', scenes: [], analysisText: '' }; });
}
function normalizeScenes(value: unknown): Scene[] {
  if (!Array.isArray(value) || !value.length) throw new Error('ChatGPT chưa trả về scenes.');
  return value.slice(0, 30).map((item, index) => { const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}; return { title: String(row.title || 'Cảnh ' + (index + 1)), backdrop: String(row.backdrop || 'Theo kịch bản'), content: String(row.content || ''), character: String(row.character || 'Theo kịch bản'), emotion: String(row.emotion || 'Theo ngữ cảnh'), shot: String(row.shot || 'Góc máy điện ảnh'), image: String(row.image || 'Theo nội dung cảnh'), prompt: String(row.prompt || ''), imageStatus: 'waiting', imageResults: [] }; });
}
function imagePrompt(style: string, scene: Scene, _ratio: string) { const template = style.trim(); const scenePrompt = scene.prompt.trim(); if (template.includes('{{SCENE_PROMPT}}')) return template.replaceAll('{{SCENE_PROMPT}}', scenePrompt); return ['SCENE:\n' + scenePrompt, template].filter(Boolean).join('\n\n'); }

function separationMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 256000) throw new Error('Metadata kết quả tách ảnh không hợp lệ.');
  const row = value as Record<string, unknown>;
  const token = (v: unknown) => { const text = String(v || ''); if (!/^[a-f0-9]{32}$/.test(text)) throw new Error('Mã job/engine không hợp lệ.'); return text; };
  const dimension = (v: unknown, min = 1) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > 16000000) throw new Error('Kích thước lớp không hợp lệ.'); return v; };
  const file = (v: unknown) => { const text = String(v || ''); if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}\.png$/.test(text)) throw new Error('Mã file PNG không hợp lệ.'); return text; };
  const width = dimension(row.width), height = dimension(row.height);
  if (width * height > 16000000 || !Array.isArray(row.layers) || !row.layers.length || row.layers.length > 500) throw new Error('Danh sách lớp không hợp lệ.');
  const seen = new Set<string>();
  const layers = row.layers.map((value: unknown) => {
    const item = (value || {}) as Record<string, unknown>; const fileId = file(item.fileId);
    if (seen.has(fileId) || !['background','person','text'].includes(String(item.kind)) || !['original','filled'].includes(String(item.role))) throw new Error('Lớp tách ảnh không hợp lệ.');
    seen.add(fileId);
    const x = dimension(item.x, 0), y = dimension(item.y, 0), w = dimension(item.width), h = dimension(item.height);
    if (x + w > width || y + h > height) throw new Error('Vị trí lớp nằm ngoài ảnh gốc.');
    return { fileId, file: fileId, title: String(item.title || fileId).slice(0,160), kind: String(item.kind), role: String(item.role), x, y, width:w, height:h };
  });
  const options = (row.options || {}) as Record<string, unknown>;
  if (['people','text','fill'].some(key => typeof options[key] !== 'boolean')) throw new Error('Tùy chọn tách ảnh không hợp lệ.');
  return { jobId: token(row.jobId), engineId: token(row.engineId), sourceName: String(row.sourceName || 'image.png').slice(0,160), sourceSceneKey: /^[A-Za-z0-9_]+:[0-9]+$/.test(String(row.sourceSceneKey || '')) ? String(row.sourceSceneKey) : undefined,
    createdAt: typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) && row.createdAt > 0 ? row.createdAt : Date.now(), width, height, layers, exactReconstruction: row.exactReconstruction === true, backgroundFilled: row.backgroundFilled === true,
    warnings: Array.isArray(row.warnings) ? row.warnings.slice(0,20).map(item => String(item).slice(0,1000)) : [], options: { people: options.people, text: options.text, fill: options.fill }, files: { original:'anh_goc.png',composite:'ghep_lai.png',zip:'cac_lop.zip',positions:'vi_tri.json' } };
}

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
      const session = await read(path[1]);
      if (path.length === 2 && req.method === 'GET') return send(res, 200, { session: session });
      if (!session) return fail(res, 'Không tìm thấy phiên làm việc.', 404);
      if (path[2] === 'separations' && path.length === 3 && req.method === 'POST') {
        let entry;
        try { entry = separationMetadata(body.result); }
        catch (error) { return fail(res, error instanceof Error ? error.message : 'Kết quả tách ảnh không hợp lệ.', 422); }
        // Atomically append metadata only; never rewrite an in-flight analysis/image job.
        await database('rpc/studio_save_separation', { method: 'POST', body: JSON.stringify({ session_id: session.id, entry }) });
        return send(res, 200, { session: await read(session.id) });
      }
      if (path[2] === 'analysis' && req.method === 'POST') {
        if (session.activeJob && !['completed','error','stopped'].includes(session.activeJob.status)) return fail(res, 'Một tác vụ đang chờ ChatGPT.', 409);
        const script = String(body.script || '').trim(); if (!script) return fail(res, 'Kịch bản không được để trống.');
        if (session.parts.length && body.confirmReset !== true) return fail(res, 'Kịch bản đã được phân tích. Muốn làm lại, hãy dùng Phân tích lại toàn bộ và xác nhận.', 409);
        if (session.parts.length) session.analysisBackup = { script: session.script, parts: structuredClone(session.parts), savedAt: Date.now() };
        pauseAnalysis(session);
        session.script = script; session.parts = []; session.lastError = ''; session.status = 'structure_processing'; session.activeJob = { id: newId(), type: 'script_structure', status: 'queued', prompt: structurePrompt(script), protocol: 2 };
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'parts' && path[3] === 'batch' && path.length === 4 && req.method === 'POST') {
        if (session.activeJob && session.activeJob.type !== 'part_analysis') return fail(res, 'Hãy hoàn tất hoặc dừng tác vụ hiện tại trước.', 409);
        if (!session.parts.length) return fail(res, 'Hãy chia kịch bản thành các phần trước.', 409);
        session.analysisQueue = session.parts.filter(part => part.status !== 'complete' && part.id !== session.activeJob?.partId).map(part => part.id);
        session.batchAnalysis = Boolean(session.activeJob || session.analysisQueue.length);
        nextAnalysis(session);
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'parts' && path[3] && path[4] === 'analysis' && req.method === 'POST') {
        if (session.activeJob) return fail(res, 'Một tác vụ đang chờ ChatGPT.', 409);
        const part = session.parts.find(item => item.id === path[3]); if (!part) return fail(res, 'Không tìm thấy phần kịch bản.', 404);
        pauseAnalysis(session); beginPart(session, part);
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'parts' && path[3] && path[4] === 'reset' && req.method === 'POST') {
        const part = session.parts.find(item => item.id === path[3]);
        if (!part) return fail(res, 'Không tìm thấy phần kịch bản.', 404);
        if (session.activeJob?.partId === part.id || part.scenes.length || part.status !== 'error') return fail(res, 'Chỉ có thể đặt lại phần lỗi cũ chưa có kết quả và không đang xử lý.', 409);
        part.status = 'ready';
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'parts' && path[3] && path[4] === 'recover' && req.method === 'POST') {
        const part = session.parts.find(item => item.id === path[3]);
        if (!part) return fail(res, 'Không tìm thấy phần cần đồng bộ.', 404);
        if (session.activeJob) {
          if (session.activeJob.type === 'part_analysis' && session.activeJob.partId === part.id) return send(res, 200, { session });
          return fail(res, 'Một phần khác đang xử lý. Hãy hoàn tất hoặc dừng phần đó trước.', 409);
        }
        if (part.status === 'complete' && part.scenes.length) return send(res, 200, { session });
        part.status = 'processing'; session.status = 'part_processing'; session.lastError = '';
        // Waiting means receive an existing response only; never dispatch another ChatGPT prompt.
        session.activeJob = { id: newId(), type: 'part_analysis', status: 'waiting', prompt: partPrompt(part), partId: part.id, protocol: 2 };
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'parts' && path[3] && path[4] === 'result' && req.method === 'POST') {
        const part = session.parts.find(item => item.id === path[3]);
        if (!part) return fail(res, 'Không tìm thấy phần nhận kết quả.', 404);
        if (part.status === 'complete' && part.scenes.length) return fail(res, 'Phần này đã có kết quả. Hãy chọn đúng phần đang thiếu.', 409);
        const job = session.activeJob;
        if (job && (job.type !== 'part_analysis' || job.partId !== part.id || String(body.expectedJobId || '') !== job.id)) return fail(res, 'Tác vụ đã thay đổi. Hãy đóng cửa sổ này, chọn đúng phần và mở Dán JSON kết quả lại.', 409);
        let parsed: Record<string, unknown>;
        let scenes: Scene[];
        try {
          parsed = jsonReply(String(body.text || ''));
          if (!Array.isArray(parsed.scenes) || !parsed.scenes.length || parsed.scenes.length > 30 || parsed.scenes.some(item => !item || typeof item !== 'object' || !String((item as Record<string, unknown>).prompt || '').trim())) throw new Error('Cần JSON scenes có từ 1 đến 30 cảnh và prompt riêng cho mỗi cảnh.');
          scenes = normalizeScenes(parsed.scenes);
        } catch (caught) { return fail(res, caught instanceof Error ? caught.message : 'Không đọc được JSON phân cảnh.', 422); }
        part.scenes = scenes; part.analysisText = JSON.stringify(parsed); part.status = 'complete';
        if (job) {
          session.finishedJobIds = [...(session.finishedJobIds || []), job.id].slice(-200);
          session.lastJob = { ...job, status: 'completed' };
        }
        session.activeJob = null; session.status = 'part_complete'; session.lastError = ''; nextAnalysis(session);
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'settings' && req.method === 'POST') {
        session.stylePrompt = String(body.stylePrompt || '');
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'script' && req.method === 'POST') {
        if (session.activeJob) return fail(res, 'Hãy hoàn tất hoặc dừng tác vụ đang chạy trước.', 409);
        session.script = String(body.script || '').trim();
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'images' && path[3] === 'capture' && req.method === 'POST') {
        const key=String(body.sceneKey||'');
        for(let attempt=0;attempt<5;attempt++){
          const rows=await database('studio_sessions?id=eq.'+encodeURIComponent(session.id)+'&select=record') as {record:Session}[];
          const fresh=rows?.[0]?.record;if(!fresh)return fail(res,'Không tìm thấy dự án.',404);
          const target=findScene(fresh,key);if(!target.scene)return fail(res,'Không tìm thấy cảnh cần nhận ảnh.',422);
          if(fresh.activeJob?.type==='image_generation'&&fresh.activeJob.sceneKey===key)return send(res,200,{session:await read(fresh.id),command:fresh.activeJob});
          const prompt=target.scene.imagePrompt||target.scene.imageResults?.[0]?.prompt;
          if(!prompt)return fail(res,'Cảnh này chưa có lệnh tạo ảnh để đối chiếu với ChatGPT.',422);
          fresh.imageCaptures=(fresh.imageCaptures||[]).filter(item=>(item.expiresAt||0)>Date.now());
          const existing=fresh.imageCaptures.find(item=>item.sceneKey===key&&item.prompt===prompt);
          if(existing)return send(res,200,{session:await read(fresh.id),command:existing});
          const command:Job={id:newId(),type:'image_generation',status:'waiting',prompt,sceneKey:key,partId:target.part?.id,protocol:3,expiresAt:Date.now()+600000};
          fresh.imageCaptures=[...fresh.imageCaptures.filter(item=>item.sceneKey!==key).slice(-9),command];
          const previous=fresh.updatedAt;fresh.updatedAt=Math.max(Date.now(),previous+1);
          const saved=await database('studio_sessions?id=eq.'+encodeURIComponent(fresh.id)+'&record->>updatedAt=eq.'+encodeURIComponent(String(previous)),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({record:fresh})}) as unknown[];
          if(saved?.length)return send(res,200,{session:await read(fresh.id),command});
        }
        return fail(res,'Dự án đang được cập nhật. Hãy bấm Đồng bộ lại ảnh sau vài giây.',409);
      }

      if (path[2] === 'images' && path[3] === 'recover' && req.method === 'POST') {
        if (session.activeJob) return fail(res, 'Hãy hoàn tất hoặc dừng tác vụ đang chạy trước.', 409);
        const key = String(body.sceneKey || ''); const target = findScene(session, key);
        const prompt = target.scene?.imageResults?.[0]?.prompt || target.scene?.imagePrompt;
        if (!target.scene || !prompt) return fail(res, 'Cảnh này chưa có lệnh tạo ảnh để tìm lại.', 422);
        session.activeJob = { id: newId(), type: 'image_generation', status: 'waiting', prompt, sceneKey: key, partId: target.part?.id, protocol: 3 };
        target.scene.imageStatus = 'generating'; target.scene.imageError = ''; session.status = 'image_processing';
        return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'images' && path.length === 3 && req.method === 'POST') {
        if (session.activeJob) return fail(res, 'Hãy hoàn tất hoặc dừng tác vụ đang chạy trước.', 409);
        const style = String(body.stylePrompt || '').trim(); const keys = [...new Set(((body.sceneKeys as unknown[]) || []).map(String))]; if (!style || !keys.length) return fail(res, 'Cần chọn cảnh và nhập prompt phong cách chung.');
        const jobs: Job[] = [];
        for (const key of keys) { const target = findScene(session, key); if (!target.scene?.prompt) continue; const prompt = imagePrompt(style, target.scene, String(body.ratio || '16:9')); target.scene.imageStatus = 'queued'; target.scene.imagePrompt = prompt; target.scene.imageError = ''; jobs.push({ id: newId(), type: 'image_generation', status: 'queued', prompt, partId: target.part?.id, sceneKey: key, protocol: 3 }); }
        if (!jobs.length) return fail(res, 'Các cảnh được chọn chưa có prompt ảnh.');
        session.stylePrompt = style; session.imageJobs.push(...jobs); nextImage(session); return send(res, 200, { session: await write(session) });
      }
      if (path[2] === 'stop' && req.method === 'POST') {
        pauseAnalysis(session);
        if (session.activeJob) session.lastJob = { ...session.activeJob, status: 'stopped' };
        if (session.activeJob) session.finishedJobIds = [...(session.finishedJobIds || []), session.activeJob.id].slice(-200);
        if (session.activeJob?.type === 'image_generation') { const target = session.activeJob.sceneKey ? findScene(session, session.activeJob.sceneKey) : undefined; if (target?.scene) target.scene.imageStatus = 'stopped'; session.imageJobs = []; }
        else if (session.activeJob?.partId) { const part = session.parts.find(item => item.id === session.activeJob?.partId); if (part) part.status = 'stopped'; }
        session.activeJob = null; session.status = 'stopped'; return send(res, 200, { session: await write(session) });
      }
    }
    if (path[0] === 'bridge' && path[1]) {
      const session = await read(path[1]); if (!session) return fail(res, 'Mã ghép không đúng.', 404);
      if (path[2] === 'ping' && req.method === 'POST') { session.bridgeLastSeen = Date.now(); await database('rpc/studio_touch_session', { method: 'POST', body: JSON.stringify({ session_id: session.id, seen_at: session.bridgeLastSeen }) }); return send(res, 200, { session: await read(session.id) }); }
      if (path[2] === 'next' && req.method === 'GET') { const job = session.activeJob; if (!job || !['queued','sending'].includes(job.status)) return send(res, 200, { command: null }); if (!current(job)) { session.activeJob = null; session.status = 'parts_ready'; await write(session); return send(res, 200, { command: null, discarded: true }); } if (job.status === 'queued') { job.status = 'sending'; await write(session); } return send(res, 200, { command: job }); }
      if (path[2] === 'event' && req.method === 'POST') {
        const eventJobId = String(body.jobId || '');
        const capture=session.imageCaptures?.find(item=>item.id===eventJobId);
        if(capture){
          if(body.state!=='completed')return fail(res,'Yêu cầu này chỉ nhận ảnh đã tạo, không tạo ảnh mới.',422);
          if((capture.expiresAt||0)<Date.now())return send(res,200,{session,acknowledged:true,ignored:true});
          try{return send(res,200,await commitImageCapture(session.id,capture,await saveImage(session,capture,body.imageDataUrl)));}
          catch(error){return fail(res,error instanceof Error?error.message:'Không lưu được ảnh đúng cảnh.',422);}
        }
        let job = session.activeJob;
        if (!job && body.state === 'completed' && session.lastJob?.id === eventJobId && session.lastJob.status === 'error' && session.lastJob.type !== 'image_generation') {
          job = { ...session.lastJob, status: 'waiting' };
          session.activeJob = job;
          session.finishedJobIds = (session.finishedJobIds || []).filter(id => id !== eventJobId);
        }
        if (session.finishedJobIds?.includes(eventJobId) || !job || eventJobId !== job.id) return send(res, 200, { session, acknowledged: true, ignored: true });
        const state = String(body.state || ''); const message = String(body.text || '').trim();
        if (state === 'progress' && job.type === 'part_analysis') {
          const parsed = jsonReply(message);
          const raw = parsed.scenes;
          if (!Array.isArray(raw) || raw.length > 30 || raw.some(scene => !scene || !String(scene.prompt || '').trim())) return fail(res, 'Dữ liệu cảnh đang đồng bộ chưa hợp lệ.', 422);
          const part = session.parts.find(item => item.id === job.partId);
          if (!part) return fail(res, 'Không tìm thấy phần đang nhận cảnh.', 404);
          if (raw.length <= part.scenes.length) return send(res, 200, { session, acknowledged: true, ignored: true });
          part.scenes = normalizeScenes(raw); part.status = 'processing'; part.receivedAt = Date.now();
          job.status = 'waiting';
          return send(res, 200, { session: await write(session) });
        }
        let savedImage;
        if (state === 'completed' && job.type === 'image_generation') {
          try { savedImage = await saveImage(session, job, body.imageDataUrl); }
          catch (error) { return fail(res, error instanceof Error ? error.message : 'Không lưu được ảnh.', 422); }
        }
        if (['completed', 'error'].includes(state)) {
          session.finishedJobIds = [...(session.finishedJobIds || []), job.id].slice(-200);
          session.lastJob = { ...job, status: state };
        }
        if (state === 'sent') { job.status = 'waiting'; if (job.type === 'image_generation' && job.sceneKey) { const target = findScene(session, job.sceneKey); if (target.scene) target.scene.imageStatus = 'generating'; } return send(res, 200, { session: await write(session) }); }
        if (state === 'error') { pauseAnalysis(session); if (job.type === 'image_generation') finishImage(session, 'error', '', message || 'ChatGPT không tạo được ảnh.'); else { if (job.partId) { const part = session.parts.find(item => item.id === job.partId); if (part) part.status = 'error'; } session.activeJob = null; session.status = 'error'; session.lastError = message || 'ChatGPT không thể hoàn tất tác vụ.'; } return send(res, 200, { session: await write(session) }); }
        if (state === 'completed' && job.type === 'image_generation' && savedImage) {
          const target = findScene(session, String(job.sceneKey));
          finishImage(session, 'complete', savedImage.url);
          if (target.scene) target.scene.imageResults = [savedImage];
          return send(res, 200, { session: await write(session) });
        }
        if (state === 'completed') { try { const parsed = jsonReply(message); if (job.type === 'script_structure') { session.parts = normalizeParts(parsed.parts); session.activeJob = null; session.status = 'parts_ready'; } else { const part = session.parts.find(item => item.id === job.partId); if (!part) throw new Error('Không tìm thấy phần kịch bản.'); part.scenes = normalizeScenes(parsed.scenes); part.analysisText = message; part.status = 'complete'; session.activeJob = null; session.status = 'part_complete'; nextAnalysis(session); } return send(res, 200, { session: await write(session) }); } catch (caught) { pauseAnalysis(session); if (job.partId) { const part = session.parts.find(item => item.id === job.partId); if (part) part.status = 'error'; } session.activeJob = null; session.status = 'error'; session.lastError = caught instanceof Error ? caught.message : 'Không đọc được JSON ChatGPT.'; await write(session); return fail(res, session.lastError, 422); } }
      }
    }
    return fail(res, 'Không tìm thấy API.', 404);
  } catch (caught) { return fail(res, caught instanceof Error ? caught.message : 'Máy chủ gặp lỗi.', 500); }
}



