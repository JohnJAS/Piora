import { contextBridge, ipcRenderer } from "electron";
const channel = "pi:browser-modal";
contextBridge.exposeInMainWorld(
  "pioraBrowserDialog",
  Object.freeze({
    ready: () => ipcRenderer.invoke(channel, "ready"),
    height: (height: number) => ipcRenderer.invoke(channel, "height", height),
    onToolsEvent: (listener: (value: unknown) => void) => {
      const refresh = () => listener({ kind: "library", section: "downloads" });
      ipcRenderer.on("pi:browser-modal-refresh", refresh);
      return () => ipcRenderer.off("pi:browser-modal-refresh", refresh);
    },
    close: (action?: "vault" | "downloads") => ipcRenderer.invoke(channel, "close", action),
    tools: (command: string, input: unknown) => ipcRenderer.invoke(channel, command, input),
  }),
);
