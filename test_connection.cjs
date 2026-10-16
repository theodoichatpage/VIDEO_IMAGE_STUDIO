const vm=require('vm'),fs=require('fs'),assert=require('assert');
const code=fs.readFileSync(__dirname+'/extension/background.js','utf8');
async function run(missing,ready=true,fail=false){let listener,injections=0,pings=0,saved=null;
const chrome={downloads:{onChanged:{addListener(){}}},runtime:{onMessage:{addListener(fn){listener=fn}}},storage:{local:{async get(){return {}},async set(v){saved=v}}},tabs:{async query(){return [{id:7,url:'https://chatgpt.com/c/test'}]},async sendMessage(){pings++;if(missing&&pings===1)throw Error('Could not establish connection. Receiving end does not exist.');return {ready}}},scripting:{async executeScript(v){injections++;assert.equal(v.target.tabId,7);assert.equal(v.files[0],'content.js');if(fail)throw Error('Permission denied')}}};
vm.runInNewContext(code,{chrome,AbortSignal,fetch:async()=>({ok:true,json:async()=>({ok:true})}),crypto:{randomUUID:()=> 'client'}});
const result=await new Promise(resolve=>listener({type:'bind',token:'test-token',browser:'Edge'},{},resolve));return {result,injections,pings,saved};}
(async()=>{let r=await run(true);assert(r.result.ok);assert.equal(r.injections,1);assert.equal(r.saved.tab,7);
r=await run(false);assert(r.result.ok);assert.equal(r.injections,0);
r=await run(true,false);assert(r.result.error);assert.equal(r.saved,null);
r=await run(true,true,true);assert(r.result.error.includes('quyền'));assert.equal(r.saved,null);
console.log('PASS: missing receiver recovers; live receiver reused; unready and denied tabs do not bind');})().catch(e=>{console.error(e);process.exit(1)});
