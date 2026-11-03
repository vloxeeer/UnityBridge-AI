/**
 * Service worker расширения: держит WebSocket-соединение с мостом UnityBridge AI.
 * Content script шлёт сообщения через chrome.runtime.sendMessage.
 */
'use strict';

const BRIDGE_HTTP = 'http://127.0.0.1:17777';
const BRIDGE_WS = 'ws://127.0.0.1:17777/ws';

let ws = null;
let token = null;
let siteUrl = '';
const pending = new Map(); // id -> {resolve, reject, timer}
let msgCounter = 0;

async function getToken() {
  if (token) return token;
  const res = await fetch(`${BRIDGE_HTTP}/token`);
  if (!res.ok) throw new Error('bridge /token: ' + res.status);
  const data = await res.json();
  token = data.token;
  return token;
}

async function ensureConnection() {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  token = await getToken();
  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(BRIDGE_WS);
    } catch (e) { reject(e); return; }
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', source: 'browser', token, site: siteUrl }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'hello' && msg.ok) { resolve(ws); return; }
      if (msg.type === 'response') {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          clearTimeout(p.timer);
          p.resolve(msg);
        }
        return;
      }
      if (msg.type === 'error') { reject(new Error(msg.error)); }
    };
    ws.onerror = () => reject(new Error('Не удалось подключиться к мосту UnityBridge AI. Запустите программу.'));
    ws.onclose = () => { ws = null; pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('Соединение с мостом закрыто')); }); pending.clear(); };
  });
}

async function sendPrompt(payload) {
  const conn = await ensureConnection();
  const id = 'ext-' + Date.now() + '-' + (msgCounter++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Таймаут ожидания ответа от Unity')); }, 125000);
    pending.set(id, { resolve, reject, timer });
    conn.send(JSON.stringify({ type: 'prompt', id, ...payload }));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ub:setSite') {
    siteUrl = sender.tab && sender.tab.url ? sender.tab.url : '';
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'ub:status') {
    getToken().then(() => fetch(`${BRIDGE_HTTP}/health`))
      .then((r) => r.json())
      .then((h) => sendResponse({ ok: true, bridge: h }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'ub:prompt') {
    sendPrompt({ url: sender.tab && sender.tab.url ? sender.tab.url : '', text: msg.text, prompt: msg.prompt, mode: msg.mode })
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
});
