/* 弹窗脚本：配置 ITAD API Key、清空缓存 */

const elKey = document.getElementById('key');
const elStatus = document.getElementById('status');
const btnSave = document.getElementById('save');
const btnClear = document.getElementById('clear');

let statusTimer = null;

function setStatus(text, kind) {
  elStatus.textContent = text || '';
  elStatus.className = 'status' + (kind ? ' ' + kind : '');
  if (statusTimer) clearTimeout(statusTimer);
  if (text) {
    statusTimer = setTimeout(() => {
      elStatus.textContent = '';
      elStatus.className = 'status';
    }, 3000);
  }
}

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

// 读取已保存的 key
(async () => {
  const s = await send({ type: 'GDP_GET_SETTINGS' });
  if (s && s.itadKey) elKey.value = s.itadKey;
})();

// 保存
btnSave.addEventListener('click', async () => {
  const val = elKey.value.trim();

  if (val && !/^[a-f0-9]{32}$/i.test(val)) {
    setStatus('Key 格式不对，应为 32 位十六进制', 'err');
    return;
  }

  btnSave.disabled = true;
  setStatus('保存中…');

  const s = await send({ type: 'GDP_GET_SETTINGS' });
  const next = Object.assign({}, s || {}, { itadKey: val });
  const r = await send({ type: 'GDP_SAVE_SETTINGS', settings: next });

  btnSave.disabled = false;

  if (r && r.ok) {
    // 保存后清掉旧缓存，让新 key 立刻生效
    await send({ type: 'GDP_CLEAR_CACHE' });
    setStatus('已保存，缓存已清空', 'ok');
  } else {
    setStatus('保存失败', 'err');
  }
});

// 清缓存
btnClear.addEventListener('click', async () => {
  btnClear.disabled = true;
  setStatus('清理中…');
  const r = await send({ type: 'GDP_CLEAR_CACHE' });
  btnClear.disabled = false;
  if (r && r.ok) {
    setStatus(`已清理 ${r.cleared || 0} 条`, 'ok');
  } else {
    setStatus('清理失败', 'err');
  }
});

// 回车即保存
elKey.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnSave.click();
});
