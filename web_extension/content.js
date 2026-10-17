let currentJob = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function composer() { return document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]'); }
function sendButton() { return document.querySelector('button[data-testid="send-button"]') || [...document.querySelectorAll('button')].find(button => /send|gửi/i.test(button.getAttribute('aria-label') || '')); }
function assistantMessages() { return [...document.querySelectorAll('[data-message-author-role="assistant"]')]; }
async function submit(command) {
  if (currentJob) return;
  currentJob = command.id;
  const before = assistantMessages().length;
  const box = composer();
  const button = sendButton();
  if (!box || !button) {
    chrome.runtime.sendMessage({ type: 'studio-finished', jobId: command.id, error: 'Không tìm thấy ô nhập hoặc nút Gửi của ChatGPT. Tải lại tab ChatGPT rồi thử lại.' });
    currentJob = null;
    return;
  }
  box.focus();
  box.textContent = command.prompt;
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: command.prompt }));
  await sleep(250);
  button.click();
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await sleep(2000);
    const messages = assistantMessages();
    const last = messages[messages.length - 1];
    if (messages.length > before && last && (last.innerText.trim().length > 0 || last.querySelector('img'))) {
      await sleep(2000);
      chrome.runtime.sendMessage({ type: 'studio-finished', jobId: command.id, text: last.innerText.trim() });
      currentJob = null;
      return;
    }
  }
  chrome.runtime.sendMessage({ type: 'studio-finished', jobId: command.id, error: 'ChatGPT chưa trả lời trong thời gian chờ. Kiểm tra tab ChatGPT rồi thử lại.' });
  currentJob = null;
}
chrome.runtime.onMessage.addListener(message => { if (message.type === 'studio-send') void submit(message.command); });