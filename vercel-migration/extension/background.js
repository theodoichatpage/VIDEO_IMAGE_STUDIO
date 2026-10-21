const DEFAULT_STUDIO_MATCH = 'https://video-image-studio.vercel.app/*';
const CHATGPT_PREFIX = 'https://chatgpt.com/';

function studioMatch(origin) {
  try { return new URL(origin || '').origin + '/*'; } catch { return DEFAULT_STUDIO_MATCH; }
}

async function chatTabs() {
  return (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith(CHATGPT_PREFIX));
}

async function ensureChatReceiver(preferredId) {
  const tabs = await chatTabs();
  if (!tabs.length) throw new Error('Chưa có tab ChatGPT. Hãy mở chatgpt.com và đăng nhập.');
  const stored = await chrome.storage.local.get(['chatTabId']);
  const tab = tabs.find(item => item.id === preferredId) || tabs.find(item => item.id === stored.chatTabId) || tabs.find(item => item.active) || tabs[0];
  try {
    const pong = await chrome.tabs.sendMessage(tab.id, { type: 'vis-ping' });
    if (pong?.ready) return tab;
  } catch {}
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['reply-reader.js', 'content.js'] });
  } catch (error) {
    throw new Error('Không thể nạp cầu nối vào tab ChatGPT. Hãy tải lại tab ChatGPT rồi thử lại. ' + (error?.message || ''));
  }
  try {
    const pong = await chrome.tabs.sendMessage(tab.id, { type: 'vis-ping' });
    if (pong?.ready) return tab;
  } catch {}
  throw new Error('Tab ChatGPT chưa sẵn sàng nhận lệnh. Hãy F5 tab ChatGPT rồi kết nối lại.');
}

async function broadcastToStudio(message) {
  const stored = await chrome.storage.local.get(['studioOrigin']);
  const tabs = await chrome.tabs.query({ url: studioMatch(stored.studioOrigin) });
  await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, message).catch(() => null)));
}

let deliveryQueue = Promise.resolve();
function deliverPending() {
  deliveryQueue = deliveryQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(['pendingChatEvents', 'pairCode']);
    for (const event of (stored.pendingChatEvents || [])) {
      const sessionId = event._sessionId;
      if (!sessionId || sessionId !== stored.pairCode) continue;
      const { _sessionId, ...payload } = event;
      try {
        const response = await fetch('https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api?path=' + encodeURIComponent('bridge/' + sessionId + '/event'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
        });
        const data = await response.json();
        if (!response.ok || data.error) continue;
        const latest = await chrome.storage.local.get(['pendingChatEvents']);
        await chrome.storage.local.set({ pendingChatEvents: (latest.pendingChatEvents || []).filter(item => !(item.jobId === event.jobId && item.state === event.state && item._sessionId === sessionId)) });
      } catch { /* Persisted result will retry on the next status poll. */ }
    }
  });
  return deliveryQueue;
}

async function captureCommand(command) {
  const jobId = command.id;
  const bound = await chrome.storage.local.get(['chatTabId']);
  const candidates = await chatTabs();
  candidates.sort((a, b) => Number(b.id === bound.chatTabId) - Number(a.id === bound.chatTabId));
  let result, matchedTab, errors = [];
  for (const candidate of candidates) {
    try {
      const tab = await ensureChatReceiver(candidate.id);
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'vis-capture-result', jobId, jobType: command.type, command });
      if (reply?.ok && reply.payload) { result = reply; matchedTab = tab.id; break; }
      errors.push(reply?.error || 'Không đọc được phản hồi.');
    } catch (error) { errors.push(error.message); }
  }
  if (!result) throw new Error(errors.join(' | ') || 'Chưa có tab ChatGPT để đồng bộ.');
  await chrome.storage.local.set({ chatTabId: matchedTab });
  return result.payload;
}

