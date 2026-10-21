import { describe, expect, it } from 'vitest';
import { assembleRewrittenScript, defaultTranscriptWorkspace, validateMindmapPayload, workspaceStorageKey } from './transcriptWorkspace';

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
