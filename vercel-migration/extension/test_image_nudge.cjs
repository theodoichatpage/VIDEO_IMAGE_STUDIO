// If ChatGPT stays idle after an image prompt, the extension nudges it (tagged with the job id), at most twice.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/content.js','utf8');
const section=src.slice(src.indexOf('  const NUDGE_AFTER_MS'),src.indexOf('  async function waitForFinalAnswer('));
function harness({imageAfterNudges=Infinity,busyForever=false}={}){
 const h={now:0,sent:[],emitted:[],compare:0,clicked:0};
 const c={Date:{now:()=>h.now},Error,replyContext:{id:'job7'},cancelled:false,generation:1,
  document:{querySelector:()=>({textContent:''})},
  expandImagePrompts:async()=>{},resolveComparison:async()=>h.compare>0?(h.compare--,h.clicked++,true):false,isGenerating:()=>busyForever,
  imageUrls:()=>h.sent.length>=imageAfterNudges?['https://chatgpt.com/img.png']:[],
  imagePayload:async ctx=>({jobId:ctx.id,state:'completed',imageDataUrl:'data:'}),
  fillComposer:async t=>{h.sent.push(t);},submit:async()=>{},emit:async p=>h.emitted.push(p),
  sleep:async ms=>{h.now+=ms;}};
 vm.createContext(c);vm.runInContext(section+';globalThis.waitForImage=waitForImage;',c);h.c=c;return h;
}
(async()=>{
 // ChatGPT ignores the prompt, creates the image after the first nudge.
 let h=harness({imageAfterNudges:1});
 const payload=await h.c.waitForImage([],1);
 assert.equal(payload.state,'completed');assert.equal(h.sent.length,1);
 assert.match(h.sent[0],/^\[VIS_JOB_ID:job7\] /,'nudge carries the job marker so the image maps to this scene');
 assert.ok(h.now>=45000,'nudge only after 45 s idle');
 // ChatGPT never reacts: two nudges, then the usual timeout error.
 h=harness();
 await assert.rejects(h.c.waitForImage([],1),/quá thời gian tạo ảnh/);
 assert.equal(h.sent.length,2,'at most two nudges');
 // ChatGPT is busy creating the image: never nudge.
 h=harness({busyForever:true});
 await assert.rejects(h.c.waitForImage([],1),/quá thời gian/);
 assert.equal(h.sent.length,0,'no nudge while ChatGPT works');
 // ChatGPT shows "Which image do you like more?": choose image 1 first, then take the image; no nudge.
 h=harness({imageAfterNudges:0});h.compare=1;
 const chosen=await h.c.waitForImage([],1);
 assert.equal(chosen.state,'completed');assert.equal(h.clicked,1,'comparison resolved before reading');assert.equal(h.sent.length,0);
 console.log('test_image_nudge PASS');
})().catch(e=>{console.error(e);process.exit(1);});
