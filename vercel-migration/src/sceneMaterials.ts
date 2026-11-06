export type Material={assetType:string;source:string;rights:'Chưa rõ'|'Cần kiểm tra'|'Đã kiểm tra'};
const key=(project:string,part:string,index:number,content:string)=>'vis-scene-material-'+JSON.stringify([project,part,index,content]);
export function loadSceneMaterial(project:string,part:string,index:number,content:string):Material|null{try{return JSON.parse(localStorage.getItem(key(project,part,index,content))||'null')}catch{return null}}
export function saveSceneMaterial(project:string,part:string,index:number,content:string,value:Material){localStorage.setItem(key(project,part,index,content),JSON.stringify(value))}
