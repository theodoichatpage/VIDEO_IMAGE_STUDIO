import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function worker(){
 let listener;const stored={pairCode:'project-a'},out=[],requests=[],sent=[];
 const context=vm.createContext({URL,AbortSignal,chrome:{
  storage:{local:{get:async()=>structuredClone(stored),set:async x=>Object.assign(stored,structuredClone(x)),remove:async keys=>keys.forEach(k=>delete stored[k])}},
  runtime:{onMessage:{addListener:fn=>listener=fn}},
  tabs:{query:async()=>[{id:2,url:'https://chatgpt.com/c/test'},{id:3,url:'https://video-image-studio.vercel.app/'}],sendMessage:async(id,msg)=>{if(msg.type==='vis-ping')return{ready:true,version:'0.4.21'};if(msg.type==='vis-command'){sent.push(msg.command);return{ok:true}}out.push(msg);return{ok:true}}}
 },fetch:async(url,opts)=>{requests.push(url);return{ok:true,json:async()=>({session:{}})}}});
 vm.runInContext(readFileSync(new URL('../extension/background.js',import.meta.url),'utf8'),context);
 return{stored,out,requests,sent,message:(m,sender={})=>new Promise(r=>listener(m,sender,r))};
}
const command={id:'transcript-job-1',type:'transcript_mindmap',prompt:'Map this transcript',kind:'mindmap'};
test('mindmap web message reaches the existing ChatGPT command transport',async()=>{
 let receive;const sent=[],posted=[];const win={addEventListener:(type,fn)=>receive=fn,postMessage:m=>posted.push(m)};
 vm.runInNewContext(readFileSync(new URL('../extension/web_bridge.js',import.meta.url),'utf8'),{window:win,location:{origin:'https://video-image-studio.vercel.app'},chrome:{runtime:{sendMessage:async m=>{sent.push(m);return{ok:true}},onMessage:{addListener:()=>{}}}}});
 await receive({source:win,data:{source:'vis-web',type:'studio-transcript-ai',pairCode:'project-a',command}});
 assert.equal(sent.at(-1).type,'vis-transcript-send');assert.equal(sent.at(-1).command.id,command.id);
 assert.equal(posted.at(-1).type,'studio-transcript-ai-result');assert.equal(posted.at(-1).state,'accepted');
});
test('mindmap completion is retained for web delivery and never sent to analysis backend',async()=>{
 const w=worker();assert.equal((await w.message({type:'vis-transcript-send',pairCode:'project-a',command})).ok,true);
 assert.equal(w.sent[0].type,'transcript_mindmap');
 await w.message({type:'vis-chat-event',payload:{jobId:command.id,state:'completed',text:'{"branches":[{"id":"1","title":"A","content":"A"}]}'}},{tab:{id:2,url:'https://chatgpt.com/c/test'}});
 assert.equal(w.requests.length,0);assert.equal(w.out.at(-1).type,'vis-transcript-event');
 assert.equal(w.out.at(-1).payload.kind,'mindmap');assert.equal(w.stored.transcriptJobs[command.id].result.state,'completed');
});
test('rejects an unpaired transcript request without sending a prompt',async()=>{
 const w=worker();const result=await w.message({type:'vis-transcript-send',pairCode:'wrong',command});
 assert.equal(result.ok,false);assert.match(result.error,/kết nối/i);assert.equal(w.sent.length,0);
});
test('stopped transcript jobs cannot deliver late results to another task',async()=>{
 const w=worker();await w.message({type:'vis-transcript-send',pairCode:'project-a',command});await w.message({type:'vis-stop'});
 const before=w.out.length;await w.message({type:'vis-chat-event',payload:{jobId:command.id,state:'completed',text:'late'}},{tab:{id:2,url:'https://chatgpt.com/c/test'}});
 assert.equal(w.out.length,before);assert.equal(w.requests.length,0);
});
test('rejects replies from a ChatGPT tab other than the one assigned the transcript job',async()=>{
 const w=worker();await w.message({type:'vis-transcript-send',pairCode:'project-a',command});const before=w.out.length;
 await w.message({type:'vis-chat-event',payload:{jobId:command.id,state:'completed',text:'wrong tab'}},{tab:{id:99,url:'https://chatgpt.com/c/other'}});
 assert.equal(w.out.length,before);assert.equal(w.requests.length,0);
});
test('reader accepts branches and plain rewritten text only after matching the current prompt',()=>{
 const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../extension/reply-reader.js',import.meta.url),'utf8'),c);
 assert.equal(JSON.parse(c.VISReplyReader.extract('{"branches":[{"id":"1"}]}','transcript_mindmap')).branches.length,1);
 const nodes=[{role:'user',text:'[VIS_JOB_ID:rewrite-2] Rewrite part 2'},{role:'assistant',text:'Kịch bản mới, không phải JSON.'}].map(x=>({innerText:x.text,textContent:x.text,getAttribute:n=>n==='data-message-author-role'?x.role:'',querySelectorAll:()=>[]}));
 const doc={querySelectorAll:s=>s.includes('data-message-author-role')?nodes:[]};
 assert.equal(c.VISReplyReader.read(doc,{id:'rewrite-2',type:'transcript_rewrite',prompt:'Rewrite part 2'}).text,'Kịch bản mới, không phải JSON.');
 assert.equal(c.VISReplyReader.read(doc,{id:'wrong',type:'transcript_rewrite',prompt:'Rewrite another part'}).text,'');
});

test('replays completed mindmap after web reload until the web acknowledges it',async()=>{
 const w=worker();await w.message({type:'vis-transcript-send',pairCode:'project-a',command});
 await w.message({type:'vis-chat-event',payload:{jobId:command.id,state:'completed',text:'{"branches":[{"id":"1"}]}'}},{tab:{id:2,url:'https://chatgpt.com/c/test'}});
 const status=await w.message({type:'vis-status'});assert.equal(status.transcriptEvents[0].jobId,command.id);
 await w.message({type:'vis-transcript-ack',jobId:command.id});
 assert.equal((await w.message({type:'vis-status'})).transcriptEvents.length,0);
});
test('a stale completed analysis slot does not block a new transcript command',async()=>{
 const w=worker();w.stored.activeJobId='old-analysis-job';
 assert.equal((await w.message({type:'vis-transcript-send',pairCode:'project-a',command})).ok,true);
 assert.equal(w.sent.length,1);
});

test('rewrite response retains its section ID and remains separate from mindmap results',async()=>{
 const w=worker();const rewrite={id:'transcript-rewrite-2',type:'transcript_rewrite',kind:'rewrite',sectionId:'2',prompt:'Phong cách: hoạt ngôn. PHẦN HIỆN TẠI: Nội dung phần 2.'};
 assert.equal((await w.message({type:'vis-transcript-send',pairCode:'project-a',command:rewrite})).ok,true);
 await w.message({type:'vis-chat-event',payload:{jobId:rewrite.id,state:'completed',text:'Nội dung phần hai đã viết lại.'}},{tab:{id:2,url:'https://chatgpt.com/c/test'}});
 const payload=w.out.at(-1).payload;assert.equal(payload.kind,'rewrite');assert.equal(payload.sectionId,'2');assert.equal(payload.text,'Nội dung phần hai đã viết lại.');assert.equal(w.requests.length,0);
});
