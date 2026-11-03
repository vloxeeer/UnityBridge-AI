# Архитектура UnityBridge AI

## Компоненты

| Компонент | Путь | Роль |
|---|---|---|
| Программа | `app/` | Electron: мост (WebSocket+HTTP на 127.0.0.1:17777), UI, установка расширения в браузеры |
| Расширение браузера | `extension/` | Content script на `<all_urls>`: кнопка «⚡ Unity» у текстовых полей; service worker держит ws-соединение |
| Расширение Unity | `unity/UnityBridgeAI/` | Editor-окно + WebSocket-клиент (`ClientWebSocket`, без внешних пакетов) |

## Протокол (JSON over WebSocket, путь `/ws`)

- Клиент → мост: `{type:"hello", source:"unity"|"browser", token, ...}`
- Браузер → мост: `{type:"prompt", id, text, prompt, mode}`
- Мост → Unity: `{type:"prompt", id, site, url, text, prompt, mode, ts}`
- Unity → мост: `{type:"response", id, ok, result, error}`
- Мост → браузер: `{type:"response", id, ok, result, error}`

Токен получается по HTTP `GET /token` (только с localhost Origin). Таймаут ответа Unity — 120 с.
