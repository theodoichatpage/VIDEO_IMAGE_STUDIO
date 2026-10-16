const vm=require('vm'),fs=require('fs'),assert=require('assert');
const code=fs.readFileSync(__dirname+'/extension/content.js','utf8');
async function capture({wrong=false,sending=false,streaming=false,override={}}={}){
 const command={id:'job-123',kind:'plan',status:sending?'sending':'waiting',pipeline_id:'run-abc',layout_stage:'split',pipeline_index:0};
 const payload={job_id:command.id,run_id:wrong?'old-run':command.pipeline_id,stage:'split',part:1,groups:[{unit_ids:['u1','u2']}],...override};
 const response={dataset:{messageAuthorRole:'assistant'},textContent:JSON.stringify(payload),innerText:JSON.stringify(payload),querySelectorAll:()=>[],querySelector:()=>null};
 const reports=[];let tick,stored=JSON.stringify({id:command.id,phase:sending?'sending':'waiting',kind:'plan',waitStartedAt:Date.now(),waitCycle:0});
 const context={document:{querySelector:q=>q==='#prompt-textarea'?{}:null,querySelectorAll:q=>q==='[data-message-author-role]'?[response]:q.includes('stop-button')&&streaming?[{}]:[]},location:{href:'https://chatgpt.com/c/test'},sessionStorage:{getItem:()=>stored,setItem:(_,v)=>stored=v,removeItem:()=>stored=null},chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(m){if(m.type==='poll')return {command};if(m.type==='result')reports.push(m.data);return {ok:true}}}},setInterval:fn=>tick=fn,console};
 vm.runInNewContext(code,context);await new Promise(r=>setImmediate(r));for(let i=0;i<6;i++)await tick();return reports;
}
(async()=>{
 for(const sending of [false,true]){const reports=await capture({sending});assert(reports.some(r=>r.phase==='done'),'matching completed JSON must be captured even without visible user marker / interrupted send');assert(!reports.some(r=>r.phase==='error'));}
 for(const override of [{job_id:'another-job'},{stage:'review'},{part:2},{part:'1'}])assert(!(await capture({override})).some(r=>r.phase==='done'),'reject wrong identity');
 assert(!(await capture({wrong:true})).some(r=>r.phase==='done'),'reject old run');
 assert(!(await capture({streaming:true})).some(r=>r.phase==='done'),'wait until streaming stops');
 console.log('PASS: capture matching JSON with missing marker and interrupted send; reject old run and streaming');
})().catch(e=>{console.error(e);process.exit(1)});
