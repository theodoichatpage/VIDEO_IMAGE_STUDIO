import type {AnalysisState} from './analysisWorkspace';
export function getScopeReview(s:AnalysisState,scope:string){const text=scope==='all'?s.script:s.parts.find(p=>p.id===scope)?.text||'';const saved=scope==='all'?{raw:s.review,snapshot:s.reviewScript}:s.partReviews?.[scope]||{raw:'',snapshot:''};return {...saved,text,stale:!!saved.raw&&saved.snapshot!==text};}
export function reviewPromptState(s:AnalysisState,scope:string):AnalysisState{if(scope==='all')return s;return {...s,script:s.parts.find(p=>p.id===scope)?.text||'',parts:[]};}
