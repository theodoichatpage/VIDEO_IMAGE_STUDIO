import type { WorkspaceTranscript } from './transcriptWorkspace';
const LOCAL='http://127.0.0.1:8000';
const json=async(r:Response)=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(d?.message||d?.detail?.message||d?.error||'Không lấy được transcript.'));return d};
const normalize=(d:any):WorkspaceTranscript=>({videoId:String(d.videoId||d.video_id||''),title:d.title,thumbnail:d.thumbnail,language:d.language||d.language_code,captionType:d.captionType||(d.is_generated?'auto':'manual'),duration:d.duration,segments:(d.segments||[]).map((x:any)=>({start:Number(x.start||0),duration:Number(x.duration||0),text:String(x.text||'')})),text:String(d.text||'')});
export async function fetchTranscript(input:{url:string;language?:string}):Promise<WorkspaceTranscript>{
 try{const r=await fetch(LOCAL+'/transcript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:input.url,languages:input.language?[input.language,'en']:['vi','en']})});return normalize(await json(r));}
 catch(localError){try{const r=await fetch('/api/transcript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:input.url,language:input.language})});return normalize(await json(r));}catch(fallbackError){throw new Error((fallbackError instanceof Error?fallbackError.message:'Không lấy được transcript.')+' (Transcript Engine local chưa phản hồi: '+(localError instanceof Error?localError.message:'mất kết nối')+')')}}
}
