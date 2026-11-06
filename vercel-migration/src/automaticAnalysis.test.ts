import { describe, expect, it } from 'vitest';
import { acceptResponse, criteriaWithSource, emptyRun, promptFor, reviewQuality, scriptOf, type Run } from './automaticAnalysis';

const source = 'A'.repeat(3500) + 'B'.repeat(3500) + 'C'.repeat(3500);
const plan = {
  title: 'Tiêu đề', question: 'Câu hỏi', promise: 'Lời hứa', opening: 'Mở đầu',
  transitions: 'Chuyển ý', payoff: 'Giải đáp', ending: 'Kết', sourceNote: 'Giới hạn',
  cover: 'Ảnh bìa đề xuất', tracks: ['Tuyến A', 'Tuyến B'],
  branches: [{ title: 'Một', end: 1 }, { title: 'Hai', end: 3 }],
};
const start = (): Run => ({ ...emptyRun(), source, style: 'Phong cách của dự án', mode: 'running' });
const reply = (run: Run, value: unknown) => acceptResponse(run, JSON.stringify(value));
const written = () => reply(reply(reply(start(), plan), { text: 'Đoạn đầu.' }), { text: 'Đoạn cuối.' });
const score = (run: Run, low = false) => ({ rows: criteriaWithSource.map(({ id, visual }) =>
  visual ? { id, score: null, part: null, evidence: '', reason: 'Cần hình thật', fix: '' }
    : { id, score: low && id === 0 ? 7 : 8, part: 1, evidence: run.parts[0].text, reason: 'Lý do', fix: 'Sửa câu đầu' }) });

describe('one-button analysis', () => {
  it('uses project style and original Aprilynne source, and writes a flexible partition without dropping source', () => {
    expect(promptFor(start())).toContain('Phong cách của dự án');
    expect(promptFor(start())).toContain('câu đầu tiên phải khớp');
    expect(() => reply(start(), { ...plan, branches: plan.branches.slice(0, 1) })).toThrow();
    const run = written();
    expect(run.parts.map(part => part.source).join('')).toBe(source);
    expect(scriptOf(run)).toBe('Đoạn đầu.\n\nĐoạn cuối.');
    expect(run.phase).toBe('review');
  });

  it('rejects missing rows, invented evidence and a numeric visual score', () => {
    const run = written();
    const { rows } = score(run);
    expect(() => reply(run, { rows: rows.slice(1) })).toThrow();
    expect(() => reply(run, { rows: [{ ...rows[0], evidence: 'Bịa' }, ...rows.slice(1)] })).toThrow();
    expect(() => reply(run, { rows: [rows[0], { ...rows[1], score: 10 }, ...rows.slice(2)] })).toThrow();
  });

  it('repairs only the affected part, rechecks the whole script and marks missing assets', () => {
    const run = written();
    const repair = reply(run, score(run, true));
    expect(repair.repairParts).toEqual([0]);
    expect(promptFor(repair)).toContain('Sửa câu đầu');
    const fixed = reply(repair, { text: 'Đoạn đầu mới.' });
    expect(fixed.rounds).toBe(1);
    expect(fixed.phase).toBe('review');
    expect(promptFor(fixed)).toContain('Đoạn cuối.');
    const reviewed = reply(fixed, score(fixed));
    // The two criteria that need the cover or footage do not block approval; they are noted for a manual check.
    expect(reviewed.mode).toBe('missing');
    expect(reviewed.phase).toBe('review');
    expect(reviewed.rows.filter(row => row.score === null)).toHaveLength(2);
  });

  it('keeps the latest evaluated script after exhausting the limit', () => {
    const run = { ...written(), limit: 1 };
    const fixed = reply(reply(run, score(run, true)), { text: 'Đoạn đầu đã sửa.' });
    const limited = reply(fixed, score(fixed, true));
    expect(limited.mode).toBe('limited');
    expect(scriptOf(limited)).toContain('Đoạn đầu đã sửa.');
    expect(limited.rows[0].score).toBe(7);
  });
});

it('reviews already rewritten sections directly and leaves the missing target title unscored', () => {
 const run: Run = { ...written(), plan: undefined };
 expect(promptFor(run)).toContain('Chưa có tiêu đề đích');
 const report = score(run);
 expect(() => reply(run, report)).toThrow();
 report.rows[0] = { id: 0, score: null, part: null, evidence: '', reason: 'Chưa có tiêu đề đích', fix: '' };
 const reviewed = reply(run, report);
 expect(reviewed.mode).toBe('missing');
 expect(reviewed.rows.filter(row => row.score === null).map(row => row.id)).toEqual([0, 1, 8]);
});

it('repairs only the selected criterion, then reviews the whole script without starting another auto repair', () => {
 const run = written();
 const { rows } = score(run, true);
 expect(reviewQuality(rows)).toEqual({ passed: 11, needsWork: 1, unscored: 2 });
 const manual: Run = { ...run, rows, phase: 'repair', index: 0, repairParts: [0], manualCriterion: 2 };
 const prompt = promptFor(manual);
 expect(prompt).toContain('"issues":[{"id":2,');
 expect(prompt).not.toContain('"issues":[{"id":0,');
 const fixed = reply(manual, { text: 'Đã sửa phần được chọn.' });
 expect(fixed.parts[1]).toEqual(run.parts[1]);
 expect(fixed.rounds).toBe(0);
 expect(fixed.phase).toBe('review');
 expect(reply(fixed, score(fixed, true)).mode).toBe('limited');
});

it('uses short excerpts for scoring and keeps full sections for the ordered manual repair batch', () => {
 const run = written();
 const text = 'A'.repeat(600) + 'HIDDEN-OMITTED-DETAIL' + 'B'.repeat(3200) + 'Cuối phần.';
 const long = { ...run, parts: [{ ...run.parts[0], text }, run.parts[1]] };
 expect(promptFor(long)).not.toContain('HIDDEN-OMITTED-DETAIL');
 expect(promptFor(long)).toContain('Cuối phần.');
 const rows = score(long, true).rows;
 const batch: Run = { ...long, rows, phase: 'repair', index: 0, repairParts: [0, 1], manualBatch: true };
 expect(promptFor(batch)).toContain('HIDDEN-OMITTED-DETAIL');
 const first = reply(batch, { text: 'Sửa phần đầu.' });
 expect(first.index).toBe(1);
 expect(first.parts[1]).toEqual(run.parts[1]);
 const second = reply(first, { text: 'Sửa phần hai.' });
 expect(second.phase).toBe('review');
 expect(second.rounds).toBe(0);
});

it('lets a Manager run proceed after all gradable criteria pass', () => {
 const run = { ...written(), managerReviewId: 'manager-review' };
 expect(reply(run, score(run)).mode).toBe('passed');
});
