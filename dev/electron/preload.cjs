const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ideaboardBridge", {
  platform: process.platform, // mac では信号機ボタンの分だけ余白が必要
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  // 同期フォルダ
  syncStatus: () => ipcRenderer.invoke("sync:status"),
  syncChoose: () => ipcRenderer.invoke("sync:choose"),
  syncClear: () => ipcRenderer.invoke("sync:clear"),
  syncList: () => ipcRenderer.invoke("sync:list"),
  syncRead: (id) => ipcRenderer.invoke("sync:read", id),
  syncWrite: (id, project, baseMtime) => ipcRenderer.invoke("sync:write", id, project, baseMtime),
  syncRemove: (id) => ipcRenderer.invoke("sync:remove", id),
});
