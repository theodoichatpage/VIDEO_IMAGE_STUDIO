// A text job where ChatGPT draws a picture is stopped and asked once more, firmly; a second picture fails the job.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/content.js','utf8');
const begin=src.indexOf('  async function run(command) {');const end=src.indexOf('\n  }\n',begin)+4;
const marker=src.match(/const IMAGE_INSTEAD = '([A-Z_]+)'/)[1];
function harness(outcomes){
 const c={currentJobId:'',currentJobType:'',finished:new Set(),generation:0,cancelled:false,replyContext:null,IMAGE_INSTEAD:marker,
  sent:[],events:[],stops:0,VISReplyReader:{snapshot:()=>[]},document:{},isGenerating:()=>false,clearImageMode:async()=>{},prepareDraft:async()=>{},
  activeImageMode:()=>null,assistantText:()=>'',submit:async()=>{},stopAndSettle:async()=>{c.stops++;}};
 c.fillComposer=async text=>{c.sent.push(text);};c.emit=async e=>{c.events.push(e);};
 c.waitForFinalAnswer=async()=>{const o=outcomes.shift();if(o instanceof Error)throw o;return o;};
 vm.createContext(c);vm.runInContext(src.slice(begin,end),c);return c;}
(async()=>{
 let c=harness([new Error(marker),'{"scenes":[]}']);
 await c.run({id:'j1',type:'part_analysis',prompt:'PHẦN: 1'});
 assert.equal(c.sent.length,2);assert.equal(c.stops,1);
 assert.ok(c.sent.every(t=>t.startsWith('[VIS_JOB_ID:j1]\n')&&t.includes('DO NOT GENERATE IMAGES')&&t.endsWith('PHẦN: 1')));
 assert.ok(!c.sent[0].includes('PREVIOUS ANSWER')&&c.sent[1].includes('PREVIOUS ANSWER WRONGLY CREATED AN IMAGE'));
 assert.deepEqual(c.events.map(e=>e.state),['sent','completed']);assert.equal(c.events[1].text,'{"scenes":[]}');
 c=harness([new Error(marker),new Error(marker)]);
 await assert.rejects(c.run({id:'j2',type:'part_analysis',prompt:'x'}),/tạo ảnh thay vì trả văn bản/);
 assert.equal(c.sent.length,2);assert.deepEqual(c.events.map(e=>e.state),['sent','error']);
 c=harness([new Error('other failure')]);
 await assert.rejects(c.run({id:'j3',type:'transcript_rewrite',prompt:'x'}),/other failure/);assert.equal(c.sent.length,1,'other errors are not retried');
 console.log('test_image_instead PASS');
})().catch(e=>{console.error(e);process.exit(1);});
