export type RewriteStatus = 'waiting'|'processing'|'done'|'error'|'stopped';
export type MindmapBranch = { id:string; title:string; summary:string; content:string; children?: {id:string;title:string}[] };
export type ScriptSection = { id:string; branchId:string; title:string; summary:string; sourceText:string; status:RewriteStatus; rewrittenText:string; error?:string };
export type WorkspaceTranscript = { videoId:string; title?:string; thumbnail?:string; language?:string; captionType?:string; duration?:number; segments:{start:number;duration?:number;text:string}[]; text:string };
export type TranscriptWorkspaceState = { url:string; language:string; transcript:WorkspaceTranscript|null; branches:MindmapBranch[]; sections:ScriptSection[]; stylePrompt:string; selectedBranchId:string; updatedAt:number };

export const workspaceStorageKey=(projectId:string)=>`vis-transcript-workspace-${projectId}`;
export const defaultTranscriptWorkspace=():TranscriptWorkspaceState=>({url:'',language:'vi',transcript:null,branches:[],sections:[],stylePrompt:localStorage.getItem('vis-transcript-style')||'',selectedBranchId:'',updatedAt:Date.now()});
export function loadTranscriptWorkspace(projectId:string):TranscriptWorkspaceState{try{const raw=localStorage.getItem(workspaceStorageKey(projectId));return raw?{...defaultTranscriptWorkspace(),...JSON.parse(raw)}:defaultTranscriptWorkspace()}catch{return defaultTranscriptWorkspace()}}
export function saveTranscriptWorkspace(projectId:string,state:TranscriptWorkspaceState){localStorage.setItem(workspaceStorageKey(projectId),JSON.stringify({...state,updatedAt:Date.now()}));}
export function validateMindmapPayload(value:unknown):MindmapBranch[]{
 const root=value as {branches?:unknown}; if(!root||!Array.isArray(root.branches)||!root.branches.length)throw new Error('Mindmap JSON không hợp lệ.');
 const seen=new Set<string>(); return root.branches.map((raw:any)=>{const id=String(raw?.id||'').trim(),title=String(raw?.title||'').trim(),content=String(raw?.content||'').trim();if(!id||!title||!content||seen.has(id))throw new Error('Mindmap thiếu ID/nội dung hoặc bị trùng ID.');seen.add(id);return{id,title,summary:String(raw?.summary||''),content,children:Array.isArray(raw?.children)?raw.children.map((x:any)=>({id:String(x?.id||''),title:String(x?.title||'')})).filter((x:any)=>x.id&&x.title):[]};});
}
export const sectionsFromBranches=(branches:MindmapBranch[]):ScriptSection[]=>branches.map(x=>({id:x.id,branchId:x.id,title:x.title,summary:x.summary,sourceText:x.content,status:'waiting',rewrittenText:''}));
export const assembleRewrittenScript=(sections:ScriptSection[])=>sections.map(x=>x.rewrittenText.trim()).filter(Boolean).join('\n\n');
