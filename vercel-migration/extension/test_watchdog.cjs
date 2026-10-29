// The watchdog reloads a hung or silent ChatGPT tab (bounded) and finally reports an error, never while ChatGPT works.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/background.js','utf8');
const section=src.slice(src.indexOf('const WATCH_HUNG_MS'),src.indexOf("chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='manager-heartbeat')"));
function harness(){
 const store={pairCode:'pair',activeJobId:'job1',chatTabId:5};const h={store,reloads:0,events:[],pong:{ready:true,generating:false},job:{id:'job1',status:'waiting'}};
 const c={stopDepth:0,cancelledJobs:new Set(),reconciledAt:123,encodeURIComponent,AbortSignal:{timeout:()=>undefined},Promise,setTimeout,
  chrome:{storage:{local:{get:async()=>({...store}),set:async o=>Object.assign(store,o),remove:async k=>{delete store[k];}}},
   tabs:{sendMessage:async()=>h.pong,reload:async()=>{h.reloads++;}}},
  fetch:async()=>({json:async()=>({session:{activeJob:h.job}})}),
  queueAndBroadcast:async p=>h.events.push(p)};
 vm.createContext(c);vm.runInContext(section+';globalThis.watch=chatWatchdog;',c);h.c=c;return h;
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
 // Silent tab (alive, not generating, job still waiting): reload after 2 min.
 h=harness();
 await h.c.watch(0);await h.c.watch(60000);assert.equal(h.reloads,0);await h.c.watch(120000);assert.equal(h.reloads,1);
 assert.equal(h.c.reconciledAt,0,'re-read allowed right after reload');
 // Job finished meanwhile: watch cleared, nothing else happens.
 h.job={id:'job1',status:'completed'};await h.c.watch(400000);assert.equal(h.store.chatWatch,undefined);assert.equal(h.reloads,1);
 // STOP ALL in progress: no action.
 h=harness();h.pong=null;h.c.stopDepth=1;for(let t=0;t<=300000;t+=30000)await h.c.watch(t);assert.equal(h.reloads,0);
 console.log('test_watchdog PASS');
})().catch(e=>{console.error(e);process.exit(1);});
