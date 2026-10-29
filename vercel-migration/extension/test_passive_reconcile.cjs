// Periodic reconciliation (every Studio status poll) must not read the ChatGPT page while it is answering.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const bg=fs.readFileSync(__dirname+'/background.js','utf8');
const section=bg.slice(bg.indexOf('async function captureCommand('),bg.indexOf('let enqueue = Promise.resolve();'));
const content=fs.readFileSync(__dirname+'/content.js','utf8');
assert.match(content,/message\.passive && \(isGenerating\(\) \|\| \(currentJobId && currentJobId === context\.id\)\)\) \{ sendResponse\(\{ ok: false, busy: true \}\)/,'content answers busy without reading');
let now=1793260000000,captures=[],broadcast=[],reply={ok:false,busy:true};
const job={id:'job1',type:'part_analysis',status:'waiting',prompt:'p'};
const c={Date:{now:()=>now},Promise,Error,String,AbortSignal:{timeout:()=>undefined},encodeURIComponent,
 stopGeneration:0,stopDepth:0,checkStop(){},studioVersion:async()=>null,ownJob:(s,id)=>[s?.activeJob,...(s?.laneJobs||[])].find(j=>j&&id&&j.id===id)||null,
 chrome:{storage:{local:{get:async()=>({pairCode:'pair',chatTabId:1}),set:async()=>{}}},tabs:{sendMessage:async(_id,msg)=>{captures.push(msg);return reply;}}},
 chatTabs:async()=>[{id:1}],ensureChatReceiver:async id=>({id}),
 fetch:async()=>({ok:true,json:async()=>({session:{activeJob:job}})}),
 queueAndBroadcast:async p=>broadcast.push(p)};
vm.createContext(c);vm.runInContext(section+';globalThis.reconcile=reconcileWaitingResult;',c);
(async()=>{
 await c.reconcile();
 assert.equal(captures.length,1);assert.equal(captures[0].passive,true,'periodic capture is passive');
 assert.equal(broadcast.length,0,'busy tab: nothing read or sent');
 now+=5000;await c.reconcile();now+=5000;await c.reconcile();
 assert.equal(captures.length,1,'status polls within 20 s do not touch the ChatGPT tab again');
 now+=20000;reply={ok:true,payload:{jobId:'job1',state:'completed',text:'{"scenes":[{"prompt":"x"}]}'}};
 await c.reconcile();
 assert.equal(captures.length,2);assert.equal(broadcast.length,1,'after the tab is free a complete reply is delivered');
 console.log('test_passive_reconcile PASS');
})().catch(e=>{console.error(e);process.exit(1);});
