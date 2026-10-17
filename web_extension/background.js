const BASE = 'https://video-image-studio-web-ma9gms.v2.appdeploy.ai';
async function settings() { return chrome.storage.local.get(['pairCode', 'busyJob']); }
async function call(path, options = {}) {
  const response = await fetch(BASE + path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thể kết nối web.');
  return data;
}
async function chatTab() {
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  return tabs.find(tab => tab.active) || tabs[0];
}
async function poll() {
  const { pairCode, busyJob } = await settings();
  if (!pairCode) return;
  try {
    await call('/api/bridge/' + pairCode + '/ping', { method: 'POST' });
    if (busyJob) return;
    const data = await call('/api/bridge/' + pairCode + '/next');
    if (!data.command) return;
    const tab = await chatTab();
    if (!tab?.id) throw new Error('Hãy mở một tab ChatGPT và đăng nhập.');
    await chrome.tabs.sendMessage(tab.id, { type: 'studio-send', command: data.command });
    await chrome.storage.local.set({ busyJob: data.command.id });
    await call('/api/bridge/' + pairCode + '/event', { method: 'POST', body: JSON.stringify({ jobId: data.command.id, state: 'sent' }) });
  } catch (caught) {
    console.warn('VIDEO IMAGE STUDIO:', caught);
  }
}
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('studio-poll', { periodInMinutes: 0.5 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('studio-poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'studio-poll') void poll(); });
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'studio-pair') {
    chrome.storage.local.set({ pairCode: message.code.trim(), busyJob: '' }).then(() => { void poll(); respond({ ok: true }); });
    return true;
  }
  if (message.type === 'studio-status') { settings().then(respond); return true; }
  if (message.type === 'studio-finished') {
    settings().then(async ({ pairCode, busyJob }) => {
      if (pairCode && busyJob === message.jobId) {
        try { await call('/api/bridge/' + pairCode + '/event', { method: 'POST', body: JSON.stringify({ jobId: message.jobId, state: message.error ? 'error' : 'completed', text: message.text || '', message: message.error || '' }) } finally { await chrome.storage.local.set({ busyJob: '' }); }
      }
      respond({ ok: true });
    });
    return true;
  }
  return false;
});
void poll();