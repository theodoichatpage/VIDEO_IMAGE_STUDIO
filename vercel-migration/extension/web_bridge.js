(() => {
  if (window.__VIS_WEB_BRIDGE_0417__) return;
  window.__VIS_WEB_BRIDGE_0417__ = true;

  const postStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'vis-status', studioOrigin: location.origin });
      for (const payload of (response?.transcriptEvents || [])) {
        window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', ...payload }, '*');
      }
      for (const payload of (response?.pendingEvents || [])) {
        window.postMessage({ source: 'vis-extension', type: 'studio-event', payload, serverManaged: Boolean(payload._sessionId) }, '*');
      }
      window.postMessage({
        source: 'vis-extension',
        type: 'studio-status',
        pairCode: response?.chatReady ? (response.pairCode || '') : '',
        chatReady: Boolean(response?.chatReady),
        version: response?.version || '',
        pendingCount: Array.isArray(response?.pendingEvents) ? response.pendingEvents.length : 0,
        syncDiagnostic: response?.syncDiagnostic || '',
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
    if (event.data.type === 'studio-transcript-ai') {
      const command = event.data.command;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'vis-transcript-send', pairCode: event.data.pairCode, command });
        if (!response?.ok) throw new Error(response?.error || 'Không gửi được lệnh Mindmap sang ChatGPT.');
        window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', jobId: command.id, kind: command.kind, sectionId: command.sectionId, state: 'accepted' }, '*');
      } catch (error) {
        window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', jobId: command?.id, kind: command?.kind, sectionId: command?.sectionId, state: 'error', message: error?.message || String(error) }, '*');
      }
      return;
    }
    if (event.data.type === 'studio-transcript-ack') {
      await chrome.runtime.sendMessage({ type: 'vis-transcript-ack', jobId: event.data.jobId }).catch(() => null);
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
        const response = await chrome.runtime.sendMessage({ type: 'vis-capture-result', jobId: event.data.jobId, command: event.data.command });
        if (!response?.ok) throw new Error(response?.error || 'Chưa đồng bộ được kết quả.');
      } catch (error) {
        window.postMessage({ source: 'vis-extension', type: 'studio-error', message: error?.message || String(error) }, '*');
      }
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'vis-transcript-event') {
      window.postMessage({ source: 'vis-extension', type: 'studio-transcript-ai-result', ...message.payload }, '*');
      return;
    }
    if (message?.type === 'vis-chat-event') {
      window.postMessage({ source: 'vis-extension', type: 'studio-event', payload: message.payload, serverManaged: Boolean(message.serverManaged) }, '*');
    }
    if (message?.type === 'vis-status-changed') void postStatus();
  });

  void postStatus();
})();
