import {test} from 'node:test';import assert from 'node:assert/strict';
import {resolveManagerLaunch} from '../src/managerLaunch.mjs';
const id='a'.repeat(32),other='b'.repeat(32),run='c'.repeat(32);
const store=()=>{const m=new Map([['vis-session',other],['vis-project-meta',JSON.stringify([{id,name:'Project A'}])]]);return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)}};
test('known immutable project ID is selected',()=>{const s=store();const r=resolveManagerLaunch(s,`?managerProject=${id}&managerRun=${run}`);assert.equal(r.projectId,id);assert.equal(r.runId,run);assert.equal(s.getItem('vis-session'),id)});
test('unknown project cannot create/reset or change active project',()=>{const s=store();const r=resolveManagerLaunch(s,`?managerProject=${'d'.repeat(32)}&managerRun=${run}`);assert.equal(r.projectId,null);assert.equal(r.runId,null);assert.equal(s.getItem('vis-session'),other);assert(r.error)});
test('ordinary Studio launch unchanged',()=>{const s=store();assert.equal(resolveManagerLaunch(s,'').projectId,null);assert.equal(s.getItem('vis-session'),other)});
test('invalid nonce rejected',()=>{const s=store();assert.equal(resolveManagerLaunch(s,`?managerProject=${id}&managerRun=bad`).runId,null);assert.equal(s.getItem('vis-session'),other)});

test('Manager opens analysis instead of transcript',()=>{const s=store();resolveManagerLaunch(s,`?managerProject=${id}&managerRun=${run}`);assert.equal(s.getItem('vis-active-menu'),'1')});
test('image workflow opens image tab',()=>{const s=store();resolveManagerLaunch(s,`?managerProject=${id}&managerRun=${run}&managerStage=images`);assert.equal(s.getItem('vis-active-menu'),'2')});

test('Manager-created project is listed by name, never renaming an existing one',()=>{const s=store();const fresh='e'.repeat(32);const r=resolveManagerLaunch(s,`?managerProject=${fresh}&managerRun=${run}&managerName=${encodeURIComponent('Dự án mới')}&managerLane=1`);assert.equal(r.projectId,fresh);assert.equal(r.lane,true);const meta=JSON.parse(s.getItem('vis-project-meta'));assert.equal(meta[0].name,'Dự án mới');assert.equal(meta.length,2);
 resolveManagerLaunch(s,`?managerProject=${id}&managerRun=${run}&managerName=Other`);assert.equal(JSON.parse(s.getItem('vis-project-meta')).find(p=>p.id===id).name,'Project A')});
test('transcript stage opens the transcript tab',()=>{const s=store();resolveManagerLaunch(s,`?managerProject=${id}&managerRun=${run}&managerStage=transcript`);assert.equal(s.getItem('vis-active-menu'),'0')});

test('Manager names the lane of each browser profile',()=>{const s=store();resolveManagerLaunch(s,`?managerProject=${id}&managerRun=${run}&managerLaneId=edge_Profile_1`);assert.equal(s.getItem('vis-lane-id'),'edge_Profile_1');
 const t=store();resolveManagerLaunch(t,`?managerProject=${id}&managerRun=${run}&managerLaneId=bad id`);assert.equal(t.getItem('vis-lane-id'),null)});
