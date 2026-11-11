import { criteria, originalExcerpt } from './analysisPrompts';
import { partitionBranches, transcriptUnits } from './transcriptPartition';

export const threshold = 8;
export const MAX_ROUNDS = 6;
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
// 'checked': a review-only run of the script already on the server (the project has parts): scores shown, nothing rewritten or saved.
export type Mode = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'limited' | 'missing' | 'passed' | 'transferred' | 'checked';
export type Run = {
  runId?: string; revision?: number; restoreTransferred?: boolean; needsSave?: boolean; workEpoch?: number;
  input: string; source: string; style: string; limit: number; rounds: number; mode: Mode; phase: Phase;
  plan?: Plan; parts: Part[]; index: number; rows: Row[]; repairParts: number[];
  manualCriterion?: number;
  managerReviewId?: string; pipelineId?: string;
  manualBatch?: boolean;
  pending?: { id: string; deadline: number; sectionId?: string; extended?: number }; notice: string;
  // The version with the most criteria passed so far: kept when the repair rounds run out, so repairs never leave a worse script.
  best?: { passed: number; total?: number; parts: Part[]; rows: Row[]; plan?: Plan; findings?: Row[] };
  // ChatGPT replies rejected by the strict check in a row, and why the last one was rejected (told to ChatGPT on the next try).
  invalid?: number; lastInvalid?: string;
  // A long script is reviewed in short steps (opening, the body chunk by chunk in full, ending): the step being asked and the rows already received.
  reviewStep?: number; partial?: Row[];
  // Weak parts seen by the other body chunks (the main row keeps the worst one): repaired too, not only the one part a row names.
  findings?: Row[];
  // Review only: score the script without rewriting it (its parts and scenes already exist).
  reviewOnly?: boolean;
  // Score of every finished review, so the tab shows whether the repairs raised it.
  history?: { round: number; passed: number; total: number }[];
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
// The report graded another script than the one saved on the server (e.g. AI MANAGER rewrote and saved it after this review).
// A run stopped on an error may still hold its unanswered ChatGPT job: that does not count as working.
export function staleReport(run: Run, serverScript?: string) {
  const flat = (text: string) => text.replace(/\s+/gu, ' ').trim();
  const halted = ['error', 'stopped', 'paused'].includes(run.mode);
  if (run.mode === 'running' || (run.pending && !halted) || (run.needsSave && !halted)) return false;
  return run.rows.length > 0 && Boolean(serverScript?.trim()) && flat(scriptOf(run)) !== flat(serverScript!);
}
export const totalScore =(rows: Row[]) => rows.reduce((sum, row) => sum + (row.score ?? 0), 0);
// Not worse than the best so far: more criteria passed, or as many with at least the same total (a repair lifting 6 to 7.5 counts; a tie keeps the newer text).
const beats = (rows: Row[], best: Run['best']) => !best
  || reviewQuality(rows).passed > best.passed
  || (reviewQuality(rows).passed === best.passed && totalScore(rows) >= (best.total ?? totalScore(best.rows)));

// Long scripts: one review of every part made ChatGPT answer after the 30-minute wait (Thái sư: 55 parts). Short steps instead.
const OPEN_IDS = [0, 2, 3, 4, 5, 7], BODY_IDS = [6, 9, 10, 13], END_IDS = [11, 12];
const BODY_BEST = new Set([6, 9]);
export const BODY_CHUNK = 14000;
type Step = { key: string; ids: number[]; parts: number[] };
export function reviewSteps(run: Run): Step[] {
  const n = run.parts.length;
  if (n <= 4) return [{ key: 'all', ids: criteria.map((_, id) => id), parts: run.parts.map((_, i) => i) }];
  const chunks: number[][] = [];
  let current: number[] = [], size = 0;
  run.parts.forEach((part, i) => {
    if (current.length && size + part.text.length > BODY_CHUNK) { chunks.push(current); current = []; size = 0; }
    current.push(i); size += part.text.length;
  });
  if (current.length) chunks.push(current);
  return [{ key: 'open', ids: OPEN_IDS, parts: [0, 1] },
    ...chunks.map((parts, k) => ({ key: 'body' + (k + 1) + '/' + chunks.length, ids: BODY_IDS, parts })),
    { key: 'end', ids: END_IDS, parts: [n - 3, n - 2, n - 1] }];
}
// The 14 rows from the steps: shown research and contrast count where strongest, pace and boring passages where weakest; other weak chunks become findings.
function combine(partial: Row[]) {
  const by = new Map<number, Row>(); const findings: Row[] = [];
  for (const row of partial) {
    const old = by.get(row.id);
    if (!old) { by.set(row.id, row); continue; }
    const better = BODY_BEST.has(row.id) ? (row.score ?? 0) > (old.score ?? 0) : (row.score ?? 0) < (old.score ?? 0);
    const [keep, drop] = better ? [row, old] : [old, row];
    by.set(row.id, keep);
    if (!BODY_BEST.has(row.id) && drop.score !== null && drop.score < threshold) findings.push(drop);
  }
  return { rows: criteriaWithSource.map(({ id }) => by.get(id) || { id, score: null, part: null, evidence: '', reason: 'Cần ảnh bìa/cảnh dựng thật', fix: '' }), findings };
}
const weakParts = (rows: Row[], findings: Row[] = []) => [...new Set([...rows, ...findings]
  .filter(row => row.score !== null && row.score < threshold && row.part !== null).map(row => row.part! - 1))].sort((a, b) => a - b);
const required = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const tidy = (value: string) => value.replace(/\s+/gu, ' ').trim();
const reference = criteriaWithSource.map(c => `${c.id}. ${c.name}${c.timing ? ` (${c.timing})` : ''}\n${c.excerpt}`).join('\n');
const planFields = ['title', 'question', 'promise', 'opening', 'transitions', 'payoff', 'ending', 'sourceNote', 'cover'] as const;
const planShape = JSON.stringify({ ...Object.fromEntries(planFields.map(key => [key, '...'])), tracks: ['...', '...'], branches: [{ title: '...', end: 1 }] });

function sourceUnits(source: string) {
  return transcriptUnits(source).flatMap(unit => unit.match(/[^]{1,3500}/gu) ?? [unit]);
}
const minimumParts = (source: string) => Math.max(1, Math.ceil(source.length / 6500));

// "Thể hiện công sức thực tế": the script shows the research behind it. Kept in code so every video is held to the same rule.
const ruleOf = (name: string, rule: string) => ({ id: criteria.findIndex(c => c.name === name), rule });
// How a criterion is met in this channel's videos. Used to grade it and to repair a part that fails it.
const CRITERION_RULES = [
  ruleOf('Thể hiện công sức thực tế', 'THỂ HIỆN CÔNG SỨC THỰC TẾ: không cần cảnh quay thật; người dẫn kể, giọng tâm sự như với bạn bè, công sức đã bỏ ra để tìm hiểu, ví dụ "trong rất nhiều tài liệu viết về ông, có hai bộ sách đáng tin nhất được giới sử học công nhận là…" hoặc "em đã mất cả tuần đối chiếu để các bác có thông tin đầy đủ nhất". Dẫn sử liệu, tài liệu có thật (với lịch sử Việt Nam: Đại Việt sử ký toàn thư, An Nam chí lược, Khâm định Việt sử thông giám cương mục, Lịch triều hiến chương loại chí…), nêu tên sách và điều sách chép, niên đại, con số. Nếu phiên ChatGPT có công cụ tìm kiếm web thì tra cứu trước khi viết. Con số (số tài liệu, thời gian bỏ ra) phải đúng hoặc nói ước lượng, chỗ chưa chắc ghi [CẦN KIỂM TRA]; không bịa số quyển, số trang hay lời trích.'),
  ruleOf('Tương phản', 'TƯƠNG PHẢN: xây hai tuyến truyện đối lập nhau về quy mô hoặc toan tính và đan xen chúng, ví dụ tuyến chính là đại sự triều chính, tuyến phụ là ngoại truyện về đời tư của nhân vật hoặc một sự kiện ít ai biết; hai tuyến soi chiếu nhau để nội dung có giá trị hơn. Chỉ dùng chuyện có thật trong sử liệu.'),
].filter(item => item.id >= 0);
const HIGHLIGHT = /sử ký|sử chép|chí lược|cương mục|hiến chương|chính sử|dã sử|tài liệu|bộ sách|ghi chép|văn bia|giai thoại|ít ai biết|đời tư|ngoại truyện|tuyến|kiểm chứng|tra cứu|đối chiếu|CẦN KIỂM TRA/i;
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
  const steps = run.phase === 'review' ? reviewSteps(run) : [];
  if (steps.length > 1) {
    const step = steps[Math.min(run.reviewStep || 0, steps.length - 1)];
    const ids = step.ids;
    const titleRule = ids.includes(0) && !run.plan?.title
      ? ' Chưa có tiêu đề: tự đề xuất MỘT tiêu đề YouTube chuẩn SEO, gây tò mò, tối đa 70 ký tự, đúng nội dung có thật, trả trong trường "title"; chấm mục 0 theo độ khớp của câu mở đầu với tiêu đề này.'
      : run.plan?.title && ids.includes(0) ? ' Chấm độ khớp với tiêu đề đề xuất trong kế hoạch.' : '';
    const scope = step.key === 'open' ? 'PHẦN MỞ ĐẦU của video (toàn văn các phần đầu)'
      : step.key === 'end' ? 'PHẦN KẾT của video (toàn văn các phần cuối)'
      : `ĐOẠN ${step.key.slice(4)} của video: TOÀN VĂN các phần ${step.parts[0] + 1}–${step.parts[step.parts.length - 1] + 1} trên tổng ${run.parts.length} phần. Đọc từng câu: chỉ ra đoạn lặp ý, giảng giải dài, câu hỏi tu từ lặp mô thức, chỗ nhịp phẳng; chỗ dẫn sử liệu cụ thể (tên sách, điều sách chép) và chỗ hai tuyến truyện soi chiếu nhau. Chấm theo những gì có trong đoạn này`;
    return `${base}
Chấm ${scope}.${titleRule} Chỉ chấm các ID ${JSON.stringify(ids)}, mỗi ID đúng một dòng: score 0–10, part là số phần (bắt đầu từ 1, trong các phần gửi kèm) chứa dẫn chứng, evidence trích NGUYÊN VĂN từ đúng phần đó, reason nói vì sao được điểm ấy. Nếu dưới 8 thì BẮT BUỘC có fix: cách sửa cụ thể (câu/đoạn nào, thêm hay cắt gì), không chung chung. Cách chấm riêng: ${CRITERION_RULES.filter(item => ids.includes(item.id)).map(item => 'mục ' + item.id + ' — ' + item.rule).join(' ') || 'không'} Trả {${ids.includes(0) && !run.plan?.title ? '"title":"tiêu đề đề xuất",' : ''}"rows":[{"id":${ids[0]},"score":7,"part":${step.parts[0] + 1},"evidence":"trích nguyên văn","reason":"...","fix":"..."}]} với đúng ${ids.length} dòng.
${JSON.stringify({ plan: run.plan, structure: run.parts.map(item => item.title), parts: step.parts.filter(i => i >= 0 && i < run.parts.length).map(i => ({ part: i + 1, title: run.parts[i].title, text: run.parts[i].text })) })}`;
  }
  if (run.phase === 'review') {
    const excerpts = run.parts.map((part, i) => {
      const text = part.text;
      const middle = Math.floor(text.length / 2);
      const excerpts = text.length <= 1400 ? [text] : [text.slice(0, 500), text.slice(middle - 200, middle + 200), text.slice(-500)];
      // Paragraphs about sources, research or a side story are where repairs add content: send them too, or the next review cannot see the repair.
      const highlights = text.length <= 1400 ? [] : text.split(/\n\s*\n/).filter(p => HIGHLIGHT.test(p) && !excerpts.some(e => e.includes(p.slice(0, 80)))).slice(0, 2).map(p => p.slice(0, 600));
      return { part: i + 1, title: part.title, excerpts, ...(highlights.length ? { highlights } : {}) };
    });
    return `${base}
Đối chiếu cấu trúc toàn video dựa trên các trích đoạn theo đúng thứ tự các phần; highlights là các đoạn nói về nguồn sử liệu, công sức tìm hiểu hoặc tuyến truyện phụ trong phần đó. Chỉ trích dẫn văn bản có trong dữ liệu; không xem điểm là đánh giá chi tiết những đoạn đã lược. ${run.plan?.title ? 'Chấm độ khớp với tiêu đề đề xuất trong kế hoạch.' : 'Chưa có tiêu đề: tự đề xuất MỘT tiêu đề YouTube chuẩn SEO, gây tò mò, tối đa 70 ký tự, đúng nội dung có thật, trả trong trường "title"; chấm mục 0 theo độ khớp của câu mở đầu với tiêu đề này.'} Chấm từng tiêu chí áp dụng 0–10 theo đúng ID (0–${criteria.length - 1}), ghi part là số phần bắt đầu từ 1 và evidence là đoạn trích NGUYÊN VĂN từ đúng phần đó. Nếu dưới 8, chọn phần cần sửa nhất và ghi cách sửa cụ thể. Mục 1 và 8 cần ảnh bìa/cảnh dựng thật nên trả score:null, part:null, evidence:"", kèm lý do thiếu dữ liệu. Các mục có đủ dữ liệu phải có điểm; nếu kịch bản thiếu yếu tố thì cho điểm thấp và trích đoạn liên quan. Cách chấm riêng: ${CRITERION_RULES.map(item => 'mục ' + item.id + ' — ' + item.rule).join(' ')} Điểm chỉ là đánh giá tham khảo. Trả {${run.plan?.title ? '' : '"title":"tiêu đề đề xuất",'}"rows":[{"id":0,"score":7,"part":1,"evidence":"trích nguyên văn","reason":"...","fix":"..."}]} với đủ ${criteria.length} dòng.
${JSON.stringify({ plan: run.plan, parts: excerpts })}`;
  }
  const part = run.parts[run.index];
  const repair = run.phase === 'repair';
  const lows = [...run.rows, ...(run.manualCriterion === undefined ? run.findings || [] : [])]
    .filter(row => row.part === run.index + 1 && (run.manualCriterion === undefined ? row.score !== null && row.score < threshold : row.id === run.manualCriterion));
  const rules = repair ? CRITERION_RULES.filter(item => lows.some(row => row.id === item.id)).map(item => item.rule) : [];
  // What this part already does well: the repair must not break it.
  const keep = repair ? run.rows.filter(row => row.part === run.index + 1 && row.score !== null && row.score >= threshold)
    .map(row => criteria[row.id].name + (row.evidence ? ': "' + row.evidence.slice(0, 200) + '"' : '')) : [];
  return `${base}
${repair ? 'Chỉ sửa phần được chỉ định theo các tiêu chí gửi kèm, làm đúng từng cách sửa (fix). Giữ những đoạn tốt, dữ kiện và liên kết với các phần khác. Với nhịp độ hoặc đoạn gây chán, ưu tiên CẮT và gộp ý lặp hơn là viết thêm.' + (keep.length ? ' Các tiêu chí phần này ĐANG ĐẠT, giữ nguyên ý và câu dẫn chứng, không làm yếu đi: ' + JSON.stringify(keep) + '.' : '') + ' Trả đầy đủ phần này sau sửa.' :'Chỉ biên tập lại phần được chỉ định theo kế hoạch toàn video. Sắp xếp ý, bổ sung kết nối và giải thích dựa trên dữ kiện trong nguồn. Giữ liên kết với phần trước và sau, tăng tiến đến giải đáp theo đúng vị trí. Không nhắc lại mở đầu hoặc kết luận toàn video ở mỗi phần.'}
${rules.length ? rules.join(' ') + ' ' : ''}Trả {"text":"lời kịch bản hoàn chỉnh của phần này"}. Giữ giọng và ngôn ngữ theo phong cách đã lưu, mặc định dùng ngôn ngữ của nguồn.
${JSON.stringify({ plan: run.plan, structure: run.parts.map(item => item.title), part: run.index + 1, total: run.parts.length,
    source: part.source, script: repair ? part.text : undefined, previousEnding: run.parts[run.index - 1]?.text.slice(-1500),
    nextOpening: run.parts[run.index + 1]?.text.slice(0, 1000),
    issues: repair ? lows : undefined })}`;
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

function reviewed(value: ReturnType<typeof parse>, run: Run, ids: number[] = criteria.map((_, id) => id)): Row[] {
  if (!Array.isArray(value?.rows) || value.rows.length !== ids.length) throw new Error('Báo cáo thiếu hoặc thừa tiêu chuẩn.');
  return criteriaWithSource.filter(({ id }) => ids.includes(id)).map(({ id, name, visual }) => {
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
    // No target title yet: ChatGPT proposes one with the first review; the opening is graded and repaired against it.
    const proposed = !run.plan?.title && typeof value?.title === 'string' ? value.title.trim().slice(0, 120) : '';
    if (proposed) {
      const plan = { ...(run.plan || { title: '', question: '', promise: '', tracks: [], opening: '', transitions: '', payoff: '', ending: '', sourceNote: '', cover: '' }), title: proposed };
      run = { ...run, plan }; next.plan = plan;
    }
    const steps = reviewSteps(run);
    const at = Math.min(run.reviewStep || 0, steps.length - 1);
    const got = reviewed(value, run, steps[at].ids);
    let rows = got, findings: Row[] = [];
    if (steps.length > 1) {
      const partial = [...(run.partial || []), ...got];
      // More steps to ask: keep what came back, ask the next one.
      if (at + 1 < steps.length) return { ...next, reviewStep: at + 1, partial };
      ({ rows, findings } = combine(partial));
    }
    next.reviewStep = undefined; next.partial = undefined;
    const passed = reviewQuality(rows).passed, total = totalScore(rows);
    next.history = [...(run.history || []), { round: run.rounds, passed, total }];
    const improved = beats(rows, run.best);
    if (improved) next.best = { passed, total, parts: run.parts, rows, plan: run.plan, findings };
    const done = (extra: Partial<Run>) => ({ ...next, manualCriterion: undefined, manualBatch: undefined, ...extra });
    if (run.reviewOnly) return done({ rows, findings, repairParts: [], mode: 'checked', notice: 'Đã chấm lại kịch bản hiện tại (chỉ xem, không sửa vì dự án đã phân cảnh).' });
    let repairParts = weakParts(rows, findings);
    // The aim is every criterion at 8: after the planned rounds, keep repairing while each round still raises the score, up to MAX_ROUNDS.
    const rising = Boolean(run.best) && (passed > run.best!.passed || (passed === run.best!.passed && total > (run.best!.total ?? totalScore(run.best!.rows))));
    const limited = run.manualCriterion !== undefined || run.manualBatch || (run.rounds >= run.limit && !(rising && run.rounds < MAX_ROUNDS));
    if (repairParts.length && !improved && run.best) {
      const best = run.best;
      if (limited) return done({ parts: best.parts, rows: best.rows, findings: best.findings || [], plan: best.plan ?? next.plan, repairParts: [], phase: 'review', mode: 'limited',
        notice: 'Giữ bản tốt nhất (' + best.passed + '/' + criteria.length + ' đạt) thay cho bản sửa cuối (' + passed + '/' + criteria.length + ').' });
      // This round's repairs made it worse: the next repairs start again from the best version, never from a worse one.
      rows = best.rows; findings = best.findings || []; repairParts = weakParts(rows, findings);
      next.parts = best.parts; next.notice = 'Bản sửa vòng ' + run.rounds + ' kém hơn (' + passed + '/' + criteria.length + '): sửa tiếp từ bản tốt nhất (' + best.passed + '/' + criteria.length + ').';
    }
    if (!repairParts.length) return done({ rows, findings, mode: next.mode === 'running' ? 'passed' : 'paused' });
    return done({ rows, findings, repairParts, index: repairParts[0], phase: 'repair', mode: limited ? 'limited' : next.mode });
  }
  if (!required(value?.text)) throw new Error('ChatGPT chưa trả kịch bản của phần này.');
  const parts = run.parts.map((part, i) => i === run.index ? { ...part, text: value.text.trim() } : part);
  const following = run.phase === 'repair' ? run.repairParts.find(index => index > run.index) : run.index + 1;
  if (following !== undefined && following < parts.length) return { ...next, parts, index: following };
  return { ...next, parts, phase: 'review', reviewStep: 0, partial: [], rounds: run.rounds + Number(run.phase === 'repair' && run.manualCriterion === undefined && !run.manualBatch), repairParts: [] };
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
