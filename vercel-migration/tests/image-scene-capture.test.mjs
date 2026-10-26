import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync('supabase/functions/studio-api/handler.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function scenario(run){
 const original=globalThis.fetch;process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY='fixture';
 let record={id:'capture-scenes-test-12345',script:'Keep original script',status:'image_processing',activeJob:{id:'other-job',type:'image_generation',status:'waiting',prompt:'Scene B',sceneKey:'p1:1',protocol:3},imageJobs:[{id:'other-job',status:'waiting'}],parts:[{id:'p1',status:'complete',content:'Keep content',scenes:[{title:'A',prompt:'Scene A',imagePrompt:'SCENE: Scene A',imageStatus:'stopped',imageResults:[]},{title:'B',prompt:'Scene B',imageStatus:'generating',imageResults:[]}]}],updatedAt:100};
 let uploads=0,afterUpload,conflict=false;
 globalThis.fetch=async(url,init={})=>{
  if(url.includes('/storage/')){if(url.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/studio-images/'+url.split('/studio-images/')[1]+'?fixture=1'});if(url.includes('/object/studio-images/')){uploads++;afterUpload?.(record)}return Response.json({ok:true})}
  if(url.includes('studio_separations'))return Response.json([]);
  if(init.method==='PATCH'){
   if(conflict){conflict=false;record.script='Concurrent change';record.updatedAt++;return Response.json([])}
   const expected=new URL(url).searchParams.get('record->>updatedAt');assert.equal(expected,'eq.'+record.updatedAt);
   record=JSON.parse(init.body).record;return Response.json([{record:structuredClone(record)}]);
  }
  if(init.method==='POST'){record=JSON.parse(init.body).record;return new Response('',{status:201})}
  return Response.json([{record:structuredClone(record)}]);
 };
 const call=async(path,body)=>{let status,data;await handler({method:'POST',query:{path:path.split('/')},headers:{},body},{setHeader(){},status(n){status=n;return{json(d){data=d}}}});return{status,data}};
 try{await run({call,state:()=>record,uploads:()=>uploads,onUpload:fn=>afterUpload=fn,conflict:()=>conflict=true})}finally{globalThis.fetch=original}
}
test('captures selected scene A while scene B is active without stopping or relabeling B',()=>scenario(async s=>{
 const active=structuredClone(s.state().activeJob),queue=structuredClone(s.state().imageJobs);
 const r=await s.call('sessions/'+s.state().id+'/images/capture',{sceneKey:'p1:0'});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.command.sceneKey,'p1:0');assert.deepEqual(s.state().activeJob,active);assert.deepEqual(s.state().imageJobs,queue);
 const job=r.data.command.id;
 const done=await s.call('bridge/'+s.state().id+'/event',{jobId:job,state:'completed',imageDataUrl:png});assert.equal(done.status,200,JSON.stringify(done.data));
 assert.equal(s.state().parts[0].scenes[0].imageStatus,'complete');assert.equal(s.state().parts[0].scenes[0].imageResults[0].jobId,job);assert.equal(s.state().parts[0].scenes[1].imageStatus,'generating');assert.deepEqual(s.state().activeJob,active);assert.deepEqual(s.state().imageJobs,queue);assert.equal(s.state().script,'Keep original script');
 await s.call('bridge/'+s.state().id+'/event',{jobId:job,state:'completed',imageDataUrl:png});assert.equal(s.uploads(),1);
}));
test('image capture preserves another job completing during upload and retries conflicting saves',()=>scenario(async s=>{
 const r=await s.call('sessions/'+s.state().id+'/images/capture',{sceneKey:'p1:0'});assert.equal(r.status,200);
 s.onUpload(record=>{record.activeJob={id:'next-job',type:'part_analysis',status:'waiting',partId:'p2'};record.parts[0].scenes[1].imageStatus='complete';record.updatedAt++});s.conflict();
 const done=await s.call('bridge/'+s.state().id+'/event',{jobId:r.data.command.id,state:'completed',imageDataUrl:png});assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(s.state().activeJob.id,'next-job');assert.equal(s.state().script,'Concurrent change');assert.equal(s.state().parts[0].scenes[1].imageStatus,'complete');
}));
test('capture rejects invalid bytes and unknown scenes without releasing the active job',()=>scenario(async s=>{
 const bad=await s.call('sessions/'+s.state().id+'/images/capture',{sceneKey:'p1:88'});assert.equal(bad.status,422);
 const r=await s.call('sessions/'+s.state().id+'/images/capture',{sceneKey:'p1:0'});assert.equal(r.status,200);
 const done=await s.call('bridge/'+s.state().id+'/event',{jobId:r.data.command.id,state:'completed',imageDataUrl:'data:text/html;base64,QQ=='});assert.equal(done.status,422);assert.equal(s.state().activeJob.id,'other-job');assert.equal(s.state().parts[0].scenes[0].imageResults.length,0);
}));

test('uses the existing active command when capturing that same scene',()=>scenario(async s=>{
 const r=await s.call('sessions/'+s.state().id+'/images/capture',{sceneKey:'p1:1'});assert.equal(r.status,200);assert.equal(r.data.command.id,'other-job');assert.equal(s.state().imageCaptures,undefined);assert.equal(s.state().activeJob.id,'other-job');
}));
