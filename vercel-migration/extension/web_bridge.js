(() => {
  if (window.__VIS_WEB_BRIDGE_048__) return;
  window.__VIS_WEB_BRIDGE_048__ = true;

  const postStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'vis-status', studioOrigin: location.origin });
      for (const payload of (response?.pendingEvents || [])) {
        window.postMessage({ source: 'vis-extension', type: 'studio-event', payload }, '*');
      }
      window.postMessage({
        source: 'vis-extension',
        type: 'studio-status',
        pairCode: response?.chatReady ? (response.pairCode || '') : '',
        chatReady: Boolean(response?.chatReady),
        version: response?.version || '',
        pendingCount: Array.isArray(response?.pendingEvents) ? response.pendingEvents.length : 0,
        message: response?.error || ''
      }, '*');
    } catch (error) {
      window.postMessage({ source: 'vis-extension', type: 'studio-status', pairCode: '', chatReady: false, message: error?.message || String(error) }, '*');
    }
  };

  window.addEventListener('message', async event => {
    if (event.source !== window || event.data?.source !== 'vis-web') return;
    if (event.data.type === 'studio-status') { await postStatus(); return; }
    if (event.data.type === 'studio-bind-current-chat') {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'vis-pair', pairCode: event.data.pairCode, studioOrigin: location.origin });
        if (!response?.ok) throw new Error(response?.error || 'Không thể kết nối ChatGPT.');
        await postStatus();
      } catch (error) {
        window.postMessage({ source: 'vis-extension', type: 'studio-error', message: error?.message || String(error) }, '*');
      }
      return;
    }
    if (event.data.type === 'studio-send') {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'vis-send', pairCode: event.data.pairCode, command: event.data.command });
        if (!response?.ok) throw new Error(response?.error || 'Không thể chuyển lệnh sang ChatGPT.');
        // The ChatGPT content script emits sent only after the prompt was actually submitted.
      } catch (error) {
        window.postMessage({ source: 'vis-extension', type: 'studio-error', message: error?.message || String(error) }, '*');
      }
      return;
    }
    if (event.data.type === 'studio-event-ack') {
      await chrome.runtime.sendMessage({ type: 'vis-event-ack', jobId: event.data.jobId }).catch(() => null);
      return;
    }
    if (event.data.type === 'studio-stop') {
      await chrome.runtime.sendMessage({ type: 'vis-stop' }).catch(() => null);
      return;
    }
    if (event.data.type === 'studio-capture-result') {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'vis-capture-result', jobId: event.data.jobId });
        if (!response?.ok) throw new Error(response?.error || 'Chưa đồng bộ được kết quả.');
      } catch (error) {
        window.postMessage({ source: 'vis-extension', type: 'studio-error', message: error?.message || String(error) }, '*');
      }
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'vis-chat-event') {
      window.postMessage({ source: 'vis-extension', type: 'studio-event', payload: message.payload }, '*');
    }
    if (message?.type === 'vis-status-changed') void postStatus();
  });

  void postStatus();
})();
