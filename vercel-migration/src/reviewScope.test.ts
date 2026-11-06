import {describe,it,expect} from 'vitest';
import {emptyAnalysis} from './analysisWorkspace';
import {getScopeReview,reviewPromptState} from './reviewScope';
describe('scoped review',()=>{it('uses each part and never borrows whole-video results',()=>{const s={...emptyAnalysis(),script:'Kịch bản toàn bộ',review:'kết quả cũ',reviewScript:'Kịch bản toàn bộ',parts:[{id:'p',title:'Giữa',text:'Nội dung phần giữa',status:'done' as const}]};expect(getScopeReview(s,'p').raw).toBe('');expect(reviewPromptState(s,'p').script).toBe('Nội dung phần giữa');expect(getScopeReview(s,'all').raw).toBe('kết quả cũ')});it('marks results stale when content changes',()=>{const s={...emptyAnalysis(),script:'Mới',review:'nhận xét',reviewScript:'Cũ'};expect(getScopeReview(s,'all').stale).toBe(true)})});
