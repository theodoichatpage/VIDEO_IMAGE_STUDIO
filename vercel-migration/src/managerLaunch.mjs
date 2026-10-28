// Select an EXISTING local project only. Never synthesize or reset project data.
export function resolveManagerLaunch(storage,search){
 const q=new URLSearchParams(search),id=q.get('managerProject'),run=q.get('managerRun');
 const none={projectId:null,runId:null,error:''};if(!id&&!run)return none;
 if(!/^[A-Za-z0-9-]{16,64}$/.test(id||'')||!/^[a-f0-9]{32}$/.test(run||''))return {...none,error:'Link AI Manager không hợp lệ; không đổi dự án.'};
 try{const metadata=JSON.parse(storage.getItem('vis-project-meta')||'[]');if(!Array.isArray(metadata)||!metadata.some(p=>p&&p.id===id))return {...none,error:'Không tìm thấy dự án được AI Manager yêu cầu trong profile này. Không tạo dự án mới.'};storage.setItem('vis-session',id);storage.setItem('vis-active-menu',q.get('managerStage')==='images'?'2':'1');return {projectId:id,runId:run,error:''}}catch{return {...none,error:'Không đọc được danh sách dự án trong profile. Không đổi dự án.'}}
}
