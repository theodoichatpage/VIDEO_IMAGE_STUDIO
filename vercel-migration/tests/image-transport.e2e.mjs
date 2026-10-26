// Real Studio UI, extension scripts and API handler; ChatGPT, database and Storage are fixtures.
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import ts from 'typescript';
const {chromium}=await import(process.env.VIS_PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const server=spawn('node',[root+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173'],{cwd:root,stdio:'pipe'});
await new Promise(r=>server.stdout.once('data',r));
const browser=await chromium.launch({executablePath:process.env.VIS_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage']});
const originalFetch=globalThis.fetch;
try{
 const context=await browser.newContext(),page=await context.newPage(),chat=await context.newPage();
 const png=Buffer.from(await chat.evaluate(()=>{const c=document.createElement('canvas');c.width=1024;c.height=576;const g=c.getContext('2d');g.fillStyle='#1877c9';g.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1]}),'base64');
 const id='image-browser-test-12345';
 let record={id,script:'Original script',status:'parts_ready',activeJob:null,imageJobs:[],parts:[{id:'p1',title:'Phần 1',content:'Original',status:'complete',scenes:[{title:'Cảnh 1 - Cầu thang',prompt:'Police walking upstairs in a historic building.',imageStatus:'error',imageError:'Lỗi tải ảnh từ lần trước',imageResults:[]}]}],updatedAt:Date.now()};
 const files=new Map();let fallbackFetches=0,previewFailure=false;
 // The unmodified production handler runs against in-memory DB/Storage.
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY='fixture-only';
 globalThis.fetch=async(url,init={})=>{
  if(url.includes('/rest/v1/')){
   if(url.includes('studio_separations'))return Response.json([]);
   if(init.method==='PATCH'){const expected=new URL(url).searchParams.get('record->>updatedAt');if(expected!=='eq.'+record.updatedAt)return Response.json([]);record=JSON.parse(init.body).record;return Response.json([{record:structuredClone(record)}])}
   if(init.method==='POST'&&init.body){const body=JSON.parse(init.body);if(body.record)record=body.record;else if(body.session_id)record.bridgeLastSeen=body.seen_at;return new Response('',{status:201})}
   return Response.json([{record:structuredClone(record)}]);
  }
  if(url.includes('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/studio-images/'+url.split('/object/sign/studio-images/')[1]+'?fixture=1'});
  if(url.includes('/storage/v1/object/studio-images/')){files.set(url.split('/object/studio-images/')[1],Buffer.from(init.body));return Response.json({ok:true})}
  if(url.includes('/storage/v1/bucket'))return Response.json({id:'studio-images'});
  throw Error('Unexpected fixture network '+url);
 };
 const js=ts.transpileModule(fs.readFileSync(root+'/supabase/functions/studio-api/handler.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const call=async(url,init={})=>{let status=200,data;const path=new URL(url).searchParams.get('path');await handler({method:init.method||'GET',query:{path:path.split('/')},body:init.body?JSON.parse(init.body):undefined,headers:{}},{setHeader(){},status(n){status=n;return{json(value){data=value}}}});return{status,data}};
 await page.route('**/functions/v1/studio-api?**',async r=>{const v=await call(r.request().url(),{method:r.request().method(),body:r.request().postData()});await r.fulfill({status:v.status,json:v.data})});
 await page.route('https://db.test/storage/**',async r=>{if(previewFailure){await r.fulfill({status:403,body:'Expired preview'});return;}const path=new URL(r.request().url()).pathname.split('/studio-images/')[1];await r.fulfill({contentType:'image/png',body:files.get(path)||png})});
 let receiver,blockCapture=false,captureFailure='';const captureWaiters=[];const stored={pairCode:id,studioOrigin:'https://video-image-studio.vercel.app'};
 const chrome={storage:{local:{get:async()=>structuredClone(stored),set:async v=>Object.assign(stored,structuredClone(v)),remove:async keys=>keys.forEach(k=>delete stored[k])}},scripting:{executeScript:async()=>{}},runtime:{onMessage:{addListener:fn=>receiver=fn}},tabs:{query:async()=>[{id:2,url:'https://chatgpt.com/c/fixture'},{id:3,url:'https://video-image-studio.vercel.app/'}],sendMessage:async(tab,m)=>{if(tab===2&&m.type==='vis-capture-result'){if(blockCapture)await new Promise(r=>captureWaiters.push(r));if(captureFailure)return{ok:false,error:captureFailure}}return tab===2?chat.evaluate(m=>new Promise(r=>{if(!window.receiver(m,{},r))r({ok:true})}),m):page.evaluate(m=>window.receiver(m),m)}}};
 const worker=vm.createContext({chrome,URL,AbortSignal,Uint8Array,btoa,fetch:async(url,init={})=>{
  if(String(url).startsWith('https://images.oaiusercontent.com/')){fallbackFetches++;return new Response(png,{headers:{'Content-Type':'application/octet-stream'}})}
  const v=await call(url,init);return{ok:v.status<400,status:v.status,json:async()=>v.data};
 }});
 vm.runInContext(fs.readFileSync(root+'/extension/background.js','utf8'),worker);
 const send=(m,s)=>new Promise(r=>receiver(m,s,r));
 await page.exposeBinding('extensionMessage',(_,m)=>send(m,{tab:{id:3,url:'https://video-image-studio.vercel.app/'}}));
 await chat.exposeBinding('extensionMessage',(_,m)=>send(m,{tab:{id:2,url:'https://chatgpt.com/c/fixture'}}));
 for(const p of [page,chat])await p.addInitScript(()=>{window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:m=>window.extensionMessage(m),onMessage:{addListener:fn=>window.receiver=fn}}}});
 await chat.route('https://images.oaiusercontent.com/**',r=>r.fulfill({body:png,contentType:'application/octet-stream'}));
 await chat.route('http://127.0.0.1:4173/chat-fixture',r=>r.fulfill({contentType:'text/html',body:`<main></main><form><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form><script>document.querySelector('button').onclick=()=>{const box=document.querySelector('textarea'),u=document.createElement('div');u.dataset.messageAuthorRole='user';u.textContent=box.value;box.value='';document.querySelector('main').append(u);setTimeout(()=>{const a=document.createElement('article'),text=document.createElement('div'),image=document.createElement('img');text.dataset.messageAuthorRole='assistant';a.append(text);image.src='https://images.oaiusercontent.com/scene.png';a.append(image);document.querySelector('main').append(a)},100)};</script>`}));
 await chat.addInitScript(()=>{const original=window.fetch;window.fetch=(url,opts)=>String(url).startsWith('https://images.oaiusercontent.com/')?Promise.reject(new TypeError('CORS blocked in fixture')):original(url,opts)});
 await chat.goto('http://127.0.0.1:4173/chat-fixture');await chat.addScriptTag({path:root+'/extension/reply-reader.js'});await chat.addScriptTag({path:root+'/extension/content.js'});
 await page.addInitScript(id=>{localStorage.setItem('vis-session',id);localStorage.setItem('vis-active-menu','2')},id);
 await page.goto('http://127.0.0.1:4173');await page.addScriptTag({path:root+'/extension/web_bridge.js'});
 await page.getByText('Cảnh 1 - Cầu thang',{exact:true}).first().waitFor();await page.getByRole('alert').filter({hasText:'Lỗi tải ảnh từ lần trước'}).waitFor();
 await page.locator('.style-bar textarea').fill('SCENE: {{SCENE_PROMPT}}');await page.waitForTimeout(300);await page.getByRole('button',{name:'Tạo ảnh',exact:true}).click();
 await page.locator('img.generated-image').waitFor({timeout:20000}).catch(async error=>{console.log('DEBUG',JSON.stringify({record,stored,fallbackFetches}),await page.locator('body').innerText(),await chat.locator('body').innerText());throw error});
 await page.waitForFunction(()=>document.querySelector('img.generated-image')?.naturalWidth===1024);
 assert.equal(record.parts[0].scenes[0].imageStatus,'complete');assert.equal(files.size,1);assert.equal(fallbackFetches>=1,true);assert.deepEqual([...files.values()][0],png);
 assert.equal(await chat.locator('[data-message-author-role="user"]').count(),1);
 // Recovery receives existing image bytes only; it must not submit another prompt.
 record.activeJob={id:'other-scene-job',type:'image_generation',status:'waiting',prompt:'Different scene B',sceneKey:'p1:1',protocol:3};record.imageJobs=[record.activeJob];record.parts[0].scenes.push({title:'Cảnh 2 - Khác',prompt:'Different scene B',imagePrompt:'Different scene B',imageStatus:'generating',imageResults:[]});
 record.parts[0].scenes[0].imageResults=[];record.parts[0].scenes[0].imageStatus='error';record.parts[0].scenes[0].imageError='Kết quả chưa đồng bộ';record.updatedAt=Date.now();
 await page.reload();await page.addScriptTag({path:root+'/extension/web_bridge.js'});await page.getByRole('alert').filter({hasText:'Kết quả chưa đồng bộ'}).waitFor();
 blockCapture=true;
 await page.getByRole('button',{name:'Đồng bộ lại ảnh',exact:true}).click();
 await page.locator('.image-sync-feedback').filter({hasText:'Đang'}).waitFor({timeout:1500});
 assert.equal(await page.getByRole('button',{name:'Đang đồng bộ…',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Đồng bộ ngay',exact:true}).isDisabled(),true);
 blockCapture=false;captureWaiters.splice(0).forEach(resolve=>resolve());
 await page.waitForFunction(()=>document.querySelector('.scene-row .chip')?.textContent==='Hoàn tất',null,{timeout:20000});
 assert.equal(await chat.locator('[data-message-author-role="user"]').count(),1);
 // Download through the page's routed signed URL, rather than authenticated ChatGPT URLs.
 const imageBytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(document.querySelector('img.generated-image').src)).arrayBuffer())));
 assert.deepEqual(Buffer.from(imageBytes),png);
 await page.locator('.image-sync-feedback').filter({hasText:'Đã đồng bộ'}).waitFor();
 assert.equal(record.activeJob.id,'other-scene-job');assert.equal(record.parts[0].scenes[1].imageStatus,'generating');
 captureFailure='Không tìm thấy ảnh đúng cảnh (kiểm thử)';
 await page.getByRole('button',{name:'Đồng bộ lại ảnh',exact:true}).click();
 await page.locator('.image-sync-feedback').filter({hasText:captureFailure}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Đồng bộ ngay',exact:true}).isEnabled(),true);
 captureFailure='';await page.getByRole('button',{name:'Đồng bộ ngay',exact:true}).click();
 await page.locator('.image-sync-feedback').filter({hasText:'Đã đồng bộ'}).waitFor({timeout:15000});
 assert.equal(await chat.locator('[data-message-author-role="user"]').count(),1);

 // A failed preview must be visible as a message, then a new URL must render normally.
 previewFailure=true;await page.reload();await page.addScriptTag({path:root+'/extension/web_bridge.js'});
 await page.locator('.image-sync-feedback').filter({hasText:'chưa tải được bản xem trước'}).waitFor();
 previewFailure=false;await page.getByRole('button',{name:'Đồng bộ lại ảnh',exact:true}).click();
 await page.locator('.image-sync-feedback').filter({hasText:'Đã đồng bộ'}).waitFor({timeout:15000});
 await page.waitForFunction(()=>document.querySelector('img.generated-image')?.naturalWidth===1024);
 assert.equal(await page.locator('img.generated-image').isVisible(),true);
 assert.equal(await chat.locator('[data-message-author-role="user"]').count(),1);
 await page.screenshot({path:root+'/image-sync-verified.png',fullPage:true});
 console.log('PASS real UI -> extension -> matched image sibling -> CORS fallback -> real API handler -> Storage fixture -> complete preview/download; recovery submits no new prompt. Live ChatGPT/DB not used.');
}finally{globalThis.fetch=originalFetch;await browser.close();server.kill()}
