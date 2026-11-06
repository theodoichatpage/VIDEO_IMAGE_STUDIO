import { describe, expect, it, vi } from 'vitest';
if (typeof localStorage === 'undefined') vi.stubGlobal('localStorage', {getItem: () => null});
import {preparedAnalysisSource, assembleRewrittenScript, defaultTranscriptWorkspace, validateMindmapPayload, workspaceStorageKey } from './transcriptWorkspace';

describe('transcript workspace', () => {
  it('uses project-scoped storage keys', () => expect(workspaceStorageKey('abc')).toBe('vis-transcript-workspace-abc'));
  it('starts with an empty workspace', () => expect(defaultTranscriptWorkspace()).toMatchObject({ transcript: null, branches: [], sections: [] }));
  it('validates ordered unique mindmap branches', () => {
    const branches = validateMindmapPayload({ branches: [{ id: 'b1', title: 'Một', summary: 'A', content: 'Nội dung A' }, { id: 'b2', title: 'Hai', summary: 'B', content: 'Nội dung B' }] });
    expect(branches.map(x => x.id)).toEqual(['b1', 'b2']);
  });
  it('rejects duplicate branch ids', () => expect(() => validateMindmapPayload({ branches: [{ id: 'b1', title: 'A', summary: '', content: 'A' }, { id: 'b1', title: 'B', summary: '', content: 'B' }] })).toThrow());
  it('assembles only rewritten sections in order', () => {
    expect(assembleRewrittenScript([
      { id:'1', branchId:'1', title:'A', summary:'', sourceText:'', status:'done', rewrittenText:'Đoạn 1' },
      { id:'2', branchId:'2', title:'B', summary:'', sourceText:'', status:'done', rewrittenText:'Đoạn 2' },
    ])).toBe('Đoạn 1\n\nĐoạn 2');
  });
});

it('only prepares a source from completed styled parts in their stored order', () => {
 const part = (id: string, rewrittenText: string, status: 'done' | 'waiting') => ({
  id, branchId: id, title: id, summary: '', sourceText: 'Transcript thô', rewrittenText, status,
 });
 const workspace = {preparedAnalysisSource, ...defaultTranscriptWorkspace(), stylePrompt: 'Văn phong mới',
  sections: [part('1', 'Bản theo văn phong', 'done'), part('2', '', 'waiting')] };
 expect(preparedAnalysisSource(workspace).text).toBe('');
 const finished = { ...workspace, sections: [workspace.sections[0], part('2', 'Phần thứ hai', 'done')] };
 expect(preparedAnalysisSource(finished)).toMatchObject({ done: 2, total: 2, style: 'Văn phong mới', text: 'Bản theo văn phong\n\nPhần thứ hai' });
 expect(preparedAnalysisSource({ ...finished, stylePrompt: '' }).text).toBe('');
});
