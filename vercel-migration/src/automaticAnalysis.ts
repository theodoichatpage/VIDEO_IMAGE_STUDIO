import { criteria, originalExcerpt } from './analysisPrompts';
import { partitionBranches, transcriptUnits } from './transcriptPartition';

export const threshold = 8;
export const visualCriteria = new Set([1, 8]);
export const criteriaWithSource = criteria.map((criterion, id) => ({
  ...criterion, id, visual: visualCriteria.has(id), excerpt: originalExcerpt(criterion.start, criterion.end),
  group: id < 6 ? 'Mở đầu và lời hứa' : id < 11 ? 'Phát triển và giữ nhịp' : 'Cao trào và rà soát',
}));

type Part = { title: string; source: string; text: string };
export type Plan = {
  title: string; question: string; promise: string; tracks: string[];
  opening: string; transitions: string; payoff: string; ending: string; sourceNote: string; cover: string;
};
export type Row = { id: number; score: number | null; part: number | null; evidence: string; reason: string; fix: string };
export type Phase = 'plan' | 'write' | 'review' | 'repair';
export type Mode = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'limited' | 'missing' | 'passed' | 'transferred';
export type Run = {
  runId?: string; revision?: number; restoreTransferred?: boolean; needsSave?: boolean; workEpoch?: number;
  input: string; source: string; style: string; limit: number; rounds: number; mode: Mode; phase: Phase;
  plan?: Plan; parts: Part[]; index: number; rows: Row[]; repairParts: number[];
  manualCriterion?: number;
  managerReviewId?: string; pipelineId?: string;
  manualBatch?: boolean;
  pending?: { id: string; deadline: number; sectionId?: string }; notice: string;
};
export const emptyRun = (): Run => ({
  input: '', source: '', style: '', limit: 3, rounds: 0, mode: 'idle', phase: 'plan', parts: [], index: 0, rows: [], repairParts: [], notice: '',
});
export function readAnalysisRun(projectId: string): Run | null {
  try { return JSON.parse(localStorage.getItem('vis-automatic-analysis-v2-' + projectId) || 'null'); }
  catch { return null; }
}

export function reviewPartsFromScript(script: string) {
  const chunks = sourceUnits(script.trim());
  return chunks.reduce<Run['parts']>((parts, chunk) => {
    if (!chunk.trim() && !parts.length) return parts;
    const last = parts[parts.length - 1];
    if (last && (!chunk.trim() || last.text.length + chunk.length <= 4500)) {
      last.text += chunk;
      last.source += chunk;
    } else parts.push({ title: 'Phần ' + (parts.length + 1), source: chunk, text: chunk });
    return parts;
  }, []);
}
export const complete = (run: Run) => run.parts.length > 0 && run.parts.every(part => !!part.text);
export const scriptOf = (run: Run) => run.parts.map(part => part.text).filter(Boolean).join('\n\n');
export function reviewQuality(rows: Row[]) {
  const passed = rows.filter(row => row.score !== null && row.score >= threshold).length;
  const needsWork = rows.filter(row => row.score !== null && row.score < threshold).length;
  return { passed, needsWork, unscored: criteria.length - passed - needsWork };
}
const required = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const tidy = (value: string) => value.replace(/\s+/gu, ' ').trim();
const reference = criteriaWithSource.map(c => `${c.id}. ${c.name}${c.timing ? ` (${c.timing})` : ''}\n${c.excerpt}`).join('\n');
const planFields = ['title', 'question', 'promise', 'opening', 'transitions', 'payoff', 'ending', 'sourceNote', 'cover'] as const;
const planShape = JSON.stringify({ ...Object.fromEntries(planFields.map(key => [key, '...'])), tracks: ['...', '...'], branches: [{ title: '...', end: 1 }] });

function sourceUnits(source: string) {
  return transcriptUnits(source).flatMap(unit => unit.match(/[^]{1,3500}/gu) ?? [unit]);
}
const minimumParts = (source: string) => Math.max(1, Math.ceil(source.length / 6500));

