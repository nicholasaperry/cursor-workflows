const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workflows", {
  status: () => ipcRenderer.invoke("app:status"),
  list: () => ipcRenderer.invoke("workflows:list"),
  get: (id) => ipcRenderer.invoke("workflows:get", id),
  run: (id) => ipcRenderer.invoke("workflows:run", id),
  send: (id, prompt) => ipcRenderer.invoke("workflows:send", id, prompt),
  cancel: (id) => ipcRenderer.invoke("workflows:cancel", id),
  reset: (id) => ipcRenderer.invoke("workflows:reset", id),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("workflow:event", listener);
    return () => ipcRenderer.removeListener("workflow:event", listener);
  },
});
