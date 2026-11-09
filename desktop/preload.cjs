const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studioDesktop", {
  openDataFolder: () => ipcRenderer.invoke("studio:open-data-folder"),
  openExternal: url => ipcRenderer.invoke('studio:open-external',url),
  chooseProductOutput: () => ipcRenderer.invoke('studio:choose-product-output'),
  openProductOutput: directory => ipcRenderer.invoke('studio:open-product-output',directory),
  chooseNewsOutput: () => ipcRenderer.invoke('studio:choose-news-output'),
  openNewsOutput: directory => ipcRenderer.invoke('studio:open-news-output',directory),
  ready: () => ipcRenderer.send('studio:ui-ready'),
});
