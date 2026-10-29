const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/content.js','utf8');
const begin=src.indexOf("    if (message?.type === 'vis-ping') {");const end=src.indexOf("    if (message?.type === 'vis-restore-draft')",begin);
assert(begin>=0&&end>begin);
const code='function ping(message,sendResponse){'+src.slice(begin,end)+'} globalThis.ping=ping';
let st={},tab=23,text='';
const c={chrome:{storage:{local:{get:async()=>st}},runtime:{sendMessage:async()=>({chatTabId:tab})}},document:{querySelectorAll:()=>text?[{innerText:text}]:[]},location:{origin:'https://chatgpt.com',pathname:'/c/abc'},composer:()=>true,isGenerating:()=>true,currentJobId:'',Date};vm.createContext(c);vm.runInContext(code,c);
const ping=()=>new Promise(resolve=>c.ping({type:'vis-ping'},resolve));
(async()=>{let p=await ping();assert.equal(p.pairCode,null);assert.equal(p.activeJobId,null);assert.equal(p.chatTabId,23);assert.equal(p.conversationUrl,'https://chatgpt.com/c/abc');assert.equal(typeof p.lastHeartbeatAt,'number');assert.equal(p.generating,true,'ping reports whether ChatGPT is answering');st={pairCode:'p',activeJobId:'j',identityJobId:'j',conversationUrl:'https://chatgpt.com/c/abc'};text='[VIS_JOB_ID:j]';p=await ping();assert.equal(p.activeJobId,'j');text='[VIS_JOB_ID:other]';p=await ping();assert.equal(p.activeJobId,null);console.log('content ping PASS')})().catch(e=>{console.error(e);process.exit(1)});
