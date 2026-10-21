import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function capture(node){
 let calls=[]; const context=vm.createContext({window:{},document:{},VISReplyReader:{sources:()=>({node})},chrome:{runtime:{onMessage:{addListener(){}}}},Uint8Array,btoa,fetch:async(url,options)=>{calls.push({url,options});return new Response(new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])],{type:'image/png'}));}});
 const src=readFileSync('extension/content.js','utf8').replace('chrome.runtime.onMessage.addListener','globalThis.capture = imagePayload; chrome.runtime.onMessage.addListener');vm.runInContext(src,context);return{run:()=>context.capture({id:'scene-job'}),calls};
}
test('copies actual image bytes from the matched answer with ChatGPT credentials',async()=>{
 const c=capture({querySelectorAll:()=>[{complete:true,naturalWidth:1024,naturalHeight:1024,currentSrc:'https://chatgpt.com/backend-api/estuary/content?id=one'}]});const result=await c.run();assert.equal(result.jobId,'scene-job');assert.match(result.imageDataUrl,/^data:image\/png;base64,/);assert.equal(c.calls[0].options.credentials,'include');assert.equal(result.imageUrl,undefined);
});
test('does not capture unrelated images without a matching answer',async()=>{const c=capture(null);await assert.rejects(c.run(),/đúng lệnh/);assert.equal(c.calls.length,0);});
test('ignores icons and unfinished image thumbnails',async()=>{const c=capture({querySelectorAll:()=>[{complete:true,naturalWidth:32,naturalHeight:32,currentSrc:'https://x/icon'},{complete:false,naturalWidth:1024,naturalHeight:1024,currentSrc:'https://x/loading'}]});await assert.rejects(c.run());assert.equal(c.calls.length,0);});
