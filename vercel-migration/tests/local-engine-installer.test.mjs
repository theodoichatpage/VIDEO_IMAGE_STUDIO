import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {createLocalEngineInstaller} from '../scripts/local-engine-installer.mjs';
test('prebuild packages every real engine file and invokes installer by quoted absolute path',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vis-engine-package-'));
 try{
  fs.mkdirSync(path.join(temp,'src'));fs.writeFileSync(path.join(temp,'src/App.tsx'),'');fs.writeFileSync(path.join(temp,'src/index.css'),'');fs.cpSync('local-engine',path.join(temp,'local-engine'),{recursive:true});
  fs.mkdirSync(path.join(temp,'supabase/functions/studio-api'),{recursive:true});fs.copyFileSync('supabase/functions/studio-api/handler.ts',path.join(temp,'supabase/functions/studio-api/handler.ts'));
  execFileSync(process.execPath,[path.resolve('scripts/apply_image_separation_tab.mjs')],{cwd:temp});
  const out=path.join(temp,'public/resources'),bat=fs.readFileSync(path.join(out,'VIDEO_IMAGE_STUDIO_Local_Engine_Setup.bat'),'utf8');
  assert.ok(bat.includes('call "%DEST%\\install_windows.bat"\r\nif errorlevel 1 goto :error'));
  assert.ok(bat.includes('pushd "%DEST%" || goto :error'));assert.ok(!/(?<!\r)\n/.test(bat));
  for(const file of JSON.parse(fs.readFileSync(path.join(out,'local-engine/manifest.json'))).files){
   assert.deepEqual(fs.readFileSync(path.join(out,'local-engine',file)),fs.readFileSync(path.join('local-engine',file)));
   assert.ok(bat.includes(`%BASE%/${file}`));assert.ok(bat.includes(`%DEST%\\${file}.download`));
  }
  const nested=fs.readFileSync(path.join(out,'local-engine/install_windows.bat'),'utf8');
  assert.ok(!nested.includes('pause & exit'));assert.ok(nested.includes('exit /b 0\r\n:error'));
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
test('installer refuses incomplete bundles or names that could alter CMD commands',()=>{
 assert.throws(()=>createLocalEngineInstaller(['app.py']),/Missing/);
 assert.throws(()=>createLocalEngineInstaller(['install_windows.bat','start_engine.bat','bad&name.py']),/Invalid/);
});
