export type AnalysisState={source:'transcript'|'script'|'topic';input:string;requirements:string;script:string;mode:'keep'|'review'|'rewrite';status:'draft'|'transferred'};
export const emptyAnalysis=():AnalysisState=>({source:'transcript',input:'',requirements:'',script:'',mode:'keep',status:'draft'});
const key=(id:string)=>`vis-analysis-workspace-${id}`;
export function loadAnalysis(id:string):AnalysisState{try{return {...emptyAnalysis(),...JSON.parse(localStorage.getItem(key(id))||'{}')}}catch{return emptyAnalysis()}}
export function saveAnalysis(id:string,state:AnalysisState){localStorage.setItem(key(id),JSON.stringify(state))}
