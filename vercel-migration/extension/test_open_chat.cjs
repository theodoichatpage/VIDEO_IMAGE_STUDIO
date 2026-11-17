// No ChatGPT tab: the extension opens one itself (at most once per 2 minutes) and keeps it from sleeping.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const bg=fs.readFileSync(__dirname+'/background.js','utf8');
const section=bg.slice(bg.indexOf('async function chatTabs()'),bg.indexOf('// Very long conversations'));
function harness(){
 const h={now:1e12,tabs:[],created:0,noDiscard:[],pong:{ready:true,version:'0.5.9'}};
 const c={CHATGPT_PREFIX:'https://chatgpt.com/',Date:{now:()=>h.now},Promise,Error,String,setTimeout:(f)=>{h.now+=500;f();},
  chrome:{storage:{local:{get:async()=>({})}},scripting:{executeScript:async()=>{}},
   tabs:{query:async()=>h.tabs,create:async o=>{h.created++;const t={id:9,url:o.url,status:'complete',active:o.active};h.tabs.push(t);return t;},get:async id=>h.tabs.find(t=>t.id===id),
    update:async(id,o)=>{if(o.autoDiscardable===false)h.noDiscard.push(id);},sendMessage:async()=>h.pong}}};
 vm.createContext(c);vm.runInContext(section.replace(/0\.5\.\d+/g,'0.5.9')+';globalThis.ensure=ensureChatReceiver;',c);h.c=c;return h;
}
(async()=>{
 let h=harness();
 const tab=await h.c.ensure();
 assert.equal(h.created,1);assert.equal(tab.id,9);assert.equal(tab.active,false,'opened in the background');assert.deepEqual(h.noDiscard,[9]);
 // Login redirect: the tab is not a chatgpt.com tab; no second tab within 2 minutes.
 h=harness();h.c.chrome.tabs.create=async()=>{h.created++;return {id:5,url:'https://auth.openai.com/'};};h.c.chrome.tabs.get=async()=>({id:5,status:'complete',url:'https://auth.openai.com/'});
 await assert.rejects(h.c.ensure(),/Không mở được tab ChatGPT/);await assert.rejects(h.c.ensure());assert.equal(h.created,1);
 // After a self-update the tab still runs the old bridge, holding a job it can no longer finish: reloaded unless
 // ChatGPT is still writing or drawing (then the tab is left alone until it finishes).
 for(const [generating,reloads] of [[false,1],[true,0]]){
  h=harness();h.tabs.push({id:4,url:'https://chatgpt.com/c/x',status:'complete',active:false});h.pong={ready:true,version:'0.5.8',activeJobId:'job1',generating};
  let n=0;h.c.chrome.tabs.reload=async()=>{n++;};h.c.newerVersion=()=>false;
  await assert.rejects(h.c.ensure(),generating?/ChatGPT đang trả lời/:/Đang tải lại tab ChatGPT/);assert.equal(n,reloads);
 }
 console.log('test_open_chat PASS');
})().catch(e=>{console.error(e);process.exit(1);});
