import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type { Json } from "./cordis-extension-contract.js";

interface PanelRequest {
  id: string;
  title: string;
  html: string;
  invoke: (method: string, input: unknown, signal: AbortSignal) => Promise<Json>;
}

const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";

export class CordisPanelWindows {
  private readonly windows = new Map<string, { window: BrowserWindow; cancel: AbortController; invoke: PanelRequest["invoke"] }>();

  constructor() {
    ipcMain.handle("pi:cordis-panel-call", (event, method: unknown, input: unknown) => {
      const panel = Array.from(this.windows.values()).find(panel => panel.window.webContents === event.sender);
      if (!panel || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith("data:text/html;base64,")
        || typeof method !== "string") throw new Error("Untrusted Cordis panel request");
      return panel.invoke(method, input, panel.cancel.signal);
    });
  }

  async open(panel: PanelRequest): Promise<void> {
    const existing = this.windows.get(panel.id);
    if (existing && !existing.window.isDestroyed()) { existing.window.focus(); return; }
    const window = new BrowserWindow({
      width: 580, height: 420, title: panel.title, show: false, autoHideMenuBar: true,
      webPreferences: {
        sandbox: true, nodeIntegration: false, contextIsolation: true,
        partition: "piora-cordis-panel-" + panel.id, preload: join(__dirname, "cordis-panel-preload.js"),
      },
    });
    const cancel = new AbortController();
    this.windows.set(panel.id, { window, cancel, invoke: panel.invoke });
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-frame-navigate", event => event.preventDefault());
    window.webContents.on("will-redirect", event => event.preventDefault());
    window.on("closed", () => {
      cancel.abort();
      if (this.windows.get(panel.id)?.window === window) this.windows.delete(panel.id);
    });
    try {
      const body = panel.html.replace(/^\s*<!doctype html>/i, "");
      const markup = "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">" + body;
      await window.loadURL("data:text/html;base64," + Buffer.from(markup).toString("base64"));
      if (!window.isDestroyed()) window.show();
    } catch (error) {
      const closedDuringLoad = cancel.signal.aborted;
      if (!window.isDestroyed()) window.destroy();
      if (!closedDuringLoad) throw error;
    }
  }

  close(id: string): void {
    const panel = this.windows.get(id);
    if (panel && !panel.window.isDestroyed()) panel.window.destroy();
  }
}
