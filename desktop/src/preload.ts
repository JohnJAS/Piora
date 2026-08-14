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
  setCompanionWindowExpanded(expanded: boolean): Promise<boolean> {
    return ipcRenderer.invoke("pi:companion-window-expanded", expanded) as Promise<boolean>;
  },
  companionAction(action: "focus-main" | "open-settings" | "hide"): Promise<boolean> {
    return ipcRenderer.invoke("pi:companion-window-action", action) as Promise<boolean>;
  },
  setGlobalShortcut(enabled: boolean): Promise<boolean> {
    return ipcRenderer.invoke("pi:set-global-shortcut", enabled) as Promise<boolean>;
  },
  requestRuntimeProfileSwitch(profile?: "normal" | "device-control"): Promise<{
    accepted: boolean;
    profile: "normal" | "device-control";
    error?: string;
  }> {
    return ipcRenderer.invoke("pi:runtime-profile-switch", profile) as Promise<{
      accepted: boolean;
      profile: "normal" | "device-control";
      error?: string;
    }>;
  },
  selectHarmonyRuntimePath(kind: "sdk" | "hdc"): Promise<string | null> {
    return ipcRenderer.invoke("pi:harmony-runtime-picker", kind) as Promise<string | null>;
  },
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
