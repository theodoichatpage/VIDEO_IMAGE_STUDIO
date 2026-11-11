const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/content.js','utf8');
const begin=src.indexOf("    if (message?.type === 'vis-ping') {");const end=src.indexOf("    if (message?.type === 'vis-restore-draft')",begin);
assert(begin>=0&&end>begin);
const code='function ping(message,sendResponse){'+src.slice(begin,end)+'} globalThis.ping=ping';
let st={},tab=23,text='';
const c={chrome:{storage:{local:{get:async()=>st}},runtime:{sendMessage:async()=>({chatTabId:tab})}},document:{querySelectorAll:()=>text?[{innerText:text}]:[]},location:{origin:'https://chatgpt.com',pathname:'/c/abc'},composer:()=>true,isGenerating:()=>true,currentJobId:'',Date,chatAccountInfo:async()=>({key:'abc123',plan:'plus',label:'a***@x.com'}),chatLimitNotice:()=>null};vm.createContext(c);vm.runInContext(code,c);
const ping=()=>new Promise(resolve=>c.ping({type:'vis-ping'},resolve));
// The limit notice is read only after the latest user turn: an old notice above it does not count.
const limitSrc=src.slice(src.indexOf('const CHAT_LIMIT='),src.indexOf('chrome.runtime.onMessage.addListener'));
function limitOf(main,lastUser){const d={document:{querySelector:()=>({innerText:main}),querySelectorAll:()=>lastUser?[{innerText:lastUser}]:[],body:{innerText:main}}};vm.createContext(d);vm.runInContext(limitSrc+';globalThis.r=chatLimitNotice()',d);return d.r;}
const notice="You've hit the Plus plan limit for image generations requests. You can create more images when the limit resets in 5 hours.";
assert.match(limitOf('Vẽ cảnh 7\n'+notice,'Vẽ cảnh 7'),/hit the Plus plan limit.*resets in 5 hours/);
assert.equal(limitOf('Vẽ cảnh 6\n'+notice+'\nVẽ cảnh 7\nĐây là ảnh của bạn','Vẽ cảnh 7'),null,'an older notice is ignored');
assert.equal(limitOf('Vẽ cảnh 7\nĐây là ảnh của bạn','Vẽ cảnh 7'),null);
(async()=>{let p=await ping();assert.equal(p.pairCode,null);assert.equal(p.activeJobId,null);assert.equal(p.chatTabId,23);assert.equal(p.conversationUrl,'https://chatgpt.com/c/abc');assert.equal(typeof p.lastHeartbeatAt,'number');assert.equal(p.generating,true,'ping reports whether ChatGPT is answering');st={pairCode:'p',activeJobId:'j',identityJobId:'j',conversationUrl:'https://chatgpt.com/c/abc'};text='[VIS_JOB_ID:j]';p=await ping();assert.equal(p.activeJobId,'j');text='[VIS_JOB_ID:other]';p=await ping();assert.equal(p.activeJobId,null);console.log('content ping PASS')})().catch(e=>{console.error(e);process.exit(1)});
