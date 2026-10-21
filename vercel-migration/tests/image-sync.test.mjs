import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync('supabase/functions/studio-api/handler.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('image bytes persist, templates replace, recovery does not send another prompt',async()=>{
 const old=globalThis.fetch; process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY='test';
 let stored={id:'image-test-session-123',script:'original',parts:[{id:'p1',status:'complete',scenes:[{title:'One',prompt:'A garden'}]}],imageJobs:[],activeJob:null};let uploads=0;
 globalThis.fetch=async(url,init)=>{
  if(url.includes('/storage/')){if(url.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/studio-images/test.png?token=test'});if(url.includes('/object/'))uploads++;return Response.json({id:'ok'});}
  if(init?.method==='POST'){stored=JSON.parse(init.body).record;return new Response('',{status:201});}return Response.json([{record:structuredClone(stored)}]);
 };
 async function call(path,body,method='POST'){let code,data;await handler({method,query:{path:path.split('/')},body,headers:{}},{setHeader(){},status(c){code=c;return{json(d){data=d}}}});return{code,data};}
 try{
  let r=await call('sessions/'+stored.id+'/images',{stylePrompt:'STYLE {{SCENE_PROMPT}} END',sceneKeys:['p1:0']});assert.equal(r.code,200,JSON.stringify(r));assert.equal(r.data.session.activeJob.prompt,'STYLE A garden END');const job=stored.activeJob.id;
  r=await call('bridge/'+stored.id+'/event',{jobId:job,state:'completed',imageUrl:'https://chatgpt.com/backend-api/estuary/content?id=x'});assert.equal(r.code,422);assert.equal(stored.activeJob.id,job);
  r=await call('bridge/'+stored.id+'/event',{jobId:job,state:'completed',imageDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='});assert.equal(r.code,200,JSON.stringify(r.data));assert.equal(uploads,1);assert.equal(stored.parts[0].scenes[0].imageStatus,'complete');assert.match(stored.parts[0].scenes[0].imageResults[0].url,/db.test\/storage/);
  r=await call('sessions/'+stored.id+'/images/recover',{sceneKey:'p1:0'});assert.equal(r.code,200);assert.equal(stored.activeJob.status,'waiting');r=await call('bridge/'+stored.id+'/next',null,'GET');assert.equal(r.data.command,null);assert.equal(stored.script,'original');
 }finally{globalThis.fetch=old;}
});
