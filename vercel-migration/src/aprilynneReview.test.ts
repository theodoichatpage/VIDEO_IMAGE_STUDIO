import { describe, expect, it } from 'vitest';
import { acceptResponse, BODY_CHUNK, emptyRun, promptFor, reviewQuality, reviewSteps, scriptOf, staleReport, type Row, type Run } from './automaticAnalysis';

// A long script like Thái sư (55 parts of about 1,000 characters).
const parts = Array.from({ length: 55 }, (_, i) => ({ title: 'Phần ' + (i + 1), source: '', text: `Câu mở phần ${i + 1}. ` + 'Nội dung kể chuyện. '.repeat(48) + `Câu cuối phần ${i + 1}.` }));
const plan = { title: 'Trần Thủ Độ', question: 'q', promise: 'p', tracks: ['A', 'B'], opening: 'o', transitions: 't', payoff: 'y', ending: 'e', sourceNote: 's', cover: 'c' };
const long = (): Run => ({ ...emptyRun(), mode: 'running', phase: 'review', style: 'Giọng kênh', plan, parts: parts.map(p => ({ ...p, source: p.text })) });
const reply = (run: Run, value: unknown) => acceptResponse(run, JSON.stringify(value));
// ChatGPT's answer to the step being asked: `score(id, firstPart)` decides each criterion.
function answer(run: Run, score: (id: number, part: number) => number) {
  const step = reviewSteps(run)[run.reviewStep || 0];
  return { rows: step.ids.map(id => {
    const part = step.parts[0];
    const value = score(id, part + 1);
    return { id, score: value, part: part + 1, evidence: `Câu mở phần ${part + 1}.`, reason: 'Lý do cụ thể', fix: value < 8 ? 'Cắt hai câu lặp ở phần ' + (part + 1) : '' };
  }) };
}
function review(run: Run, score: (id: number, part: number) => number) {
  let current = run;
  for (let guard = 0; guard < 20 && current.phase === 'review' && current.mode === 'running'; guard++) {
    const before = current.reviewStep || 0;
    current = reply(current, answer(current, score));
    if ((current.reviewStep || 0) <= before && current.phase === 'review' && current.reviewStep !== undefined) break;
    if (current.reviewStep === undefined) break;
  }
  return current;
}

