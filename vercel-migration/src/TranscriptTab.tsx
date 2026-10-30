import { useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, Download, ExternalLink, LoaderCircle, ListOrdered, RotateCcw, Save, Square, Youtube } from 'lucide-react';
import './transcriptTab.css';
import {buildPartitionPrompt,partitionBranches} from './transcriptPartition';
import { assembleRewrittenScript, loadTranscriptWorkspace, saveTranscriptWorkspace, sectionsFromBranches, type ScriptSection, type TranscriptWorkspaceState } from './transcriptWorkspace';
import { fetchTranscript } from './transcriptProvider';
import { buildRewritePrompt } from './transcriptAi';
import { statusLabel } from './rewriteQueue';
import { api } from './api';
import { readManagerTranscript, readManagerTranscriptState, writeManagerTranscriptState, type ManagerTranscript, type ManagerTranscriptState } from './managerTranscript';

type Props={onUseTranscript:(text:string,title?:string)=>void;projectId?:string};
const time=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`};
const downloadText=(text:string,name:string)=>{const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)};
type PendingAi={id:string;kind:'mindmap'|'rewrite';sectionId?:string;expires:number;started?:boolean};
const readPending=(key:string):PendingAi|null=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return value?.id&&value.expires>Date.now()?value:null}catch{return null}};

const readProjectName=(id:string)=>{try{const items=JSON.parse(localStorage.getItem('vis-project-meta')||'[]');return String((Array.isArray(items)&&items.find((x:{id?:string})=>x?.id===id)?.name)||'')}catch{return ''}};
const saveProjectName=(id:string,name:string)=>{try{const items=JSON.parse(localStorage.getItem('vis-project-meta')||'[]');const list=Array.isArray(items)?items:[];const time=Date.now();const found=list.find((x:{id?:string})=>x?.id===id);if(found){found.name=name;found.updatedAt=time}else list.unshift({id,name,createdAt:time,updatedAt:time});localStorage.setItem('vis-project-meta',JSON.stringify(list))}catch{}};
export default function TranscriptTab({onUseTranscript,projectId=localStorage.getItem('vis-session')||'default'}:Props){
 const [projectName,setProjectName]=useState(()=>readProjectName(projectId));
 const nameDefault=!projectName.trim()||projectName.trim()==='Dự án VIDEO IMAGE STUDIO';
 const [ws,setWs]=useState<TranscriptWorkspaceState>(()=>loadTranscriptWorkspace(projectId));
 const pairCode=localStorage.getItem('vis-session')||projectId;
 const pendingKey='vis-transcript-pending-'+pairCode;
 const pending=useRef<PendingAi|null>(readPending(pendingKey));
 const batch=useRef(false);
 const stopGeneration=useRef(0);
 const [batchRunning,setBatchRunning]=useState(false);
 const setBatch=(active:boolean)=>{batch.current=active;setBatchRunning(active)};
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const recovery=useRef<{jobId:string;manual:boolean}|null>(null);
 const recoveryTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [syncing,setSyncing]=useState(false);
 const [showJson,setShowJson]=useState(false),[jsonText,setJsonText]=useState(''),[jsonError,setJsonError]=useState('');
 const [aiStatus,setAiStatus]=useState(pending.current?'Đang chờ kết quả ChatGPT…':'');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[withTime,setWithTime]=useState(true),[aiBusy,setAiBusy]=useState(pending.current?(pending.current.kind==='mindmap'?'mindmap':pending.current.sectionId||'rewrite'):'');
 const display=useMemo(()=>ws.transcript?(withTime?ws.transcript.segments.map(x=>`[${time(x.start)}] ${x.text}`).join('\n'):ws.transcript.text):'',[ws.transcript,withTime]);
 const finalText=useMemo(()=>assembleRewrittenScript(ws.sections),[ws.sections]);
 useEffect(()=>saveTranscriptWorkspace(projectId,ws),[projectId,ws]);
 const finishRecovery=()=>{clearTimeout(recoveryTimer.current);recovery.current=null;setSyncing(false)};
 const requestResult=(manual=true)=>{
  const job=pending.current;if(!job||recovery.current)return;
  recovery.current={jobId:job.id,manual};setSyncing(true);
  if(manual){setError('');setAiStatus('Đang nhận lại kết quả từ đúng tác vụ ChatGPT…')}
  recoveryTimer.current=setTimeout(()=>{if(recovery.current?.jobId===job.id){finishRecovery();if(manual)setError('Extension chưa phản hồi kiểm tra kết quả. Giữ đúng hội thoại ChatGPT mở rồi thử Đồng bộ kết quả.')}},20000);
  window.postMessage({source:'vis-web',type:'studio-capture-result',jobId:job.id},'*');
 };
 const clearPending=()=>{finishRecovery();clearTimeout(timer.current);pending.current=null;localStorage.removeItem(pendingKey);setAiBusy('');setAiStatus('')};
 const failPending=(message:string)=>{setBatch(false);if(pending.current)window.postMessage({source:'vis-web',type:'studio-transcript-ack',jobId:pending.current.id},'*');const sectionId=pending.current?.sectionId;if(sectionId)setWs(s=>({...s,sections:s.sections.map(x=>x.id===sectionId?{...x,status:'error',error:message}:x)}));clearPending();setError(message)};
 const armTimeout=(ms:number,message:string)=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{if(pending.current)failPending(message)},ms)};
 useEffect(()=>{
  const receive=(e:MessageEvent)=>{
   if(e.source===window&&e.data?.source==='vis-web'&&e.data.type==='studio-stop-all-local'){stopGeneration.current++;setBusy(false);setBatch(false);clearPending();setWs(s=>({...s,sections:s.sections.map(x=>['waiting','processing'].includes(x.status)?{...x,status:'stopped'}:x)}));setAiStatus('Đã dừng tất cả.');return;}
   if(e.source!==window||e.data?.source!=='vis-extension')return;
   if(e.data.type==='studio-error'){
    if(recovery.current&&pending.current&&recovery.current.jobId===pending.current.id){const manual=recovery.current?.manual;finishRecovery();if(manual)setError(String(e.data.message||'Chưa đọc được kết quả. Mở đúng hội thoại ChatGPT rồi thử lại.'))}
    return;
   }
   if(e.data.type!=='studio-transcript-ai-result')return;
   const data=e.data,job=pending.current;
   if(!job||data.jobId!==job.id||data.kind!==job.kind||data.sectionId!==job.sectionId)return;
   if(data.state==='accepted'||data.state==='sent'){
    job.started=true;localStorage.setItem(pendingKey,JSON.stringify(job));
    setAiStatus(data.state==='sent'?'ChatGPT đã nhận lệnh, đang xử lý…':'Extension đã nhận lệnh, đang gửi sang ChatGPT…');
    armTimeout(Math.max(1,job.expires-Date.now()),'ChatGPT chưa trả kết quả trong thời gian chờ. Hãy mở hội thoại và bấm Đồng bộ kết quả trên Extension.');return;
   }
   if(data.state==='error'){
    window.postMessage({source:'vis-web',type:'studio-transcript-ack',jobId:job.id},'*');
    failPending(String(data.message||data.text||'Không gửi được lệnh sang ChatGPT.'));return;
   }
   if(data.state==='progress'){finishRecovery();return;}
   if(data.state!=='completed')return;
   finishRecovery();
   try{
    if(job.kind==='mindmap'){
     const parsed=typeof data.text==='string'?JSON.parse(data.text):data.text;
     const branches=partitionBranches(parsed,ws.transcript?.text||'');
     setWs(s=>({...s,branches,sections:sectionsFromBranches(branches),selectedBranchId:branches[0]?.id||''}));
    }else if(job.sectionId){
     const text=String(data.text||'').trim();if(!text)throw new Error('ChatGPT trả về kịch bản trống.');
     setWs(s=>({...s,sections:s.sections.map(x=>x.id===job.sectionId?{...x,status:'done',rewrittenText:text}:x)}));
    }
    window.postMessage({source:'vis-web',type:'studio-transcript-ack',jobId:job.id},'*');setError('');clearPending();
   }catch(err){window.postMessage({source:'vis-web',type:'studio-transcript-ack',jobId:job.id},'*');failPending(err instanceof Error?err.message:'Kết quả ChatGPT không hợp lệ.')}
  };
  window.addEventListener('message',receive);
  if(pending.current){pending.current.started=true;armTimeout(Math.max(1,pending.current.expires-Date.now()),'Tác vụ Transcript đã quá thời gian chờ.');window.postMessage({source:'vis-web',type:'studio-status'},'*')}
  const poll=window.setInterval(()=>{if(pending.current?.started)requestResult(false)},8000);
  return()=>{window.removeEventListener('message',receive);clearTimeout(timer.current);clearTimeout(recoveryTimer.current);recovery.current=null;window.clearInterval(poll)};
 },[projectId,pairCode,ws.transcript?.text]);
 const sendChat=(prompt:string,kind:'mindmap'|'rewrite',sectionId?:string)=>{
  if(pending.current)return;
  const job:PendingAi={id:'transcript-'+crypto.randomUUID(),kind,sectionId,expires:Date.now()+10*60*1000};
  pending.current=job;localStorage.setItem(pendingKey,JSON.stringify(job));setError('');setAiBusy(kind==='mindmap'?'mindmap':sectionId||'rewrite');setAiStatus('Đang chuyển lệnh sang Extension…');
  armTimeout(45000,'Extension chưa nhận lệnh sau 45 giây. Kiểm tra: chỉ bật một bản Extension (bản trong thư mục AI_MANAGER), ChatGPT đã đăng nhập, và Studio đã Kết nối ChatGPT.');
  window.postMessage({source:'vis-web',type:'studio-transcript-ai',pairCode,command:{id:job.id,type:kind==='mindmap'?'transcript_mindmap':'transcript_rewrite',kind,sectionId,prompt}},'*');
 };

 const patch=(p:Partial<TranscriptWorkspaceState>)=>setWs(s=>({...s,...p}));
 const load=async(override?:{url:string;language?:string})=>{const url=(override?.url||ws.url).trim(),language=override?.language||ws.language;if(!url)return false;const generation=stopGeneration.current;setBusy(true);setError('');try{const transcript=await fetchTranscript({url,language});if(generation!==stopGeneration.current)return false;patch({url,language,transcript,branches:[],sections:[],selectedBranchId:''});return true;}catch(e){if(generation===stopGeneration.current)setError(e instanceof Error?e.message:'Không lấy được transcript.');return e instanceof Error?e.message:'Không lấy được transcript.'}finally{if(generation===stopGeneration.current)setBusy(false)}};
 const createParts=()=>{if(!ws.transcript||pending.current)return;if(ws.sections.length&&!window.confirm('Chia lại sẽ thay thế danh sách phần và nội dung đã viết lại. Bạn có chắc muốn tiếp tục?'))return;sendChat(buildPartitionPrompt(ws.transcript.text,ws.language),'mindmap')};
 const rewrite=(section:ScriptSection)=>{if(pending.current)return;setWs(s=>({...s,sections:s.sections.map(x=>x.id===section.id?{...x,status:'processing'}:x)}));const idx=ws.sections.findIndex(x=>x.id===section.id);const context=[ws.sections[idx-1]?.summary,ws.sections[idx+1]?.summary].filter(Boolean).join(' | ');sendChat(buildRewritePrompt(section,ws.stylePrompt,context),'rewrite',section.id)};
 const stop=()=>{setBatch(false);const wasPending=!!pending.current;clearPending();setWs(s=>({...s,sections:s.sections.map(x=>x.status==='processing'||x.status==='waiting'?{...x,status:'stopped'}:x)}));if(wasPending)window.postMessage({source:'vis-web',type:'studio-stop'},'*')};
 const rewriteAll=()=>{if(!pending.current&&ws.sections.some(x=>x.status!=='done'))setBatch(true)};
 useEffect(()=>{
  if(!batchRunning||pending.current)return;
  const next=ws.sections.find(x=>x.status!=='done');
  if(!next){setBatch(false);return}
  // Give the completed job's acknowledgement time to settle before dispatching the next.
  const dispatch=setTimeout(()=>{if(batch.current&&!pending.current)rewrite(next)},300);
  return()=>clearTimeout(dispatch);
 },[batchRunning,aiBusy,ws.sections,ws.stylePrompt]);
 const importPartition=()=>{
  if(!ws.transcript)return;
  try{
   const parsed=JSON.parse(jsonText.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
   const branches=partitionBranches(parsed,ws.transcript.text);
   if(ws.sections.some(x=>x.rewrittenText.trim())&&!window.confirm('Lưu danh sách phần mới sẽ thay thế nội dung đã viết lại. Tiếp tục?'))return;
   if(pending.current)window.postMessage({source:'vis-web',type:'studio-stop'},'*');
   setBatch(false);clearPending();setWs(s=>({...s,branches,sections:sectionsFromBranches(branches),selectedBranchId:branches[0]?.id||''}));setError('');setShowJson(false);setJsonText('');setJsonError('');
  }catch(err){setJsonError(err instanceof Error?err.message:'JSON chưa hợp lệ. Nội dung hiện tại vẫn được giữ nguyên.')}
 };

 // AI MANAGER pipeline: Get transcript -> split -> rewrite in the saved style -> hand the script to analysis.
 // Runs only for a command addressed to the open project; each step reuses the buttons above.
 const [mgr,setMgr]=useState<ManagerTranscript|null>(null);
 useEffect(()=>{
  const check=()=>{const cmd=readManagerTranscript();if(!cmd||cmd.sessionId!==localStorage.getItem('vis-session'))return;const st=readManagerTranscriptState();if(st?.id===cmd.id&&['done','error'].includes(st.stage))return;setMgr(current=>current?.id===cmd.id?current:cmd)};
  check();const t=window.setInterval(check,2000);return()=>window.clearInterval(t);
 },[]);
 useEffect(()=>{
  if(!mgr||busy||aiBusy||pending.current)return;
  const st=readManagerTranscriptState();const state=st?.id===mgr.id?st:{id:mgr.id,stage:'start',attempts:0};
  if(['done','error'].includes(state.stage))return;
  const save=(next:Partial<ManagerTranscriptState>)=>writeManagerTranscriptState({...state,...next,id:mgr.id,at:Date.now()});
  const fail=(message:string)=>{save({stage:'error',error:message});setMgr(null)};
  const attempt=(stage:string)=>{const n=state.stage===stage?(state.attempts||0)+1:1;if(n>3){fail(error||'Không hoàn tất bước '+stage+' sau 3 lần thử.');return false}save({stage,attempts:n,error:''});return true};
  if(!ws.transcript||ws.url.trim()!==mgr.url){if(!attempt('fetch'))return;void load({url:mgr.url,language:mgr.language});return}
  if(!mgr.rewrite){save({stage:'done',done:1,total:1});setMgr(null);void onUseTranscript(ws.transcript.text,ws.transcript.title);return}
  if(mgr.style&&ws.stylePrompt!==mgr.style){patch({stylePrompt:mgr.style});return}
  if(!ws.stylePrompt.trim()){fail('Chưa có prompt phong cách viết lại. Nhập trong AI MANAGER hoặc tab Get Transcript.');return}
  if(!ws.sections.length){if(!attempt('partition'))return;sendChat(buildPartitionPrompt(ws.transcript.text,ws.language),'mindmap');return}
  const done=ws.sections.filter(x=>x.status==='done').length;
  // Several ChatGPT tabs: hand the sections to the Studio server; AI MANAGER gives each tab its share.
  if(mgr.parallel&&done<ws.sections.length){
   if(!state.uploaded){
    const sections=ws.sections.map((s,i)=>({id:s.id,title:s.title,prompt:buildRewritePrompt(s,ws.stylePrompt,[ws.sections[i-1]?.summary,ws.sections[i+1]?.summary].filter(Boolean).join(' | '))}));
    save({stage:'rewrite',done,total:ws.sections.length,uploaded:false});
    void api.post('/api/sessions/'+projectId+'/rewrite',{sections}).then(()=>save({stage:'rewrite',done,total:ws.sections.length,uploaded:true})).catch(err=>{if(attempt('upload'))setError(err instanceof Error?err.message:'Không gửi được danh sách phần.')});
   }
   return;
  }
  if(done<ws.sections.length){if(batchRunning){if(state.stage!=='rewrite'||state.done!==done)save({stage:'rewrite',done,total:ws.sections.length,attempts:state.stage==='rewrite'?state.attempts:0});return}
   const failed=ws.sections.filter(x=>x.status==='error'||x.status==='stopped').length;if(failed&&!attempt('rewrite'))return;save({stage:'rewrite',done,total:ws.sections.length});setBatch(true);return}
  const text=assembleRewrittenScript(ws.sections);if(!text.trim()){fail('Kịch bản viết lại trống.');return}
  save({stage:'done',done,total:ws.sections.length});setMgr(null);void onUseTranscript(text,ws.transcript.title);
 },[mgr,busy,aiBusy,batchRunning,ws.transcript,ws.url,ws.sections,ws.stylePrompt,error]);

 // Parallel rewrite: read the results the tabs saved on the Studio server (small stamp first).
 useEffect(()=>{
  if(!mgr?.parallel)return;
  let seen='';
  const pull=async()=>{
   const st=readManagerTranscriptState();if(!st||st.id!==mgr.id||!st.uploaded)return;
   try{
    const v=(await api.get<{version:{rewrite?:{done:number;total:number;updatedAt:number}|null}|null}>('/api/sessions/'+projectId+'/version')).data.version?.rewrite;
    if(!v)return;const key=v.done+':'+v.updatedAt;if(key===seen)return;seen=key;
    const rows=((await api.get('/api/sessions/'+projectId)).data.session as unknown as {rewrite?:{sections:{id:string;status:string;text:string;error?:string}[]}}|null)?.rewrite?.sections||[];
    const byId=new Map(rows.map(r=>[r.id,r]));
    setWs(s=>({...s,sections:s.sections.map(x=>{const r=byId.get(x.id);if(!r)return x;return r.status==='done'?{...x,status:'done',rewrittenText:r.text}:r.status==='processing'?{...x,status:'processing'}:r.status==='error'?{...x,status:'error',error:r.error}:x})}));
    writeManagerTranscriptState({...st,stage:'rewrite',done:v.done,total:v.total,at:Date.now()});
   }catch{/* next round */}
  };
  void pull();const t=window.setInterval(()=>void pull(),8000);return()=>window.clearInterval(t);
 },[mgr?.id,mgr?.parallel,projectId]);
 // A job lost in a browser restart (the extension no longer has it) is dropped at once, not after 10 minutes.
 const lostChecks=useRef(0);
 useEffect(()=>{
  const onStatus=(e:MessageEvent)=>{
   if(e.source!==window||e.data?.source!=='vis-extension'||e.data.type!=='studio-status')return;
   if(typeof e.data.activeJobId!=='string'||!e.data.chatReady)return;const job=pending.current;if(!job?.started){lostChecks.current=0;return}
   const known=String(e.data.activeJobId||'')===job.id||(e.data.transcriptEvents||[]).some((x:{jobId?:string})=>x?.jobId===job.id);
   lostChecks.current=known?0:lostChecks.current+1;
   if(lostChecks.current>=3){lostChecks.current=0;failPending('Tác vụ dở bị mất khi trình duyệt khởi động lại; sẽ làm lại phần này.')}
  };
  window.addEventListener('message',onStatus);return()=>window.removeEventListener('message',onStatus);
 },[]);
 const selectedPart=ws.sections.find(x=>x.branchId===ws.selectedBranchId)||ws.sections[0];
 const chars=ws.transcript?.text.length||0;
 return <section className="transcript-page workspace">
  {showJson&&<div className="connection-modal" role="dialog" aria-modal="true" aria-label="Nhận JSON chia phần"><section className="connection-dialog json-import-dialog"><button className="modal-close" onClick={()=>setShowJson(false)} aria-label="Đóng dán JSON">×</button><h2>Nhận kết quả chia phần đã có</h2><p>Dán toàn bộ JSON của đúng transcript hiện tại từ ChatGPT. Web kiểm tra mốc chia và lấy nguyên văn, không gửi lệnh phân tích lại.</p><textarea aria-label="JSON chia phần" value={jsonText} onChange={e=>setJsonText(e.target.value)} placeholder={'{"branches":[{"title":"Phần 1","end":1}]}'} spellCheck={false}/>{jsonError&&<p className="transcript-error" role="alert">{jsonError}</p>}<button onClick={importPartition} disabled={!jsonText.trim()}>Lưu các phần từ JSON</button></section></div>}

  <div className="yt-row panel"><strong>Tên dự án</strong><input className="project-name" value={projectName} onChange={e=>setProjectName(e.target.value)} onBlur={()=>{const name=projectName.trim();if(name)saveProjectName(projectId,name)}} placeholder="Đặt tên dự án trước"/><strong><Youtube size={19}/> Link YouTube</strong><input className="youtube-link" value={ws.url} onChange={e=>patch({url:e.target.value})} placeholder="https://www.youtube.com/watch?v=..."/><label>Ngôn ngữ<select value={ws.language} onChange={e=>patch({language:e.target.value})}><option value="vi">Tiếng Việt (Tự động)</option><option value="en">English</option></select></label><button>Tùy chọn</button><button className="primary" onClick={()=>void load()} disabled={busy||!!aiBusy||batchRunning||!ws.url||nameDefault} title={nameDefault?'Đặt tên dự án trước để lưu công việc riêng cho dự án này':''}>{busy?<LoaderCircle className="spin" size={17}/>:<Youtube size={17}/>} Lấy Transcript</button></div>
  <div className="transcript-panel panel"><header><strong>▣ Transcript (kịch bản gốc từ YouTube)</strong><span className="ok">● {ws.transcript?'Đã lấy transcript thành công':'Chưa có transcript'}</span>{ws.transcript&&<span>• Số ký tự: {chars.toLocaleString('vi-VN')}</span>}<div className="grow"/><button onClick={()=>window.open(ws.url,'_blank')}><ExternalLink size={15}/> Xem video</button><button onClick={()=>navigator.clipboard?.writeText(display)}><Clipboard size={15}/> Sao chép</button><button onClick={()=>downloadText(display,'youtube-transcript.txt')}><Download size={15}/> Tải xuống (.txt)</button></header><textarea value={display} readOnly placeholder="Transcript sẽ hiển thị tại đây..."/><label className="timestamp"><input type="checkbox" checked={withTime} onChange={e=>setWithTime(e.target.checked)}/> Timestamp</label></div>
  {aiStatus&&<div className="transcript-ai-status" role="status">{aiStatus}</div>}
  {error&&<div className="transcript-error">{error}</div>}
  <div className="middle-grid">
   <div className="panel transcript-part-panel"><header><strong><ListOrdered size={18}/> Nội dung phần đang chọn</strong><div className="grow"/><button className="primary" onClick={createParts} disabled={!ws.transcript||!!aiBusy||batchRunning}><ListOrdered size={15}/> Chia phần để viết lại</button><button onClick={createParts} disabled={!ws.transcript||!!aiBusy||batchRunning||!ws.sections.length}><RotateCcw size={15}/> Chia lại</button><button onClick={()=>requestResult()} disabled={!aiBusy||syncing}>{syncing?'Đang đồng bộ…':'Đồng bộ kết quả'}</button><button onClick={()=>{setShowJson(true);setJsonError('')}} disabled={!ws.transcript}>Dán JSON kết quả</button><button className="mindmap-stop" onClick={stop} disabled={!aiBusy&&!batchRunning}><Square size={15}/> Dừng</button></header>{selectedPart?<div className="transcript-part-source"><b>{selectedPart.title}</b><small>{selectedPart.sourceText.length.toLocaleString('vi-VN')} ký tự · Nguyên văn transcript</small><div>{selectedPart.sourceText}</div></div>:<div className="transcript-part-empty">Bấm “Chia phần để viết lại”. ChatGPT chỉ chọn mốc chia; web giữ nguyên nội dung gốc, không cần tạo Mindmap.</div>}</div>
   <div className="panel sections-panel"><header><strong>☷ Các phần kịch bản</strong><span className="grow"/>Tổng: {ws.sections.length} phần</header><div className="transcript-sections-scroll"><table><thead><tr><th>#</th><th>Tên phần</th><th>Nội dung đầu phần</th><th>Số ký tự</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{ws.sections.map((s,i)=><tr key={s.id} className={ws.selectedBranchId===s.branchId?'selected-row':''}><td>{i+1}</td><td><b>{s.title}</b></td><td>{s.summary}</td><td>{s.sourceText.length.toLocaleString('vi-VN')}</td><td><span className={'status '+s.status}>{statusLabel(s.status)}</span></td><td><button onClick={()=>patch({selectedBranchId:s.branchId})}>Xem</button></td></tr>)}</tbody></table></div></div>
  </div>
  <div className="panel rewrite-panel"><header><strong>✎ Prompt phong cách & Viết lại kịch bản</strong></header><div className="rewrite-grid"><div className="style-box"><b>Phong cách cá nhân hóa</b><textarea value={ws.stylePrompt} onChange={e=>patch({stylePrompt:e.target.value})} placeholder="Mô tả cách viết, giọng văn, thói quen, chủ đề yêu thích..."/><button onClick={()=>{localStorage.setItem('vis-transcript-style',ws.stylePrompt)}}><Save size={15}/> Lưu phong cách</button></div><div className="processing"><div className="part-actions"><b>{batchRunning?`Đang viết lần lượt · ${ws.sections.filter(x=>x.status==='done').length}/${ws.sections.length} phần xong`:'Xử lý từng phần'}</b>{ws.sections.map((s,i)=><button key={s.id} onClick={()=>rewrite(s)} disabled={!!aiBusy||batchRunning}>{`Phần ${i+1}`}<small>{s.status==='done'?'Đã viết':'Viết lại'}</small></button>)}<button onClick={rewriteAll} disabled={!ws.sections.some(x=>x.status!=='done')||!!aiBusy||batchRunning}>Viết lại toàn bộ<br/><small>(từng phần)</small></button><button className="danger" onClick={stop} disabled={!aiBusy&&!batchRunning}><Square size={14}/> Dừng xử lý</button></div><div className="result-head"><b>▣ Kết quả kịch bản đã viết lại</b><div className="grow"/><button onClick={()=>navigator.clipboard?.writeText(finalText)}>Sao chép</button><button onClick={()=>downloadText(finalText,'kich-ban-da-viet-lai.txt')}>Tải xuống (.txt)</button></div><textarea className="final-text" value={finalText} readOnly placeholder="Kịch bản sau khi viết lại sẽ hiển thị tại đây..."/><button className="finish" disabled={!finalText} onClick={()=>onUseTranscript(finalText,ws.transcript?.title)}>Hoàn tất & Đưa kịch bản sang Phân tích →</button></div></div></div>
 </section>;
}
