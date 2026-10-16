async function ensureConnected(tabId){try{return await chrome.tabs.sendMessage(tabId,{type:'ping'});}catch(_){try{await chrome.scripting.executeScript({target:{tabId},files:['content.js']});}catch(e){throw Error('Kiểm tra quyền truy cập chatgpt.com. '+e.message);}return await chrome.tabs.sendMessage(tabId,{type:'ping'});}}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{(async()=>{
 const config=await chrome.storage.local.get(['token','tab','client','browser']);
 if(m.type==='bind'){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab||!tab.url?.startsWith('https://chatgpt.com/'))throw Error('Mở tab chatgpt.com rồi bấm tiện ích.');
  if(!m.token?.trim())throw Error('Dán mã kết nối từ Studio trước.');const ping=await ensureConnected(tab.id);if(!ping?.ready)throw Error('Chưa nhận diện được ô nhập trên tab này. Bấm vào ô Ask ChatGPT, tải lại trang rồi kết nối lại. Nếu vẫn lỗi, gửi ảnh màn hình cho người hỗ trợ.');
  const binding={token:m.token,tab:tab.id,client:crypto.randomUUID(),browser:m.browser};
  let response;
  try{response=await fetch('http://127.0.0.1:7871/bridge/bind',{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Studio-Token':binding.token},body:JSON.stringify({client:binding.client,browser:binding.browser,ready:ping.ready,url:tab.url})})}catch(e){throw Error('Chưa kết nối được máy chủ Studio tại 127.0.0.1:7871. Kiểm tra cửa sổ chạy Studio còn mở, rồi thử lại. '+e.message)}
  const result=await response.json();if(!response.ok)throw Error(result.error||'Máy chủ Studio từ chối kết nối. Sao chép lại mã mới trong Studio.');
  await chrome.storage.local.set(binding);await chrome.tabs.sendMessage(tab.id,{type:'wake'});reply({ok:true,connected:true});return;
 }
 if(m.type==='unbind'){if(config.token&&config.client){try{await fetch('http://127.0.0.1:7871/bridge/unbind',{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Studio-Token':config.token},body:JSON.stringify({client:config.client})})}catch(_){}}await chrome.storage.local.remove(['tab','token','client']);reply({ok:true});return}
 if(sender.tab?.id!==config.tab||!sender.url?.startsWith('https://chatgpt.com/')){reply({inactive:true});return}
 if(!config.token){reply({inactive:true});return}
 const path=m.type==='heartbeat'?'/bridge/heartbeat':m.type==='poll'?'/bridge/poll':'/bridge/result';
 if(!['poll','result','heartbeat'].includes(m.type))throw Error('Lệnh không hợp lệ.');
 const r=await fetch('http://127.0.0.1:7871'+path,{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Studio-Token':config.token},body:JSON.stringify({...m.data,client:config.client,browser:config.browser})});const d=await r.json();if(!r.ok)throw Error(d.error||'Studio chưa kết nối.');reply(d);
 })().catch(e=>reply({error:e.message}));return true;});

chrome.downloads.onChanged.addListener(delta=>{if(delta.state?.current!=='complete')return;(async()=>{
 const config=await chrome.storage.local.get(['token','client']);if(!config.token||!config.client)return;
 const items=await chrome.downloads.search({id:delta.id});const item=items[0];if(!item?.filename||!/\.(png|jpe?g|webp)$/i.test(item.filename))return;
 await fetch('http://127.0.0.1:7871/bridge/download-complete',{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json','X-Studio-Token':config.token},body:JSON.stringify({client:config.client,filename:item.filename})});
})().catch(()=>{});});
