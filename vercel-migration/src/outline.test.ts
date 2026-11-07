import { describe, expect, it } from 'vitest';
import { buildPartitionPrompt, parsePlan } from './transcriptPartition';
import { buildRewritePrompt } from './transcriptAi';
import type { ScriptSection } from './transcriptWorkspace';

const section = (text: string): ScriptSection => ({ id: 'part-1', branchId: 'part-1', title: 'Mở đầu', summary: '', sourceText: text, status: 'waiting', rewrittenText: '' });
const reply = { plan: { title: 'Trần Thủ Độ: công thần hay kẻ cướp ngôi?', hook: 'Câu mở', question: 'Q', promise: 'P', tracks: ['Triều chính', 'Đời tư ít ai biết'], turns: 'T', payoff: 'Y', ending: 'E', sources: 'Đại Việt sử ký toàn thư', cover: 'C' },
  branches: [{ title: 'Mở đầu', end: 1, role: 'hook và lời hứa' }, { title: 'Kết', end: 2, role: 'cao trào' }] };

describe('Aprilynne outline before the rewrite', () => {
  it('asks for the outline with the split', () => {
    const prompt = buildPartitionPrompt('Câu một. Câu hai.');
    expect(prompt).toContain('DÀN Ý');
    expect(prompt).toContain('"plan"');
  });
  it('reads the outline and the role of every part', () => {
    const plan = parsePlan(reply)!;
    expect(plan.title).toContain('Trần Thủ Độ');
    expect(plan.tracks).toHaveLength(2);
    expect(plan.roles).toEqual(['hook và lời hứa', 'cao trào']);
    expect(parsePlan({ branches: [] })).toBeUndefined();
  });
  it('writes each part to its role, near the source length, with the call to action at the start and the end', () => {
    const plan = parsePlan(reply)!;
    const first = buildRewritePrompt(section('x'.repeat(3000)), 'Phong cách', '', plan, 0, 2);
    expect(first).toContain('DÀN Ý APRILYNNE');
    expect(first).toContain('hook và lời hứa');
    expect(first).toContain('2700–3900 ký tự');
    expect(first).toContain('bấm theo dõi');
    const last = buildRewritePrompt(section('x'.repeat(3000)), 'Phong cách', '', plan, 1, 2);
    expect(last).toContain('PHẦN KẾT');
    expect(last).toContain('bấm theo dõi');
    expect(buildRewritePrompt(section('abc'), 'Phong cách')).not.toContain('DÀN Ý');
  });
});
