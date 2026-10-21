(() => {
  if (window.__VIS_CHAT_BRIDGE_0413__) return;
  window.__VIS_CHAT_BRIDGE_0413__ = true;
  let currentJobId = '';
  let currentJobType = '';
  let cancelled = false;
  let generation = 0;
  let replyContext = {};
  const finished = new Set();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const composer = () => document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][data-virtualkeyboard="true"]') || document.querySelector('div[contenteditable="true"].ProseMirror');
  const stopButton = () => document.querySelector('button[data-testid="stop-button"]') || [...document.querySelectorAll('button')].find(button => /^(stop generating|stop streaming|dừng tạo|dừng tạo câu trả lời)$/i.test((button.getAttribute('aria-label') || button.textContent || '').trim()));
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
  const jsonFromPage = kind => VISReplyReader.read(document, { ...replyContext, type: kind }).text;
  const assistantText = kind => {
    const structured = jsonFromPage(kind);
    if (structured) return structured;
    return (VISReplyReader.sources(document, replyContext).sources.at(-1) || '').trim();
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
    let sentScenes = 0, progressAt = 0;
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
        const newTexts = VISReplyReader.sources(document, replyContext).sources;
        if (kind !== 'image_generation' && newTexts.some(text => /creating image|đang tạo (hình )?ảnh/i.test(text))) {
          stopButton()?.click();
          throw new Error('ChatGPT đã chuyển sang tạo ảnh. Đã yêu cầu dừng; hãy tắt chế độ Tạo ảnh và phân tích lại phần này.');
        }
        const next = assistantText(kind);
        if (next !== last) { last = next; changedAt = Date.now(); }
        if (next && next !== before) started = true;
        if (kind === 'part_analysis' && Date.now() - progressAt > 3000) {
          const progress = VISReplyReader.readStreaming(document, { ...replyContext, type: kind });
          if (progress.text) {
            const count = JSON.parse(progress.text).scenes.length;
            if (count > sentScenes) { await emit({ jobId: replyContext.id, state: 'progress', text: progress.text }); sentScenes = count; progressAt = Date.now(); }
          }
        }
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

  const draftText = node => {
    if (!node) return '';
    const text = typeof node.value === 'string' ? node.value : typeof node.innerText === 'string' ? node.innerText : node.textContent || '';
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  };
  async function prepareDraft(command) {
    const node = await waitForComposer();
    const text = draftText(node);
    if (!text) return;
    const stored = await chrome.storage.local.get(['studioDraftBackups']);
    const backups = Array.isArray(stored.studioDraftBackups) ? stored.studioDraftBackups : [];
    const previous = backups.at(-1);
    if (previous?.text === text && previous.chatUrl === location.href) return;
    await chrome.storage.local.set({ studioDraftBackups: [...backups, { text, chatUrl: location.href, jobId: command.id, createdAt: Date.now() }].slice(-10) });
  }
  async function restoreDraft() {
    if (currentJobId || isGenerating()) throw new Error('Hãy đợi tác vụ hoàn tất hoặc bấm Dừng trước khi khôi phục bản nháp.');
    const node = await waitForComposer();
    if (draftText(node)) throw new Error('Ô ChatGPT hiện có nội dung. Bản nháp vẫn được lưu, chưa ghi đè.');
    const stored = await chrome.storage.local.get(['studioDraftBackups']);
    const backup = (stored.studioDraftBackups || []).filter(item => item.chatUrl === location.href).at(-1);
    if (!backup) throw new Error('Hội thoại này chưa có bản nháp được lưu dự phòng.');
    await fillComposer(backup.text);
    return { ok: true };
  }
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
    replyContext = { ...command, before: VISReplyReader.snapshot(document) };
    try {
      if (isGenerating()) throw new Error('ChatGPT đang trả lời. Hãy bấm Dừng trước khi gửi phần tiếp theo.');
      if (command.type !== 'image_generation') await clearImageMode();
      await prepareDraft(command);
      if (token !== generation || cancelled) return;
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
      await fillComposer('[VIS_JOB_ID:' + command.id + ']\nTEXT ANALYSIS ONLY. DO NOT GENERATE IMAGES OR USE IMAGE TOOLS. Return only the requested JSON.\n' + command.prompt);
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
    if (message?.type === 'vis-ping') { sendResponse({ ready: Boolean(composer()), version: '0.4.13', conversationLabel: location.pathname }); return; }
    if (message?.type === 'vis-restore-draft') {
      restoreDraft().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
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
      const context = message.command?.id === message.jobId ? message.command : currentJobId === message.jobId ? replyContext : null;
      if (!context?.id) { sendResponse({ ok: false, error: 'Chưa nhận diện được tác vụ đang chờ.' }); return; }
      if (String(message.jobType || currentJobType || '') === 'image_generation') {
        if (isGenerating()) { sendResponse({ ok: false, error: 'ChatGPT vẫn đang tạo ảnh.' }); return; }
        const imageUrl = imageUrls().at(-1);
        if (!imageUrl) { sendResponse({ ok: false, error: 'ChatGPT chưa có ảnh để đồng bộ.' }); return; }
        sendResponse({ ok: true, payload: { jobId: String(message.jobId || currentJobId), state: 'completed', imageUrl } });
        return;
      }
      const result = VISReplyReader.readStreaming(document, { ...context, type: context.type || message.jobType || currentJobType });
      if (!result.text) { sendResponse({ ok: false, error: (result.reason === 'latest-user-mismatch' ? 'Tab ChatGPT đang mở không có lệnh của phần cần đồng bộ. Hãy mở đúng hội thoại đã trả lời phần này.' : result.reason === 'invalid-json' ? 'Đã tìm thấy phản hồi đúng phần nhưng JSON chưa đầy đủ hoặc không hợp lệ.' : 'Chưa đọc được câu trả lời sau lệnh của phần này. Giữ tab ChatGPT mở ở cuối phản hồi rồi bấm Đồng bộ lại.' ) + ' [' + VISReplyReader.diagnose(document, context) + ']' }); return; }
      // Capturing a valid reply ends the matching waiter without stopping ChatGPT.
      // Recovery may use a new job ID for the exact same original prompt.
      const complete = result.complete && !isGenerating();
      if (complete && currentJobId && (currentJobId === context.id || (replyContext.prompt && replyContext.prompt === context.prompt))) {
        finished.add(currentJobId);
        generation += 1;
        currentJobId = ''; currentJobType = ''; cancelled = false;
      }
      if (complete) finished.add(context.id);
      sendResponse({ ok: true, payload: { jobId: context.id, state: complete ? 'completed' : 'progress', text: result.text } });
    }
  });
})();
