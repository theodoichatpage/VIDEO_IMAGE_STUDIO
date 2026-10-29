import fs from 'node:fs';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
export const extensionFiles=['manifest.json','background.js','content.js','web_bridge.js','reply-reader.js','popup.js','popup.html','HUONG_DAN_CAI_DAT.txt'];
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function packageExtension(root=process.cwd()){
 const dir=path.join(root,'extension'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')),version=manifest.version;
 if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))throw Error('Invalid extension version');
 for(const file of ['background.js','content.js','popup.js']){const source=fs.readFileSync(path.join(dir,file),'utf8');for(const match of source.matchAll(/(?<![\d.])0\.\d+\.\d+\b/g))if(match[0]!==version)throw Error('Runtime version mismatch in '+file+': '+match[0]+' != '+version);}
 const name='VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v'+version;
 const locals=[],central=[];let offset=0;
 for(const file of extensionFiles){
  const data=fs.readFileSync(path.join(dir,file)),filename=Buffer.from(name+'/'+file),compressed=deflateRawSync(data),crc=crc32(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(8,10);header.writeUInt16LE(33,14);header.writeUInt32LE(crc,16);header.writeUInt32LE(compressed.length,20);header.writeUInt32LE(data.length,24);header.writeUInt16LE(filename.length,28);header.writeUInt32LE(offset,42);
  locals.push(local,filename,compressed);central.push(header,filename);offset+=local.length+filename.length+compressed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(extensionFiles.length,8);end.writeUInt16LE(extensionFiles.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 const bytes=Buffer.concat([...locals,directory,end]);
 const relative='/resources/'+name+'.zip',target=path.join(root,'public',relative.slice(1));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
 fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.writeFileSync(path.join(root,'src/extensionRelease.ts'),'// Generated from extension/manifest.json by scripts/package-extension.mjs.\nexport const EXTENSION_VERSION = '+JSON.stringify(version)+';\nexport const EXTENSION_DOWNLOAD_URL = '+JSON.stringify(relative)+';\n');
 return{version,relative,bytes};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=packageExtension();console.log('Extension '+r.version+' packaged at '+r.relative);}
