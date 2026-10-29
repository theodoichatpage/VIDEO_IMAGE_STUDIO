// A long conversation is switched to a new ChatGPT chat before a text analysis job; nothing else is.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/background.js','utf8');
const section=src.slice(src.indexOf('const NEW_CHAT_AFTER_CHARS'),src.indexOf('async function broadcastToStudio'));
function harness(size){
 const calls=[];let listener=null;
 const chrome={tabs:{
  sendMessage:async(_id,msg)=>{calls.push(msg.type);return size;},
  update:async(id,o)=>{calls.push('update:'+o.url);setTimeout(()=>listener&&listener(id,{status:'complete'},{url:'https://chatgpt.com/'}),5);return {};},
  onUpdated:{addListener:f=>{listener=f;},removeListener:()=>{listener=null;}}}};
 const c={chrome,setTimeout,clearTimeout,CHATGPT_PREFIX:'https://chatgpt.com/',checkStop(){},ensureChatReceiver:async id=>{calls.push('ensure:'+id);return {id};}};
 vm.createContext(c);vm.runInContext(section+';globalThis.fresh=freshConversationIfLong;',c);return {c,calls};
}
(async()=>{
 let h=harness({chars:150000,path:'/c/abc',generating:false});
 assert.deepEqual(await h.c.fresh({id:7},{id:'j',type:'part_analysis'},0),{id:7});
 assert.deepEqual(h.calls,['vis-conversation-size','update:https://chatgpt.com/','ensure:7'],'long conversation opens a new chat first');
 h=harness({chars:20000,path:'/c/abc',generating:false});await h.c.fresh({id:7},{id:'j',type:'part_analysis'},0);
 assert.deepEqual(h.calls,['vis-conversation-size'],'short conversation is kept');
 h=harness({chars:150000,path:'/c/abc',generating:true});await h.c.fresh({id:7},{id:'j',type:'script_structure'},0);
 assert.deepEqual(h.calls,['vis-conversation-size'],'never navigates away while ChatGPT is answering');
 h=harness({chars:150000,path:'/',generating:false});await h.c.fresh({id:7},{id:'j',type:'part_analysis'},0);
 assert.deepEqual(h.calls,['vis-conversation-size'],'already a new chat');
 h=harness({chars:150000,path:'/c/abc',generating:false});await h.c.fresh({id:7},{id:'j',type:'image_generation'},0);
 assert.deepEqual(h.calls,[],'image jobs keep their conversation');
 console.log('test_new_chat PASS');
})().catch(e=>{console.error(e);process.exit(1);});
