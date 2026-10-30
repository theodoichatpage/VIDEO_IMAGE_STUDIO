const DEFAULT_STUDIO_MATCH = 'https://video-image-studio.vercel.app/*';
const CHATGPT_PREFIX = 'https://chatgpt.com/';
let deliveryDiagnostic = '';
// Which ChatGPT account this browser uses (masked label + short hash), so AI MANAGER can tell lanes apart.
let chatAccount = null;
// The job this browser works on: the shared job, or this browser's own lane job when several tabs run in parallel.
const STUDIO_API = 'https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api?path=';
// Small version stamp of a project (job ids/statuses only). null when the server is older.
async function studioVersion(pairCode) {
  try { const response = await fetch(STUDIO_API + encodeURIComponent('sessions/' + pairCode + '/version'), { signal: AbortSignal.timeout(10000) }); if (!response.ok) return null; const data = await response.json(); return data.version && !data.version.full ? data.version : null; } catch { return null; }
}
function ownJob(session, id) { return [session?.activeJob, ...(session?.laneJobs || [])].find(job => job && id && job.id === id) || null; }
let stopGeneration=0,stopDepth=0;const cancelledJobs=new Set();const downloads=new Map();
function checkStop(token,id){if(token!==stopGeneration||stopDepth||cancelledJobs.has(id))throw new Error('Tác vụ đã được Dừng. Chỉ bắt đầu lại khi bạn bấm lệnh mới.');}

function studioMatch(origin) {
  try { return new URL(origin || '').origin + '/*'; } catch { return DEFAULT_STUDIO_MATCH; }
}

async function chatTabs() {
  return (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith(CHATGPT_PREFIX));
}

// No ChatGPT tab yet: open one in the background instead of asking the user to.
let chatTabOpenedAt = 0;
async function openChatTab() {
  // At most one new tab per 2 minutes (a login redirect must not open tab after tab).
  if (Date.now() - chatTabOpenedAt < 120000) return [];
  chatTabOpenedAt = Date.now();
  const created = await chrome.tabs.create({ url: CHATGPT_PREFIX, active: false });
  for (let waited = 0; waited < 30000; waited += 500) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try { const tab = await chrome.tabs.get(created.id); if (tab.status === 'complete' && tab.url?.startsWith(CHATGPT_PREFIX)) return [tab]; } catch { break; }
  }
  return chatTabs();
}
async function ensureChatReceiver(preferredId) {
  let tabs = await chatTabs();
  if (!tabs.length) tabs = await openChatTab();
  if (!tabs.length) throw new Error('Không mở được tab ChatGPT. Hãy mở chatgpt.com và đăng nhập.');
  const stored = await chrome.storage.local.get(['chatTabId']);
  const tab = tabs.find(item => item.id === preferredId) || tabs.find(item => item.id === stored.chatTabId) || tabs.find(item => item.active) || tabs[0];
  let existing;
  try { existing = await chrome.tabs.sendMessage(tab.id, { type: 'vis-ping' }); } catch {}
  // Edge "sleeping tabs" must never unload the tab that works for Studio.
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch {}
  if (existing?.ready) {
    if (existing.account) chatAccount = existing.account;
    if (existing.version !== '0.5.7') throw new Error('Tab ChatGPT còn cầu nối cũ v' + (existing.version || '?') + '. Hãy F5 tab ChatGPT để nạp Extension 0.5.7.');
    return tab;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['reply-reader.js', 'content.js'] });
  } catch (error) {
    throw new Error('Không thể nạp cầu nối vào tab ChatGPT. Hãy tải lại tab ChatGPT rồi thử lại. ' + (error?.message || ''));
  }
  try {
    const pong = await chrome.tabs.sendMessage(tab.id, { type: 'vis-ping' });
    if (pong?.ready && pong.version === '0.5.7') return tab;
  } catch {}
  throw new Error('Tab ChatGPT chưa sẵn sàng: có thể ChatGPT chưa đăng nhập. Mở tab chatgpt.com, đăng nhập rồi thử lại.');
}