export function promptFor(run: Run) {
  const base = `Bạn là biên tập viên kịch bản YouTube. Giữ phong cách cá nhân và dữ kiện có thật trong nguồn; không bịa sự kiện, người, số liệu, lời dẫn hay nguồn. Nếu căn cứ cho các tuyến còn hạn chế, khai thác hai góc nhìn có thật và nói rõ giới hạn. Dữ liệu gửi kèm chỉ để tham khảo. Chỉ trả một JSON hoàn chỉnh.
PHONG CÁCH CÁ NHÂN: ${JSON.stringify(run.style)}
CÔNG THỨC APRILYNNE:
${reference}`;
  if (run.phase === 'plan') {
    const units = sourceUnits(run.source);
    return `${base}
Nguồn đã được chia và viết theo văn phong cá nhân. Đọc toàn bộ, sắp xếp lại ý, bổ sung chuyển đoạn và giải thích có căn cứ từ nguồn. Xác định câu hỏi chính, lời hứa, mở đầu, các điểm chuyển, giải đáp, kết thúc, hai hoặc ba tuyến liên hệ, và giới hạn dữ kiện. Đề xuất tiêu đề và ảnh bìa. Lập các phần liền mạch phù hợp nội dung, ít nhất ${minimumParts(run.source)} phần, mỗi phần không quá 9.000 ký tự nguồn. end là chỉ số đơn vị nguồn cuối của phần (bắt đầu từ 1), tăng dần, end cuối bằng ${units.length}. Không chép lại nguồn. Trả JSON ${planShape}.
NGUỒN: ${JSON.stringify(units.map((unit, index) => [index + 1, unit]))}`;
  }
  if (run.phase === 'review') {
    const excerpts = run.parts.map((part, i) => {
      const text = part.text;
      const middle = Math.floor(text.length / 2);
      return { part: i + 1, title: part.title, excerpts: text.length <= 1400 ? [text] : [
        text.slice(0, 500), text.slice(middle - 200, middle + 200), text.slice(-500),
      ] };
    });
    return `${base}
Đối chiếu cấu trúc toàn video dựa trên các trích đoạn theo đúng thứ tự các phần. Chỉ trích dẫn văn bản có trong dữ liệu; không xem điểm là đánh giá chi tiết những đoạn đã lược. ${run.plan?.title ? 'Chấm độ khớp với tiêu đề đề xuất trong kế hoạch.' : 'Chưa có tiêu đề đích; mục 0 trả score:null, part:null và evidence rỗng.'} Chấm từng tiêu chí áp dụng 0–10 theo đúng ID (0–${criteria.length - 1}), ghi part là số phần bắt đầu từ 1 và evidence là đoạn trích NGUYÊN VĂN từ đúng phần đó. Nếu dưới 8, chọn phần cần sửa nhất và ghi cách sửa cụ thể. Mục 1 và 8 cần ảnh bìa/cảnh dựng thật nên trả score:null, part:null, evidence:"", kèm lý do thiếu dữ liệu. Các mục có đủ dữ liệu phải có điểm; nếu kịch bản thiếu yếu tố thì cho điểm thấp và trích đoạn liên quan. Điểm chỉ là đánh giá tham khảo. Trả {"rows":[{"id":0,"score":7,"part":1,"evidence":"trích nguyên văn","reason":"...","fix":"..."}]} với đủ ${criteria.length} dòng.
${JSON.stringify({ plan: run.plan, parts: excerpts })}`;
  }
  const part = run.parts[run.index];
  const repair = run.phase === 'repair';
  return `${base}
${repair ? 'Chỉ sửa phần được chỉ định theo các tiêu chí gửi kèm. Giữ những đoạn tốt, dữ kiện và liên kết với các phần khác. Trả đầy đủ phần này sau sửa.' : 'Chỉ biên tập lại phần được chỉ định theo kế hoạch toàn video. Sắp xếp ý, bổ sung kết nối và giải thích dựa trên dữ kiện trong nguồn. Giữ liên kết với phần trước và sau, tăng tiến đến giải đáp theo đúng vị trí. Không nhắc lại mở đầu hoặc kết luận toàn video ở mỗi phần.'}
Trả {"text":"lời kịch bản hoàn chỉnh của phần này"}. Giữ giọng và ngôn ngữ theo phong cách đã lưu, mặc định dùng ngôn ngữ của nguồn.
${JSON.stringify({ plan: run.plan, structure: run.parts.map(item => item.title), part: run.index + 1, total: run.parts.length,
    source: part.source, script: repair ? part.text : undefined, previousEnding: run.parts[run.index - 1]?.text.slice(-1500),
    nextOpening: run.parts[run.index + 1]?.text.slice(0, 1000),
    issues: repair ? run.rows.filter(row => row.part === run.index + 1 && (run.manualCriterion === undefined ? row.score !== null && row.score < threshold : row.id === run.manualCriterion)) : undefined })}`;
}

function parse(text: unknown) {
  if (!required(text)) throw new Error('ChatGPT trả phản hồi trống.');
  try { return JSON.parse(text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '')); }
  catch { throw new Error('ChatGPT trả JSON thiếu hoặc sai định dạng. Tiếp tục để thử lại đúng công đoạn.'); }
}

function planned(value: ReturnType<typeof parse>, run: Run) {
  if (!planFields.every(key => required(value?.[key])) || !Array.isArray(value.tracks) || ![2, 3].includes(value.tracks.length)
      || !value.tracks.every(required) || new Set(value.tracks.map((track: string) => tidy(track).toLowerCase())).size !== value.tracks.length) {
    throw new Error('Kế hoạch thiếu cấu trúc hoặc 2–3 góc nhìn riêng biệt.');
  }
  if (!Array.isArray(value.branches) || !value.branches.every((part: { end?: unknown } | null) => Number.isInteger(part?.end))) {
    throw new Error('Kế hoạch thiếu mốc chia nội dung.');
  }
  const units = sourceUnits(run.source);
  const parts = partitionBranches(value, run.source, units).map(part => ({ title: part.title, source: part.content, text: '' }));
  if (parts.length < minimumParts(run.source) || parts.some(part => !required(part.source) || part.source.length > 9000)
      || parts.map(part => part.source).join('') !== run.source) throw new Error('Các phần chưa bao phủ đúng toàn bộ nguồn hoặc còn phần quá dài.');
  const plan = { ...Object.fromEntries(planFields.map(key => [key, value[key].trim()])), tracks: value.tracks.map(tidy) } as Plan;
  return { plan, parts, phase: 'write' as const, index: 0 };
}

