// ChatGPT shows a reply that is only a picture (no answer block, reader says "no-new-answer"): the picture between
// this job's prompt and the next message is read directly; another job's picture and older pictures never count.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/content.js','utf8');
const a=src.slice(src.indexOf('  const pictureNodesAfterPrompt'),src.indexOf('  const IMAGE_INSTEAD'));
const b=src.slice(src.indexOf('  const finishedUrls'),src.indexOf('  const expandedImagePrompts'));
let order=0;
const node=(extra={})=>({order:++order,textContent:'',alt:'',naturalWidth:0,naturalHeight:0,complete:true,src:'',closest:()=>null,contains(o){return o===this},
 compareDocumentPosition(o){return o.order>this.order?4:o.order<this.order?2:0},getAttribute:()=>null,...extra});
const user=text=>node({textContent:text});
const pic=url=>node({naturalWidth:1024,naturalHeight:1024,src:url,currentSrc:url});
function run(items,id='job7'){
 const users=items.filter(x=>x.kind==='user').map(x=>x.n),imgs=items.filter(x=>x.kind==='img').map(x=>x.n);
 const document={querySelectorAll:sel=>sel.includes('author-role')?users:sel==='main img'?imgs:[]};
 const c={document,replyContext:{id},VISReplyReader:{sources:()=>({node:null,reason:'no-new-answer'})},Number};
 vm.createContext(c);vm.runInContext(a+b+';globalThis.urls=imageUrls;',c);return [...c.urls()];
}
const u=(text)=>({kind:'user',n:user(text)}),i=url=>({kind:'img',n:pic(url)});
assert.deepEqual(run([u('[VIS_JOB_ID:job7] vẽ cảnh'),i('https://x/1.png')]),['https://x/1.png'],'picture-only reply is found');
assert.deepEqual(run([i('https://x/old.png'),u('[VIS_JOB_ID:job7] vẽ'),i('https://x/1.png'),u('[VIS_JOB_ID:job8] vẽ khác'),i('https://x/other.png')]),['https://x/1.png'],'neither older nor the next job\'s picture');
assert.deepEqual(run([u('[VIS_JOB_ID:job7] vẽ')]),[],'no picture yet: nothing to read, the nudge logic still applies');
const unfinished=pic('https://x/2.png');unfinished.complete=false;
assert.deepEqual(run([u('[VIS_JOB_ID:job7] vẽ'),{kind:'img',n:unfinished}]),[],'a picture still loading is not taken');
// A background tab leaves a finished picture unloaded (lazy): it is asked to load, and once ChatGPT has stopped an
// unrendered picture is read from its address; while ChatGPT is still drawing it is never taken.
function lazy(generating,loadsWhenAsked){
 const users=[user('[VIS_JOB_ID:job7] vẽ')];const img=node({alt:'Generated image',src:'https://x/lazy.png',currentSrc:'',complete:false,
  scrollIntoView(){if(loadsWhenAsked){this.complete=true;this.naturalWidth=this.naturalHeight=1024;this.currentSrc=this.src}}});
 const document={querySelectorAll:sel=>sel.includes('author-role')?users:sel==='main img'?[img]:[]};
 const c={document,replyContext:{id:'job7'},VISReplyReader:{sources:()=>({node:null,reason:'no-new-answer'})},Number,String,sleep:async()=>{},isGenerating:()=>generating};
 vm.createContext(c);vm.runInContext(a+b+';globalThis.t={imageUrls,loadPictures,unrenderedUrl};',c);return {c,img};
}
(async()=>{
 let {c,img}=lazy(false,true);await c.t.loadPictures();
 assert.equal(img.loading,'eager');assert.deepEqual([...c.t.imageUrls()],['https://x/lazy.png'],'a lazy picture loads when asked');
 ({c}=lazy(false,false));let last=await c.t.loadPictures();
 assert.deepEqual([...c.t.imageUrls()],[],'still unrendered');assert.equal(c.t.unrenderedUrl(last),'https://x/lazy.png','read from its address once ChatGPT stopped');
 ({c}=lazy(true,false));last=await c.t.loadPictures();assert.equal(c.t.unrenderedUrl(last),'','never while ChatGPT is drawing');
 console.log('test_picture_only_reply PASS');
})().catch(e=>{console.error(e);process.exit(1);});
