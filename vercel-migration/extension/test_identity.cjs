const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/background.js','utf8');
const section=src.slice(src.indexOf('async function managerHeartbeat()'),src.indexOf("chrome.alarms.create('manager-heartbeat'"));
const data={chatTabId:1,pairCode:'pair',activeJobId:'job',conversationUrl:'https://chatgpt.com/c/abc',identityJobId:'job'};
let sent=[],tabs=[{id:1,url:data.conversationUrl}],ping={ready:true,pairCode:'pair',activeJobId:'job',lastHeartbeatAt:1000,version:'0.4.22'};
const chrome={storage:{local:{get:async()=>({...data}),set:async o=>Object.assign(data,o)}},tabs:{get:async id=>tabs.find(t=>t.id===id),query:async()=>tabs,sendMessage:async()=>ping,onUpdated:{addListener(){}}}};
const c={chrome,URL,AbortSignal,setTimeout,clearTimeout,fetch:async(_,v)=>{sent.push(JSON.parse(v.body));return {ok:true}}};vm.createContext(c);vm.runInContext(section+';globalThis.run=managerHeartbeat;',c);
(async()=>{await c.run();assert.equal(sent[0].chatTabId,1);assert.equal(sent[0].activeJobId,'job');tabs=[{id:2,url:data.conversationUrl}];await c.run();assert.equal(sent[1].chatTabId,2);ping={ready:true,pairCode:'pair',activeJobId:'other'};await c.run();assert.equal(sent[2].chatTabId,null);assert.equal(sent[2].lastHeartbeatAt,null);console.log('heartbeat identity PASS')})().catch(e=>{console.error(e);process.exit(1)});
