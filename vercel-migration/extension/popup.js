const pair = document.querySelector('#pair');
const status = document.querySelector('#status');

function show(message, ok) {
  status.textContent = message;
  status.className = ok ? 'ok' : 'bad';
}

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'vis-status' })
    .catch(error => ({ error: error.message }));
  if (result?.pairCode) pair.value = result.pairCode;
  const connected = Boolean(result?.chatReady && result?.pairCode);
  show(
    connected
      ? 'Đã kết nối ChatGPT · v0.4.28'
      : (result?.error || 'Chưa kết nối ChatGPT'),
    connected,
  );
}

document.querySelector('#connect').onclick = async () => {
  const result = await chrome.runtime.sendMessage({
    type: 'vis-pair',
    pairCode: pair.value,
  }).catch(error => ({ error: error.message }));
  show(
    result?.ok
      ? 'Đã kết nối ChatGPT · v0.4.28'
      : (result?.error || 'Kết nối thất bại'),
    Boolean(result?.ok),
  );
};

document.querySelector('#disconnect').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'vis-unpair' });
  pair.value = '';
  show('Đã ngắt kết nối.', false);
};

document.querySelector('#sync').onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'vis-capture-result' })
    .catch(error => ({ error: error.message }));
  show(result?.ok ? 'Đã gửi kết quả cuối về web.' : (result?.error || 'Chưa đồng bộ được kết quả.'), Boolean(result?.ok));
};

document.querySelector('#restore').onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'vis-restore-draft' }).catch(error => ({ error: error.message }));
  show(result?.ok ? 'Đã khôi phục bản nháp vào ô ChatGPT, chưa gửi.' : result?.error || 'Chưa khôi phục được bản nháp.', Boolean(result?.ok));
};

void refresh();