describe('Aprilynne review of a long script', () => {
  it('asks in short steps (opening, body in full chunks, ending), never the whole script at once', () => {
    const run = long();
    const steps = reviewSteps(run);
    expect(steps[0].key).toBe('open');
    expect(steps[steps.length - 1].key).toBe('end');
    expect(steps.length).toBeGreaterThanOrEqual(5);
    // Every criterion that the script can show is asked exactly in the steps; the two visual ones are not asked.
    expect(new Set(steps.flatMap(s => s.ids))).toEqual(new Set([0, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13]));
    // Every part is read in full by one body step.
    expect(steps.filter(s => s.key.startsWith('body')).flatMap(s => s.parts)).toEqual(parts.map((_, i) => i));
    const sizes = steps.map((_, i) => promptFor({ ...run, reviewStep: i }).length);
    expect(Math.max(...sizes)).toBeLessThan(BODY_CHUNK + 12000);
    const body = promptFor({ ...run, reviewStep: 1 });
    expect(body).toContain('TOÀN VĂN');
    expect(body).toContain(parts[0].text);
  });

  it('combines the steps into 14 rows, keeps every weak part as a finding and repairs all of them', () => {
    // Boring passages (13) are weak in the first two body chunks, research (6) is strong in one chunk only.
    const done = review(long(), (id, part) => id === 13 && part < 30 ? 5 : id === 6 ? (part === 1 ? 9 : 6) : 9);
    expect(done.reviewStep).toBeUndefined();
    expect(done.rows).toHaveLength(14);
    expect(done.rows.find(r => r.id === 6)?.score).toBe(9);
    expect(done.rows.find(r => r.id === 13)?.score).toBe(5);
    expect((done.findings || []).filter(f => f.id === 13).length).toBeGreaterThanOrEqual(1);
    expect(done.phase).toBe('repair');
    expect(done.repairParts.length).toBeGreaterThanOrEqual(2);
    const prompt = promptFor(done);
    expect(prompt).toContain('Cắt hai câu lặp');
    expect(prompt).toContain('ĐANG ĐẠT');
  });

  it('re-grades after every repair round, keeps the best version and shows the scores going up', () => {
    let run = long();
    // Round by round the repairs fix more criteria: 9 → 11 → 12 of 12.
    const plans = [(id: number) => [6, 10, 13].includes(id) ? 6 : 9, (id: number) => id === 13 ? 7 : 9, () => 9];
    for (let round = 0; round < plans.length; round++) {
      run = review(run, plans[round]);
      if (run.phase !== 'repair') break;
      while (run.phase === 'repair') run = reply(run, { text: run.parts[run.index].text + ' Đã sửa vòng ' + (round + 1) + '.' });
      run = { ...run, reviewStep: 0 };
    }
    expect(run.history?.map(h => h.passed)).toEqual([9, 11, 12]);
    expect(run.mode).toBe('passed');
    expect(scriptOf(run)).toContain('Đã sửa vòng 2.');
  });

  it('keeps repairing past 3 rounds while the score still rises, until every criterion reaches 8 (at most 6 rounds)', () => {
    let run = long();
    // One more criterion passes each round: 7 → 8 → … → 12 of 12 needs 5 repair rounds.
    const low = [6, 9, 10, 12, 13];
    for (let round = 0; round < 8 && run.mode === 'running'; round++) {
      run = review({ ...run, reviewStep: 0 }, id => low.slice(round).includes(id) ? 6 : 9);
      while (run.phase === 'repair' && run.mode === 'running') run = reply(run, { text: run.parts[run.index].text + ' Sửa ' + round + '.' });
    }
    expect(run.history?.map(h => h.passed)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(run.rounds).toBe(5);
    expect(run.mode).toBe('passed');
  });

  it('repairs again from the best version when a round makes the script worse', () => {
    let run = review(long(), id => id === 13 ? 6 : 9);
    const bestText = scriptOf(run);
    while (run.phase === 'repair') run = reply(run, { text: `Câu mở phần ${run.index + 1}. Bản sửa tệ.` });
    run = review(run, id => [10, 12, 13].includes(id) ? 5 : 9);
    expect(run.phase).toBe('repair');
    expect(scriptOf(run)).toBe(bestText);
    expect(run.notice).toContain('kém hơn');
    expect(reviewQuality(run.rows).passed).toBe(11);
  });

  it('a review-only run of a project with parts grades and never rewrites', () => {
    const run = review({ ...long(), reviewOnly: true }, id => id === 13 ? 5 : 9);
    expect(run.mode).toBe('checked');
    expect(run.phase).toBe('review');
    expect(run.repairParts).toEqual([]);
    expect(scriptOf(run)).toBe(scriptOf(long()));
  });

  it('flags a report of another script even when it stopped on a timeout with its job still pending (Thái sư)', () => {
    const old = review(long(), () => 9);
    const server = 'Kịch bản mới do AI MANAGER lưu.';
    const timedOut: Run = { ...old, mode: 'error', phase: 'review', pending: { id: 'transcript-x', deadline: 0, extended: 2 } };
    expect(staleReport(timedOut, server)).toBe(true);
    expect(staleReport({ ...timedOut, needsSave: true }, server)).toBe(true);
    expect(staleReport({ ...timedOut, mode: 'running' }, server)).toBe(false);
    expect(staleReport({ ...timedOut, mode: 'passed' }, server)).toBe(false);
    expect(staleReport(timedOut, scriptOf(old) + '\n')).toBe(false);
  });

  it('rejects a low score without a fix or with invented evidence in a step', () => {
    const run = long();
    const good = answer(run, () => 6);
    expect(() => reply(run, { rows: good.rows.map((r: Row) => ({ ...r, fix: '' })) })).toThrow();
    expect(() => reply(run, { rows: good.rows.map((r: Row) => ({ ...r, evidence: 'Câu bịa ra.' })) })).toThrow();
  });
});
