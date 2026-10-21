import { useMemo, useState } from 'react';
import { Clipboard, Download, FileInput, LoaderCircle, Youtube } from 'lucide-react';
import './transcriptTab.css';

type Segment={start:number;duration?:number;text:string};
type TranscriptResult={videoId:string;title?:string;thumbnail?:string;language?:string;captionType?:string;segments:Segment[];text:string};
type Props={onUseTranscript:(text:string,title?:string)=>void};

const time=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const x=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`};

export default function TranscriptTab({onUseTranscript}:Props){
 const [url,setUrl]=useState(''); const [language,setLanguage]=useState(''); const [withTime,setWithTime]=useState(true); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [result,setResult]=useState<TranscriptResult|null>(null);
 const display=useMemo(()=>result?(withTime?result.segments.map(x=>`[${time(x.start)}] ${x.text}`).join('\n'):result.text):'',[result,withTime]);
 const load=async()=>{if(!url.trim())return;setBusy(true);setError('');try{const r=await fetch('/api/transcript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url.trim(),language:language.trim()||undefined})});const data=await r.json();if(!r.ok)throw new Error(data?.error||'Không lấy được transcript.');setResult(data);}catch(e){setError(e instanceof Error?e.message:'Không lấy được transcript.');}finally{setBusy(false)}};
 const copy=()=>navigator.clipboard?.writeText(display);
 const download=()=>{if(!result)return;const blob=new Blob([display],{type:'text/plain;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(result.title||result.videoId||'youtube-transcript').replace(/[\\/:*?\"<>|]/g,'-')+'.txt';a.click();URL.revokeObjectURL(a.href)};
 return <section className="transcript-page">
  <div className="transcript-head"><div><h2><Youtube size={23}/> Get Transcript</h2><p>Dán link YouTube để lấy lời thoại và đưa thẳng vào kịch bản dự án.</p></div></div>
  <div className="transcript-search"><input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&void load()} placeholder="https://www.youtube.com/watch?v=..."/><input className="lang" value={language} onChange={e=>setLanguage(e.target.value)} placeholder="Ngôn ngữ (vi, en...)"/><button onClick={()=>void load()} disabled={busy||!url.trim()}>{busy?<LoaderCircle className="spin" size={18}/>:<Youtube size={18}/>} Lấy Transcript</button></div>
  {error&&<div className="transcript-error">{error}</div>}
  {result&&<div className="transcript-result">
   <aside>{result.thumbnail&&<img src={result.thumbnail} alt=""/>}<h3>{result.title||'YouTube video'}</h3><p>Video ID: {result.videoId}</p><p>Ngôn ngữ: {result.language||'Tự động'}</p><p>Nguồn: {result.captionType==='manual'?'Phụ đề gốc':result.captionType==='auto'?'Phụ đề tự động':result.captionType||'YouTube captions'}</p><label><input type="checkbox" checked={withTime} onChange={e=>setWithTime(e.target.checked)}/> Hiện timestamp</label><button className="primary" onClick={()=>onUseTranscript(result.text,result.title)}><FileInput size={17}/> Đưa vào dự án</button><button onClick={copy}><Clipboard size={17}/> Copy</button><button onClick={download}><Download size={17}/> Tải TXT</button></aside>
   <main><div className="transcript-toolbar"><strong>Transcript</strong><span>{result.segments.length} đoạn · {result.text.split(/\s+/).filter(Boolean).length} từ</span></div><textarea readOnly value={display}/></main>
  </div>}
  {!result&&!busy&&!error&&<div className="transcript-empty"><Youtube size={46}/><strong>Nhập URL YouTube</strong><span>Transcript sẽ hiển thị tại đây sau khi lấy thành công.</span></div>}
 </section>;
}
