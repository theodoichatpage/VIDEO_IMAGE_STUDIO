export type RewriteStatus = 'waiting'|'processing'|'done'|'error'|'stopped';
export type MindmapBranch = { id:string; title:string; summary:string; content:string; children?: {id:string;title:string}[] };
export type ScriptSection = { id:string; branchId:string; title:string; summary:string; sourceText:string; status:RewriteStatus; rewrittenText:string; error?:string };
export type WorkspaceTranscript = { videoId:string; title?:string; thumbnail?:string; language?:string; captionType?:string; duration?:number; segments:{start:number;duration?:number;text:string}[]; text:string };
// Aprilynne outline made with the split, before any rewriting: every section is written to fill its role in it.
export type StoryPlan = { title:string; hook:string; question:string; promise:string; tracks:string[]; turns:string; payoff:string; ending:string; sources:string; cover:string; roles:string[] };
export type TranscriptWorkspaceState = { url:string; language:string; transcript:WorkspaceTranscript|null; branches:MindmapBranch[]; sections:ScriptSection[]; stylePrompt:string; selectedBranchId:string; updatedAt:number; plan?:StoryPlan };

export const workspaceStorageKey=(projectId:string)=>`vis-transcript-workspace-${projectId}`;
export const defaultTranscriptWorkspace=():TranscriptWorkspaceState=>({url:'',language:'vi',transcript:null,branches:[],sections:[],stylePrompt:localStorage.getItem('vis-transcript-style')||'',selectedBranchId:'',updatedAt:Date.now()});
// Each project keeps its own Get Transcript work. The old shared ("default") workspace is handed once to
// the first project opened after this change, never to a second one, so projects do not overwrite each other.
export function claimSharedWorkspace(projectId:string){try{if(projectId==='default'||localStorage.getItem(workspaceStorageKey(projectId))!==null||localStorage.getItem('vis-transcript-default-owner'))return;const shared=localStorage.getItem(workspaceStorageKey('default'));localStorage.setItem('vis-transcript-default-owner',projectId);if(shared)localStorage.setItem(workspaceStorageKey(projectId),shared)}catch{}}
export function loadTranscriptWorkspace(projectId:string):TranscriptWorkspaceState{try{claimSharedWorkspace(projectId);const raw=localStorage.getItem(workspaceStorageKey(projectId));return raw?{...defaultTranscriptWorkspace(),...JSON.parse(raw)}:defaultTranscriptWorkspace()}catch{return defaultTranscriptWorkspace()}}
export function saveTranscriptWorkspace(projectId:string,state:TranscriptWorkspaceState){localStorage.setItem(workspaceStorageKey(projectId),JSON.stringify({...state,updatedAt:Date.now()}));
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('vis-transcript-workspace-updated',{detail:{projectId}}));
}
export function validateMindmapPayload(value:unknown):MindmapBranch[]{
 const root=value as {branches?:unknown}; if(!root||!Array.isArray(root.branches)||!root.branches.length)throw new Error('Mindmap JSON không hợp lệ.');
 const seen=new Set<string>(); return root.branches.map((raw:any)=>{const id=String(raw?.id||'').trim(),title=String(raw?.title||'').trim(),content=String(raw?.content||'').trim();if(!id||!title||!content||seen.has(id))throw new Error('Mindmap thiếu ID/nội dung hoặc bị trùng ID.');seen.add(id);return{id,title,summary:String(raw?.summary||''),content,children:Array.isArray(raw?.children)?raw.children.map((x:any)=>({id:String(x?.id||''),title:String(x?.title||'')})).filter((x:any)=>x.id&&x.title):[]};});
}
export const sectionsFromBranches=(branches:MindmapBranch[]):ScriptSection[]=>branches.map(x=>({id:x.id,branchId:x.id,title:x.title,summary:x.summary,sourceText:x.content,status:'waiting',rewrittenText:''}));
export const assembleRewrittenScript=(sections:ScriptSection[])=>sections.map(x=>x.rewrittenText.trim()).filter(Boolean).join('\n\n');

export function preparedAnalysisSource(workspace: TranscriptWorkspaceState) {
 const { sections, stylePrompt } = workspace;
 const done = sections.filter(part => part.status === 'done' && part.rewrittenText.trim()).length;
 const ready = !!stylePrompt.trim() && sections.length > 0 && done === sections.length;
 return { done, total: sections.length, style: stylePrompt, text: ready ? assembleRewrittenScript(sections) : '',
  parts: ready ? sections.map(part => ({ title: part.title, source: part.rewrittenText.trim(), text: part.rewrittenText.trim() })) : [] };
}
