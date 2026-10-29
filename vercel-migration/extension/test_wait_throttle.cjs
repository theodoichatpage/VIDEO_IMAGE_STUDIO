// The reply waiter must not read/parse the page on every streamed token (that froze ChatGPT).
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/content.js','utf8');
const section=src.slice(src.indexOf('  async function waitForFinalAnswer('),src.indexOf('  async function waitForComposer()'));
let now=0,generating=true,reads=0,observerCb=null,emitted=[];
const final=JSON.stringify({scenes:[{title:'A',prompt:'p'}]});
const reader={
 sources(){reads++;return {sources:[generating?'{"scenes":[{"title":"A"':final]};},
 readStreaming(){reads++;return {text:'',complete:false};},
 read(){reads++;return generating?{text:'',reason:'invalid-json'}:{text:final,reason:'matched'};},
};
const c={VISReplyReader:reader,Date:{now:()=>now},Math,JSON,Error,
 document:{body:{}},replyContext:{id:'j'},cancelled:false,generation:1,
 MutationObserver:class{constructor(cb){observerCb=cb;}observe(){}disconnect(){}},
 isGenerating:()=>generating,stopButton:()=>null,emit:async p=>emitted.push(p),
 assistantText:()=>{reads++;return generating?'partial':final;},
 sleep:async ms=>{now+=ms;for(let i=0;i<200&&generating;i++)observerCb();if(now>=20000)generating=false;}};
vm.createContext(c);vm.runInContext('globalThis.wait=(async()=>{})();'+section.replace('async function waitForFinalAnswer','globalThis.waitForFinalAnswer=async function'),c);
(async()=>{
 const text=await c.waitForFinalAnswer('before','part_analysis',1);
 assert.equal(text,final,'final reply returned once ChatGPT is idle');
 // 20 s of streaming with ~8,000 DOM mutations: reads are throttled to a few dozen at most.
 assert.ok(reads<40,'reader calls throttled, got '+reads);
 console.log('test_wait_throttle PASS ('+reads+' reads for 8000 mutations)');
})().catch(e=>{console.error(e);process.exit(1);});