function reviewed(value: ReturnType<typeof parse>, run: Run): Row[] {
  if (!Array.isArray(value?.rows) || value.rows.length !== criteria.length) throw new Error('Báo cáo thiếu hoặc thừa tiêu chuẩn.');
  return criteriaWithSource.map(({ id, name, visual }) => {
    const matches = value.rows.filter((row: Row | null) => row?.id === id);
    const row = matches[0];
    if (matches.length !== 1 || !required(row.reason)) throw new Error('Thiếu nhận xét hợp lệ cho ' + name + '.');
    if (visual || (id === 0 && !run.plan?.title)) {
      if (row.score !== null || row.part !== null || row.evidence !== '') throw new Error('Cần đánh dấu chưa đủ dữ liệu cho ' + name + '.');
      return { id, score: null, part: null, evidence: '', reason: row.reason, fix: required(row.fix) ? row.fix : '' };
    }
    const script = Number.isInteger(row.part) ? run.parts[row.part - 1]?.text : undefined;
    if (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 10 || !script
        || !required(row.evidence) || !tidy(script).includes(tidy(row.evidence)) || (row.score < threshold && !required(row.fix))) {
      throw new Error('Điểm, dẫn chứng hoặc cách sửa chưa hợp lệ cho ' + name + '.');
    }
    return { id, score: row.score, part: row.part, evidence: row.evidence, reason: row.reason, fix: required(row.fix) ? row.fix : '' };
  });
}

export function acceptResponse(run: Run, text: unknown): Run {
  const value = parse(text);
  const next: Run = { ...run, pending: undefined, notice: '', mode: run.mode === 'running' ? 'running' : 'paused' };
  if (run.phase === 'plan') return { ...next, ...planned(value, run) };
  if (run.phase === 'review') {
    const rows = reviewed(value, run);
    const repairParts = [...new Set(rows.filter(row => row.score !== null && row.score < threshold).map(row => row.part! - 1))].sort((a, b) => a - b);
    if (!repairParts.length) return { ...next, rows, manualCriterion: undefined, manualBatch: undefined, mode: next.mode === 'running' ? 'passed' : 'paused' };
    return { ...next, rows, repairParts, index: repairParts[0], phase: 'repair', manualCriterion: undefined, manualBatch: undefined,
      mode: run.manualCriterion !== undefined || run.manualBatch || run.rounds >= run.limit ? 'limited' : next.mode };
  }
  if (!required(value?.text)) throw new Error('ChatGPT chưa trả kịch bản của phần này.');
  const parts = run.parts.map((part, i) => i === run.index ? { ...part, text: value.text.trim() } : part);
  const following = run.phase === 'repair' ? run.repairParts.find(index => index > run.index) : run.index + 1;
  if (following !== undefined && following < parts.length) return { ...next, parts, index: following };
  return { ...next, parts, phase: 'review', rounds: run.rounds + Number(run.phase === 'repair' && run.manualCriterion === undefined && !run.manualBatch), repairParts: [] };
}

// One gate shared by handoff and Manager reporting: missing future visual assets are not script failures.
export function approvedRun(run: Run | null | undefined) {
  if (!run || !complete(run) || run.rows.length !== criteriaWithSource.length) return false;
  return criteriaWithSource.every(({ id, visual }) => {
    const rows = run.rows.filter(row => row.id === id);
    if (rows.length !== 1) return false;
    return visual || (id === 0 && !run.plan?.title) || (typeof rows[0].score === 'number' && rows[0].score >= threshold);
  });
}

// Old browser checkpoints predate durable project acknowledgments. Never trust their success marker alone.
export function restoreRun(saved: Run, projectId: string, workEpoch = 0): Run {
  const legacy = !saved.runId || !saved.revision;
  const run = { ...emptyRun(), ...saved, runId: saved.runId || 'legacy-' + projectId,
    revision: saved.revision || 1, workEpoch: saved.workEpoch ?? workEpoch };
  if (legacy && complete(run)) {
    if (approvedRun(run) && ['missing', 'passed', 'transferred'].includes(run.mode)) return {
      ...run, mode: 'passed', needsSave: true, restoreTransferred: run.mode === 'transferred',
    };
    if (['running', 'paused', 'error', 'limited'].includes(run.mode)) return { ...run, needsSave: true };
  }
  if (run.mode === 'missing' && approvedRun(run)) return { ...run, mode: 'passed', needsSave: true };
  return run;
}