let reconciliation = null;
let syncDiagnostic = '';
function reconcileWaitingResult() {
  if (reconciliation) return reconciliation;
  reconciliation = (async () => {
    const stored = await chrome.storage.local.get(['pairCode']);
    if (!stored.pairCode) return;
    try {
      const response = await fetch('https://wtxgjsorpqjanxoevxuw.supabase.co/functions/v1/studio-api?path=' + encodeURIComponent('sessions/' + stored.pairCode), { signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok || data.error) return;
      const command = data.session?.activeJob;
      if (!command || !['sent', 'waiting'].includes(command.status) || !['part_analysis', 'script_structure'].includes(command.type)) { syncDiagnostic = ''; return; }
      await queueAndBroadcast(await captureCommand(command));
      syncDiagnostic = '';
    } catch (error) { syncDiagnostic = error?.message || String(error); }
  })().finally(() => { reconciliation = null; });
  return reconciliation;
}

let enqueue = Promise.resolve();
function queueAndBroadcast(payload) {
  enqueue = enqueue.catch(() => {}).then(() => persistAndDeliver(payload));
  return enqueue;
}
async function persistAndDeliver(payload) {
  if (!payload?.jobId || !['progress', 'completed', 'error'].includes(payload.state)) return;
  const stored = await chrome.storage.local.get(['pendingChatEvents', 'pairCode']);
  if ((stored.pendingChatEvents || []).some(item => item.jobId === payload.jobId && item.state === 'completed')) return;
  const events = Array.isArray(stored.pendingChatEvents) ? stored.pendingChatEvents.filter(item => item?.jobId !== payload.jobId) : [];
  events.push({ ...payload, _sessionId: stored.pairCode });
  await chrome.storage.local.set({ pendingChatEvents: events.slice(-10) });
  await deliverPending();
  await broadcastToStudio({ type: 'vis-chat-event', payload, serverManaged: true });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'vis-status') {
      await deliverPending();
      void reconcileWaitingResult();
      if (message.studioOrigin) await chrome.storage.local.set({ studioOrigin: String(message.studioOrigin) });
      const stored = await chrome.storage.local.get(['pairCode']);
      let chatReady = false;
      let error = '';
      try { await ensureChatReceiver(); chatReady = true; } catch (caught) { error = caught?.message || String(caught); }
      const pending = await chrome.storage.local.get(['pendingChatEvents']);
      sendResponse({ ok: true, pairCode: stored.pairCode || '', chatReady, error, syncDiagnostic, version: '0.4.14', pendingEvents: Array.isArray(pending.pendingChatEvents) ? pending.pendingChatEvents : [] });
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
      sendResponse({ ok: true, pairCode, chatReady: true, version: '0.4.14' });
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
      const tab = await ensureChatReceiver();
      await chrome.storage.local.set({ activeCommand: message.command });
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'vis-command', command: message.command });
      if (!result?.ok) throw new Error(result?.error || 'ChatGPT không nhận được lệnh.');
      await chrome.storage.local.set({ activeJobId: message.command.id, activeJobType: String(message.command.type || ''), chatTabId: tab.id });
      sendResponse({ ok: true, accepted: true });
      return;
    }
    if (message?.type === 'vis-stop') {
      const bound = await chrome.storage.local.get(['chatTabId']);
      const tabs = await chatTabs();
      await Promise.all(tabs.filter(tab => tab.id === bound.chatTabId).map(tab => chrome.tabs.sendMessage(tab.id, { type: 'vis-stop' }).catch(() => null)));
      const stored = await chrome.storage.local.get(['activeJobId', 'pendingChatEvents']);
      await chrome.storage.local.set({ activeJobId: '', activeJobType: '', pendingChatEvents: (stored.pendingChatEvents || []).filter(event => event.jobId !== stored.activeJobId) });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'vis-chat-event' && sender.tab?.url?.startsWith(CHATGPT_PREFIX)) {
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
      await queueAndBroadcast(await captureCommand(command));
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
