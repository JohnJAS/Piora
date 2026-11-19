import { app, BrowserWindow, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Json } from "./cordis-extension-contract.js";

export interface PanelRequest {
  id: string;
  title: string;
  html?: string;
  community?: {
    package: string;
    version: string;
    source: string;
    slots: readonly string[];
    note: { en: string; zh: string };
    probe: boolean;
  };
  invoke: (method: string, input: unknown, signal: AbortSignal) => Promise<Json>;
}

const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";

export class CordisPanelWindows {
  private readonly windows = new Map<string, { window: BrowserWindow; cancel: AbortController; invoke: PanelRequest["invoke"] }>();
  private readonly writes = new Map<string, Set<Promise<Json>>>();
  private renderer: Promise<[string, string]> | undefined;

  constructor() {
    ipcMain.handle("pi:cordis-panel-call", (event, method: unknown, input: unknown) => {
      const panel = Array.from(this.windows.values()).find(panel => panel.window.webContents === event.sender);
      if (!panel || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith("data:text/html;base64,")
        || typeof method !== "string") throw new Error("Untrusted Cordis panel request");
      return panel.invoke(method, input, panel.cancel.signal);
    });
  }

  async open(panel: PanelRequest, signal?: AbortSignal): Promise<void> {
    const community = panel.community;
    const existing = this.windows.get(panel.id);
    if (existing && !existing.window.isDestroyed()) { existing.window.focus(); return; }
    const html = community ? await this.communityMarkup(community) : panel.html ?? "";
    signal?.throwIfAborted();
    const window = new BrowserWindow({
      width: community ? 920 : 580, height: community ? 720 : 420, title: panel.title, show: false, autoHideMenuBar: true,
      webPreferences: {
        sandbox: true, nodeIntegration: false, contextIsolation: true,
        backgroundThrottling: !community?.probe,
        partition: "piora-cordis-panel-" + panel.id, preload: join(__dirname, "cordis-panel-preload.js"),
      },
    });
    const cancel = new AbortController();
    let finish: ((error?: unknown) => void) | undefined;
    const ready = community ? new Promise<void>((resolve, reject) => {
      finish = error => { if (error) reject(error); else resolve(); };
    }) : undefined;
    const deadline = AbortSignal.any([cancel.signal, AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]);
    const stopWaiting = () => finish?.(deadline.reason);
    if (ready) {
      // Observe rejection even if loadURL is still settling.
      void ready.catch(() => {});
      deadline.addEventListener("abort", stopWaiting, { once: true });
    }
    this.windows.set(panel.id, { window, cancel, invoke: async (method, input, signal) => {
      if (community && method === "community.ready" && input === community.version) {
        finish?.();
        return null;
      }
      if (community && method === "community.failed") {
        finish?.(new Error(typeof input === "string" ? input.slice(0, 500) : "Could not render the community panel"));
        return null;
      }
      if (community && method === "community.storage.write") {
        if (community.probe) throw new Error("A health check cannot change extension data");
        // A user can close the window just after changing a preference. Let that save
        // finish before the host stops or the next version clones this data.
        const request = panel.invoke(method, input, AbortSignal.timeout(8_000));
        const writes = this.writes.get(panel.id) ?? new Set<Promise<Json>>();
        this.writes.set(panel.id, writes);
        writes.add(request);
        try { return await request; }
        finally {
          writes.delete(request);
          if (!writes.size) this.writes.delete(panel.id);
        }
      }
      return panel.invoke(method, input, signal);
    } });
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
      const body = html.replace(/^\s*<!doctype html>/i, "");
      const markup = "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">" + body;
      await Promise.all([
        window.loadURL("data:text/html;base64," + Buffer.from(markup).toString("base64")),
        ready,
      ]);
      if (!community?.probe && !window.isDestroyed()) window.show();
    } catch (error) {
      const closedDuringLoad = cancel.signal.aborted;
      if (!window.isDestroyed()) window.destroy();
      if (community?.probe || !closedDuringLoad) throw error;
    } finally {
      deadline.removeEventListener("abort", stopWaiting);
      if (community?.probe && !window.isDestroyed()) window.destroy();
    }
  }

  private async communityMarkup(panel: NonNullable<PanelRequest["community"]>): Promise<string> {
    this.renderer ??= Promise.all([
      readFile(join(__dirname, "cordis-community.js"), "utf8"),
      readFile(join(__dirname, "cordis-community.css"), "utf8"),
    ]).catch(error => { this.renderer = undefined; throw error; });
    const [script, css] = await this.renderer;
    const locale = app.getLocale().startsWith("zh") ? "zh" : "en";
    const config = JSON.stringify({
      package: panel.package, version: panel.version, source: panel.source, slots: panel.slots, probe: panel.probe, locale,
    }).replaceAll("<", "\\u003c");
    const note = panel.note[locale].replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    return `<style>${css}</style><p id="community-note">${note}</p><p id="community-error" role="alert" hidden></p>
      <main id="community-root"></main><script type="application/json" id="community-config">${config}</script>
      <script>${script}</script>`;
  }

  async close(id: string): Promise<void> {
    const panel = this.windows.get(id);
    if (panel && !panel.window.isDestroyed()) panel.window.destroy();
    await Promise.allSettled(this.writes.get(id) ?? []);
  }
}
