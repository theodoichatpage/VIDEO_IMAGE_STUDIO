import type {AnalysisState} from './analysisWorkspace';
export const analysisSteps=[{id:'source',label:'Nguồn nội dung'},{id:'research',label:'Nghiên cứu & hướng video'},{id:'outline',label:'Hai tuyến & dàn ý'},{id:'write',label:'Viết kịch bản'},{id:'review',label:'Đối chiếu'}] as const;
export type AnalysisStep=typeof analysisSteps[number]['id'];
export function initialStep(value:string|null):AnalysisStep{return analysisSteps.some(s=>s.id===value)?value as AnalysisStep:'source'}
export function stepForMode(mode:AnalysisState['mode']):AnalysisStep{return mode==='review'?'review':mode==='rewrite'?'outline':'write'}
