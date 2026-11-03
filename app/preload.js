'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unitybridge', {
  getInfo: () => ipcRenderer.invoke('bridge:getInfo'),
  getStatus: () => ipcRenderer.invoke('bridge:status'),
  clearLog: () => ipcRenderer.invoke('bridge:clearLog'),
  detectBrowsers: () => ipcRenderer.invoke('browser:detect'),
  installExtensions: () => ipcRenderer.invoke('browser:install'),
  restartBridge: () => ipcRenderer.invoke('bridge:restart'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onLog: (cb) => ipcRenderer.on('bridge:log', (ev, entry) => cb(entry)),
});
