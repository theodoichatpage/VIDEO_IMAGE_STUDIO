const fs=require('fs');const s=fs.readFileSync('extension/content.js','utf8');
function ok(v,m){if(!v)throw Error(m)}
ok(s.includes('responseTextForJob'),'must scan response by stable job id');
ok(s.includes("t.includes(id)&&/[\\\"']job_id"),'must require exact job id protocol field');
ok(s.includes("if(c.kind==='analysis_text'||c.kind==='plan')"),'analysis must use protocol scan');
ok(s.includes("await report('done',{text:direct})"),'protocol scan must report completed JSON');
console.log('PASS job-id JSON capture source checks');
