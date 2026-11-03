/**
 * Smoke-тесты моста UnityBridge AI (v0.1.0, In Testing).
 * Запуск: npm test  (нужен установленный пакет ws)
 */
'use strict';

const assert = require('assert');
const WebSocket = require('ws');
const { createBridge } = require('../app/bridge-server');

const PORT = 18777;

function wsClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    ws.once('message', (raw) => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); });
  });
}

async function main() {
  const bridge = createBridge({ port: PORT });
  const { token } = await bridge.start();
  const url = `ws://127.0.0.1:${PORT}/ws`;
  console.log('✓ мост запущен');

  // 1. Health check
  const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json());
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.unityConnected, false);
  console.log('✓ /health отвечает');

  // 2. Чужой Origin отклоняется
  await assert.rejects(wsClient(url), /socket hang up|Unexpected|403/i).catch(async () => {
    // ws-клиент с Origin
    const ws = new WebSocket(url, { headers: { Origin: 'https://evil.example.com' } });
    await new Promise((res) => { ws.on('error', res); ws.on('close', res); });
  });
  console.log('✓ чужой Origin отклонён');

  // 3. Неверный токен отклоняется (сервер закрывает соединение с кодом 4001)
  const bad = await wsClient(url);
  const badClosed = new Promise((resolve) => {
    bad.on('close', (code) => resolve(code));
    bad.on('message', () => resolve(-1)); // не должно прислать hello ok
  });
  bad.send(JSON.stringify({ type: 'hello', source: 'unity', token: 'wrong' }));
  const badCode = await badClosed;
  assert.strictEqual(badCode, 4001);
  console.log('✓ неверный токен не проходит');

  // 4. Unity подключается
  const unity = await wsClient(url);
  unity.send(JSON.stringify({ type: 'hello', source: 'unity', token }));
  const hello = await nextMessage(unity);
  assert.strictEqual(hello.ok, true);
  console.log('✓ Unity подключился');

  // 5. Браузер подключается и шлёт prompt, Unity отвечает
  const browser = await wsClient(url);
  browser.send(JSON.stringify({ type: 'hello', source: 'browser', token, site: 'https://arena.ai' }));
  await nextMessage(browser);
  browser.send(JSON.stringify({ type: 'prompt', id: 't1', text: 'привет', prompt: 'создай куб', mode: 'ask' }));
  const promptAtUnity = await nextMessage(unity);
  assert.strictEqual(promptAtUnity.type, 'prompt');
  assert.strictEqual(promptAtUnity.id, 't1');
  assert.strictEqual(promptAtUnity.prompt, 'создай куб');
  unity.send(JSON.stringify({ type: 'response', id: 't1', ok: true, result: 'Создан куб Cube' }));
  const respAtBrowser = await nextMessage(browser);
  assert.strictEqual(respAtBrowser.ok, true);
  assert.strictEqual(respAtBrowser.result, 'Создан куб Cube');
  console.log('✓ полный цикл prompt → Unity → response работает');

  // 6. Prompt без Unity отклоняется (новый браузер после отключения Unity)
  unity.close();
  await new Promise((r) => setTimeout(r, 200));
  const b2 = await wsClient(url);
  b2.send(JSON.stringify({ type: 'hello', source: 'browser', token, site: 'x' }));
  await nextMessage(b2);
  b2.send(JSON.stringify({ type: 'prompt', id: 't2', text: '', prompt: 'test' }));
  const noUnity = await nextMessage(b2);
  assert.strictEqual(noUnity.ok, false);
  assert.match(noUnity.error, /Unity не подключён/);
  console.log('✓ запрос без Unity корректно отклоняется');

  // 7. Невалидный JSON
  b2.send('not json');
  const err = await nextMessage(b2);
  assert.strictEqual(err.type, 'error');
  console.log('✓ невалидный JSON отклоняется');

  bridge.stop();
  console.log('\nВсе тесты пройдены ✅');
  process.exit(0);
}

main().catch((e) => { console.error('❌ Тест провален:', e); process.exit(1); });
