// The watchdog reloads a hung or silent ChatGPT tab (bounded) and finally reports an error, never while ChatGPT works.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/background.js','utf8');
const section=src.slice(src.indexOf('const WATCH_HUNG_MS'),src.indexOf("chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='manager-heartbeat')"));
function harness(){
 const store={pairCode:'pair',activeJobId:'job1',chatTabId:5};const h={store,reloads:0,updates:[],events:[],pong:{ready:true,generating:false},job:{id:'job1',status:'waiting'}};
 const c={studioVersion:async()=>null,ownJob:(s,id)=>[s?.activeJob,...(s?.laneJobs||[])].find(j=>j&&id&&j.id===id)||null,stopDepth:0,stopGeneration:0,cancelledJobs:new Set(),reconciledAt:123,encodeURIComponent,AbortSignal:{timeout:()=>undefined},Promise,setTimeout,clearTimeout,
  chrome:{storage:{local:{get:async()=>({...store}),set:async o=>Object.assign(store,o),remove:async k=>{delete store[k];}}},
   tabs:{sendMessage:async(id,m)=>m.type==='vis-capture-result'?h.capture:h.pong,reload:async()=>{h.reloads++;},update:async(id,o)=>{h.updates.push({id,url:o.url});}}},
  fetch:async()=>({json:async()=>({session:{activeJob:h.job}})}),
  queueAndBroadcast:async p=>h.events.push(p)};
 c.CHATGPT_PREFIX='https://chatgpt.com/';vm.createContext(c);vm.runInContext(section+';globalThis.watch=chatWatchdog;',c);h.c=c;return h;
}
(async()=>{
 // ChatGPT is answering: never reload, however long.
 let h=harness();h.pong={ready:true,generating:true};
 for(let t=0;t<=600000;t+=30000)await h.c.watch(t);
 assert.equal(h.reloads,0,'busy ChatGPT is left alone');
 // Hung tab (no ping reply): reload after 60 s, at most twice, then a clear error.
 h=harness();h.pong=null;
 for(let t=0;t<=900000;t+=30000)await h.c.watch(t);
 assert.equal(h.reloads,2,'bounded reloads');
 assert.equal(h.events.length,1);assert.equal(h.events[0].state,'error');assert.equal(h.events[0].jobId,'job1');
 assert.deepEqual(h.updates,[{id:5,url:'https://chatgpt.com/'}],'after giving up the tab goes to a new chat, so the retry starts fresh');
 // Silent tab (alive, not generating, job still waiting): reload after 2 min.
 h=harness();
 await h.c.watch(0);await h.c.watch(60000);assert.equal(h.reloads,0);await h.c.watch(120000);assert.equal(h.reloads,1);
 assert.equal(h.c.reconciledAt,0,'re-read allowed right after reload');
 // Job finished meanwhile: watch cleared, nothing else happens.
 h.job={id:'job1',status:'completed'};await h.c.watch(400000);assert.equal(h.store.chatWatch,undefined);assert.equal(h.reloads,1);
 // A finished image can already be present when the generation indicator goes idle.
 h=harness();h.job.type='image_generation';
 h.capture={ok:true,payload:{jobId:'job1',state:'completed',imageDataUrl:'data:image/png;base64,aW1hZ2U='}};
 await h.c.watch(0);await h.c.watch(120000);
 assert.equal(h.reloads,0,'capture the completed image before reloading its conversation');
 assert.equal(h.events[0]?.state,'completed');
 assert.deepEqual(h.updates,[]);
 // A completed image waiting on an API retry must not be replaced by a watchdog error.
 h=harness();h.job.type='image_generation';h.pong=null;
 h.store.pendingChatEvents=[{_sessionId:'pair',jobId:'job1',state:'completed',imageDataUrl:'data:image/png;base64,aW1hZ2U='}];
 for(let t=0;t<=900000;t+=30000)await h.c.watch(t);
 assert.equal(h.reloads,0);assert.deepEqual(h.events,[]);assert.deepEqual(h.updates,[]);
 // If capture fails even after two reloads, leave the image conversation open for manual capture.
 h=harness();h.job.type='image_generation';h.pong=null;
 for(let t=0;t<=900000;t+=30000)await h.c.watch(t);
 assert.equal(h.reloads,2);assert.equal(h.events[0]?.state,'error');assert.deepEqual(h.updates,[]);
 // ChatGPT shows its image limit notice: no reload, one error carrying ChatGPT's words (the Manager rests the tab).
 h=harness();h.job.type='image_generation';h.pong={ready:true,generating:false,limit:"You've hit the Plus plan limit for image generations requests. You can create more images when the limit resets in 5 hours."};
 for(let t=0;t<=900000;t+=30000)await h.c.watch(t);
 assert.equal(h.reloads,0,'a limit is not cured by reloading');assert.equal(h.events.length,1);assert.equal(h.events[0].state,'error');
 assert.match(h.events[0].text,/giới hạn.*resets in 5 hours/);assert.deepEqual(h.updates,[]);
 // STOP ALL in progress: no action.
 h=harness();h.pong=null;h.c.stopDepth=1;for(let t=0;t<=300000;t+=30000)await h.c.watch(t);assert.equal(h.reloads,0);
 console.log('test_watchdog PASS');
})().catch(e=>{console.error(e);process.exit(1);});
