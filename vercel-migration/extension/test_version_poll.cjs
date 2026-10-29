// Egress: periodic checks read the small version stamp; the whole project is downloaded only when needed.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const bg=fs.readFileSync(__dirname+'/background.js','utf8');
const section=bg.slice(bg.indexOf('async function captureCommand('),bg.indexOf('let enqueue = Promise.resolve();'));
const own=bg.slice(bg.indexOf('function ownJob('),bg.indexOf('\n',bg.indexOf('function ownJob(')));
function run(version,stored){
 const h={full:0,captures:0,now:1793260000000};
 const c={Date:{now:()=>h.now},Promise,Error,String,AbortSignal:{timeout:()=>undefined},encodeURIComponent,stopGeneration:0,stopDepth:0,checkStop(){},
  studioVersion:async()=>version,
  chrome:{storage:{local:{get:async()=>stored,set:async()=>{}}},tabs:{sendMessage:async()=>{h.captures++;return {ok:false,busy:true};}}},
  chatTabs:async()=>[{id:1}],ensureChatReceiver:async id=>({id}),
  fetch:async()=>{h.full++;return {ok:true,json:async()=>({session:{activeJob:version?.activeJob?{...version.activeJob,prompt:'p'}:null}})}},queueAndBroadcast:async()=>{}};
 vm.createContext(c);vm.runInContext(own+';'+section+';globalThis.reconcile=reconcileWaitingResult;',c);return {h,c};
}
(async()=>{
 let {h,c}=run({activeJob:null,laneJobs:[],lastJob:null,lastError:''},{pairCode:'pair',activeJobId:''});
 await c.reconcile();assert.equal(h.full,0,'idle project: no full download');assert.equal(h.captures,0);
 ({h,c}=run({activeJob:{id:'j1',type:'part_analysis',status:'waiting',lane:'laneB'},laneJobs:[]},{pairCode:'pair',activeJobId:'other'}));
 await c.reconcile();assert.equal(h.full,0,'another browser\'s job: no download');
 ({h,c}=run({activeJob:{id:'j1',type:'part_analysis',status:'waiting'},laneJobs:[]},{pairCode:'pair',activeJobId:'j1'}));
 await c.reconcile();assert.equal(h.full,1,'own waiting job: full project read once to re-read the reply');
 ({h,c}=run(null,{pairCode:'pair',activeJobId:''}));
 await c.reconcile();assert.equal(h.full,1,'older server without stamp: previous behaviour');
 console.log('test_version_poll PASS');
})().catch(e=>{console.error(e);process.exit(1);});
