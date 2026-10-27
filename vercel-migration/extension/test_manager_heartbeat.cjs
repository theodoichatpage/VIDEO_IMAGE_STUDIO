const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/background.js','utf8');
const begin=src.indexOf('async function managerHeartbeat()');
const end=src.indexOf("chrome.alarms.create('manager-heartbeat'",begin);
assert(begin>=0&&end>begin);
const calls=[];const st={chatTabId:7,pairCode:'pair',activeJobId:'job'};
const c={chrome:{storage:{local:{get:async()=>st}},tabs:{get:async id=>({id,url:'https://chatgpt.com/c/test'}),sendMessage:async()=>({msgCount:1,lastLen:10,jobId:'job'})}},fetch:async(url,opt)=>{calls.push({url,body:JSON.parse(opt.body)});return {ok:true}},AbortSignal};
vm.runInNewContext(src.slice(begin,end)+';globalThis.run=managerHeartbeat',c);
(async()=>{await c.run();assert.equal(calls.length,1);assert.equal(calls[0].body.tabAlive,true);assert.equal(calls[0].body.activeJobId,'job');c.chrome.tabs.get=async()=>({url:'https://example.com'});await c.run();assert.equal(calls[1].body.tabAlive,false);assert.equal(calls[1].body.fp,null);console.log('heartbeat mock PASS')})().catch(e=>{console.error(e);process.exit(1)});
