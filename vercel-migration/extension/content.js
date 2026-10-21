(() => {
  if (window.__VIS_CHAT_BRIDGE_048__) return;
  window.__VIS_CHAT_BRIDGE_048__ = true;
  let currentJobId = '';
  let currentJobType = '';
  let cancelled = false;
  let generation = 0;
  let baseline = 0;
  const finished = new Set();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const composer = () => document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][data-virtualkeyboard="true"]') || document.querySelector('div[contenteditable="true"].ProseMirror');
  const stopButton = () => document.querySelector('button[data-testid="stop-button"]') || [...document.querySelectorAll('button')].find(button => /stop generating|dừng tạo|stop/i.test(button.getAttribute('aria-label') || button.textContent || ''));
  const isVisible = node => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const sendButton = node => {
    const form = node?.closest('form');
    const selector = "button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='send'], button[aria-label*='Gửi'], button[aria-label*='gửi'], button[title*='Send'], button[title*='Gửi'], form button[type='submit']";
    const buttons = [...(form?.querySelectorAll("button[type='submit'], button[data-testid='send-button']") || []), ...document.querySelectorAll(selector)];
    return buttons.find(button => !button.disabled && isVisible(button));
  };
  const jsonFromPage = kind => {
    const sources = [
      ...[...document.querySelectorAll('[data-message-author-role="assistant"]')].slice(baseline).slice(-1).map(node => node.innerText || node.textContent || ''),
    ];
    for (const text of sources) {
      const keys = kind === 'script_structure' ? ['"parts"'] : kind === 'part_analysis' ? ['"scenes"'] : ['"parts"', '"scenes"'];
      const matches = keys.flatMap(key => [...text.matchAll(new RegExp(key, 'g'))].map(match => match.index ?? -1)).sort((a, b) => b - a);
      for (const index of matches) {
        const start = text.lastIndexOf('{', index);
        if (start < 0) continue;
        let depth = 0;
        let quote = false;
        let escaped = false;
        for (let cursor = start; cursor < text.length; cursor += 1) {
          const char = text[cursor];
          if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quote = false;
            continue;
          }
          if (char === '"') { quote = true; continue; }
          if (char === '{') depth += 1;
          if (char === '}') depth -= 1;
          if (depth === 0) {
            const candidate = text.slice(start, cursor + 1);
            try {
              const parsed = JSON.parse(candidate);
              if (Array.isArray(parsed?.[kind === 'script_structure' ? 'parts' : 'scenes'])) return candidate;
            } catch {}
            break;
          }
        }
      }
    }
    return '';
  };
  const assistantText = kind => {
    const structured = jsonFromPage(kind);
    if (structured) return structured;
    const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const last = turns.length > baseline ? turns.at(-1) : null;
    return (last?.innerText || last?.textContent || '').trim();
  };
  const emit = payload => chrome.runtime.sendMessage({ type: 'vis-chat-event', payload }).catch(() => null);

  const isGenerating = () => {
    const button = stopButton();
    return Boolean(button && !button.disabled && isVisible(button));
  };

  const activeImageMode = () => {
    const box = composer();
    const root = box?.closest('form') || box?.parentElement?.parentElement;
    return [...(root?.querySelectorAll('button') || [])].filter(isVisible).find(button => /^(create image|creating image|image|images|tạo ảnh|tạo hình ảnh)$/i.test((button.innerText || '').trim()));
  };
  async function clearImageMode() {
    const chip = activeImageMode();
    if (!chip) return;
    const remove = chip.parentElement?.querySelector('button[aria-label*="Remove"], button[aria-label*="remove"], button[aria-label*="Close"], button[aria-label*="Xóa"], button[aria-label*="Đóng"]');
    if (remove) remove.click();
    await sleep(300);
    if (activeImageMode()) throw new Error('ChatGPT đang bật chế độ Tạo ảnh. Hãy tắt Tạo ảnh cạnh ô nhập rồi phân tích lại phần này. Lệnh phân tích chưa được gửi.');
  }

  const imageUrls = () => [...document.querySelectorAll('main img')].map(image => image.currentSrc || image.src || '').filter(url => /^https?:\/\//.test(url));
  async function waitForImage(before, token) {
    const previous = new Set(before);
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (cancelled || token !== generation) throw new Error('Đã dừng tác vụ tạo ảnh.');
      const next = imageUrls().filter(url => !previous.has(url));
      if (next.length && !isGenerating()) return next.at(-1);
      await sleep(750);
    }
    throw new Error('ChatGPT quá thời gian tạo ảnh hoặc không đọc được ảnh kết quả.');
  }

  async function waitForFinalAnswer(before, kind, token) {
    let last = assistantText(kind);
    let started = Boolean(last && last !== before);
    let changedAt = Date.now();
    const observer = new MutationObserver(() => {
      const next = assistantText(kind);
      if (next !== last) { last = next; changedAt = Date.now(); }
      if (next && next !== before) started = true;
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    const deadline = Date.now() + 10 * 60 * 1000;
    try {
      while (Date.now() < deadline) {
        if (cancelled || token !== generation) throw new Error('Đã dừng tác vụ.');
        const newTurns = [...document.querySelectorAll('[data-message-author-role="assistant"]')].slice(baseline);
        if (kind !== 'image_generation' && newTurns.some(node => /creating image|đang tạo (hình )?ảnh/i.test(node.innerText || ''))) {
          stopButton()?.click();
          throw new Error('ChatGPT đã chuyển sang tạo ảnh. Đã yêu cầu dừng; hãy tắt chế độ Tạo ảnh và phân tích lại phần này.');
        }
        const next = assistantText(kind);
        if (next !== last) { last = next; changedAt = Date.now(); }
        if (next && next !== before) started = true;
        if (started && last && !isGenerating() && Date.now() - changedAt >= 3000 && jsonFromPage(kind)) return jsonFromPage(kind);
        await sleep(500);
      }
      throw new Error('ChatGPT quá thời gian phản hồi.');
    } finally { observer.disconnect(); }
  }

  async function waitForComposer() {
    for (let i = 0; i < 40; i += 1) {
      const node = composer();
      if (node) return node;
      await sleep(250);
    }
    throw new Error('Không tìm thấy ô nhập ChatGPT. Hãy F5 tab ChatGPT.');
  }

  async function fillComposer(text) {
    const node = await waitForComposer();
    node.focus();
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')?.set;
      setter?.call(node, text);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, text);
      if ((node.innerText || '').trim() !== text.trim()) {
        node.textContent = text;
        node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
    await sleep(300);
  }

  const draftText = node => (node?.value || node?.innerText || node?.textContent || '').trim();
  const userTurnCount = () => document.querySelectorAll('[data-message-author-role="user"]').length;

  async function waitForSendButton(node) {
    for (let i = 0; i < 40; i += 1) {
      const button = sendButton(node);
      if (button && !button.disabled) return button;
      await sleep(250);
    }
    throw new Error('Nút gửi ChatGPT chưa sẵn sàng sau khi đã điền lệnh.');
  }

  async function submit(token) {
    const node = await waitForComposer();
    const beforeDraft = draftText(node);
    const beforeUserTurns = userTurnCount();
    const button = await waitForSendButton(node);
    if (token !== generation || cancelled) throw new Error('Đã dừng tác vụ.');
    button.focus();
    button.click();
    for (let i = 0; i < 24; i += 1) {
      if (token !== generation || cancelled) throw new Error('Đã dừng tác vụ.');
      if (isGenerating() || userTurnCount() > beforeUserTurns || draftText(node) !== beforeDraft) return;
      await sleep(250);
    }
    throw new Error('ChatGPT chưa gửi lệnh: nội dung vẫn nằm trong ô soạn thảo.');
  }

  async function run(command) {
    if (!command?.id || !command?.prompt) throw new Error('Lệnh từ Studio không hợp lệ.');
    if (currentJobId === command.id || finished.has(command.id)) return { ok: true, duplicate: true };
    if (currentJobId) throw new Error('ChatGPT đang xử lý một lệnh khác.');
    currentJobId = command.id;
    currentJobType = String(command.type || '');
    cancelled = false;
    const token = ++generation;
    baseline = document.querySelectorAll('[data-message-author-role="assistant"]').length;
    try {
      if (isGenerating()) throw new Error('ChatGPT đang trả lời. Hãy bấm Dừng trước khi gửi phần tiếp theo.');
      if (draftText(composer())) throw new Error('Ô ChatGPT còn nội dung chưa gửi. Hãy gửi hoặc xóa nội dung đó trước.');
      if (command.type !== 'image_generation') await clearImageMode();
      if (command.type === 'image_generation') {
        const beforeImages = imageUrls();
        await fillComposer(command.prompt);
        await submit(token);
        await emit({ jobId: command.id, state: 'sent' });
        const imageUrl = await waitForImage(beforeImages, token);
        await emit({ jobId: command.id, state: 'completed', imageUrl });
        finished.add(command.id);
        return;
      }
      const before = assistantText(currentJobType);
      await fillComposer('TEXT ANALYSIS ONLY. DO NOT GENERATE IMAGES OR USE IMAGE TOOLS. Return only the requested JSON.\n' + command.prompt);
      if (token !== generation || cancelled) return;
      if (activeImageMode()) throw new Error('Chế độ Tạo ảnh vẫn bật. Chưa gửi lệnh phân tích.');
      await submit(token);
      await emit({ jobId: command.id, state: 'sent' });
      const text = await waitForFinalAnswer(before, currentJobType, token);
      await emit({ jobId: command.id, state: 'completed', text });
      finished.add(command.id);
    } catch (error) {
      finished.add(command.id);
      if (token === generation && !cancelled) await emit({ jobId: command.id, state: 'error', text: error?.message || String(error) });
      throw error;
    } finally {
      if (token === generation) {
      currentJobId = '';
      currentJobType = '';
      cancelled = false;
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'vis-ping') { sendResponse({ ready: Boolean(composer()), version: '0.4.8', conversationLabel: location.pathname }); return; }
    if (message?.type === 'vis-stop') {
      cancelled = true;
      generation += 1;
      if (currentJobId) finished.add(currentJobId);
      stopButton()?.click();
      currentJobId = '';
      currentJobType = '';
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'vis-command') {
      if (currentJobId === message.command?.id || finished.has(message.command?.id)) { sendResponse({ ok: true, duplicate: true }); return; }
      if (currentJobId) { sendResponse({ ok: false, error: 'ChatGPT đang xử lý phần khác. Hãy bấm Dừng trước.' }); return; }
      run(message.command).catch(() => null);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'vis-capture-result') {
      if (!currentJobId || currentJobId !== message.jobId || isGenerating()) { sendResponse({ ok: false, error: 'Phần hiện tại chưa có kết quả hoàn chỉnh trong tab này.' }); return; }
      if (String(message.jobType || currentJobType || '') === 'image_generation') {
        const imageUrl = imageUrls().at(-1);
        if (!imageUrl) { sendResponse({ ok: false, error: 'ChatGPT chưa có ảnh để đồng bộ.' }); return; }
        sendResponse({ ok: true, payload: { jobId: String(message.jobId || currentJobId), state: 'completed', imageUrl } });
        return;
      }
      const text = jsonFromPage(String(message.jobType || currentJobType || ''));
      if (!text) { sendResponse({ ok: false, error: 'ChatGPT chưa có phản hồi để đồng bộ.' }); return; }
      sendResponse({ ok: true, payload: { jobId: String(message.jobId || currentJobId), state: 'completed', text } });
    }
  });
})();
