import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.VIS_PLAYWRIGHT_MODULE || 'playwright');
import {spawn} from 'node:child_process';import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const server=spawn('node',[root+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173'],{cwd:root,stdio:'pipe'});await new Promise(r=>server.stdout.once('data',r));
const browser=await chromium.launch({executablePath:process.env.VIS_CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:1366,height:960}}),page=await context.newPage(),chat=await context.newPage();
 let listener;const stored={pairCode:'project-a',studioOrigin:'https://video-image-studio.vercel.app'},backend=[];
 const chrome={storage:{local:{get:async()=>structuredClone(stored),set:async x=>Object.assign(stored,structuredClone(x)),remove:async keys=>keys.forEach(k=>delete stored[k])}},scripting:{executeScript:async()=>{}},runtime:{onMessage:{addListener:fn=>listener=fn}},tabs:{query:async()=>[{id:2,url:'https://chatgpt.com/c/fixture'},{id:3,url:'https://video-image-studio.vercel.app/'}],sendMessage:async(id,msg)=>id===2?chat.evaluate(m=>new Promise(resolve=>{const async=window.receiver(m,{},resolve);if(!async)resolve({ok:true})}),msg):page.evaluate(m=>window.receiver(m),msg)}};
 const worker=vm.createContext({chrome,URL,AbortSignal,fetch:async(url,opts)=>{if(opts?.body)backend.push(JSON.parse(opts.body));return{ok:true,json:async()=>({session:{activeJob:null}})}}});
 vm.runInContext(fs.readFileSync(root+'/extension/background.js','utf8'),worker);
 const message=(m,sender)=>new Promise(resolve=>listener(m,sender,resolve));
 await page.exposeBinding('extensionMessage',(_,m)=>message(m,{tab:{id:3,url:'https://video-image-studio.vercel.app/'}}));
 let droppedCompletion=false;let notifyDropped;const completionDropped=new Promise(resolve=>notifyDropped=resolve);
 await chat.exposeBinding('extensionMessage',(_,m)=>{if(process.env.VIS_DROP_TRANSCRIPT_COMPLETION==='1'&&!droppedCompletion&&m.type==='vis-chat-event'&&m.payload?.state==='completed'){droppedCompletion=true;notifyDropped();return{ok:true}}return message(m,{tab:{id:2,url:'https://chatgpt.com/c/fixture'}})});
 for(const p of [page,chat])await p.addInitScript(()=>{window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:m=>window.extensionMessage(m),onMessage:{addListener:fn=>window.receiver=fn}}}});
 await chat.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"></head><body><main></main><form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form><script>
 document.querySelector('button').onclick=()=>{const box=document.querySelector('textarea'),prompt=box.value;window.lastPrompt=prompt;box.value='';const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=prompt;document.querySelector('main').append(user);
 setTimeout(()=>{const a=document.createElement('div');a.setAttribute('data-message-author-role','assistant');a.textContent=prompt.includes('PHẦN HIỆN TẠI')?'Đây là nội dung đã viết lại.':JSON.stringify({branches:[{id:'1',title:'Mở đầu',end:1},{id:'2',title:'Kết thúc',end:2}]});document.querySelector('main').append(a)},window.responseDelay||100)};
 </script></body></html>`}));
 await chat.goto('http://127.0.0.1:4173/chat-fixture');
 await chat.addScriptTag({path:root+'/extension/reply-reader.js'});await chat.addScriptTag({path:root+'/extension/content.js'});
 await page.addInitScript(()=>localStorage.setItem('vis-session','project-a'));
 await page.route('**/functions/v1/studio-api?**',r=>r.fulfill({json:{session:{id:'project-a',script:'',parts:[],updatedAt:1},command:null}}));
 await page.route('http://127.0.0.1:8000/transcript',r=>r.fulfill({json:{videoId:'fixture',text:'Mở đầu câu chuyện. Kết thúc câu chuyện.',segments:[{start:0,text:'Mở đầu câu chuyện.'},{start:10,text:'Kết thúc câu chuyện.'}]}}));
 await page.goto('http://127.0.0.1:4173');await page.addScriptTag({path:root+'/extension/web_bridge.js'});
 await page.getByPlaceholder('https://www.youtube.com/watch?v=...').fill('https://www.youtube.com/watch?v=fixture');await page.getByRole('button',{name:'Lấy Transcript',exact:true}).click();await page.getByText('Đã lấy transcript thành công',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Chia phần để viết lại',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Chia lại',exact:true}).isDisabled(),true);
 if(process.env.VIS_DROP_TRANSCRIPT_COMPLETION==='1'&&(process.env.VIS_MANUAL_RECOVERY==='1'||process.env.VIS_RECOVER_AFTER_RELOAD==='1')){
  await chat.locator('[data-message-author-role="assistant"]').first().waitFor();await completionDropped;
  if(process.env.VIS_RECOVER_AFTER_RELOAD==='1'){await page.reload();await page.addScriptTag({path:root+'/extension/web_bridge.js'})}
  if(process.env.VIS_MANUAL_RECOVERY==='1')await page.getByRole('button',{name:'Đồng bộ kết quả',exact:true}).click();
 }

 await page.locator('.sections-panel tbody tr').first().waitFor({timeout:15000}).catch(async e=>{console.log('DEBUG',JSON.stringify(stored),await page.locator('.transcript-page').innerText(),await chat.locator('body').innerText());throw e});assert.equal(await page.locator('.mindmap-node').count(),0);assert.match(await page.locator('.transcript-part-source').innerText(),/Mở đầu câu chuyện/);assert.equal(await page.locator('.sections-panel tbody tr').count(),2);assert.equal(await chat.locator('[data-message-author-role="user"]').count(),1);if(process.env.VIS_DROP_TRANSCRIPT_COMPLETION==='1')assert.equal(droppedCompletion,true);assert.equal(backend.length,0);
 assert.match(await chat.evaluate(()=>window.lastPrompt),/Chia transcript/);assert.ok(!(await chat.evaluate(()=>window.lastPrompt)).includes('\"children\"'));assert.equal(await page.getByRole('button',{name:'Chia lại',exact:true}).isEnabled(),true);
 await page.locator('.style-box textarea').fill('Giọng văn hoạt ngôn, gần gũi; không bịa sự kiện.');
 await page.locator('.part-actions button').first().click();await page.waitForFunction(()=>document.querySelector('.final-text').value.includes('Đây là nội dung đã viết lại.'),null,{timeout:15000}).catch(async e=>{console.log('REWRITE DEBUG',JSON.stringify(stored),await page.locator('.transcript-page').innerText(),await chat.locator('body').innerText());throw e});
 const rewritePrompt=await chat.evaluate(()=>window.lastPrompt);assert.match(rewritePrompt,/Giọng văn hoạt ngôn, gần gũi/);assert.match(rewritePrompt,/PHẦN HIỆN TẠI - Mở đầu/);assert.match(rewritePrompt,/Kết thúc câu chuyện/);assert.ok(!rewritePrompt.includes('Return only the requested JSON'));
 assert.equal(await page.locator('.sections-panel .status').first().innerText(),'Đã xử lý');assert.equal(await page.locator('.sections-panel .status').nth(1).innerText(),'Chờ xử lý');assert.equal(backend.length,0);
 page.once('dialog',d=>d.accept());await chat.evaluate(()=>window.responseDelay=10000);await page.getByRole('button',{name:'Chia lại',exact:true}).click();await page.getByRole('button',{name:'Dừng',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Chia lại',exact:true}).isEnabled(),true);
 await page.screenshot({path:root+'/transcript-transport-verified.png',fullPage:true});
 // Old or missing extensions must produce an actionable error, not an endless busy state.
 const missing=await context.newPage();await missing.route('**/functions/v1/studio-api?**',r=>r.fulfill({json:{session:{id:'project-b',script:'',parts:[]}}}));await missing.addInitScript(()=>{localStorage.setItem('vis-session','project-b');localStorage.setItem('vis-transcript-workspace-default',JSON.stringify({url:'test',language:'vi',transcript:{text:'test',segments:[]},branches:[],sections:[],stylePrompt:'',selectedBranchId:''}))});await missing.goto('http://127.0.0.1:4173');await missing.getByRole('button',{name:'Chia phần để viết lại',exact:true}).click();await missing.getByText('Extension chưa nhận lệnh.',{exact:false}).waitFor({timeout:10000});assert.equal(await missing.getByRole('button',{name:'Chia phần để viết lại',exact:true}).isEnabled(),true);
 console.log('PASS real web_bridge + background + content + reply-reader: button -> submitted composer -> compact ranges -> original source sections; rewrite plain text; stop; missing extension timeout; no analysis API mutation. ChatGPT response is a test fixture.');
}finally{await browser.close();server.kill()}
