import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  session,
  shell,
  WebContentsView,
  type IpcMainInvokeEvent,
  type DownloadItem,
  type Event,
  type Rectangle,
  type Session,
  type WebContents,
} from "electron";
import type { Logger } from "./logger.js";

export const BROWSER_STATE_CHANNEL = "pi:browser-state";
export const BROWSER_DOWNLOAD_CHANNEL = "pi:browser-download";
export const BROWSER_GET_STATE_CHANNEL = "pi:browser-get-state";
export const BROWSER_ACTION_CHANNEL = "pi:browser-action";
export const BROWSER_VIEWPORT_CHANNEL = "pi:browser-viewport";
export const BROWSER_IMPORT_CHROME_BOOKMARKS_CHANNEL = "pi:browser-import-chrome-bookmarks";

const BROWSER_PARTITION = "persist:piora-browser";
const MAX_TABS = 20;
const MAX_BOOKMARKS = 5_000;

export interface DesktopBrowserState {
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  tabs: Array<{ id: string; title: string; url: string }>;
  title: string;
  url: string;
}

export interface ImportedChromeBookmark {
  folder: string;
  profile: string;
  title: string;
  url: string;
}

export interface ChromeBookmarkImportResult {
  bookmarks: ImportedChromeBookmark[];
  profiles: number;
}

export interface DesktopBrowserAction {
  action: "back" | "close_tab" | "forward" | "navigate" | "new_tab" | "reload" | "switch_tab";
  tabId?: string;
  url?: string;
}

export interface DesktopBrowserDownload {
  filename: string;
  path: string;
  percent: number;
  state: "cancelled" | "completed" | "interrupted" | "progressing";
}

type BrowserTab = {
  id: string;
  loading: boolean;
  title: string;
  view: WebContentsView;
};

type ChromeBookmarkNode = {
  children?: ChromeBookmarkNode[];
  name?: string;
  type?: string;
  url?: string;
};

function browserUrl(contentsUrl: string): string {
  return contentsUrl || "about:blank";
}

