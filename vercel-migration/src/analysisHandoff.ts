import type {AnalysisState} from './analysisWorkspace';
export function makeHandoff(s:AnalysisState,imageStyle:string){return {script:s.script,title:s.title,cover:s.cover,openingScene:s.openingScene,direction:s.direction,routes:s.routes,research:s.research,outline:s.outline,parts:s.parts.map(p=>({...p})),imageStyle};}
export function saveHandoff(projectId:string,data:ReturnType<typeof makeHandoff>){localStorage.setItem('vis-analysis-handoff-'+projectId,JSON.stringify(data))}
export function loadHandoff(projectId:string):ReturnType<typeof makeHandoff>|null{try{const value=JSON.parse(localStorage.getItem('vis-analysis-handoff-'+projectId)||'null');return value&&typeof value==='object'?value:null}catch{return null}}
