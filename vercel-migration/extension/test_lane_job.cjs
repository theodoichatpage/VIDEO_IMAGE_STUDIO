// Several browsers run in parallel: each extension follows only its own job (shared job or its lane job).
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const bg=fs.readFileSync(__dirname+'/background.js','utf8');
const c={};vm.createContext(c);vm.runInContext(bg.slice(bg.indexOf('function ownJob('),bg.indexOf('\n',bg.indexOf('function ownJob(')))+';globalThis.own=ownJob;',c);
const shared={id:'s1',lane:'laneA'},mine={id:'l2',lane:'laneB'},other={id:'l3',lane:'laneC'};
const session={activeJob:shared,laneJobs:[mine,other]};
assert.equal(c.own(session,'l2'),mine,'lane job found by this extension\'s active job id');
assert.equal(c.own(session,'s1'),shared);
assert.equal(c.own(session,''),null,'no active job: nothing is claimed');
assert.equal(c.own({activeJob:null},'l2'),null);
// Periodic re-read never picks another browser's shared job.
assert.match(bg,/ownJob\(session, stored\.activeJobId\) \|\| \(session\.activeJob && !session\.activeJob\.lane \? session\.activeJob : null\)/);
assert.match(bg,/job=ownJob\(\(await response\.json\(\)\)\.session,st\.activeJobId\)/,'watchdog follows lane jobs too');
console.log('test_lane_job PASS');
