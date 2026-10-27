import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {inflateRawSync} from 'node:zlib';
import {packageExtension,extensionFiles,crc32} from '../scripts/package-extension.mjs';
function unzip(bytes){const files=new Map();let offset=0;while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+30,offset+30+nameLength).toString(),start=offset+30+nameLength+extra,data=inflateRawSync(bytes.subarray(start,start+size));assert.equal(crc32(data),bytes.readUInt32LE(offset+14));files.set(name,data);offset=start+size;}assert.equal(bytes.readUInt32LE(offset),0x02014b50);return files;}
test('ZIP filename, enclosing folder, manifest and generated web release are consistent',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vis-release-'));
 try{fs.cpSync('extension',path.join(root,'extension'),{recursive:true});const release=packageExtension(root),files=unzip(release.bytes),manifest=JSON.parse(fs.readFileSync('extension/manifest.json'));
 assert.equal(release.version,manifest.version);assert.ok(release.relative.endsWith('_v'+manifest.version+'.zip'));assert.equal(files.size,extensionFiles.length);
 for(const file of extensionFiles)assert.deepEqual(files.get('VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v'+manifest.version+'/'+file),fs.readFileSync('extension/'+file));
 assert.equal(JSON.parse(files.get('VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v'+manifest.version+'/manifest.json')).version,release.version);
 assert.ok(fs.readFileSync(path.join(root,'src/extensionRelease.ts'),'utf8').includes(JSON.stringify(release.relative)));
 assert.deepEqual(packageExtension(root).bytes,release.bytes,'Archive is reproducible');
 const changed={...manifest,version:'0.4.24'};fs.writeFileSync(path.join(root,'extension/manifest.json'),JSON.stringify(changed));assert.throws(()=>packageExtension(root),/Runtime version mismatch/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('web bridge reports installed 4.23 unchanged instead of claiming 4.22',async()=>{
 const out=[];const c=vm.createContext({location:{origin:'https://video-image-studio.vercel.app'},window:{addEventListener(){},postMessage:m=>out.push(m)},chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async()=>({ok:true,version:'0.4.23',chatReady:true,pairCode:'p'})}},setInterval(){},clearInterval(){}});
 vm.runInContext(fs.readFileSync('extension/web_bridge.js','utf8'),c);await new Promise(r=>setImmediate(r));assert.equal(out.find(m=>m.type==='studio-status').version,'0.4.23');
});
test('CRC32 matches standard ZIP reference vector',()=>assert.equal(crc32(Buffer.from('123456789')),0xcbf43926));
