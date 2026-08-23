import { contextBridge, ipcRenderer } from "electron";

const runtime = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }),
  notifyCompletion(taskTitle?: string): Promise<boolean> {
    return ipcRenderer.invoke(
      "pi:completion-notification",
      typeof taskTitle === "string" ? taskTitle : undefined,
    ) as Promise<boolean>;
  },
  openMenu(menu: "file" | "edit" | "view" | "window" | "help", x: number, y: number): Promise<boolean> {
    return ipcRenderer.invoke("pi:open-application-menu", menu, x, y) as Promise<boolean>;
  },
  revealPath(filePath: string): Promise<boolean> {
    return ipcRenderer.invoke("pi:reveal-path", filePath) as Promise<boolean>;
  },
  openPath(filePath: string): Promise<boolean> {
    return ipcRenderer.invoke("pi:open-path", filePath) as Promise<boolean>;
  },
  setCompanionWindowVisible(visible: boolean): Promise<boolean> {
    return ipcRenderer.invoke("pi:companion-window-visible", visible) as Promise<boolean>;
  },
  setCompanionWindowAlwaysOnTop(alwaysOnTop: boolean): Promise<boolean> {
    return ipcRenderer.invoke("pi:companion-window-always-on-top", alwaysOnTop) as Promise<boolean>;
  },
  setCompanionWindowExpanded(expanded: boolean): Promise<boolean> {
    return ipcRenderer.invoke("pi:companion-window-expanded", expanded) as Promise<boolean>;
  },
  companionAction(action: "focus-main" | "open-settings" | "hide"): Promise<boolean> {
    return ipcRenderer.invoke("pi:companion-window-action", action) as Promise<boolean>;
  },
  setGlobalShortcut(enabled: boolean): Promise<boolean> {
    return ipcRenderer.invoke("pi:set-global-shortcut", enabled) as Promise<boolean>;
  },
  selectHarmonyRuntimePath(kind: "sdk" | "hdc"): Promise<string | null> {
    return ipcRenderer.invoke("pi:harmony-runtime-picker", kind) as Promise<string | null>;
  },
  browser: Object.freeze({
    getState() {
      return ipcRenderer.invoke("pi:browser-get-state");
    },
    action(input: unknown) {
      return ipcRenderer.invoke("pi:browser-action", input);
    },
    setViewport(bounds: { x: number; y: number; width: number; height: number }, visible: boolean) {
      return ipcRenderer.invoke("pi:browser-viewport", bounds, visible) as Promise<boolean>;
    },
    importChromeBookmarks() {
      return ipcRenderer.invoke("pi:browser-import-chrome-bookmarks");
    },
    onState(listener: (state: unknown) => void) {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
      ipcRenderer.on("pi:browser-state", handler);
      return () => ipcRenderer.removeListener("pi:browser-state", handler);
    },
    onDownload(listener: (download: unknown) => void) {
      const handler = (_event: Electron.IpcRendererEvent, download: unknown) => listener(download);
      ipcRenderer.on("pi:browser-download", handler);
      return () => ipcRenderer.removeListener("pi:browser-download", handler);
    },
  }),
  onMenuAction(listener: (action: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action === "string") listener(action);
    };
    ipcRenderer.on("pi:menu-action", handler);
    return () => ipcRenderer.removeListener("pi:menu-action", handler);
  },
});

// Keep the bridge intentionally small. Pi, filesystem, process execution, and
// credentials remain exclusively in the standalone server process.
contextBridge.exposeInMainWorld("piDesktop", runtime);