function isBrowserUrl(rawUrl: string): boolean {
  if (rawUrl === "about:blank") return true;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAddress(value: string): string {
  const input = value.trim();
  if (!input || input === "about:blank") return "about:blank";
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[\w.-]+(?::\d+)?(?:[/?#].*)?$/u.test(input) && (input.includes(".") || input.startsWith("localhost"))) {
    return `https://${input}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function validBounds(value: unknown, window: BrowserWindow): Rectangle | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Rectangle>;
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite)) return null;
  const content = window.getContentBounds();
  const x = Math.max(0, Math.round(candidate.x!));
  const y = Math.max(0, Math.round(candidate.y!));
  const width = Math.max(1, Math.min(Math.round(candidate.width!), content.width - x));
  const height = Math.max(1, Math.min(Math.round(candidate.height!), content.height - y));
  if (x >= content.width || y >= content.height) return null;
  return { x, y, width, height };
}

function chromeUserDataDirectory(): string | null {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    return localAppData ? join(localAppData, "Google", "Chrome", "User Data") : null;
  }
  if (process.platform === "darwin") {
    return join(app.getPath("home"), "Library", "Application Support", "Google", "Chrome");
  }
  return join(app.getPath("home"), ".config", "google-chrome");
}

function readChromeBookmarks(): ChromeBookmarkImportResult {
  const userData = chromeUserDataDirectory();
  if (!userData) return { bookmarks: [], profiles: 0 };

  let profileDirectories: string[];
  try {
    profileDirectories = readdirSync(userData, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name === "Default" || /^Profile \d+$/u.test(entry.name)))
      .map((entry) => entry.name);
  } catch {
    return { bookmarks: [], profiles: 0 };
  }

  const bookmarks: ImportedChromeBookmark[] = [];
  const seen = new Set<string>();
  let profiles = 0;

  const visit = (node: ChromeBookmarkNode, folders: string[], profile: string): void => {
    if (bookmarks.length >= MAX_BOOKMARKS) return;
    if (node.type === "url" && typeof node.url === "string" && isBrowserUrl(node.url)) {
      const title = typeof node.name === "string" && node.name.trim() ? node.name.trim() : node.url;
      const key = `${node.url}\n${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        bookmarks.push({ folder: folders.join(" / "), profile, title, url: node.url });
      }
      return;
    }
    const nextFolders = typeof node.name === "string" && node.name.trim()
      ? [...folders, node.name.trim()]
      : folders;
    for (const child of node.children ?? []) visit(child, nextFolders, profile);
  };

  for (const profile of profileDirectories) {
    try {
      const parsed = JSON.parse(readFileSync(join(userData, profile, "Bookmarks"), "utf8")) as {
        roots?: Record<string, ChromeBookmarkNode>;
      };
      if (!parsed.roots) continue;
      profiles += 1;
      for (const root of Object.values(parsed.roots)) visit(root, [], profile);
    } catch {
      // A missing, locked, or malformed profile does not block other profiles.
    }
  }
  return { bookmarks, profiles };
}

export class DesktopBrowserManager {
  private readonly tabs: BrowserTab[] = [];
  private activeTabId = "";
  private bounds: Rectangle | null = null;
  private requestedVisible = false;
  private nextTabId = 1;
  private readonly browserSession: Session;
  private destroyed = false;
  private readonly handleDownload = (_event: Event, item: DownloadItem, contents: WebContents): void => {
    if (!this.tabs.some((tab) => tab.view.webContents === contents)) return;
    const send = (state: DesktopBrowserDownload["state"]): void => {
      const total = item.getTotalBytes();
      const percent = total > 0 ? Math.round((item.getReceivedBytes() / total) * 100) : 0;
      this.sendDownload({
        filename: item.getFilename(),
        path: item.getSavePath(),
        percent: Math.max(0, Math.min(100, percent)),
        state,
      });
    };
    send("progressing");
    item.on("updated", (_downloadEvent, state) => send(state));
    item.once("done", (_downloadEvent, state) => send(state));
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly log: Logger,
    private readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  ) {
    this.browserSession = session.fromPartition(BROWSER_PARTITION, { cache: true });
    this.configureSession();
    this.createTab("about:blank", false);
    this.registerIpc();
    this.window.on("hide", () => this.updateVisibility(false));
    this.window.on("show", () => this.updateVisibility());
    this.window.on("closed", () => this.destroy());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.browserSession.off("will-download", this.handleDownload);
    for (const tab of this.tabs.splice(0)) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.removeIpc();
  }

  private configureSession(): void {
    this.browserSession.setDownloadPath(app.getPath("downloads"));
    this.browserSession.setPermissionCheckHandler(() => false);
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.browserSession.on("will-download", this.handleDownload);
  }

  private registerIpc(): void {
    this.removeIpc();
    ipcMain.handle(BROWSER_GET_STATE_CHANNEL, (event): DesktopBrowserState | null => {
      if (!this.isTrustedSender(event)) return null;
      return this.getState();
    });
    ipcMain.handle(BROWSER_VIEWPORT_CHANNEL, (event, rawBounds: unknown, visible: unknown): boolean => {
      if (!this.isTrustedSender(event)) return false;
      this.bounds = validBounds(rawBounds, this.window);
      this.requestedVisible = visible === true;
      this.updateVisibility();
      return Boolean(this.bounds);
    });
    ipcMain.handle(BROWSER_ACTION_CHANNEL, async (event, input: unknown): Promise<DesktopBrowserState | null> => {
      if (!this.isTrustedSender(event)) return null;
      await this.performAction(input);
      return this.getState();
    });
    ipcMain.handle(BROWSER_IMPORT_CHROME_BOOKMARKS_CHANNEL, (event): ChromeBookmarkImportResult | null => {
      if (!this.isTrustedSender(event)) return null;
      return readChromeBookmarks();
    });
  }

  private removeIpc(): void {
    ipcMain.removeHandler(BROWSER_GET_STATE_CHANNEL);
    ipcMain.removeHandler(BROWSER_VIEWPORT_CHANNEL);
    ipcMain.removeHandler(BROWSER_ACTION_CHANNEL);
    ipcMain.removeHandler(BROWSER_IMPORT_CHROME_BOOKMARKS_CHANNEL);
  }

  private createTab(rawUrl: string, activate = true): BrowserTab {
    if (this.tabs.length >= MAX_TABS) return this.activeTab() ?? this.tabs[0]!;
    const id = `tab-${this.nextTabId++}`;
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        devTools: !app.isPackaged || process.env.PI_DESKTOP_DEVTOOLS === "1",
      },
    });
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const tab: BrowserTab = { id, loading: false, title: "", view };
    this.tabs.push(tab);
    this.installTabEvents(tab);
    if (activate || !this.activeTabId) this.activeTabId = id;
    const targetUrl = normalizeAddress(rawUrl);
    if (targetUrl !== "about:blank") {
      void view.webContents.loadURL(targetUrl).catch((error) => {
        this.log.warn("Browser tab failed to load", error);
      });
    }
    this.updateVisibility();
    this.sendState();
    return tab;
  }

  private installTabEvents(tab: BrowserTab): void {
    const contents = tab.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (isBrowserUrl(url)) this.createTab(url);
      else void shell.openExternal(url).catch((error) => this.log.warn("Unable to open browser protocol", error));
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isBrowserUrl(url)) {
        event.preventDefault();
        void shell.openExternal(url).catch((error) => this.log.warn("Unable to open browser protocol", error));
      }
    });
    contents.on("page-title-updated", (_event, title) => {
      tab.title = title;
      this.sendState();
    });
    contents.on("did-start-loading", () => {
      tab.loading = true;
      this.sendState();
    });
    contents.on("did-stop-loading", () => {
      tab.loading = false;
      this.sendState();
    });
    contents.on("did-navigate", () => {
      this.updateVisibility();
      this.sendState();
    });
    contents.on("did-navigate-in-page", () => this.sendState());
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        this.log.warn("Browser navigation failed", { errorCode, errorDescription, validatedUrl });
      }
      tab.loading = false;
      this.sendState();
    });
    contents.on("context-menu", (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (params.linkURL && isBrowserUrl(params.linkURL)) {
        template.push({ label: "在新标签页中打开链接", click: () => this.createTab(params.linkURL) });
        template.push({ type: "separator" });
      }
      if (params.selectionText) template.push({ role: "copy", label: "复制" });
      if (params.isEditable) {
        template.push({ role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" });
      }
      if (template.length) template.push({ type: "separator" });
      template.push(
        { label: "后退", enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
        { label: "重新加载", click: () => contents.reload() },
      );
      Menu.buildFromTemplate(template).popup({ window: this.window });
    });
    contents.on("render-process-gone", (_event, details) => {
      this.log.warn("Browser tab renderer exited", details);
      tab.loading = false;
      this.sendState();
    });
  }

  private activeTab(): BrowserTab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeTabId);
  }

  private getState(): DesktopBrowserState {
    const active = this.activeTab() ?? this.tabs[0]!;
    const url = browserUrl(active.view.webContents.getURL());
    return {
      activeTabId: active.id,
      canGoBack: active.view.webContents.navigationHistory.canGoBack(),
      canGoForward: active.view.webContents.navigationHistory.canGoForward(),
      loading: active.loading,
      tabs: this.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: browserUrl(tab.view.webContents.getURL()),
      })),
      title: active.title,
      url,
    };
  }

  private sendState(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(BROWSER_STATE_CHANNEL, this.getState());
  }

  private sendDownload(download: DesktopBrowserDownload): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(BROWSER_DOWNLOAD_CHANNEL, download);
  }

  private updateVisibility(force?: boolean): void {
    const active = this.activeTab();
    const shouldShow = force ?? Boolean(
      this.requestedVisible
      && this.bounds
      && active
      && browserUrl(active.view.webContents.getURL()) !== "about:blank"
      && this.window.isVisible(),
    );
    for (const tab of this.tabs) {
      const visible = shouldShow && tab === active;
      if (visible && this.bounds) tab.view.setBounds(this.bounds);
      tab.view.setVisible(visible);
    }
  }

  private async performAction(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const input = value as DesktopBrowserAction;
    const active = this.activeTab();
    if (!active) return;
    if (input.action === "navigate" && typeof input.url === "string") {
      await active.view.webContents.loadURL(normalizeAddress(input.url));
    } else if (input.action === "back" && active.view.webContents.navigationHistory.canGoBack()) {
      active.view.webContents.navigationHistory.goBack();
    } else if (input.action === "forward" && active.view.webContents.navigationHistory.canGoForward()) {
      active.view.webContents.navigationHistory.goForward();
    } else if (input.action === "reload") {
      active.view.webContents.reload();
    } else if (input.action === "new_tab") {
      this.createTab(typeof input.url === "string" ? input.url : "about:blank");
    } else if (input.action === "switch_tab" && typeof input.tabId === "string" && this.tabs.some((tab) => tab.id === input.tabId)) {
      this.activeTabId = input.tabId;
      this.updateVisibility();
      this.sendState();
    } else if (input.action === "close_tab" && typeof input.tabId === "string") {
      this.closeTab(input.tabId);
    }
  }

  private closeTab(tabId: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    if (this.tabs.length === 1) {
      const tab = this.tabs[0]!;
      tab.title = "";
      tab.view.webContents.navigationHistory.clear();
      void tab.view.webContents.loadURL("about:blank");
      return;
    }
    const [tab] = this.tabs.splice(index, 1);
    if (!tab) return;
    this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[Math.min(index, this.tabs.length - 1)]!.id;
    }
    this.updateVisibility();
    this.sendState();
  }
}
