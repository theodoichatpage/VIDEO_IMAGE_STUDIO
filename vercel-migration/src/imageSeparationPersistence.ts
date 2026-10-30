import type {LibraryImage} from './imageSeparationState';
import type {SeparationResult} from './localEngine';
export type PersistedOutput={imageKey:string;imageName:string;jobId:string;result:SeparationResult};
export type PersistedSeparationState={selectedKeys:string[];outputs:PersistedOutput[];activeOutput:number;fill:boolean;mode?:'parallax'|'edit';layerCount?:3|4};
const DB='video-image-studio-separation';const STORE='images';const VERSION=1;
const stateKey=(projectId:string)=>`video-image-studio:separation:${projectId}`;
function db(){return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open(DB,VERSION);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
export async function saveLibraryImage(projectId:string,img:LibraryImage){if(!img.file)return;const d=await db();await new Promise<void>((resolve,reject)=>{const tx=d.transaction(STORE,'readwrite');tx.objectStore(STORE).put({id:`${projectId}:${img.file!.name}:${img.file!.size}:${img.file!.lastModified}`,projectId,name:img.file!.name,type:img.file!.type,lastModified:img.file!.lastModified,file:img.file});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});d.close()}
export async function loadLibraryImages(projectId:string):Promise<LibraryImage[]>{const d=await db();const all=await new Promise<any[]>((resolve,reject)=>{const tx=d.transaction(STORE,'readonly');const req=tx.objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)});d.close();return all.filter(x=>x.projectId===projectId).map(x=>{const file=x.file instanceof File?x.file:new File([x.file],x.name,{type:x.type,lastModified:x.lastModified});return{name:x.name,url:URL.createObjectURL(file),file,local:true}})}
export function saveSeparationState(projectId:string,state:PersistedSeparationState){localStorage.setItem(stateKey(projectId),JSON.stringify(state))}
export function loadSeparationState(projectId:string):PersistedSeparationState|null{try{const raw=localStorage.getItem(stateKey(projectId));return raw?JSON.parse(raw):null}catch{return null}}
export function zipName(imageName:string){const base=(imageName||'anh').replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').trim()||'anh';return `${base}.zip`}
