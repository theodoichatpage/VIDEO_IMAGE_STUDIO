// A job the tab still remembers but the background abandoned must not block new commands while ChatGPT is idle.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/content.js','utf8');
const begin=src.indexOf("    if (message?.type === 'vis-command') {");const end=src.indexOf("    if (message?.type === 'vis-capture-result')",begin);
function harness(busyJob,generating){
 const c={currentJobId:busyJob,currentJobType:'x',finished:new Set(),generation:0,cancelled:true,ran:[],isGenerating:()=>generating};
 c.run=async cmd=>{c.ran.push(cmd.id)};
 vm.createContext(c);vm.runInContext('function handle(message,sendResponse){'+src.slice(begin,end)+'}',c);return c;}
const call=(c,m)=>{let r;c.handle(m,x=>r=x);return r;};
let c=harness('old',false);
assert.equal(call(c,{type:'vis-command',command:{id:'new'}}).ok,false,'without replaceStale: unchanged behaviour');
assert.equal(call(c,{type:'vis-command',command:{id:'new'},replaceStale:true}).ok,true);assert.deepEqual(c.ran,['new']);assert.ok(c.finished.has('old'));assert.equal(c.generation,1);
c=harness('old',true);
assert.equal(call(c,{type:'vis-command',command:{id:'new'},replaceStale:true}).ok,false,'ChatGPT still writing: stays busy');
console.log('test_stale_job PASS');
