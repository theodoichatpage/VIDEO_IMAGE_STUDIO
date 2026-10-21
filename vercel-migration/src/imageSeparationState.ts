export type LibraryImage={name:string;url:string;file?:File;local?:boolean};
export function imageKey(img:LibraryImage){return img.file?`${img.file.name}:${img.file.size}:${img.file.lastModified}`:`url:${img.url}`}
export function mergeLibrary<T extends LibraryImage>(current:T[],incoming:T[]){const seen=new Set(current.map(imageKey));return [...current,...incoming.filter(img=>{const key=imageKey(img);if(seen.has(key))return false;seen.add(key);return true})]}
export function removeSelection<T extends LibraryImage>(selected:T[],img:T){const key=imageKey(img);return selected.filter(x=>imageKey(x)!==key)}
