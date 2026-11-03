'use strict';
/* global unitybridge */

const $ = (s) => document.querySelector(s);

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

function setStatus(ok, text) {
  const pill = $('#statusPill');
  pill.classList.toggle('ok', ok);
  pill.classList.toggle('err', !ok);
  $('#statusText').textContent = text;
}

async function refresh() {
  const info = await unitybridge.getInfo();
  const st = await unitybridge.getStatus();
  $('#bridgeAddr').textContent = `ws://127.0.0.1:${info.port}/ws`;
  $('#browserCount').textContent = st.browserCount;
  $('#pendingCount').textContent = st.pendingCount;
  if (st.unityConnected) {
    $('#unityStatus').textContent = 'Подключён';
    $('#unityStatus').className = 'card-value ok';
    $('#unitySub').textContent = `клиентов: ${st.unityCount}`;
    setStatus(true, 'Мост работает · Unity онлайн');
  } else {
    $('#unityStatus').textContent = 'Не подключён';
    $('#unityStatus').className = 'card-value err';
    $('#unitySub').textContent = 'откройте Unity с расширением';
    setStatus(false, 'Мост работает · Unity оффлайн');
  }
  // дописываем лог
  info.log.forEach(renderLog);
}

const rendered = new Set();
function renderLog(e) {
  const key = e.ts + e.message;
  if (rendered.has(key)) return;
  rendered.add(key);
  const box = $('#logBox');
  const div = document.createElement('div');
  div.className = 'l-' + e.level;
  div.innerHTML = `<span class="ts">${e.ts.slice(11, 19)}</span>${e.message}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

unitybridge.onLog(renderLog);

$('#btnClearLog').addEventListener('click', async () => {
  await unitybridge.clearLog();
  rendered.clear();
  $('#logBox').innerHTML = '';
});
$('#btnRestart').addEventListener('click', async () => {
  await unitybridge.restartBridge();
  await refresh();
});
$('#btnCopyToken').addEventListener('click', async () => {
  const info = await unitybridge.getInfo();
  try { await navigator.clipboard.writeText(info.token); } catch (e) { /* буфер недоступен */ }
});
$('#btnDetect').addEventListener('click', async () => {
  const list = await unitybridge.detectBrowsers();
  $('#browserList').innerHTML = list.length
    ? list.map((b) => `<span class="browser-chip">${b.name} (${b.engine})</span>`).join('')
    : '<span class="muted">Браузеры не найдены</span>';
});
$('#btnInstall').addEventListener('click', async () => {
  const res = await unitybridge.installExtensions();
  $('#installResult').innerHTML = res.results.map((r) =>
    `<div class="install-item${r.ok ? '' : ' fail'}">${r.ok ? '✅' : '❌'} ${r.browser}: ${r.ok ? (r.method || 'OK') : (r.error || 'ошибка')}</div>`
  ).join('');
});

refresh();
setInterval(refresh, 3000);
