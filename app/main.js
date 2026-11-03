/**
 * UnityBridge AI — главное окно Electron.
 * Запускает мост, управляет автоустановкой расширения в браузеры,
 * отдаёт статистику в renderer через IPC.
 */
'use strict';

const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('path');
const { createBridge } = require('./bridge-server');
const { installExtensionForAllBrowsers, detectInstalledBrowsers } = require('./browser-installer');

let mainWindow = null;
let tray = null;
let bridge = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'UnityBridge AI',
    backgroundColor: '#0b0e17',
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'renderer', 'icon.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть UnityBridge AI', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
  tray.setToolTip('UnityBridge AI — мост AI ↔ Unity');
  tray.setContextMenu(menu);
  tray.on('click', () => { if (mainWindow) mainWindow.show(); });
}

app.whenReady().then(async () => {
  bridge = createBridge({});
  bridge.onLog((entry) => {
    if (mainWindow) mainWindow.webContents.send('bridge:log', entry);
  });
  await bridge.start();
  const { port, token } = bridge.state;

  ipcMain.handle('bridge:getInfo', () => ({
    port,
    token,
    log: bridge.state.log.slice(-100),
  }));
  ipcMain.handle('bridge:status', () => ({
    unityConnected: bridge.state.unityClients.size > 0,
    unityCount: bridge.state.unityClients.size,
    browserCount: bridge.state.browserClients.size,
    pendingCount: bridge.state.pending.size,
  }));
  ipcMain.handle('bridge:clearLog', () => { bridge.state.log.length = 0; return true; });
  ipcMain.handle('browser:detect', () => detectInstalledBrowsers());
  ipcMain.handle('browser:install', async () => {
    const extensionPath = path.join(__dirname, '..', 'extension');
    return installExtensionForAllBrowsers(extensionPath);
  });
  ipcMain.handle('bridge:restart', async () => {
    const port = bridge.state.port;
    bridge.stop();
    bridge = createBridge({ port });
    bridge.onLog((entry) => { if (mainWindow) mainWindow.webContents.send('bridge:log', entry); });
    await bridge.start();
    return { port: bridge.state.port, token: bridge.state.token };
  });
  ipcMain.handle('shell:openExternal', (ev, url) => { if (url.startsWith('http')) shell.openExternal(url); });

  createWindow();
  createTray();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  // Программа живёт в трее, пока пользователь не нажмёт «Выход»
});

app.on('before-quit', () => { if (bridge) bridge.stop(); });
