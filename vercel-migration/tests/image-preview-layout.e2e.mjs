import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.VIS_PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const server=spawn('node',[root+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173'],{cwd:root,stdio:'pipe'});
await new Promise(resolve=>server.stdout.once('data',resolve));
const browser=await chromium.launch({executablePath:process.env.VIS_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--no-zygote','--single-process']});
try{
 const page=await browser.newPage();
 const pngs=[];
 for(const [width,height] of [[2048,1152],[1152,2048],[2048,2048]])pngs.push(await page.evaluate(([w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#1877c9';g.fillRect(0,0,w,h);return c.toDataURL('image/png')},[width,height]));
 let image=pngs[0];
 const session={id:'preview-layout-fixture',script:'Original script',status:'parts_ready',activeJob:null,imageJobs:[],parts:[{id:'p1',title:'Phần 1 - Cuộc bắt giữ tại Hồng Kông',content:'Original',status:'complete',scenes:[{title:'Cảnh 1 - Cảnh sát đột kích',prompt:'Scene prompt',imageStatus:'complete',imageResults:[{id:'saved-image',url:'https://fixture.test/image.png'}]}]}],updatedAt:Date.now()};
 await page.route('https://fixture.test/image.png',r=>r.fulfill({body:Buffer.from(image.split(',')[1],'base64'),contentType:'image/png'}));
 await page.route('**/functions/v1/studio-api?**',r=>r.fulfill({json:{session,projects:[],command:null}}));
 await page.addInitScript(()=>{localStorage.setItem('vis-session','preview-layout-fixture');localStorage.setItem('vis-active-menu','2')});
 for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[1280,720]]){
  await page.setViewportSize({width,height});
  for(const png of pngs){
   image=png;await page.goto('http://127.0.0.1:4173');await page.locator('img.generated-image').waitFor();await page.waitForFunction(()=>document.querySelector('img.generated-image')?.naturalWidth>0);
   const bounds=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const img=document.querySelector('.generated-image'),grid=document.querySelector('.production-grid');return {image:rect('.generated-image'),panel:rect('.preview-empty'),actions:rect('.preview-actions'),workspace:rect('.image-workspace'),gridOverflow:grid.scrollWidth-grid.clientWidth,fit:getComputedStyle(img).objectFit}});
   assert.equal(bounds.fit,'contain');assert.ok(bounds.image.height>40,JSON.stringify(bounds));
   assert.ok(bounds.image.x>=bounds.panel.x&&bounds.image.right<=bounds.panel.right+1,JSON.stringify(bounds));
   assert.ok(bounds.image.y>=bounds.panel.y&&bounds.image.bottom<=bounds.panel.bottom+1,JSON.stringify(bounds));
   assert.ok(bounds.image.bottom<=bounds.actions.y+1,JSON.stringify(bounds));
   assert.ok(bounds.actions.bottom<=height+1,JSON.stringify(bounds));assert.ok(bounds.workspace.bottom<=height+1,JSON.stringify(bounds));assert.ok(bounds.gridOverflow<=1,JSON.stringify(bounds));
  }
 }
 console.log('PASS actual Studio UI: 2048px landscape, portrait and square previews fit their frame; controls visible; no grid overflow at 1920x1080, 1440x900, 1366x768 and 1280x720. No real user data changed.');
}finally{await browser.close();server.kill()}
