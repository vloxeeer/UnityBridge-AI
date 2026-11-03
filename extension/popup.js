'use strict';
chrome.runtime.sendMessage({ type: 'ub:status' }, (res) => {
  const b = document.getElementById('bridge');
  const u = document.getElementById('unity');
  if (res && res.ok && res.bridge) {
    b.textContent = 'онлайн (v' + (res.bridge.version || '?') + ')';
    b.className = 'ok';
    u.textContent = res.bridge.unityConnected ? 'подключён' : 'не подключён';
    u.className = res.bridge.unityConnected ? 'ok' : 'bad';
  } else {
    b.textContent = 'оффлайн — запустите программу';
    b.className = 'bad';
    u.textContent = '—';
    u.className = 'bad';
  }
});
