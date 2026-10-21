(() => {
  if (globalThis.__VIS_IMAGE_PREVIEW_PATCH_0415__) return;
  globalThis.__VIS_IMAGE_PREVIEW_PATCH_0415__ = true;

  const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

  const candidateImages = () => [...document.querySelectorAll('main img')]
    .filter(img => (img.naturalWidth || img.width || 0) >= 400 && (img.naturalHeight || img.height || 0) >= 200);

  async function makePreview(sourceUrl) {
    const images = candidateImages();
    const image = images.find(img => (img.currentSrc || img.src || '') === sourceUrl) || images.at(-1);
    if (!image) return '';
    if (!image.complete || !image.naturalWidth) {
      await new Promise(resolve => {
        const done = () => resolve();
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        setTimeout(done, 3000);
      });
    }
    if (!image.naturalWidth || !image.naturalHeight) return '';

    // Preview only: keep the Studio project light. The original stays in ChatGPT.
    const maxWidth = 480;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return '';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.60);
  }

  chrome.runtime.sendMessage = function(message, ...args) {
    const payload = message?.type === 'vis-chat-event' ? message.payload : null;
    if (payload?.state === 'completed' && payload.imageUrl && !String(payload.imageUrl).startsWith('data:')) {
      return makePreview(payload.imageUrl)
        .catch(() => '')
        .then(preview => nativeSendMessage({
          ...message,
          payload: {
            ...payload,
            sourceImageUrl: payload.imageUrl,
            imageUrl: preview || payload.imageUrl,
            previewOnly: Boolean(preview)
          }
        }, ...args));
    }
    return nativeSendMessage(message, ...args);
  };
})();
