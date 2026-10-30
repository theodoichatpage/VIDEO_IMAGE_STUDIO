// A new version written into the extension folder is picked up by reloading, never during a job.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const bg=fs.readFileSync(__dirname+'/background.js','utf8');
const section=bg.slice(bg.indexOf('async function reloadIfUpdated()'),bg.indexOf('chrome.alarms.onAlarm.addListener(alarm=>{'));
function run(disk,running,job){const h={reloads:0};const c={stopDepth:0,fetch:async()=>({json:async()=>({version:disk})}),
 chrome:{runtime:{getURL:p=>p,getManifest:()=>({version:running}),reload:()=>h.reloads++},storage:{local:{get:async()=>({activeJobId:job,activeJobSeen:h.seen}),set:async o=>{h.seen=o.activeJobSeen}}}}};
 vm.createContext(c);vm.runInContext(section+';globalThis.check=reloadIfUpdated;',c);return {h,c};}
(async()=>{
 let {h,c}=run('0.5.4','0.5.3','');assert.equal(await c.check(),true);assert.equal(h.reloads,1);
 ({h,c}=run('0.5.3','0.5.3',''));await c.check();assert.equal(h.reloads,0,'same version: nothing');
 ({h,c}=run('0.5.4','0.5.3','job1'));await c.check();assert.equal(h.reloads,0,'never in the middle of a job');
 ({h,c}=run('0.5.4','0.5.3','stuck'));h.seen={id:'stuck',at:Date.now()-1300000};await c.check();assert.equal(h.reloads,1,'a job stuck 20+ minutes does not block an update');
 console.log('test_self_update PASS');
})().catch(e=>{console.error(e);process.exit(1);});
