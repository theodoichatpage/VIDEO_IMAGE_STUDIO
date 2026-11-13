import { describe, expect, it } from 'vitest';
import { managerStoryStatus, readManagerStory, reviewQuality } from './automaticAnalysis';

// What AI MANAGER sends for Thái sư (analysis/story.json): 3 rounds, 6 → 9 → 10 of 12.
const thaiSu = {
  stage: 'saved', round: 2, rounds: 3, maxRounds: 6, needed: 8, threshold: 8, title: 'Trần Thủ Độ: gian thần hay công thần?', sections: 24, passed: 10,
  note: 'Hết 3 vòng: dùng bản tốt nhất 10/14', error: '',
  rows: Array.from({ length: 14 }, (_, id) => ({ id, score: [1, 8].includes(id) ? null : [6, 13].includes(id) ? 7 : 9, part: [1, 8].includes(id) ? null : 1, evidence: 'e', reason: 'r', fix: 'f' })),
  findings: [], history: [{ round: 0, passed: 6 }, { round: 1, passed: 9 }, { round: 2, passed: 10 }],
};

describe("AI MANAGER's review shown by the Analysis tab", () => {
  it('reads the report and counts 10 of 12 criteria at 8, approved at 8 of 12', () => {
    const story = readManagerStory(thaiSu)!;
    expect(story.history.map(h => h.passed)).toEqual([6, 9, 10]);
    const q = reviewQuality(story.rows);
    expect(q.passed).toBe(10); expect(q.needsWork).toBe(2); expect(q.unscored).toBe(2);
    expect(q.passed >= story.needed).toBe(true);
    expect(managerStoryStatus(story)).toContain('Đã duyệt phân tích');
  });
  it('says what ChatGPT is doing while the review runs', () => {
    expect(managerStoryStatus(readManagerStory({ ...thaiSu, stage: 'repair', round: 1, note: '' })!)).toBe('ChatGPT đang viết lại các phần chưa chặt (vòng 2)');
    expect(managerStoryStatus(readManagerStory({ ...thaiSu, stage: 'plan', note: '' })!)).toContain('dàn ý Aprilynne');
  });
  it('reads the machine check, the notes taken out and the doubtful facts', () => {
    const story = readManagerStory({ ...thaiSu, clean: [{ kind: 'opening', part: 3, detail: 'Phần mở lại bằng "Các bác ạ"' }], notes: [{ part: 2, note: 'Ông sinh năm 1194.' }], facts: [{ part: 5, claim: 'Trần Nhật Hạo', fix: 'Trần Nhật Hiệu' }] })!;
    expect(story.clean[0].kind).toBe('opening'); expect(story.notes[0].part).toBe(2); expect(story.facts[0].fix).toBe('Trần Nhật Hiệu');
    expect(readManagerStory(thaiSu)!.clean).toEqual([]);
  });
  it('ignores a missing or malformed report (the tab then works as before)', () => {
    expect(readManagerStory(null)).toBeNull();
    expect(readManagerStory({ stage: 'saved' })).toBeNull();
    expect(readManagerStory('x')).toBeNull();
  });
});
