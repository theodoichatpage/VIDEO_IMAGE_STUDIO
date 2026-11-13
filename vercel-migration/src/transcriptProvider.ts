import type { WorkspaceTranscript } from './transcriptWorkspace';
// A dev build may point at a test engine (VITE_TRANSCRIPT_ENGINE); the real Studio always uses the local engine on port 8000.
const LOCAL=(import.meta as any).env?.VITE_TRANSCRIPT_ENGINE||'http://127.0.0.1:8000';
// YouTube codes for "this video has no captions": its speech is turned into text instead.
const NO_CAPTIONS=new Set(['TRANSCRIPTS_DISABLED','NO_TRANSCRIPT_FOUND']);
const POLL_MS=2000;
class EngineError extends Error{constructor(message:string,public code=''){super(message)}}
const json=async(r:Response)=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new EngineError(String(d?.message||d?.detail?.message||d?.error?.message||(typeof d?.error==='string'?d.error:'')||'Không lấy được transcript.'),String(d?.error?.code||d?.code||''));return d};
const normalize=(d:any):WorkspaceTranscript=>({videoId:String(d.videoId||d.video_id||''),title:d.title,thumbnail:d.thumbnail,language:d.language||d.language_code,captionType:d.captionType||(d.source==='speech'?'speech':d.is_generated?'auto':'manual'),duration:d.duration,segments:(d.segments||[]).map((x:any)=>({start:Number(x.start||0),duration:Number(x.duration||0),text:String(x.text||'')})),text:String(d.text||'')});
export const isYouTubeUrl=(url:string)=>{try{const host=new URL(url.trim()).hostname.toLowerCase().replace(/^(www|m)\./,'');return host==='youtube.com'||host==='youtu.be'}catch{return /^[A-Za-z0-9_-]{11}$/.test(url.trim())}};
export type TranscriptProgress={onStatus?:(text:string)=>void;cancelled?:()=>boolean;sleep?:(ms:number)=>Promise<void>};
export const CANCELLED='Đã dừng lấy transcript.';
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** Facebook, TikTok, a YouTube video without captions...: the local engine downloads the audio and recognises the speech (minutes on a CPU). */
async function speechTranscript(url:string,language:string|undefined,progress:TranscriptProgress):Promise<WorkspaceTranscript>{
 let health:any;
 try{health=await fetch(LOCAL+'/health').then(r=>r.json())}catch{throw new EngineError('Transcript Engine local chưa chạy. Mở Cài đặt → Cài Transcript Engine (hoặc để AI MANAGER tự bật) rồi thử lại.')}
 if(!(health?.features||[]).includes('media_link'))throw new EngineError('Transcript Engine trên máy là bản cũ, chỉ lấy được phụ đề YouTube. Mở Cài đặt → Cài Transcript Engine để cập nhật, rồi thử lại.');
 let job=await json(await fetch(LOCAL+'/media/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,language:language||'vi'})}));
 const sleep=progress.sleep||wait;
 // Stop also stops the engine's job, so the CPU is free for the next link.
 const stopped=()=>{if(!progress.cancelled?.())return false;fetch(LOCAL+'/media/jobs/'+encodeURIComponent(job.id),{method:'DELETE'}).catch(()=>{});return true};
 for(;;){
  if(stopped())throw new EngineError(CANCELLED,'CANCELLED');
  if(job.status==='done')return normalize(job.result);
  if(job.status==='cancelled')throw new EngineError(CANCELLED,'CANCELLED');
  if(job.status==='error')throw new EngineError(String(job.error?.message||'Không nhận được giọng nói trong video.'),String(job.error?.code||''));
  progress.onStatus?.(`${job.message||'Đang xử lý'} · ${Math.round(Number(job.progress||0)*100)}%`);
  await sleep(POLL_MS);
  if(stopped())throw new EngineError(CANCELLED,'CANCELLED');
  job=await json(await fetch(LOCAL+'/media/jobs/'+encodeURIComponent(job.id)));
 }
}
export async function fetchTranscript(input:{url:string;language?:string},progress:TranscriptProgress={}):Promise<WorkspaceTranscript>{
 const url=input.url.trim();
 if(!isYouTubeUrl(url))return speechTranscript(url,input.language,progress);
 let localError:unknown;
 try{const r=await fetch(LOCAL+'/transcript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,languages:input.language?[input.language,'en']:['vi','en']})});return normalize(await json(r));}
 catch(e){localError=e;if(e instanceof EngineError&&NO_CAPTIONS.has(e.code)){progress.onStatus?.('Video không có phụ đề, chuyển sang nhận giọng nói…');return speechTranscript(url,input.language,progress)}}
 try{const r=await fetch('/api/transcript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,language:input.language})});return normalize(await json(r));}
 catch(fallbackError){throw new Error((fallbackError instanceof Error?fallbackError.message:'Không lấy được transcript.')+' (Transcript Engine local chưa phản hồi: '+(localError instanceof Error?localError.message:'mất kết nối')+')')}
}