// Very long conversations (full script + several parts of JSON) freeze the ChatGPT tab mid-answer.
// Text analysis jobs carry their own [VIS_JOB_ID] prompt, so they can safely start in a new chat.
const NEW_CHAT_AFTER_CHARS = 60000;
async function freshConversationIfLong(tab, command, token) {
  if (!['part_analysis', 'script_structure'].includes(command?.type)) return tab;
  let size;
  try { size = await chrome.tabs.sendMessage(tab.id, { type: 'vis-conversation-size' }); } catch { return tab; }
  if (!size || size.generating || !/^\/c\//.test(size.path || '') || size.chars < NEW_CHAT_AFTER_CHARS) return tab;
  checkStop(token, command.id);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Không mở được hội thoại ChatGPT mới. Hãy mở chatgpt.com rồi gửi lại.')); }, 30000);
    const listener = (id, change, updated) => { if (id === tab.id && change.status === 'complete' && /^https:\/\/chatgpt\.com\/?(\?.*)?$/.test(updated.url || '')) { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tab.id, { url: CHATGPT_PREFIX }).catch(error => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); reject(error); });
  });
  checkStop(token, command.id);
  return ensureChatReceiver(tab.id);
}

async function broadcastToStudio(message) {
  const stored = await chrome.storage.local.get(['studioOrigin']);
  const tabs = await chrome.tabs.query({ url: studioMatch(stored.studioOrigin) });
  await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, message).catch(() => null)));
}

let deliveryQueue = Promise.resolve();
function deliverPending() {
  deliveryQueue = deliveryQueue.catch(() => {}).then(async () => {
    const token=stopGeneration;
    const stored = await chrome.storage.local.get(['pendingChatEvents', 'pairCode']);
    for (const event of (stored.pendingChatEvents || [])) {
      if(token!==stopGeneration||stopDepth)break;
      const sessionId = event._sessionId;
      if (!sessionId || sessionId !== stored.pairCode) continue;
      const { _sessionId, ...payload } = event;
      try {
        const response = await fetch('https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api?path=' + encodeURIComponent('bridge/' + sessionId + '/event'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(45000)
        });
        const data = await response.json();
        if (!response.ok || data.error) {deliveryDiagnostic='Chưa lưu được ảnh/kết quả lên Studio (HTTP '+response.status+'): '+String(data.error || 'Máy chủ từ chối kết quả.');continue;}
        deliveryDiagnostic='';
        const latest = await chrome.storage.local.get(['pendingChatEvents']);
        await chrome.storage.local.set({ pendingChatEvents: (latest.pendingChatEvents || []).filter(item => !(item.jobId === event.jobId && item.state === event.state && item._sessionId === sessionId)) });
      } catch (error) { deliveryDiagnostic='Kết quả đã giữ trong tiện ích, đang chờ gửi lại: '+(error?.message || String(error)); }
    }
  });
  return deliveryQueue;
}

// Last capture outcome, reported to AI MANAGER so failures are visible without the popup.
let lastCapture = null;
async function captureCommand(command,token=stopGeneration,passive=false) {
  const jobId = command.id;
  const bound = await chrome.storage.local.get(['chatTabId']);
  const candidates = await chatTabs();
  candidates.sort((a, b) => Number(b.id === bound.chatTabId) - Number(a.id === bound.chatTabId));
  let result, matchedTab, errors = [];
  for (const candidate of candidates) {
    try {
      checkStop(token,jobId);const tab = await ensureChatReceiver(candidate.id);
      checkStop(token,jobId);
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'vis-capture-result', jobId, jobType: command.type, command, passive });
      checkStop(token,jobId);
      // The tab is answering this very job itself: its own waiter reads the reply; never read in parallel.
      if (passive && reply?.busy) return null;
      if (reply?.ok && reply.payload) { result = reply; matchedTab = tab.id; break; }
      errors.push(reply?.error || 'Không đọc được phản hồi.');
    } catch (error) { errors.push(error.message); }
  }
  lastCapture = { at: Date.now(), jobId, passive, ok: Boolean(result), error: result ? '' : String(errors.join(' | ') || 'Chưa có tab ChatGPT để đồng bộ.').slice(0, 300) };
  if (!result) throw new Error(errors.join(' | ') || 'Chưa có tab ChatGPT để đồng bộ.');
  await chrome.storage.local.set({ chatTabId: matchedTab });
  return result.payload;
}

