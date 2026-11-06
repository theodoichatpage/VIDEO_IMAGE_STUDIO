import { describe, it, expect, beforeEach } from 'vitest';
import { loadAnalysis, saveAnalysis, emptyAnalysis } from './analysisWorkspace';
const store = new Map<string,string>();
Object.assign(globalThis, { localStorage: { getItem:(k:string)=>store.get(k)??null, setItem:(k:string,v:string)=>store.set(k,v), removeItem:(k:string)=>store.delete(k) } });
beforeEach(()=>store.clear());
describe('analysis workspace',()=>{
 it('keeps each project independent and restores all fields',()=>{const state={...emptyAnalysis(), source:'topic' as const,input:'Đề tài',requirements:'Yêu cầu',script:'Bản thảo',mode:'review' as const,status:'draft' as const};saveAnalysis('a',state);expect(loadAnalysis('a')).toEqual(state);expect(loadAnalysis('b')).toEqual(emptyAnalysis())});
 it('opens safely when old projects have no analysis workspace',()=>{expect(loadAnalysis('old')).toEqual(emptyAnalysis())});
});
