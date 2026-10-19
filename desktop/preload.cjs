const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopBridge', { notify: (payload) => ipcRenderer.invoke('notify', payload) });