let reconciliation = null;
let syncDiagnostic = '';
let reconciledAt = 0;
function reconcileWaitingResult() {
  // Every Studio tab asks for status every 5 s; reading ChatGPT that often while it streams hung the tab.
  if (reconciliation) return reconciliation;
  if (Date.now() - reconciledAt < 20000) return Promise.resolve();
  reconciledAt = Date.now();
  reconciliation = (async () => {
    const token=stopGeneration;
    const stored = await chrome.storage.local.get(['pairCode','activeJobId']);
    if (!stored.pairCode||stopDepth) return;
    try {
      // Download the whole project only when the small stamp shows a job this browser may need to re-read.
      const v = await studioVersion(stored.pairCode);
      if (v) {
        const mine = ownJob(v, stored.activeJobId), shared = v.activeJob && !v.activeJob.lane ? v.activeJob : null, waiting = job => job && ['sent', 'waiting', 'error'].includes(job.status);
        const timedOut = !v.activeJob && v.lastJob?.status === 'error' && /quá thời gian|JSON không hợp lệ/i.test(String(v.lastError || ''));
        if (!waiting(mine) && !waiting(shared) && !timedOut) { syncDiagnostic = ''; return; }
      }
      const response = await fetch('https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api?path=' + encodeURIComponent('sessions/' + stored.pairCode), { signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok || data.error) return;
      const session = data.session || {};
      // Another browser's lane job is never read here.
      let command = ownJob(session, stored.activeJobId) || (session.activeJob && !session.activeJob.lane ? session.activeJob : null);
      // A text job that only timed out (e.g. the ChatGPT tab froze) may still have its full reply in the
      // conversation: keep re-reading it. Studio accepts it only while it is still the latest job.
      if (!command && session.lastJob?.status === 'error' && ['part_analysis', 'script_structure'].includes(session.lastJob.type) && /quá thời gian|JSON không hợp lệ/i.test(String(session.lastError || ''))) command = session.lastJob;
      if (!command || !['sent', 'waiting', 'error'].includes(command.status) || !['part_analysis', 'script_structure', 'image_generation'].includes(command.type)) { syncDiagnostic = ''; return; }
      if (command.status === 'error') {
        const payload = await captureCommand(command, token, true);
        if (payload?.state === 'completed') await queueAndBroadcast(payload, token);
        syncDiagnostic = '';
        return;
      }
      const payload = await captureCommand(command,token,true);
      if (payload) await queueAndBroadcast(payload,token);
      syncDiagnostic = '';
    } catch (error) { syncDiagnostic = error?.message || String(error); }
  })().finally(() => { reconciliation = null; });
  return reconciliation;
}

let enqueue = Promise.resolve();
function queueAndBroadcast(payload,token=stopGeneration) {
  enqueue = enqueue.catch(() => {}).then(() => token===stopGeneration&&!stopDepth&&!cancelledJobs.has(payload?.jobId)?persistAndDeliver(payload,token):undefined);
  return enqueue;
}
async function persistAndDeliver(payload,token) {
  if (!payload?.jobId || !['progress', 'completed', 'error'].includes(payload.state)) return;
  const stored = await chrome.storage.local.get(['pendingChatEvents', 'pairCode']);
  if ((stored.pendingChatEvents || []).some(item => item.jobId === payload.jobId && item.state === 'completed' && (!payload.imageDataUrl || item.imageDataUrl))) return;
  if(token!==stopGeneration||stopDepth||cancelledJobs.has(payload.jobId))return;
  const events = Array.isArray(stored.pendingChatEvents) ? stored.pendingChatEvents.filter(item => item?.jobId !== payload.jobId) : [];
  events.push({ ...payload, _sessionId: stored.pairCode });
  await chrome.storage.local.set({ pendingChatEvents: events.slice(-10) });
  if(token!==stopGeneration||stopDepth)return;
  await deliverPending();
  if(token!==stopGeneration||stopDepth)return;
  await broadcastToStudio({ type: 'vis-chat-event', payload, serverManaged: true });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const token=stopGeneration;if(message?.type==='vis-stop'){stopGeneration++;stopDepth++;}
  (async () => {
    if (message?.type === 'vis-tab-id') { sendResponse({chatTabId:sender.tab?.id ?? null}); return; }
    if (message?.type === 'vis-fetch-image') {
      if (!sender.tab?.url?.startsWith(CHATGPT_PREFIX)) throw new Error('Chỉ tab ChatGPT được tải tệp ảnh.');
      const url = new URL(String(message.url || ''));
      const trusted = url.hostname === 'chatgpt.com' || url.hostname.endsWith('.oaiusercontent.com') || /^(?:oaidalleapiprodscus|sdmntpr[a-z0-9-]*)\.blob\.core\.windows\.net$/.test(url.hostname);
      if (url.protocol !== 'https:' || url.username || url.password || !trusted) throw new Error('Địa chỉ ảnh không thuộc máy chủ ChatGPT được phép.');
      const controller=new AbortController();downloads.set(controller,sender.tab.id);try{
      const response = await fetch(url.href, {credentials:url.hostname === 'chatgpt.com'?'include':'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),redirect:'error'});
      if (!response.ok) throw new Error('Không tải được ảnh ChatGPT (HTTP ' + response.status + ').');
      if (Number(response.headers.get('content-length')) > 8388608) throw new Error('Ảnh vượt giới hạn 8 MB.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 8388608) throw new Error('Ảnh vượt giới hạn 8 MB.');
      const mime = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80 ? 'image/webp' : '';
      if (!mime) throw new Error('Máy chủ chưa trả tệp PNG/JPEG/WebP hợp lệ.');
      let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      sendResponse({ok:true,imageDataUrl:'data:'+mime+';base64,'+btoa(binary)});return;}finally{downloads.delete(controller);}
    }
    if (message?.type === 'vis-transcript-send') {
      const stored = await chrome.storage.local.get(['pairCode', 'transcriptJobs', 'activeJobId']);
      if (!stored.pairCode || stored.pairCode !== message.pairCode) throw new Error('Hãy kết nối ChatGPT với đúng dự án trước khi tạo Mindmap.');
      const command = message.command;
      if (!command?.id || !command.prompt || !['transcript_mindmap','transcript_rewrite'].includes(command.type)) throw new Error('Lệnh Transcript không hợp lệ.');
      const existing = stored.transcriptJobs?.[command.id];
      if (existing) { sendResponse({ok:true,duplicate:true}); return; }
      { const prev = stored.transcriptJobs?.[stored.activeJobId];
        // Only a live job of this same project (under 15 minutes old) keeps ChatGPT busy; leftovers do not.
        if (stored.activeJobId && prev && !prev.result && prev.state !== 'stopped' && prev.pairCode === stored.pairCode && Date.now() - (prev.at || 0) < 900000) throw new Error('ChatGPT đang xử lý tác vụ khác. Hãy đợi hoàn tất hoặc Dừng trước.'); }
      const tab = await ensureChatReceiver();checkStop(token,command.id);
      const jobs = Object.fromEntries(Object.entries(stored.transcriptJobs || {}).slice(-19));
      jobs[command.id] = {command, pairCode:stored.pairCode, tabId:tab.id, state:'sending', at:Date.now()};
      await chrome.storage.local.set({transcriptJobs:jobs});
      try {
        checkStop(token,command.id);const result = await chrome.tabs.sendMessage(tab.id, {type:'vis-command',command,replaceStale:true});
        checkStop(token,command.id);
        if (!result?.ok) throw new Error(result?.error || 'ChatGPT không nhận được lệnh.');
        const u=new URL(tab.url);const conversationUrl=u.origin==='https://chatgpt.com'&&/^\/c\/[^/]+$/.test(u.pathname)?u.origin+u.pathname:null;
        await chrome.storage.local.set({activeJobId:command.id,activeJobType:command.type,activeCommand:command,chatTabId:tab.id,conversationUrl,identityJobId:command.id});
      } catch (error) {
        const latest = await chrome.storage.local.get(['transcriptJobs']);
        if (latest.transcriptJobs?.[command.id]) latest.transcriptJobs[command.id].state = 'stopped';
        await chrome.storage.local.set({transcriptJobs:latest.transcriptJobs || {}});
        throw error;
      }
      sendResponse({ok:true}); return;
    }
    if (message?.type === 'vis-transcript-ack') {
      const stored = await chrome.storage.local.get(['transcriptJobs','activeJobId']);
      const job = stored.transcriptJobs?.[message.jobId];
      if (job?.result) {
        job.acknowledged = true;
        await chrome.storage.local.set({transcriptJobs:stored.transcriptJobs,...(stored.activeJobId === message.jobId ? {activeJobId:'',activeJobType:''} : {})});
      }
      sendResponse({ok:true});return;
    }
    if (message?.type === 'vis-status') {
      // A leftover job (finished, stopped or lost in a browser restart) must not keep the extension "busy".
      { const st = await chrome.storage.local.get(['activeJobId','transcriptJobs','chatWatch']); const id = st.activeJobId || ''; const tj = st.transcriptJobs?.[id];
        const st2 = await chrome.storage.local.get(['pairCode']);
        const dead = id && ((id.startsWith('transcript-') && (!tj || tj.result || tj.state === 'stopped' || tj.pairCode !== st2.pairCode || Date.now() - (tj.at || 0) >= 900000)) || (st.chatWatch?.jobId === id && st.chatWatch.gaveUp));
        if (dead) await chrome.storage.local.remove(['activeJobId','activeJobType','activeCommand']); }
      await deliverPending();
      void reconcileWaitingResult();
      if (message.studioOrigin) await chrome.storage.local.set({ studioOrigin: String(message.studioOrigin) });
      const stored = await chrome.storage.local.get(['pairCode']);
      let chatReady = false;
      let error = '';
      try { await ensureChatReceiver(); chatReady = true; } catch (caught) { error = caught?.message || String(caught); }
      const pending = await chrome.storage.local.get(['pendingChatEvents','transcriptJobs']);
      const transcriptEvents = Object.values(pending.transcriptJobs || {}).filter(job => job.pairCode === stored.pairCode && job.result && !job.acknowledged && job.state !== 'stopped').map(job => job.result);
      sendResponse({ ok: true, pairCode: stored.pairCode || '', chatReady, error, syncDiagnostic:deliveryDiagnostic || syncDiagnostic, version: '0.5.7', account: chatAccount, chatTabCount: (await chatTabs()).length, activeJobId: (await chrome.storage.local.get(['activeJobId'])).activeJobId || '', transcriptEvents, pendingEvents: Array.isArray(pending.pendingChatEvents) ? pending.pendingChatEvents : [] });
      return;
    }
    if (message?.type === 'vis-pair') {
      const pairCode = String(message.pairCode || '').trim();
      if (!pairCode) throw new Error('Mã kết nối đang trống.');
      const tabs = await chatTabs();
      const chosen = tabs.find(item => item.active) || tabs[0];
      if (chosen) await chrome.storage.local.set({ chatTabId: chosen.id });
      await ensureChatReceiver();
      await chrome.storage.local.set({ pairCode, ...(message.studioOrigin ? { studioOrigin: String(message.studioOrigin) } : {}) });
      sendResponse({ ok: true, pairCode, chatReady: true, version: '0.5.7' });
      await broadcastToStudio({ type: 'vis-status-changed' });
      return;
    }
    if (message?.type === 'vis-unpair') {
      await chrome.storage.local.remove(['pairCode']);
      sendResponse({ ok: true });
      await broadcastToStudio({ type: 'vis-status-changed' });
      return;
    }
    if (message?.type === 'vis-send') {
      const stored = await chrome.storage.local.get(['pairCode']);
      if (!stored.pairCode || stored.pairCode !== message.pairCode) throw new Error('Mã kết nối không khớp. Hãy kết nối lại tiện ích.');
      let tab = await ensureChatReceiver();
      checkStop(token,message.command.id);
      tab = await freshConversationIfLong(tab, message.command, token);
      checkStop(token,message.command.id);
      await chrome.storage.local.set({ activeCommand: message.command });
      checkStop(token,message.command.id);
      // Studio hands out a job only after the server closed the previous one, so an old tab job is stale.
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'vis-command', command: message.command, replaceStale: true });
      checkStop(token,message.command.id);
      if (!result?.ok) throw new Error(result?.error || 'ChatGPT không nhận được lệnh.');
      let currentTab=tab;try {currentTab=await chrome.tabs.get(tab.id);}catch{}
      const conversationUrl = /^https:\/\/chatgpt\.com\/c\/[^/?#]+/.test(currentTab.url || '') ? new URL(currentTab.url).origin + new URL(currentTab.url).pathname : null;
      await chrome.storage.local.set({ activeJobId: message.command.id, activeJobType: String(message.command.type || ''), chatTabId: tab.id, conversationUrl, identityJobId:message.command.id });
      sendResponse({ ok: true, accepted: true });
      return;
    }
    if (message?.type === 'vis-stop') {
      try{
        const stored=await chrome.storage.local.get(['pairCode','chatTabId','activeJobId','pendingChatEvents','transcriptJobs']);
        const ids=new Set([stored.activeJobId,...(message.cancelledJobIds||[])].filter(Boolean)),tabs=new Set([stored.chatTabId].filter(Boolean));
        const jobs=stored.transcriptJobs||{};
        for(const [id,job] of Object.entries(jobs))if((message.scope==='all'&&job.pairCode===stored.pairCode)||id===stored.activeJobId){if(!['completed','error','stopped'].includes(job.state)&&job.tabId)tabs.add(job.tabId);job.state='stopped';ids.add(id);}
        for(const id of ids)cancelledJobs.add(id);
        for(const [controller,tabId] of downloads)if(tabs.has(tabId))controller.abort();
        await chrome.storage.local.set({transcriptJobs:jobs,activeJobId:'',activeJobType:'',activeCommand:null,pendingChatEvents:(stored.pendingChatEvents||[]).filter(event=>!ids.has(event.jobId)&&!(message.scope==='all'&&event._sessionId===stored.pairCode))});
        await Promise.all([...tabs].map(id=>chrome.tabs.sendMessage(id,{type:'vis-stop'}).catch(()=>null)));
        syncDiagnostic='';deliveryDiagnostic='';sendResponse({ok:true,stopped:true});return;
      }finally{stopDepth--;}
    }
    if (message?.type === 'vis-chat-event' && sender.tab?.url?.startsWith(CHATGPT_PREFIX)) {
      if(cancelledJobs.has(message.payload?.jobId)||stopDepth){sendResponse({ok:true,ignored:true});return;}
      const stored = await chrome.storage.local.get(['transcriptJobs']);
      const job = stored.transcriptJobs?.[message.payload?.jobId];
      if (job) {
        if (job.state === 'stopped' || job.result || sender.tab.id !== job.tabId) {sendResponse({ok:true,ignored:true});return;}
        const payload = {...message.payload,kind:job.command.kind,sectionId:job.command.sectionId};
        job.state = payload.state;
        if (['completed','error'].includes(payload.state)) job.result = payload;
        await chrome.storage.local.set({transcriptJobs:stored.transcriptJobs});
        await broadcastToStudio({type:'vis-transcript-event',payload});
        sendResponse({ok:true});return;
      }
      if (String(message.payload?.jobId || '').startsWith('transcript-')) {sendResponse({ok:true,ignored:true});return;}

      if (message.payload?.state === 'sent') {
        await broadcastToStudio({ type: 'vis-chat-event', payload: message.payload });
        sendResponse({ ok: true }); return;
      }
      await queueAndBroadcast(message.payload);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'vis-capture-result') {
      const stored = await chrome.storage.local.get(['activeJobId', 'activeJobType', 'activeCommand', 'pairCode']);
      let command = message.command;
      if (!command && ['transcript_mindmap','transcript_rewrite'].includes(stored.activeCommand?.type) && stored.activeJobId === stored.activeCommand.id) command = stored.activeCommand;
      if (!command || (message.jobId && command.id !== message.jobId)) {
        if (!stored.pairCode) throw new Error('Hãy kết nối tiện ích với web trước khi đồng bộ.');
        const response = await fetch('https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api?path=' + encodeURIComponent('sessions/' + stored.pairCode));
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'Không lấy được tác vụ đang chờ từ web.');
        command = data.session?.activeJob || (data.session?.lastJob?.status === 'error' ? data.session.lastJob : null);
      }
      const jobId = String(message.jobId || command?.id || '');
      if (!jobId) throw new Error('Không có tác vụ nào đang chờ kết quả.');
      if (!command || command.id !== jobId) throw new Error('Không tìm thấy đúng lệnh đang chờ trong dự án. Tải lại web rồi đồng bộ lại.');
      const payload = await captureCommand(command,token);checkStop(token,command.id);
      if (['transcript_mindmap','transcript_rewrite'].includes(command.type)) {
        const latest = await chrome.storage.local.get(['transcriptJobs']);const job=latest.transcriptJobs?.[command.id];
        if (!job || job.state === 'stopped') throw new Error('Tác vụ Transcript đã dừng.');
        const event={...payload,kind:command.kind,sectionId:command.sectionId};if(['completed','error'].includes(payload.state))job.result=event;job.state=payload.state;
        await chrome.storage.local.set({transcriptJobs:latest.transcriptJobs});
        await broadcastToStudio({type:'vis-transcript-event',payload:event});
      } else await queueAndBroadcast(payload);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'vis-restore-draft') {
      const tab = await ensureChatReceiver();
      sendResponse(await chrome.tabs.sendMessage(tab.id, { type: 'vis-restore-draft' }));
      return;
    }
    if (message?.type === 'vis-event-ack') {
      const stored = await chrome.storage.local.get(['pendingChatEvents']);
      if(token!==stopGeneration||stopDepth||cancelledJobs.has(payload.jobId))return;
  const events = Array.isArray(stored.pendingChatEvents) ? stored.pendingChatEvents.filter(item => item?.jobId !== message.jobId) : [];
      await chrome.storage.local.set({ pendingChatEvents: events });
      if (!events.some(item => item?.jobId === message.jobId)) {
        const active = await chrome.storage.local.get(['activeJobId']);
        if (active.activeJobId === message.jobId) await chrome.storage.local.remove(['activeJobId', 'activeJobType', 'activeCommand']);
      }
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  })().catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});


// Monitoring only: the Manager returns no commands in this release.
async function managerHeartbeat() {
  const st = await chrome.storage.local.get(['chatTabId','pairCode','activeJobId','conversationUrl','identityJobId']);
  if (!st.pairCode) return;
  let candidates=[];
  try { const bound=await chrome.tabs.get(st.chatTabId); if(bound?.url?.startsWith('https://chatgpt.com/')) candidates.push(bound); } catch {}
  if(st.activeJobId && st.identityJobId===st.activeJobId && st.conversationUrl) {
    try { for(const t of await chrome.tabs.query({})) if(t.id!==st.chatTabId && t.url?.split(/[?#]/)[0]===st.conversationUrl) candidates.push(t); } catch {}
  }
  let chosen=null, reply=null;
  for(const t of candidates) {
    try {
      const p=await Promise.race([chrome.tabs.sendMessage(t.id,{type:'vis-ping'}),new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
      if(p?.pairCode===st.pairCode && (!st.activeJobId || p.activeJobId===st.activeJobId)) {chosen=t;reply=p;break;}
    } catch {}
  }
  const watch=(await chrome.storage.local.get(['chatWatch'])).chatWatch||null;
  const diagnostic={sync:String(syncDiagnostic||deliveryDiagnostic||'').slice(0,300),capture:lastCapture,watch:watch&&{jobId:watch.jobId,reloads:watch.reloads,lastReason:watch.lastReason||null,gaveUp:Boolean(watch.gaveUp),aliveAgo:Math.round((Date.now()-watch.aliveAt)/1000),busyAgo:Math.round((Date.now()-watch.busyAt)/1000)},pingOk:Boolean(reply),candidates:candidates.length};
  const body={diagnostic,pairCode:st.pairCode,activeJobId:st.activeJobId||null,chatTabId:chosen?.id??null,conversationUrl:st.identityJobId===st.activeJobId?st.conversationUrl||null:null,lastHeartbeatAt:reply?.lastHeartbeatAt??null,version:'0.5.7',identityVersion:1};
  try { await fetch('http://127.0.0.1:8765/api/ext/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)}); } catch {}
}
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{ if(!change.url)return; void (async()=>{const st=await chrome.storage.local.get(['chatTabId','activeJobId','identityJobId']); if(tabId!==st.chatTabId||!st.activeJobId||st.activeJobId!==st.identityJobId)return; try {const u=new URL(change.url);if(u.origin==='https://chatgpt.com'&&/^\/c\/[^/]+$/.test(u.pathname))await chrome.storage.local.set({conversationUrl:u.origin+u.pathname});}catch{}})(); });
chrome.alarms.create('manager-heartbeat',{periodInMinutes:0.5});
// Watchdog: does what the user otherwise did by hand. If the ChatGPT tab stops answering pings (hung) or
// stays idle without delivering while Studio still waits for this job, reload that tab (bounded); after a
// reload the periodic re-read collects a reply that already exists. If reloading does not help, report a
// clear error so Studio/Manager can retry the job instead of waiting forever.
const WATCH_HUNG_MS=60000, WATCH_IDLE_MS=120000, WATCH_RELOAD_GAP_MS=120000, WATCH_MAX_RELOADS=2, WATCH_GIVE_UP_MS=180000;
async function chatWatchdog(now=Date.now()) {
  const st=await chrome.storage.local.get(['pairCode','activeJobId','chatTabId','chatWatch']);
  if(!st.pairCode||!st.activeJobId||!st.chatTabId||stopDepth) return;
  let w=st.chatWatch&&st.chatWatch.jobId===st.activeJobId?st.chatWatch:{jobId:st.activeJobId,sentAt:now,aliveAt:now,busyAt:now,reloads:0,reloadedAt:0};
  let job;
  try { const v=await studioVersion(st.pairCode); if(v) job=ownJob(v,st.activeJobId); else { const response=await fetch('https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api?path='+encodeURIComponent('sessions/'+st.pairCode),{signal:AbortSignal.timeout(10000)}); job=ownJob((await response.json()).session,st.activeJobId); } } catch { return; }
  if(!job||job.id!==st.activeJobId||!['queued','sending','sent','waiting'].includes(job.status)||cancelledJobs.has(job.id)) { await chrome.storage.local.remove('chatWatch'); return; }
  let pong=null;
  try { pong=await Promise.race([chrome.tabs.sendMessage(st.chatTabId,{type:'vis-ping'}),new Promise(resolve=>setTimeout(()=>resolve(null),3000))]); } catch {}
  if(pong?.ready) { w.aliveAt=now; if(pong.generating) w.busyAt=now; }
  const hung=now-w.aliveAt>=WATCH_HUNG_MS;
  const idle=Boolean(pong?.ready)&&!pong.generating&&now-w.busyAt>=WATCH_IDLE_MS&&now-w.sentAt>=WATCH_IDLE_MS;
  if((hung||idle)&&w.reloads<WATCH_MAX_RELOADS&&now-w.reloadedAt>=WATCH_RELOAD_GAP_MS) {
    w={...w,reloads:w.reloads+1,reloadedAt:now,aliveAt:now,busyAt:now,lastReason:hung?'hung':'idle'};
    await chrome.storage.local.set({chatWatch:w});
    try { await chrome.tabs.reload(st.chatTabId); } catch {}
    reconciledAt=0;
    return;
  }
  if((hung||idle)&&w.reloads>=WATCH_MAX_RELOADS&&!w.gaveUp&&now-w.reloadedAt>=WATCH_GIVE_UP_MS) {
    w={...w,gaveUp:true};await chrome.storage.local.set({chatWatch:w});
    await queueAndBroadcast({jobId:st.activeJobId,state:'error',text:'ChatGPT không phản hồi sau '+WATCH_MAX_RELOADS+' lần tự tải lại tab. Có thể chạy lại phần/cảnh này.'});
    return;
  }
  await chrome.storage.local.set({chatWatch:w});
}
// After a self-update, put the new bridges into tabs that are already open (no F5 needed).
chrome.runtime?.onInstalled?.addListener(details=>{ if(details.reason!=='update')return; void (async()=>{
  for(const tab of await chrome.tabs.query({})){
    const url=tab.url||'';
    try{
      if(url.startsWith(CHATGPT_PREFIX))await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reply-reader.js','content.js']});
      else if(/^https:\/\/([a-z0-9-]+\.)*vercel\.app\//.test(url)||url.startsWith('https://video-image-studio-web-ma9gms.v2.appdeploy.ai/'))await chrome.scripting.executeScript({target:{tabId:tab.id},files:['web_bridge.js']});
    }catch{}
  }
})(); });
// Self-update: AI MANAGER writes new versions into this extension's folder. When the folder holds a
// different version and no job is running, reload so the new code takes over without the user.
async function reloadIfUpdated(){
  try{
    const onDisk=(await (await fetch(chrome.runtime.getURL('manifest.json'),{cache:'no-store'})).json()).version;
    if(!onDisk||onDisk===chrome.runtime.getManifest().version)return false;
    if(stopDepth)return false;
    // Wait for a running job, but not forever: a job stuck for 20 minutes must not block an update (the fix may be in it).
    const st=await chrome.storage.local.get(['activeJobId','activeJobSeen']);
    if(st.activeJobId){
      if(st.activeJobSeen?.id!==st.activeJobId){await chrome.storage.local.set({activeJobSeen:{id:st.activeJobId,at:Date.now()}});return false;}
      if(Date.now()-st.activeJobSeen.at<1200000)return false;
    }
    chrome.runtime.reload();return true;
  }catch{return false;}
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='manager-heartbeat'){void managerHeartbeat();void chatWatchdog().catch(()=>null);void reloadIfUpdated();}});

