export type AnalysisPending={id:string;stage:'research'|'directions'|'routes'|'outline'|'write'|'review';partId?:string;inputSnapshot:string;scriptSnapshot?:string;expires:number};
export type AnalysisPart={id:string;title:string;text:string;status:'waiting'|'processing'|'done'|'error'|'stopped'};
export type AnalysisState={source:'transcript'|'script'|'topic';input:string;requirements:string;script:string;mode:'keep'|'review'|'rewrite';status:'draft'|'transferred';duration:string;research:string;direction:string;routes:string;outline:string;review:string;reviewScript:string;pending:AnalysisPending|null;parts:AnalysisPart[];inbox:string};
export const emptyAnalysis=():AnalysisState=>({source:'transcript',input:'',requirements:'',script:'',mode:'keep',status:'draft',duration:'',research:'',direction:'',routes:'',outline:'',review:'',reviewScript:'',pending:null,parts:[],inbox:''});
const key=(id:string)=>`vis-analysis-workspace-${id}`;
export function loadAnalysis(id:string):AnalysisState{try{return {...emptyAnalysis(),...JSON.parse(localStorage.getItem(key(id))||'{}')}}catch{return emptyAnalysis()}}
export function saveAnalysis(id:string,state:AnalysisState){localStorage.setItem(key(id),JSON.stringify(state))}
