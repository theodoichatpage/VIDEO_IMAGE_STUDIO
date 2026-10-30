// Select an EXISTING local project only. Never synthesize or reset project data.
export function resolveManagerLaunch(storage,search){
 const q=new URLSearchParams(search),id=q.get('managerProject'),run=q.get('managerRun');
 const none={projectId:null,runId:null,error:''};if(!id&&!run)return none;
 if(!/^[A-Za-z0-9-]{16,64}$/.test(id||'')||!/^[a-f0-9]{32}$/.test(run||''))return {...none,error:'Link AI Manager không hợp lệ; không đổi dự án.'};
 try{const metadata=JSON.parse(storage.getItem('vis-project-meta')||'[]');if(!Array.isArray(metadata))return {...none,error:'Không đọc được danh sách dự án trong profile. Không đổi dự án.'};
  // A project AI Manager created on the Studio server (or a second ChatGPT browser for it) is only
  // listed by name here; its data stays on the server. Existing projects are never renamed or reset.
  const name=String(q.get('managerName')||'').trim().slice(0,200);
  if(!metadata.some(p=>p&&p.id===id)){if(!name)return {...none,error:'Không tìm thấy dự án được AI Manager yêu cầu trong profile này. Không tạo dự án mới.'};const time=Date.now();storage.setItem('vis-project-meta',JSON.stringify([{id,name,createdAt:time,updatedAt:time},...metadata]))}
  // AI MANAGER names this browser profile's ChatGPT lane, so cloned profiles never share one.
  const laneId=q.get('managerLaneId')||'';if(/^[A-Za-z0-9_-]{6,64}$/.test(laneId))storage.setItem('vis-lane-id',laneId);
  const stage=q.get('managerStage');storage.setItem('vis-session',id);storage.setItem('vis-active-menu',stage==='images'?'2':stage==='transcript'?'0':'1');return {projectId:id,runId:run,error:'',lane:q.get('managerLane')==='1'}}catch{return {...none,error:'Không đọc được danh sách dự án trong profile. Không đổi dự án.'}}
}
