import { describe, expect, it } from 'vitest';
import { criteria, originalExcerpt } from './analysisPrompts';
import { acceptResponse, criteriaWithSource, emptyRun, promptFor, type Run } from './automaticAnalysis';

const run = (): Run => ({ ...emptyRun(), phase: 'review', mode: 'running', style: 'Giọng thử', plan: { title: 't', question: 'q', promise: 'p', tracks: ['A', 'B'], opening: 'o', transitions: 'x', payoff: 'y', ending: 'e', sourceNote: 's', cover: 'c' },
  parts: [{ title: 'Phần 1', source: 'nguồn', text: 'Đây là kịch bản thử có chữ dẫn chứng.' }] });
const rows = (score: (id: number) => number | null) => ({ rows: criteriaWithSource.map(({ id, visual }) => visual
  ? { id, score: null, part: null, evidence: '', reason: 'Cần ảnh bìa/cảnh dựng thật' }
  : { id, score: score(id), part: 1, evidence: 'chữ dẫn chứng', reason: 'ok', fix: score(id)! < 8 ? 'sửa' : '' }) });

describe('the 14 Aprilynne criteria', () => {
  it('has the reward and the climax as two separate criteria, each tied to the transcript', () => {
    expect(criteria).toHaveLength(14);
    const names = criteria.map(c => c.name);
    expect(names).toContain('Hé lộ phần thưởng lớn');
    expect(names).toContain('Kết thúc ở cao trào');
    expect(names).not.toContain('Phần thưởng lớn và kết thúc cao trào');
    expect(originalExcerpt('11:57', '12:02')).toContain('hé lộ phần thưởng lớn');
    expect(originalExcerpt('12:02', '12:06')).toContain('kết thúc video ở cao trào');
  });
  it('asks ChatGPT for every id and every row', () => {
    const prompt = promptFor(run());
    expect(prompt).toContain('(0–13)');
    expect(prompt).toContain('đủ 14 dòng');
  });
  it('approves a script when every gradable criterion reaches 8, noting the two that need assets', () => {
    const done = acceptResponse(run(), JSON.stringify(rows(() => 9)));
    expect(done.mode).toBe('passed');
    expect(done.phase).toBe('review');
    expect(done.repairParts).toEqual([]);
  });
  it('does not approve while a gradable criterion is below 8', () => {
    const done = acceptResponse(run(), JSON.stringify(rows(id => id === 12 ? 6 : 9)));
    expect(done.mode).not.toBe('missing');
    expect(done.phase).toBe('repair');
    expect(done.repairParts).toEqual([0]);
  });
});

describe('repairs never leave a worse script', () => {
  it('keeps the best version when the rounds run out', () => {
    const first = acceptResponse(run(), JSON.stringify(rows(id => id === 12 ? 6 : 9)));
    expect(first.best?.passed).toBe(11);
    const repaired: Run = { ...first, phase: 'review', rounds: first.limit, parts: [{ title: 'Phần 1', source: 'nguồn', text: 'Đây là kịch bản thử có chữ dẫn chứng. Bản sửa kém hơn.' }] };
    const worse = acceptResponse(repaired, JSON.stringify(rows(id => id === 12 || id === 6 ? 5 : 9)));
    expect(worse.mode).toBe('limited');
    expect(worse.parts[0].text).toBe('Đây là kịch bản thử có chữ dẫn chứng.');
    expect(worse.notice).toContain('Giữ bản tốt nhất');
  });
  it('sends paragraphs about sources to the review', () => {
    const text = 'a'.repeat(2000) + '\n\nTheo Đại Việt sử ký toàn thư, ông mất năm 1264.\n\n' + 'b'.repeat(2000);
    const prompt = promptFor({ ...run(), parts: [{ title: 'Phần 1', source: text, text }] });
    expect(prompt).toContain('highlights');
    expect(prompt).toContain('Theo Đại Việt sử ký toàn thư');
  });
});
