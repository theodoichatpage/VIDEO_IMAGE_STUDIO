import type { ScriptSection } from './transcriptWorkspace';
export const markProcessing=(items:ScriptSection[],id:string)=>items.map(x=>x.id===id?{...x,status:'processing' as const,error:undefined}:x);
export const markDone=(items:ScriptSection[],id:string,text:string)=>items.map(x=>x.id===id?{...x,status:'done' as const,rewrittenText:text,error:undefined}:x);
export const markError=(items:ScriptSection[],id:string,error:string)=>items.map(x=>x.id===id?{...x,status:'error' as const,error}:x);
export const stopWaiting=(items:ScriptSection[])=>items.map(x=>x.status==='waiting'?{...x,status:'stopped' as const}:x);
export const nextRewriteSection=(items:ScriptSection[])=>items.find(x=>x.status==='waiting'||x.status==='error')||null;
export const statusLabel=(status:ScriptSection['status'])=>({waiting:'Chờ xử lý',processing:'Đang xử lý',done:'Đã xử lý',error:'Lỗi',stopped:'Đã dừng'}[status]);
