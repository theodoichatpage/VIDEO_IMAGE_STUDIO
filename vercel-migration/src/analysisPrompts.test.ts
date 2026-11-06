import {describe,it,expect} from 'vitest';
import {criteria,makeAnalysisPrompt,originalExcerpt} from './analysisPrompts';
import {emptyAnalysis} from './analysisWorkspace';
describe('analysis criteria and prompts',()=>{
 it('links all criteria to text actually present in the supplied transcript',()=>{expect(criteria).toHaveLength(13);for(const c of criteria)expect(originalExcerpt(c.start,c.end)).toContain('['+c.start+']')});
 it('includes the source, style and criteria without claiming verification',()=>{const p=makeAnalysisPrompt('outline',{...emptyAnalysis(),input:'Nguồn thử',requirements:'Yêu cầu'},'Giọng thử');expect(p).toContain('Nguồn thử');expect(p).toContain('Giọng thử');expect(p.toLowerCase()).toContain('không bịa');expect(p).toContain('Câu đầu khớp tiêu đề')});
});
