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
console.log('test_picture_only_reply PASS');
