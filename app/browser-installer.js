/**
 * Автоустановка расширения UnityBridge AI в браузеры.
 * Chrome/Edge/Opera/Brave (Chromium): пишем манифест внешнего расширения
 *   Windows: HKCU\Software\Google\Chrome\Extensions\<id> (path)
 *            и аналогично для Microsoft\Edge, Opera Software, BraveSoftware
 *   macOS:   ~/Library/Application Support/<Browser>/External Extensions/<id>.json
 *   Linux:   ~/.config/<browser>/External Extensions/<id>.json
 * Firefox: регистрируем native manifest в
 *   Windows: HKCU\Software\Mozilla\NativeMessagingHosts\com.unitybridge.ai
 *   macOS/Linux: ~/.mozilla/native-messaging-hosts/com.unitybridge.ai.json
 *   ( Для Firefox также кладём .xpi-совместимый манифест рядом — подхват зависит от версии. )
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSION_ID = 'unitybridgeai'; // должен совпадать с key в extension/manifest.json

function home() { return os.homedir(); }
function platformDirs() {
  const p = process.platform;
  if (p === 'win32') return { kind: 'win' };
  if (p === 'darwin') return { kind: 'mac' };
  return { kind: 'linux' };
}

const CHROMIUM_BROWSERS = [
  { name: 'Chrome', winReg: ['Software\\Google\\Chrome\\Extensions', 'chrome'], macDir: 'Google/Chrome', linuxDir: 'google-chrome' },
  { name: 'Edge', winReg: ['Software\\Microsoft\\Edge\\Extensions', 'edge'], macDir: 'Microsoft Edge', linuxDir: 'microsoft-edge' },
  { name: 'Opera', winReg: ['Software\\Opera Software\\Opera Stable\\Extensions', 'opera'], macDir: 'com.operasoftware.Opera', linuxDir: 'opera' },
  { name: 'Brave', winReg: ['Software\\BraveSoftware\\Brave-Browser\\Extensions', 'brave'], macDir: 'BraveSoftware/Brave-Browser', linuxDir: 'BraveSoftware/Brave-Browser' },
  { name: 'Yandex', winReg: ['Software\\Yandex\\YandexBrowser\\Extensions', 'yandex'], macDir: 'Yandex/YandexBrowser', linuxDir: 'yandex-browser' },
];

function detectInstalledBrowsers() {
  const found = [];
  const { kind } = platformDirs();
  for (const b of CHROMIUM_BROWSERS) {
    try {
      if (kind === 'win') {
        const out = execSync(`reg query "HKCU\\${b.winReg[0]}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        if (out) found.push({ name: b.name, engine: 'chromium', installed: true });
      } else {
        const dir = kind === 'mac'
          ? path.join(home(), 'Library', 'Application Support', b.macDir)
          : path.join(home(), '.config', b.linuxDir);
        if (fs.existsSync(dir)) found.push({ name: b.name, engine: 'chromium', installed: true });
      }
    } catch (e) { /* не установлен */ }
  }
  // Firefox
  try {
    const ffDir = kind === 'win'
      ? path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox')
      : kind === 'mac'
        ? path.join(home(), 'Library', 'Application Support', 'Firefox')
        : path.join(home(), '.mozilla', 'firefox');
    if (fs.existsSync(ffDir)) found.push({ name: 'Firefox', engine: 'firefox', installed: true });
  } catch (e) { /* ignore */ }
  return found;
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function installChromium(extensionPath, browser) {
  const { kind } = platformDirs();
  const manifest = {
    external_update_url: null,
    path: extensionPath,
  };
  // У Chromium расширений с фиксированным id нужен "key" — генерируем стабильный из имени
  const keyFile = path.join(extensionPath, 'manifest.json');
  if (fs.existsSync(keyFile)) {
    const m = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    if (m.key) manifest.key = m.key;
  }
  const results = [];
  if (kind === 'win') {
    try {
      execSync(`reg add "HKCU\\${browser.winReg[0]}\\${EXTENSION_ID}" /ve /t REG_SZ /d "${extensionPath}" /f`, { stdio: ['ignore', 'pipe', 'ignore'] });
      results.push({ browser: browser.name, ok: true, method: 'registry' });
    } catch (e) {
      results.push({ browser: browser.name, ok: false, error: e.message });
    }
  } else {
    const base = kind === 'mac'
      ? path.join(home(), 'Library', 'Application Support', browser.macDir, 'External Extensions')
      : path.join(home(), '.config', browser.linuxDir, 'External Extensions');
    try {
      writeJson(path.join(base, EXTENSION_ID + '.json'), manifest);
      results.push({ browser: browser.name, ok: true, method: 'external-extensions-file', path: path.join(base, EXTENSION_ID + '.json') });
    } catch (e) {
      results.push({ browser: browser.name, ok: false, error: e.message });
    }
  }
  return results;
}

function installFirefox(extensionPath) {
  const { kind } = platformDirs();
  const hostName = 'com.unitybridge.ai';
  const nativeManifest = {
    name: hostName,
    description: 'UnityBridge AI bridge host',
    path: extensionPath, // для MV3 в Firefox подхватывается через отдельный механизм; здесь — манифест расширения
    type: 'stdio',
    allowed_extensions: [EXTENSION_ID + '@unitybridge.ai'],
  };
  const results = [];
  try {
    if (kind === 'win') {
      const regPath = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${hostName}`;
      const tmp = path.join(os.tmpdir(), hostName + '.json');
      writeJson(tmp, nativeManifest);
      execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${tmp}" /f`, { stdio: ['ignore', 'pipe', 'ignore'] });
      results.push({ browser: 'Firefox', ok: true, method: 'registry' });
    } else {
      const dir = kind === 'mac'
        ? path.join(home(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')
        : path.join(home(), '.mozilla', 'native-messaging-hosts');
      writeJson(path.join(dir, hostName + '.json'), nativeManifest);
      results.push({ browser: 'Firefox', ok: true, method: 'native-messaging-hosts', path: path.join(dir, hostName + '.json') });
    }
  } catch (e) {
    results.push({ browser: 'Firefox', ok: false, error: e.message });
  }
  return results;
}

function installExtensionForAllBrowsers(extensionPath) {
  const browsers = detectInstalledBrowsers();
  const results = [];
  for (const b of browsers) {
    if (b.engine === 'chromium') results.push(...installChromium(extensionPath, CHROMIUM_BROWSERS.find((x) => x.name === b.name)));
    if (b.engine === 'firefox') results.push(...installFirefox(extensionPath));
  }
  if (results.length === 0) {
    results.push({ browser: '—', ok: false, error: 'Поддерживаемые браузеры не найдены. Установите расширение вручную через chrome://extensions → «Загрузить распакованное».' });
  }
  return { browsers, results, extensionPath };
}

module.exports = { installExtensionForAllBrowsers, detectInstalledBrowsers, EXTENSION_ID };
