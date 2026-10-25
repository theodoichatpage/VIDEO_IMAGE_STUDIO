import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.VIS_PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const server=spawn('node',[root+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173'],{cwd:root,stdio:'pipe'});
await new Promise(r=>server.stdout.once('data',r));
const browser=await chromium.launch({executablePath:process.env.VIS_CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext();
 const setup=async()=>{
  const page=await context.newPage();
  await page.route('**/functions/v1/studio-api?**',r=>r.fulfill({json:{session:{id:'batch-test',script:'',parts:[]},command:null}}));
  await page.addInitScript(()=>{
   const sections=Array.from({length:4},(_,i)=>({id:String(i+1),branchId:String(i+1),title:'Mục '+(i+1),summary:'Nội dung '+(i+1),sourceText:'Nguyên văn '+(i+1),status:i===0?'done':'waiting',rewrittenText:i===0?'Kết quả cũ phần 1':''}));
   localStorage.setItem('vis-session','batch-test');
   localStorage.setItem('vis-transcript-workspace-default',JSON.stringify({url:'fixture',language:'vi',transcript:{text:'Nguyên văn',segments:[]},branches:[],sections,stylePrompt:'Phong cách thử nghiệm',selectedBranchId:'1'}));
   window.commands=[];window.stops=0;
   window.addEventListener('message',e=>{
    if(e.data?.source!=='vis-web')return;
    if(e.data.type==='studio-stop')window.stops++;
    if(e.data.type==='studio-transcript-ai'){
     window.commands.push(e.data.command);
     const c=e.data.command;
     window.postMessage({source:'vis-extension',type:'studio-transcript-ai-result',jobId:c.id,kind:c.kind,sectionId:c.sectionId,state:'sent'},'*');
    }
   });
  });
  await page.goto('http://127.0.0.1:4173');return page;
 };
 const reply=async(page,state='completed',commandIndex=-1)=>page.evaluate(({state,commandIndex})=>{
  const c=window.commands.at(commandIndex);
  window.postMessage({source:'vis-extension',type:'studio-transcript-ai-result',jobId:c.id,kind:c.kind,sectionId:c.sectionId,state,text:'Viết lại '+c.sectionId,message:'Lỗi thử nghiệm'},'*');
 },{state,commandIndex});
 const page=await setup();
 await page.getByRole('button',{name:/Viết lại toàn bộ/}).click();
 await page.waitForFunction(()=>window.commands.length===1);
 assert.equal(await page.evaluate(()=>window.commands[0].sectionId),'2');
 await reply(page);
 // Regression: old implementation stops here after rewriting only one section.
 await page.waitForFunction(()=>window.commands.length===2,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.commands[1].sectionId),'3');
 await reply(page);await page.waitForFunction(()=>window.commands.length===3);
 assert.equal(await page.evaluate(()=>window.commands[2].sectionId),'4');
 await reply(page);await page.waitForFunction(()=>[...document.querySelectorAll('.sections-panel .status')].every(x=>x.textContent==='Đã xử lý'));
 assert.match(await page.locator('.final-text').inputValue(),/Kết quả cũ phần 1/);
 assert.equal(await page.evaluate(()=>window.commands.length),3);
 const between=await setup();await between.getByRole('button',{name:/Viết lại toàn bộ/}).click();await between.waitForFunction(()=>window.commands.length===1);
 await reply(between);await between.waitForFunction(()=>document.querySelectorAll('.sections-panel .status')[1].textContent==='Đã xử lý');
 await between.getByRole('button',{name:'Dừng xử lý',exact:true}).click();await between.waitForTimeout(800);
 assert.equal(await between.evaluate(()=>window.commands.length),1,'Stop between jobs must cancel scheduled dispatch');
 assert.equal(await between.locator('.sections-panel .status').nth(2).innerText(),'Đã dừng');
 const stopped=await setup();await stopped.getByRole('button',{name:/Viết lại toàn bộ/}).click();await stopped.waitForFunction(()=>window.commands.length===1);
 await stopped.getByRole('button',{name:'Dừng xử lý',exact:true}).click();
 await stopped.waitForFunction(()=>window.stops===1);
 await reply(stopped); // Late completion must not restart the batch or overwrite saved data.
 await stopped.waitForTimeout(800);
 assert.equal(await stopped.evaluate(()=>window.commands.length),1);
 assert.equal(await stopped.locator('.sections-panel .status').nth(1).innerText(),'Đã dừng');
 assert.equal(await stopped.locator('.final-text').inputValue(),'Kết quả cũ phần 1');
 await stopped.getByRole('button',{name:/Viết lại toàn bộ/}).click();await stopped.waitForFunction(()=>window.commands.length===2);
 assert.equal(await stopped.evaluate(()=>window.commands[1].sectionId),'2');
 await reply(stopped,'error');await stopped.waitForTimeout(800);
 assert.equal(await stopped.evaluate(()=>window.commands.length),2);
 assert.equal(await stopped.locator('.sections-panel .status').nth(1).innerText(),'Lỗi');
 assert.equal(await stopped.getByRole('button',{name:/Viết lại toàn bộ/}).isEnabled(),true);
 console.log('PASS batch rewrite: ordered continuation, skip completed, stop blocks late results, resume unfinished, error pauses queue; fixture transport.');
}finally{await browser.close();server.kill()}
