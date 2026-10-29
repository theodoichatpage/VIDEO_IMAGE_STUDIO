(() => {
  if (window.__VIS_CHAT_BRIDGE_0425__) return;
  window.__VIS_CHAT_BRIDGE_0425__ = true;
  let currentJobId = '';
  let lastDomChange = Date.now();
  new MutationObserver(() => { lastDomChange = Date.now(); }).observe(document.documentElement, {subtree:true, childList:true, characterData:true});
  let currentJobType = '';
  let cancelled = false;
  let generation = 0;
  let replyContext = {};
  const finished = new Set();
  const downloads=new Set();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const composer = () => document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][data-virtualkeyboard="true"]') || document.querySelector('div[contenteditable="true"].ProseMirror');
  // Current ChatGPT labels the composer's stop control just "Stop" without a test id.
  const buttonLabel = button => (button.getAttribute('aria-label') || button.textContent || '').trim();
  const stopButton = () => document.querySelector('button[data-testid="stop-button"]')
    || [...(composer()?.closest('form')?.querySelectorAll('button') || [])].find(button => /^(stop|stop generating|stop streaming|stop answering|dừng|dừng tạo|dừng tạo câu trả lời|dừng trả lời)$/i.test(buttonLabel(button)))
    || [...document.querySelectorAll('button')].find(button => /^(stop generating|stop streaming|stop answering|dừng tạo|dừng tạo câu trả lời|dừng trả lời)$/i.test(buttonLabel(button)));
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

  const imageUrls = (context = replyContext) => [...(VISReplyReader.sources(document, context).node?.querySelectorAll('img') || [])].filter(image => image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256).map(image => image.currentSrc || image.src || '').filter(url => /^(https?:|blob:)/.test(url));
  const expandedImagePrompts = new WeakSet();
  async function expandImagePrompts(context) {
    // Long ChatGPT prompts can contain only the preview until Show more is clicked.
    // Expand the user turn, then keep using exact prompt matching (never a style prefix).
    let expanded = false;
    const known = VISReplyReader.turns(document, context).filter(turn => turn.role === 'user').flatMap(turn => [...turn.node.querySelectorAll('button, [role="button"]')]);
    const controls = [...new Set([...known, ...document.querySelectorAll('button, [role="button"]')])];
    for (const button of controls) {
        if (button.closest?.('form, #prompt-textarea, [contenteditable="true"]')) continue;
        const label = (button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim();
        if (!/^(show more|read more|see more|xem thêm|hiển thị thêm|mở rộng)$/i.test(label) || expandedImagePrompts.has(button)) continue;
        expandedImagePrompts.add(button);button.click();expanded = true;
    }
    if (expanded) await sleep(150);
  }
  async function imagePayload(context) {
    await expandImagePrompts(context);
    const imageUrl = imageUrls(context).at(-1);
    if (!imageUrl) throw new Error('Chưa tìm thấy ảnh hoàn tất đúng lệnh của cảnh này. Mở đúng hội thoại và cuộn tới ảnh. [' + VISReplyReader.sources(document, context).reason + ']');
    const controller=new AbortController();downloads.add(controller);
    try{
    try {
      const response = await fetch(imageUrl, { credentials: 'include',signal:controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const blob = await response.blob();
      if (blob.size > 8388608) throw new Error('Ảnh vượt giới hạn 8 MB.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80 ? 'image/webp' : '';
      if (!mime) throw new Error('Tệp nhận được không phải PNG/JPEG/WebP.');
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { jobId: context.id, state: 'completed', imageDataUrl: 'data:' + mime + ';base64,' + btoa(binary) };
    } catch (error) {
      if(controller.signal.aborted)throw new Error('Đã dừng tải ảnh.');
      // Displaying a signed cross-origin image does not grant page fetch permission.
      // The extension worker has narrowly scoped host permissions for this fallback.
      if (!/^https:\/\//.test(imageUrl)) throw error;
      const result = await chrome.runtime.sendMessage({type:'vis-fetch-image',url:imageUrl});
      if (!result?.ok || !result.imageDataUrl) throw new Error('Chưa tải được tệp ảnh: ' + (result?.error || error?.message || String(error)));
      return {jobId:context.id,state:'completed',imageDataUrl:result.imageDataUrl};
    }
    }finally{downloads.delete(controller);}
  }

  async function waitForImage(_before, token) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (cancelled || token !== generation) throw new Error('Đã dừng tác vụ tạo ảnh.');
      await expandImagePrompts(replyContext);
      if (cancelled || token !== generation) throw new Error('Đã dừng tác vụ tạo ảnh.');
      if (imageUrls().length && !isGenerating()) return imagePayload(replyContext);
      await sleep(1500);
    }
    throw new Error('ChatGPT quá thời gian tạo ảnh hoặc không đọc được ảnh đúng cảnh.');
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
        if (started && last && !isGenerating() && Date.now() - changedAt >= 3000) {
          const result = VISReplyReader.read(document, { ...replyContext, type: kind });
          if (result.text) return result.text;
          // ChatGPT finished and stayed idle, but the reply for THIS job is not valid JSON: fail clearly instead of hanging.
          if (result.reason === 'invalid-json' && Date.now() - changedAt >= 45000) throw new Error('ChatGPT đã trả lời xong nhưng JSON không hợp lệ (' + result.detail + '). Kiểm tra hội thoại rồi bấm Đồng bộ kết quả ngay hoặc chạy lại phần này.');
        }
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
        const payload = await waitForImage(beforeImages, token);
        if (token !== generation || cancelled) return;
        await emit(payload);
        finished.add(command.id);
        return;
      }
      const before = assistantText(currentJobType);
      await fillComposer('[VIS_JOB_ID:' + command.id + ']\nTEXT ANALYSIS ONLY. DO NOT GENERATE IMAGES OR USE IMAGE TOOLS. ' + (command.type === 'transcript_rewrite' ? 'Return only the rewritten script, without JSON or markdown.\n' : 'Return only the requested JSON.\n') + command.prompt);
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
    if (message?.type === 'MGR_FP') {
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = messages[messages.length - 1];
      const body = (document.body?.innerText || '').slice(0, 5000);
      sendResponse({generating:isGenerating(),msgCount:messages.length,lastLen:(last?.innerText || '').length,captcha:/captcha|verify you are human/i.test(body),rateLimit:/too many requests|rate limit|try again later/i.test(body),login:!composer(),lastDomChange,jobId:currentJobId}); return;
    }
    if (message?.type === 'vis-ping') {
      (async()=>{
        const st=await chrome.storage.local.get(['pairCode','activeJobId','activeCommand','conversationUrl','identityJobId']);
        let tabId=null;try {tabId=(await chrome.runtime.sendMessage({type:'vis-tab-id'}))?.chatTabId ?? null;}catch{}
        const url=/^\/c\/[^/]+$/.test(location.pathname)?location.origin+location.pathname:null;
        const turns=document.querySelectorAll('[data-message-author-role="user"]');
        const last=turns[turns.length-1];
        const marker=st.activeJobId && last && (last.innerText||'').includes('[VIS_JOB_ID:'+st.activeJobId+']');
        const imagePrompt=st.activeCommand?.type==='image_generation' && st.activeCommand?.id===st.activeJobId && typeof st.activeCommand.prompt==='string' && st.activeCommand.prompt.length>0 && last && (last.innerText||'').includes(st.activeCommand.prompt);
        const verified=currentJobId===st.activeJobId && !!currentJobId || Boolean((marker||imagePrompt) && st.identityJobId===st.activeJobId && st.conversationUrl===url);
        sendResponse({ready:Boolean(composer()),version:'0.4.25',conversationLabel:location.pathname,pairCode:st.pairCode||null,activeJobId:verified?st.activeJobId:null,chatTabId:tabId,conversationUrl:url,lastHeartbeatAt:Date.now()});
      })().catch(()=>sendResponse({ready:Boolean(composer()),version:'0.4.25',conversationLabel:location.pathname,pairCode:null,activeJobId:null,chatTabId:null,conversationUrl:null,lastHeartbeatAt:null}));
      return true;
    }
    if (message?.type === 'vis-restore-draft') {
      restoreDraft().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === 'vis-stop') {
      cancelled = true;
      for(const controller of downloads)controller.abort();
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
        imagePayload(context).then(payload => {
          if (currentJobId && (currentJobId === context.id || replyContext.prompt === context.prompt)) {finished.add(currentJobId);generation += 1;currentJobId='';currentJobType='';cancelled=false;}
          finished.add(context.id);sendResponse({ ok: true, payload });
        }).catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      const result = VISReplyReader.readStreaming(document, { ...context, type: context.type || message.jobType || currentJobType });
      if (!result.text) { sendResponse({ ok: false, error: (result.reason === 'latest-user-mismatch' ? 'Tab ChatGPT đang mở không có lệnh của phần cần đồng bộ. Hãy mở đúng hội thoại đã trả lời phần này.' : result.reason === 'invalid-json' ? (isGenerating() ? 'ChatGPT vẫn đang trả lời phần này; JSON chưa hoàn tất. Đợi ChatGPT xong rồi đồng bộ lại.' : 'Đã tìm thấy phản hồi đúng phần nhưng JSON không hợp lệ: ' + (result.detail || 'không tìm thấy JSON') + '.') : 'Chưa đọc được câu trả lời sau lệnh của phần này. Giữ tab ChatGPT mở ở cuối phản hồi rồi bấm Đồng bộ lại.' ) + ' [' + VISReplyReader.diagnose(document, context) + ']' }); return; }
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


