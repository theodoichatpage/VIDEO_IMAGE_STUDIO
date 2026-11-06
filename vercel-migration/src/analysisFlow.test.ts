import {it,expect} from 'vitest';import {analysisSteps,initialStep,stepForMode} from './analysisFlow';
it('keeps the work in order and restores only known steps',()=>{expect(analysisSteps.map(x=>x.id)).toEqual(['source','research','outline','write','review']);expect(initialStep('review')).toBe('review');expect(initialStep('unknown')).toBe('source')});
it('takes an imported script to the selected operation',()=>{expect(stepForMode('keep')).toBe('write');expect(stepForMode('review')).toBe('review');expect(stepForMode('rewrite')).toBe('outline')});
