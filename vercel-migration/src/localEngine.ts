export const LOCAL_ENGINE_URL='http://127.0.0.1:17841';
export type EngineHealth={ok:boolean;version:string;sam2:boolean;device:string;ffmpeg:boolean};
export type SeparationJob={jobId:string;status:'queued'|'processing'|'complete'|'error';progress:number;message:string;error?:string};
export type SeparationLayer={fileId:string;file:string;title:string;type:'background'|'person'|'person_group'|'text'|'other';x:number;y:number;width:number;height:number;pixels:number};
export type SeparationResult={layers:SeparationLayer[];exact:boolean;background_filled:boolean;warning?:string;width:number;height:number};
async function json<T>(url:string,init?:RequestInit,timeout=3500):Promise<T>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);try{const r=await fetch(url,{...init,signal:controller.signal});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Local Engine HTTP ${r.status}`);return data as T}finally{clearTimeout(timer)}}
export const checkLocalEngine=()=>json<EngineHealth>(LOCAL_ENGINE_URL+'/v1/health');
export async function createSeparationJob(file:File,fill:boolean){const body=new FormData();body.append('image',file);body.append('fill',fill?'1':'0');return json<{jobId:string}>(LOCAL_ENGINE_URL+'/v1/separate',{method:'POST',body},15000)}
export const getSeparationJob=(id:string)=>json<SeparationJob>(LOCAL_ENGINE_URL+'/v1/jobs/'+encodeURIComponent(id));
export const getSeparationResult=(id:string)=>json<SeparationResult>(LOCAL_ENGINE_URL+'/v1/jobs/'+encodeURIComponent(id)+'/result');
export const separationFileUrl=(id:string,fileId:string,download=false)=>LOCAL_ENGINE_URL+'/v1/jobs/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(fileId)+(download?'?download=1':'');
export const separationZipUrl=(id:string)=>LOCAL_ENGINE_URL+'/v1/jobs/'+encodeURIComponent(id)+'/zip';
export async function downloadSeparationZip(id:string,fileName:string){const r=await fetch(separationZipUrl(id));if(!r.ok)throw new Error('Không tải được thư mục ZIP.');const blob=await r.blob();const url=URL.createObjectURL(blob);try{const a=document.createElement('a');a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove()}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}}
