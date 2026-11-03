/**
 * UnityBridge AI — локальный мост (bridge server).
 * Слушает WebSocket на 127.0.0.1:17777 и принимает подключения от:
 *   - расширения браузера (content script -> background -> ws)
 *   - расширения Unity (C# WebSocket client)
 * Протокол: JSON-сообщения. Все сообщения валидируются.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 17777;
const HOST = '127.0.0.1';

// Одноразовый токен на запуск моста. Расширение получает его через HTTP-эндпоинт
// только с localhost, поэтому удалённые сайты его не увидят.
function createBridge(options = {}) {
  const port = options.port || DEFAULT_PORT;
  const token = crypto.randomBytes(24).toString('hex');
  const listeners = new Set(); // колбэки UI: (event) => {}

  const state = {
    token,
    port,
    unityClients: new Set(),   // ws клиентов Unity
    browserClients: new Set(), // ws клиентов браузера
    pending: new Map(),        // id -> {resolve, ws, timer}
    log: [],                   // кольцевой буфер логов для UI
  };

  const MAX_LOG = 500;
  function log(level, message, data) {
    const entry = { ts: new Date().toISOString(), level, message, data: data || null };
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
    listeners.forEach((fn) => { try { fn(entry); } catch (e) { /* ignore */ } });
  }

  function emit(event) { listeners.forEach((fn) => { try { fn(event); } catch (e) { /* ignore */ } }); }

  function safeSend(ws, obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    return false;
  }

  function broadcastStatus() {
    emit({
      type: 'status',
      unityConnected: state.unityClients.size > 0,
      unityCount: state.unityClients.size,
      browserCount: state.browserClients.size,
      pendingCount: state.pending.size,
    });
  }

  // --- HTTP: отдаём токен только локальным запросам ---
  const httpServer = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    // Разрешаем только запросы без Origin (локальные инструменты) или с localhost Origin
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden origin' }));
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: 'UnityBridge-AI', version: '0.1.0', unityConnected: state.unityClients.size > 0 }));
      return;
    }
    if (req.url === '/token') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ token, port }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  // --- WebSocket ---
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const MAX_MSG = 256 * 1024; // 256 КБ на сообщение

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin || '';
    // Браузерные расширения шлют Origin chrome-extension://... или moz-extension://...
    const isExtensionOrigin = /^chrome-extension:\/\//i.test(origin) || /^moz-extension:\/\//i.test(origin) || /^safari-web-extension:\/\//i.test(origin);
    // Unity шлёт Origin вовсе без него или "http://localhost"
    const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    if (!isExtensionOrigin && !isLocalOrigin) {
      log('warn', `Отклонено подключение с чужого Origin: ${origin || '(нет)'}`);
      ws.close(4003, 'Forbidden origin');
      return;
    }

    ws.isAlive = true;
    ws.role = null; // 'unity' | 'browser'
    ws.meta = {};
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      if (raw.length > MAX_MSG) { ws.close(1009, 'Message too big'); return; }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) {
        safeSend(ws, { type: 'error', error: 'Invalid JSON' });
        return;
      }
      handleMessage(ws, msg);
    });

    ws.on('close', () => {
      state.unityClients.delete(ws);
      state.browserClients.delete(ws);
      if (ws.role === 'unity') log('info', 'Unity отключился от моста');
      if (ws.role === 'browser') log('info', `Браузерное подключение закрыто (${ws.meta.site || 'сайт неизвестен'})`);
      broadcastStatus();
    });

    ws.on('error', (err) => { log('error', `Ошибка сокета: ${err.message}`); });
  });

  function handleMessage(ws, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      safeSend(ws, { type: 'error', error: 'Message must be an object with "type"' });
      return;
    }

    switch (msg.type) {
      case 'hello': {
        if (msg.token !== state.token) {
          log('warn', 'Неверный токен при рукопожатии — соединение закрыто');
          ws.close(4001, 'Unauthorized');
          return;
        }
        if (msg.source === 'unity') {
          ws.role = 'unity';
          ws.meta = { unityVersion: msg.unityVersion || 'unknown', project: msg.project || '' };
          state.unityClients.add(ws);
          log('info', `Unity подключился к мосту (версия ${ws.meta.unityVersion}${ws.meta.project ? ', проект ' + ws.meta.project : ''})`);
          safeSend(ws, { type: 'hello', ok: true, name: 'UnityBridge-AI', version: '0.1.0' });
        } else if (msg.source === 'browser') {
          ws.role = 'browser';
          ws.meta = { site: typeof msg.site === 'string' ? msg.site.slice(0, 300) : '' };
          state.browserClients.add(ws);
          log('info', `Браузер подключился: ${ws.meta.site || 'неизвестный сайт'}`);
          safeSend(ws, { type: 'hello', ok: true, name: 'UnityBridge-AI', version: '0.1.0' });
        } else {
          safeSend(ws, { type: 'error', error: 'Unknown source. Use "unity" or "browser".' });
        }
        broadcastStatus();
        break;
      }

      case 'prompt': {
        // prompt идёт от браузера и должен быть адресован Unity
        if (ws.role !== 'browser') { safeSend(ws, { type: 'error', error: 'Only browser clients can send prompts' }); return; }
        const id = typeof msg.id === 'string' && msg.id.length <= 64 ? msg.id : crypto.randomBytes(8).toString('hex');
        const payload = {
          type: 'prompt',
          id,
          site: ws.meta.site || '',
          url: typeof msg.url === 'string' ? msg.url.slice(0, 500) : '',
          text: typeof msg.text === 'string' ? msg.text.slice(0, 100000) : '',
          prompt: typeof msg.prompt === 'string' ? msg.prompt.slice(0, 20000) : '',
          mode: typeof msg.mode === 'string' ? msg.mode.slice(0, 40) : 'ask',
          ts: Date.now(),
        };
        if (state.unityClients.size === 0) {
          safeSend(ws, { type: 'response', id, ok: false, error: 'Unity не подключён. Откройте Unity с расширением UnityBridge AI.' });
          log('warn', `Запрос ${id} отклонён: Unity не подключён`);
          return;
        }
        // Отправляем первому доступному Unity-клиенту
        const target = state.unityClients.values().next().value;
        const timer = setTimeout(() => {
          if (state.pending.delete(id)) {
            safeSend(ws, { type: 'response', id, ok: false, error: 'Unity не ответил за 120 секунд (таймаут)' });
            log('warn', `Таймаут запроса ${id}`);
          }
        }, 120000);
        state.pending.set(id, { resolve: null, ws, timer });
        log('info', `Запрос ${id} отправлен в Unity (режим: ${payload.mode}, сайт: ${payload.site || '?'})`);
        emit({ type: 'prompt', payload });
        safeSend(target, payload);
        break;
      }

      case 'response': {
        // response идёт от Unity и возвращается браузеру
        if (ws.role !== 'unity') { safeSend(ws, { type: 'error', error: 'Only unity clients can send responses' }); return; }
        const id = typeof msg.id === 'string' ? msg.id : '';
        const pending = state.pending.get(id);
        if (!pending) { log('warn', `Ответ с неизвестным id ${id} — отброшен`); return; }
        clearTimeout(pending.timer);
        state.pending.delete(id);
        const ok = msg.ok === true;
        const result = typeof msg.result === 'string' ? msg.result.slice(0, 200000) : '';
        const error = typeof msg.error === 'string' ? msg.error.slice(0, 2000) : '';
        safeSend(pending.ws, { type: 'response', id, ok, result, error });
        log(ok ? 'info' : 'warn', `Ответ по запросу ${id}: ${ok ? 'успех' : 'ошибка — ' + error}`);
        emit({ type: 'response', id, ok, result, error });
        break;
      }

      case 'ping':
        safeSend(ws, { type: 'pong', ts: Date.now() });
        break;

      default:
        safeSend(ws, { type: 'error', error: `Unknown message type: ${msg.type}` });
    }
  }

  // Пинг_interval: закрываем мёртвые соединения
  const pingTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* ignore */ }
    });
  }, 30000);

  function start() {
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, HOST, () => {
        log('info', `Мост запущен на ws://${HOST}:${port}/ws`);
        resolve({ port, token, httpServer, wss, state, log, onLog: (fn) => listeners.add(fn), broadcastStatus, stop });
      });
    });
  }

  function stop() {
    clearInterval(pingTimer);
    state.pending.forEach((p) => clearTimeout(p.timer));
    state.pending.clear();
    wss.clients.forEach((ws) => { try { ws.close(1001, 'Bridge shutting down'); } catch (e) {} });
    wss.close();
    httpServer.close();
  }

  return { start, stop, state, log, onLog: (fn) => listeners.add(fn), broadcastStatus };
}

// Запуск как отдельного процесса: node app/bridge-server.js [port]
if (require.main === module) {
  const port = parseInt(process.argv[2] || String(DEFAULT_PORT), 10);
  const bridge = createBridge({ port });
  bridge.onLog((e) => console.log(`[${e.level}] ${e.message}`));
  bridge.start().then(({ port }) => {
    console.log(`UnityBridge-AI bridge listening on ws://${HOST}:${port}/ws`);
  });
}

module.exports = { createBridge, DEFAULT_PORT, HOST };
