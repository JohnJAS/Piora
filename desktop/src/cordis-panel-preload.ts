import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pioraExtension", Object.freeze({
  invoke: (method: string, input?: unknown) => ipcRenderer.invoke("pi:cordis-panel-call", method, input),
}));
