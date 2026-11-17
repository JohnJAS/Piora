import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loginEvidence, loginEvidenceAccepted, matchesLoginReturn, type LoginEvidence } from "./credential-sso.js";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  safeStorage,
  shell,
  WebContentsView,
  type IpcMainInvokeEvent,
  type DownloadItem,
  type Event,
  type Rectangle,
  type Session,
  type WebContents,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions,
} from "electron";
import { BrowserCookieStore } from "./browser-cookie-store.js";
import { BrowserPreferences, browserDownloadPath, browserFontPreferences, browserOrigin } from "./browser-preferences.js";
import { BrowserPermissions } from "./browser-permissions.js";
import { getCredentialVault } from "./credential-vault-ipc.js";
import { BROWSER_LOGIN_STATE_SCRIPT, readBrowserLoginState } from "./browser-login.js";
import { executePrivateLogin } from "./browser-login-executor.js";
import { credentialFillScript } from "./credential-fill.js";
import type { Logger } from "./logger.js";
import {
  NAVIGATION_TIMEOUT_MS,
  RENDERER_CRASHED_ERROR,
  formatNavigationToken,
  isNonFatalNavigationError,
  rejectAgentCreateAtCapacity,
} from "./browser-agent-logic.js";

export const BROWSER_STATE_CHANNEL = "pi:browser-state";
export const BROWSER_DOWNLOAD_CHANNEL = "pi:browser-download";
export const BROWSER_GET_STATE_CHANNEL = "pi:browser-get-state";
export const BROWSER_ACTION_CHANNEL = "pi:browser-action";
export const BROWSER_VIEWPORT_CHANNEL = "pi:browser-viewport";
export const BROWSER_IMPORT_CHROME_BOOKMARKS_CHANNEL = "pi:browser-import-chrome-bookmarks";
export const BROWSER_BOOKMARK_MENU_CHANNEL = "pi:browser-bookmark-menu";
export const BROWSER_AGENT_ACTIVITY_CHANNEL = "pi:browser-agent-activity";
export const BROWSER_AGENT_BACKEND_CHANNEL = "pi:browser-agent-backend";
export const BROWSER_AGENT_BACKEND_GET_CHANNEL = "pi:browser-get-agent-backend";
export const BROWSER_PREFERENCES_CHANNEL = "pi:browser-preferences";

export const BROWSER_PARTITION = "persist:piora-browser";
const MAX_TABS = 20;
const MANUAL_BROWSER_SESSION_ID = "__piora_browser_manual__";

export interface DesktopBrowserState {
  zoomFactor?: number;
  tabCount?: number;
  tabLimit?: number;
  idleTabCount?: number;
  vaultProtected?: boolean;
  vaultMatches?: number;
  loginNotice?: string;
  sessionId: string;
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  tabs: Array<{ id: string; title: string; url: string }>;
  title: string;
  url: string;
  agentTabId?: string | null;
  agentOperating?: boolean;
  agentWaiting?: boolean;
  agentWaitReason?: string;
  agentWaitPurpose?: "login" | "confirmation";
}

export interface ImportedChromeBookmark {
  id: string;
  type: "bookmark";
  title: string;
  url: string;
}

export interface ImportedChromeBookmarkFolder {
  children: ImportedChromeBookmarkNode[];
  id: string;
  title: string;
  type: "folder";
}

export type ImportedChromeBookmarkNode = ImportedChromeBookmark | ImportedChromeBookmarkFolder;

export interface ImportedChromeBookmarkProfile {
  children: ImportedChromeBookmarkNode[];
  id: string;
  title: string;
}

export interface ChromeBookmarkImportResult {
  bookmarkCount: number;
  profiles: ImportedChromeBookmarkProfile[];
}

export interface DesktopBrowserAction {
  action: "back" | "close_tab" | "close_idle_tabs" | "forward" | "navigate" | "new_tab" | "reload" | "set_session" | "switch_tab" | "configure_login" | "show_agent_tab" | "zoom_in" | "zoom_out" | "zoom_reset";
  sessionId?: string;
  tabId?: string;
  url?: string;
}

interface BrowserAgentBinding {
  replaceLoginTab(previous: string, replacement: string): void;
  heldTabs(): Array<{ id: string; bounds: { x: number; y: number; width: number; height: number } }>;
  afterVisibilityChange(): void;
  failAll(message: string): void;
  idleAll(): Promise<unknown> | void;
  destroy(): void;
  cancel(requestId: string): void;
  handleRequest(message: unknown): Promise<unknown>;
  agentTabId(sessionId: string): string | null;
  status(sessionId: string): { tabId: string | null; operating: boolean; waiting: boolean; reason?: string; purpose?: "login" | "confirmation" };
  noteUsed(tabId: string): void;
  idleTabIds(): string[];
  closeIdleTabs(): void;
  reclaimIdleTab(): void;
}

export interface DesktopBrowserDownload {
  filename: string;
  path: string;
  percent: number;
  state: "cancelled" | "completed" | "interrupted" | "progressing";
}

type BrowserTab = {
  loginEntryUrl?: string;
  loginParentTabId?: string;
  vaultProtected?: boolean;
  documentEpoch?: number;
  protectedDocumentEpoch?: number;
  releaseAfterNavigation?: boolean;
  loginNotice?: string;
  loginUsername?: { url: string; username: string; expires: number };
  automaticLoginKey?: string;
  initialLoad?: Promise<void>;
  authHost?: string;
  attached: boolean;
  discarding?: boolean;
  id: string;
  loading: boolean;
  navigationEpoch?: number;
  savedTitle?: string;
  savedUrl?: string;
  sessionId: string;
  title: string;
  unloaded?: boolean;
  view: WebContentsView;
  navigationWait?: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
};

type ChromeBookmarkNode = {
  children?: ChromeBookmarkNode[];
  id?: string;
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

function bookmarkMenuTemplate(value: unknown, select: (url: string) => void, depth = 0): MenuItemConstructorOptions[] {
  if (!Array.isArray(value) || value.length > 50_000 || depth > 100) throw new Error("Invalid bookmark menu");
  if (!value.length) return [{ label: "—", enabled: false }];
  return value.map((node) => {
    if (!node || typeof node.title !== "string") throw new Error("Invalid bookmark");
    const label = (node.title || node.url || "—").slice(0, 200).replace(/&/g, "&&");
    if (node.type === "folder") return { label, submenu: bookmarkMenuTemplate(node.children, select, depth + 1) };
    if (node.type !== "bookmark" || typeof node.url !== "string" || !isBrowserUrl(node.url)) throw new Error("Invalid bookmark URL");
    return { label, click: () => select(node.url) };
  });
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

function normalizeBrowserSessionId(value: unknown): string {
  if (typeof value !== "string") return MANUAL_BROWSER_SESSION_ID;
  const sessionId = value.trim();
  return sessionId && sessionId.length <= 512 ? sessionId : MANUAL_BROWSER_SESSION_ID;
}

function validBounds(value: unknown, window: BrowserWindow): Rectangle | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Rectangle>;
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite)) return null;
  if (candidate.width! <= 0 || candidate.height! <= 0) return null;
  const content = window.getContentBounds();
  // DOM rectangles use CSS pixels; native views use device-independent pixels.
  const zoom = window.webContents.getZoomFactor();
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  const x = Math.max(0, Math.ceil(candidate.x! * zoom));
  const y = Math.max(0, Math.ceil(candidate.y! * zoom));
  const right = Math.min(content.width, Math.floor((candidate.x! + candidate.width!) * zoom));
  const bottom = Math.min(content.height, Math.floor((candidate.y! + candidate.height!) * zoom));
  const width = right - x, height = bottom - y;
  if (width <= 0 || height <= 0) return null;
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
  if (!userData) return { bookmarkCount: 0, profiles: [] };

  let profileDirectories: string[];
  try {
    profileDirectories = readdirSync(userData, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name === "Default" || /^Profile \d+$/u.test(entry.name)))
      .map((entry) => entry.name);
  } catch {
    return { bookmarkCount: 0, profiles: [] };
  }

  const profiles: ImportedChromeBookmarkProfile[] = [];
  let bookmarkCount = 0;

  const convertNode = (node: ChromeBookmarkNode, fallbackId: string): ImportedChromeBookmarkNode | null => {
    const id = `${fallbackId}:${node.id?.trim() || "node"}`;
    const title = node.name?.trim() || (typeof node.url === "string" ? node.url : "Untitled");
    if (node.type === "url" && typeof node.url === "string" && node.url.trim()) {
      bookmarkCount += 1;
      return { id, type: "bookmark", title, url: node.url.trim() };
    }
    if (!Array.isArray(node.children)) return null;
    return {
      children: node.children.flatMap((child, index) => {
        const converted = convertNode(child, `${id}:${index}`);
        return converted ? [converted] : [];
      }),
      id,
      title,
      type: "folder",
    };
  };

  for (const profile of profileDirectories) {
    try {
      const parsed = JSON.parse(readFileSync(join(userData, profile, "Bookmarks"), "utf8")) as {
        roots?: Record<string, ChromeBookmarkNode>;
      };
      const bookmarkBar = parsed.roots?.bookmark_bar;
      if (!Array.isArray(bookmarkBar?.children)) continue;
      const children = bookmarkBar.children.flatMap((child, index) => {
        const converted = convertNode(child, `${profile}:bookmark_bar:${index}`);
        return converted ? [converted] : [];
      });
      profiles.push({ children, id: profile, title: profile });
    } catch {
      // A missing, locked, or malformed profile does not block other profiles.
    }
  }
  return { bookmarkCount, profiles };
}

export class DesktopBrowserManager {
  private readonly tabs: BrowserTab[] = [];
  private readonly activeTabIds = new Map<string, string>();
  private displayedSessionId = MANUAL_BROWSER_SESSION_ID;
  private bounds: Rectangle | null = null;
  private requestedVisible = false;
  private nextTabId = 1;
  private readonly browserSession: Session;
  private browserPermissions: BrowserPermissions | undefined;
  private readonly cookieStore: BrowserCookieStore;
  private readonly storageReady: Promise<void>;
  private destroyed = false;
  private agentControl: BrowserAgentBinding | null = null;
  private reportedAgentBackend: "desktop" | "playwright" | null = null;
  private storageFlushTimer: NodeJS.Timeout | undefined;
  private storageFlushChain: Promise<void> = Promise.resolve();
  private readonly preferences: BrowserPreferences;
  private defaultDownloadDirectory = "";
  private readonly downloadPaths = new Set<string>();
  private readonly handleCookieChanged = (): void => this.scheduleStorageFlush();
  private readonly handleDownload = (_event: Event, item: DownloadItem, contents: WebContents): void => {
    if (!this.tabs.some((tab) => tab.view.webContents === contents)) return;
    const preferences = this.preferences.downloads(this.defaultDownloadDirectory);
    let reserved: string | undefined;
    try {
      mkdirSync(preferences.effectiveDirectory, { recursive: true });
      const path = browserDownloadPath(preferences.effectiveDirectory, item.getFilename(), this.downloadPaths);
      if (preferences.askEachTime) item.setSaveDialogOptions({ defaultPath: path });
      else { reserved = path; this.downloadPaths.add(path); item.setSavePath(path); }
    } catch (error) {
      _event.preventDefault();
      this.log.warn("Unable to save browser download in the selected directory", error);
      this.sendDownload({ filename: item.getFilename(), path: "", percent: 0, state: "interrupted" });
      return;
    }
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
    item.once("done", (_downloadEvent, state) => { if (reserved) this.downloadPaths.delete(reserved); send(state); });
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly log: Logger,
    private readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
    private readonly startup: { agentDirectory?: () => string | undefined; credentialVault?: typeof getCredentialVault } = {},
  ) {
    this.browserSession = session.fromPartition(BROWSER_PARTITION, { cache: true });
    this.preferences = new BrowserPreferences(join(app.getPath("userData"), "browser-preferences.json"));
    this.cookieStore = new BrowserCookieStore(join(app.getPath("userData"), "browser-session-cookies.enc"), this.browserSession.cookies, safeStorage);
    this.storageReady = this.cookieStore.restore().catch(() => this.log.warn("Unable to restore browser session cookies"));
    this.configureSession();
    this.createTab("about:blank", false, MANUAL_BROWSER_SESSION_ID);
    this.registerIpc();
    this.window.on("hide", () => this.updateVisibility(false));
    this.window.on("show", () => this.updateVisibility());
    this.window.on("minimize", () => this.updateVisibility(false));
    this.window.on("restore", () => this.updateVisibility());
    this.window.on("closed", () => {
      void this.flushStorage().catch((error) => this.log.warn("Unable to persist browser state while closing", error));
      this.destroy();
    });
  }

  bindAgentControl(control: BrowserAgentBinding): void {
    this.agentControl?.destroy();
    this.agentControl = control;
  }

  handleAgentRequest(message: unknown): Promise<unknown> {
    if (!this.agentControl) return Promise.resolve({ type: "pi-desktop:browser-agent-response", requestId: "", ok: false, error: "Desktop browser bridge unavailable." });
    return this.agentControl.handleRequest(message);
  }

  cancelAgentRequest(requestId: string): void {
    this.agentControl?.cancel(requestId);
  }

  failAgentRequests(message: string): void {
    this.agentControl?.failAll(message);
    void this.agentControl?.idleAll();
  }

  setReportedAgentBackend(backend: "desktop" | "playwright"): void {
    this.reportedAgentBackend = backend;
    this.publishAgentBackend();
  }

  destroy(): void {
    for (const controller of this.loginControllers.values()) controller.abort();
    for (const timer of this.protectedWatchers.values()) clearInterval(timer);
    this.protectedWatchers.clear();
    for (const candidate of this.rememberedCandidates.values()) clearInterval(candidate.timer);
    this.rememberedCandidates.clear();
    if (this.destroyed) return;
    this.destroyed = true;
    this.agentControl?.failAll("Browser manager was closed");
    void this.agentControl?.idleAll();
    this.agentControl?.destroy();
    this.agentControl = null;
    if (this.storageFlushTimer) clearTimeout(this.storageFlushTimer);
    this.storageFlushTimer = undefined;
    void this.flushStorage().catch((error) => this.log.warn("Unable to persist browser state while closing", error));
    this.browserSession.off("will-download", this.handleDownload);
    this.browserSession.cookies.off("changed", this.handleCookieChanged);
    for (const tab of this.tabs.splice(0)) {
      this.settleNavigation(tab, new Error("Browser tab is closed."));
      // Discarded tabs retain their view record after Electron releases its contents.
      // Capture a live reference before detaching instead of reading the native getter again.
      const contents = this.liveContents(tab);
      if (tab.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
      tab.attached = false;
      if (contents && !contents.isDestroyed()) contents.close();
    }
    this.removeIpc();
  }

  flushStorage(): Promise<void> {
    this.browserSession.flushStorageData();
    this.storageFlushChain = this.storageFlushChain
      .catch(() => undefined)
      .then(async () => {
        await this.storageReady;
        await this.browserSession.cookies.flushStore();
        await this.cookieStore.save();
      });
    return this.storageFlushChain;
  }

  private scheduleStorageFlush(): void {
    if (this.destroyed) return;
    if (this.storageFlushTimer) return;
    this.storageFlushTimer = setTimeout(() => {
      this.storageFlushTimer = undefined;
      void this.flushStorage().catch((error) => this.log.warn("Unable to persist browser state", error));
    }, 600);
    this.storageFlushTimer.unref?.();
  }

  private configureSession(): void {
    this.browserSession.allowNTLMCredentialsForDomains(this.readLoginHosts().join(","));
    try {
      this.defaultDownloadDirectory = app.getPath("downloads");
      this.browserSession.setDownloadPath(this.defaultDownloadDirectory);
    } catch (error) {
      // Headless Windows profiles (including hosted release runners) may not
      // expose a shell Downloads folder. Browser setup is optional startup
      // hardening, so fall back to an app-owned directory instead of making
      // the entire desktop application fail before its renderer can mount.
      try {
        const fallbackDirectory = join(app.getPath("userData"), "Downloads");
        this.defaultDownloadDirectory = fallbackDirectory;
        mkdirSync(fallbackDirectory, { recursive: true });
        this.browserSession.setDownloadPath(fallbackDirectory);
        this.log.warn("System Downloads folder is unavailable; using Piora Downloads", error);
      } catch (fallbackError) {
        this.log.warn("Unable to configure the browser download directory", fallbackError);
      }
    }
    const customDirectory = this.preferences.downloads(this.defaultDownloadDirectory).directory;
    if (customDirectory) {
      try { mkdirSync(customDirectory, { recursive: true }); this.browserSession.setDownloadPath(customDirectory); }
      catch (error) { this.log.warn("Custom browser download directory is unavailable", error); }
    }
    this.browserPermissions = new BrowserPermissions(join(app.getPath("userData"), "browser-permissions.json"), {
      page: contents => {
        const tab = this.tabs.find(candidate => candidate.view.webContents === contents);
        if (!tab || tab.unloaded || contents.isDestroyed() || this.destroyed || this.window.isDestroyed()) return null;
        return { url: contents.getURL(), documentId: `${tab.id}:${tab.navigationEpoch ?? 0}`,
          visible: tab === this.activeTab() && tab.attached && this.requestedVisible && this.window.isVisible() && !this.window.isMinimized() };
      },
      prompt: async (origin, permissions) => {
        const answer = await dialog.showMessageBox(this.window, {
          type: "question", title: "网站权限", message: `${origin} 请求使用${permissions.join("、")}`,
          buttons: ["允许", "拒绝", "暂不决定"], defaultId: 2, cancelId: 2,
          checkboxLabel: "记住此站点的选择", checkboxChecked: true, noLink: true,
          detail: "可在浏览器登录菜单中重置此站点的网站权限。",
        });
        return { decision: answer.response === 2 ? null : answer.response === 0, remember: answer.checkboxChecked };
      },
      warn: error => this.log.warn("Unable to persist browser permissions", error),
    });
    this.browserPermissions.install(this.browserSession);
    this.browserSession.on("will-download", this.handleDownload);
    this.browserSession.cookies.on("changed", this.handleCookieChanged);
  }

  private registerIpc(): void {
    this.removeIpc();
    ipcMain.handle(BROWSER_PREFERENCES_CHANNEL, (event, input: unknown) => {
      if (!this.isTrustedSender(event)) throw new Error("Untrusted browser preferences request");
      if (input === undefined) return this.preferences.downloads(this.defaultDownloadDirectory);
      return this.preferences.updateDownloads(input, this.defaultDownloadDirectory, directory => this.browserSession.setDownloadPath(directory));
    });
    ipcMain.handle(BROWSER_GET_STATE_CHANNEL, (event): DesktopBrowserState | null => {
      if (!this.isTrustedSender(event)) return null;
      return this.getState();
    });
    ipcMain.handle(BROWSER_VIEWPORT_CHANNEL, (event, rawBounds: unknown, visible: unknown): boolean => {
      if (!this.isTrustedSender(event)) return false;
      // Windows reports a 0x0 content area while minimized. A late renderer
      // resize must not erase the last usable viewport before restore.
      if (!this.window.isMinimized()) this.bounds = validBounds(rawBounds, this.window);
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
    ipcMain.handle(BROWSER_AGENT_BACKEND_GET_CHANNEL, (event): "desktop" | "playwright" => {
      if (!this.isTrustedSender(event)) return "playwright";
      return this.resolvedAgentBackend();
    });
    ipcMain.handle(BROWSER_BOOKMARK_MENU_CHANNEL, (event, nodes: unknown, position: unknown): Promise<string | null> | null => {
      if (!this.isTrustedSender(event)) return null;
      const point = position as { x?: number; y?: number } | null;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Invalid bookmark menu position");
      const bounds = this.window.getContentBounds();
      const zoom = this.window.webContents.getZoomFactor();
      let selected: string | null = null;
      const menu = Menu.buildFromTemplate(bookmarkMenuTemplate(nodes, (url) => { selected = url; }));
      return new Promise((resolve) => menu.popup({
        window: this.window,
        x: Math.max(0, Math.min(bounds.width - 1, Math.round(point.x! * zoom))),
        y: Math.max(0, Math.min(bounds.height - 1, Math.round(point.y! * zoom))),
        callback: () => resolve(selected),
      }));
    });
  }

  private removeIpc(): void {
    ipcMain.removeHandler(BROWSER_PREFERENCES_CHANNEL);
    ipcMain.removeHandler(BROWSER_GET_STATE_CHANNEL);
    ipcMain.removeHandler(BROWSER_VIEWPORT_CHANNEL);
    ipcMain.removeHandler(BROWSER_ACTION_CHANNEL);
    ipcMain.removeHandler(BROWSER_IMPORT_CHROME_BOOKMARKS_CHANNEL);
    ipcMain.removeHandler(BROWSER_BOOKMARK_MENU_CHANNEL);
    ipcMain.removeHandler(BROWSER_AGENT_BACKEND_GET_CHANNEL);
  }

  private canCreateTab(): boolean {
    return this.tabs.length < MAX_TABS || (this.agentControl?.idleTabIds().length ?? 0) > 0;
  }

  private createTab(rawUrl: string, activate = true, sessionId = this.displayedSessionId, popupOptions?: BrowserWindowConstructorOptions & { webContents?: WebContents }, deferLoad = false): BrowserTab {
    if (this.tabs.length >= MAX_TABS) this.agentControl?.reclaimIdleTab();
    if (this.tabs.length >= MAX_TABS) {
      throw new Error(`The browser tab limit of ${MAX_TABS} has been reached.`);
    }
    const id = `tab-${this.nextTabId++}`;
    const view = this.createBrowserView(popupOptions);
    const tab: BrowserTab = { attached: false, id, loading: false, sessionId, title: "", view };
    this.installTabEvents(tab);
    this.tabs.push(tab);
    if (activate || !this.activeTabIds.has(sessionId)) this.activeTabIds.set(sessionId, id);
    const targetUrl = normalizeAddress(rawUrl);
    tab.loginEntryUrl = targetUrl;
    // Agent opens defer the load so the request can wait for did-stop-loading
    // instead of returning while the tab is still about:blank.
    if (!deferLoad && targetUrl !== "about:blank") {
      void this.storageReady.then(() => view.webContents.isDestroyed() ? undefined : view.webContents.loadURL(targetUrl)).catch((error) => {
        this.log.warn("Browser tab failed to load", error);
      });
    }
    this.updateVisibility();
    this.sendState();
    return tab;
  }

  private armNavigation(tab: BrowserTab): Promise<void> {
    this.settleNavigation(tab, new Error("Navigation was replaced."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settleNavigation(tab, new Error("Navigation timed out after 30 seconds."));
      }, NAVIGATION_TIMEOUT_MS);
      timer.unref?.();
      tab.navigationWait = { resolve, reject, timer };
    });
  }

  private noteMainFrameNavigation(tab: BrowserTab): void {
    tab.navigationEpoch = (tab.navigationEpoch ?? 0) + 1;
  }

  private settleNavigation(tab: BrowserTab, error?: Error): void {
    const wait = tab.navigationWait;
    if (!wait) return;
    delete tab.navigationWait;
    clearTimeout(wait.timer);
    if (error) wait.reject(error);
    else wait.resolve();
  }

  private async loadTabUrl(tab: BrowserTab, url: string): Promise<void> {
    if (url !== "about:blank") tab.loginEntryUrl = url;
    await this.storageReady;
    const contents = tab.view.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("Browser tab is closed.");
    const waited = this.armNavigation(tab);
    const loading = (async () => {
      try {
        await contents.loadURL(url);
      } catch (error) {
        if (!isNonFatalNavigationError(error)) {
          this.settleNavigation(tab, error instanceof Error ? error : new Error(String(error)));
        }
      }
    })();
    // Navigation events and the timeout can reject before loadURL settles.
    // Observe both promises immediately so that failure cannot terminate Node.
    await Promise.all([waited, loading]);
  }

  private async waitForHistoryNavigation(tab: BrowserTab, start: () => void): Promise<void> {
    const waited = this.armNavigation(tab);
    start();
    await waited;
  }

  private installTabEvents(tab: BrowserTab): void {
    const view = tab.view;
    const contents = view.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("Browser tab is closed.");
    contents.on("ipc-message-sync", (event, channel, value: unknown) => {
      if (channel !== "piora:credential-policy") return;
      event.returnValue = { allowed: false };
      if (event.senderFrame !== contents.mainFrame || tab.view.webContents !== contents) return;
      const url = (value as { url?: unknown } | null)?.url;
      if (typeof url !== "string") return;
      try {
        if (new URL(url).origin === new URL(event.senderFrame.url).origin) event.returnValue = { allowed: this.credentialVault().allowedUrl(url) };
      } catch { /* Invalid renderer input stays denied. */ }
    });
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
      const key = input.key.toLowerCase();
      if (!["+", "=", "-", "0"].includes(key)) return;
      event.preventDefault();
      this.changeZoom(tab, key === "0" ? "zoom_reset" : key === "-" ? "zoom_out" : "zoom_in");
    });
    contents.on("ipc-message", (event, channel, value: unknown) => {
      if (event.senderFrame !== contents.mainFrame) return;
      if (channel === "piora:login-capture-rejected") {
        const url = (value as { url?: unknown } | null)?.url;
        const reason = (value as { reason?: unknown } | null)?.reason;
        try { if (typeof url === "string" && new URL(url).origin === new URL(contents.getURL()).origin) {
          if (!this.credentialVault().allowedUrl(url)) this.setLoginNotice(tab, "http-blocked");
          else if (reason === "unsupported-form") this.setLoginNotice(tab, "unsupported-form");
        } } catch { /* Invalid notice. */ }
        return;
      }
      if (channel === "piora:login-form-ready") {
        void this.autoFillCredential(tab).catch(() => this.setLoginNotice(tab, "failed"));
        return;
      }
      if (channel === "piora:login-username") {
        if (this.loginRecoveries.has(tab.id)) return;
        const candidate = value as { url?: unknown; username?: unknown } | null;
        if (!this.credentialVault().rememberedStatus().enabled || typeof candidate?.url !== "string" || typeof candidate.username !== "string" || !candidate.username || candidate.username.length > 500) return;
        try { if (new URL(candidate.url).origin !== new URL(contents.getURL()).origin || !this.credentialVault().allowedUrl(candidate.url)) { this.setLoginNotice(tab, "http-blocked"); return; } } catch { return; }
        tab.loginUsername = { url: candidate.url, username: candidate.username, expires: Date.now() + 120_000 };
        return;
      }
      if (channel !== "piora:remember-login-candidate") return;
      if (this.loginRecoveries.has(tab.id)) return;
      if (!this.credentialVault().rememberedStatus().enabled || !value || typeof value !== "object") return;
      const candidate = value as { url?: unknown; username?: unknown; password?: unknown };
      if (typeof candidate.url !== "string" || typeof candidate.username !== "string" || typeof candidate.password !== "string" || candidate.username.length > 500 || candidate.password.length > 4096) return;
      try { if (new URL(candidate.url).origin !== new URL(event.senderFrame.url).origin || !this.credentialVault().allowedUrl(candidate.url)) { this.setLoginNotice(tab, "http-blocked"); return; } } catch { return; }
      const staged = tab.loginUsername;
      const sameFlow = staged && staged.expires > Date.now() && new URL(staged.url).origin === new URL(candidate.url).origin;
      const username = candidate.username || (sameFlow ? staged.username : "");
      if (!username || !candidate.password) return;
      const startUrl = sameFlow && staged.username === username ? staged.url : undefined;
      delete tab.loginUsername;
      this.protectCredentialTab(tab);
      this.setLoginNotice(tab, "save-pending");
      this.observeRememberedLogin(tab, { url: candidate.url, username, password: candidate.password, ...(startUrl ? { startUrl } : {}) });
    });
    contents.on("login", (_event, details, authInfo) => {
      if (authInfo.isProxy || !/^(ntlm|negotiate)$/i.test(authInfo.scheme)) return;
      try {
        const url = new URL(details.url);
        if (url.protocol === "https:" && url.hostname === authInfo.host) tab.authHost = url.hostname;
      } catch { /* Ignore malformed authentication challenges. */ }
      this.log.info("Browser integrated authentication requires site configuration", { host: tab.authHost, scheme: authInfo.scheme });
    });
    contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame) this.noteMainFrameNavigation(tab);
      if (isMainFrame && !isInPlace) delete tab.authHost;
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isBrowserUrl(url) && this.canCreateTab()) {
        return {
          action: "allow",
          createWindow: (options) => {
            const popup = this.createTab((options as { webContents?: WebContents }).webContents ? "about:blank" : url, true, tab.sessionId, options);
            popup.loginEntryUrl = tab.loginEntryUrl || contents.getURL();
            popup.loginParentTabId = tab.id;
            return popup.view.webContents;
          },
        };
      }
      if (!isBrowserUrl(url)) void shell.openExternal(url).catch((error) => this.log.warn("Unable to open browser protocol", error));
      return { action: "deny" };
    });
    contents.on("destroyed", () => {
      if (tab.view !== view) return;
      this.loginControllers.get(tab.id)?.abort();
      const candidate = this.rememberedCandidates.get(tab.id);
      const opener = tab.loginParentTabId ? this.findTab(tab.loginParentTabId) : undefined;
      if (!opener || opener.sessionId !== tab.sessionId || !this.liveContents(opener)) {
        if (candidate) clearInterval(candidate.timer);
        this.rememberedCandidates.delete(tab.id);
      }
      this.stopProtectedWatch(tab.id);
      if (tab.view === view) this.settleNavigation(tab, new Error("Browser tab is closed."));
      if (this.destroyed || tab.view !== view || tab.discarding) return;
      if (!this.tabs.includes(tab)) return;
      if (tab.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
      this.tabs.splice(this.tabs.indexOf(tab), 1);
      this.updateVisibility();
      this.sendState();
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
      this.settleNavigation(tab);
      this.scheduleStorageFlush();
      this.sendState();
      void this.autoFillCredential(tab).catch(() => this.setLoginNotice(tab, "failed"));
    });
    contents.on("did-navigate", () => {
      contents.setZoomLevel?.(this.preferences.zoomLevel(contents.getURL()));
      tab.documentEpoch = (tab.documentEpoch ?? 0) + 1;
      delete tab.automaticLoginKey;
      if (tab.releaseAfterNavigation) {
        tab.vaultProtected = false;
        delete tab.releaseAfterNavigation;
        delete tab.protectedDocumentEpoch;
      }
      this.noteMainFrameNavigation(tab);
      this.scheduleStorageFlush();
      this.updateVisibility();
      this.sendState();
    });
    contents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame === true) this.noteMainFrameNavigation(tab);
      this.scheduleStorageFlush();
      this.sendState();
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        this.log.warn("Browser navigation failed", { errorCode, errorDescription, validatedUrl });
        tab.loading = false;
        const failure = new Error(`Page failed to load (${errorCode}): ${errorDescription}`);
        (failure as Error & { errorCode: number }).errorCode = errorCode;
        this.settleNavigation(tab, failure);
        this.sendState();
        return;
      }
      tab.loading = false;
      this.sendState();
    });
    contents.on("context-menu", (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (params.linkURL && isBrowserUrl(params.linkURL)) {
        template.push({ label: "在新标签页中打开链接", enabled: this.canCreateTab(), click: () => {
          // A menu can stay open while another session consumes the final slot.
          if (this.canCreateTab()) this.createTab(params.linkURL, true, tab.sessionId);
        } });
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
      this.settleNavigation(tab, new Error(RENDERER_CRASHED_ERROR));
      this.sendState();
    });
  }

  private activeTab(sessionId = this.displayedSessionId): BrowserTab | undefined {
    const activeTabId = this.activeTabIds.get(sessionId);
    return this.tabs.find((tab) => tab.sessionId === sessionId && tab.id === activeTabId)
      ?? this.tabs.find((tab) => tab.sessionId === sessionId);
  }

  private ensureSession(sessionId: string): BrowserTab {
    return this.activeTab(sessionId) ?? this.createTab("about:blank", false, sessionId);
  }

  private getState(sessionId = this.displayedSessionId): DesktopBrowserState {
    const active = this.activeTab(sessionId);
    const contents = active ? this.liveContents(active) : undefined;
    const url = active ? this.tabUrl(active) : "about:blank";
    const agent = this.agentControl?.status(sessionId);
    return {
      sessionId,
      tabCount: this.tabs.length,
      tabLimit: MAX_TABS,
      idleTabCount: this.agentControl?.idleTabIds().length ?? 0,
      activeTabId: active?.id ?? "",
      canGoBack: contents ? contents.navigationHistory.canGoBack() : false,
      canGoForward: contents ? contents.navigationHistory.canGoForward() : false,
      loading: active?.loading ?? false,
      tabs: this.tabs.filter((tab) => tab.sessionId === sessionId).map((tab) => ({
        id: tab.id,
        title: this.tabTitle(tab),
        url: this.tabUrl(tab),
      })),
      title: active ? this.tabTitle(active) : "",
      url,
      zoomFactor: contents?.getZoomFactor?.() ?? 1,
      ...(agent ? {
        agentTabId: agent.tabId,
        agentOperating: agent.operating,
        agentWaiting: agent.waiting,
        ...(agent.waiting && agent.reason ? { agentWaitReason: agent.reason } : {}),
        ...(agent.waiting && agent.purpose ? { agentWaitPurpose: agent.purpose } : {}),
      } : {}),
      vaultProtected: Boolean(active?.vaultProtected),
      vaultMatches: this.credentialVault().candidates(url, false).length,
      ...(active?.loginNotice ? { loginNotice: active.loginNotice } : {}),
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
    if (this.destroyed || this.window.isDestroyed()) return;
    const active = this.activeTab(this.displayedSessionId);
    const shouldShow = force ?? Boolean(
      this.requestedVisible
      && this.bounds
      && active
      && !active.unloaded
      && this.tabUrl(active) !== "about:blank"
      && this.window.isVisible()
      && !this.window.isMinimized(),
    );
    const held = new Map((this.agentControl?.heldTabs() ?? []).map((entry) => [entry.id, entry.bounds]));
    let attachmentChanged = false;
    for (const tab of this.tabs) {
      if (tab.unloaded) {
        if (tab.attached && !this.window.isDestroyed()) {
          this.window.contentView.removeChildView(tab.view);
          tab.attached = false;
          attachmentChanged = true;
        }
        continue;
      }
      const visible = shouldShow && tab === active && tab.sessionId === this.displayedSessionId;
      const hold = !visible ? held.get(tab.id) : undefined;
      if (visible && this.bounds) {
        tab.view.setBounds(this.bounds);
        if (!tab.attached) {
          this.window.contentView.addChildView(tab.view);
          tab.attached = true;
          attachmentChanged = true;
        }
      } else if (hold) {
        // A hidden agent tab stays attached offscreen. Detached or 0x0 views
        // stop producing frames, so CDP input and capturePage would time out.
        tab.view.setBounds(hold);
        if (!tab.attached) {
          this.window.contentView.addChildView(tab.view);
          tab.attached = true;
          attachmentChanged = true;
        }
      }
      tab.view.setVisible(visible || Boolean(hold));
      if (!visible && !hold && tab.attached) {
        // Native Chromium surfaces (including cross-origin login frames) are
        // outside React/CSS clipping. Remove the entire view from the host,
        // but keep its WebContents alive so sign-in and navigation survive.
        this.window.contentView.removeChildView(tab.view);
        tab.attached = false;
        attachmentChanged = true;
      }
    }
    if (attachmentChanged) {
      this.log.info("Browser display attachment changed", {
        visible: Boolean(shouldShow),
        attachedViews: this.tabs.filter((tab) => tab.attached).length,
      });
    }
    this.agentControl?.afterVisibilityChange();
  }

  private async performAction(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const input = value as DesktopBrowserAction;
    if (input.action === "set_session") {
      this.displayedSessionId = normalizeBrowserSessionId(input.sessionId);
      if (this.tabs.length < MAX_TABS) this.ensureSession(this.displayedSessionId);
      this.updateVisibility();
      this.sendState();
      return;
    }
    if (input.action === "show_agent_tab") {
      const agentTabId = this.agentControl?.agentTabId(this.displayedSessionId);
      if (agentTabId && this.tabs.some((tab) => tab.id === agentTabId && tab.sessionId === this.displayedSessionId && !tab.unloaded)) {
        this.activeTabIds.set(this.displayedSessionId, agentTabId);
        this.agentControl?.noteUsed(agentTabId);
      }
      this.updateVisibility();
      this.sendState();
      return;
    }
    if (input.action === "close_idle_tabs") {
      this.agentControl?.closeIdleTabs();
      this.updateVisibility();
      this.sendState();
      return;
    }
    if (input.action === "close_tab" && typeof input.tabId === "string") {
      const closing = this.findTab(input.tabId);
      if (closing?.sessionId === this.displayedSessionId) this.abandonLogin(closing);
      this.closeTab(input.tabId, this.displayedSessionId, true);
      return;
    }
    if (input.action === "switch_tab" && typeof input.tabId === "string") {
      const tab = this.tabs.find(tab => tab.id === input.tabId && tab.sessionId === this.displayedSessionId);
      if (!tab) return;
      await this.restoreTab(tab.id);
      this.activeTabIds.set(this.displayedSessionId, tab.id);
      this.noteTabUsed(tab);
      this.updateVisibility();
      this.sendState();
      return;
    }
    const active = this.activeTab(this.displayedSessionId);
    if (!active) {
      if (input.action === "new_tab" || input.action === "navigate") this.noteTabUsed(this.createTab(typeof input.url === "string" ? input.url : "about:blank", true, this.displayedSessionId));
      return;
    }
    if (active.unloaded) await this.restoreTab(active.id);
    if (input.action === "zoom_in" || input.action === "zoom_out" || input.action === "zoom_reset") { this.changeZoom(active, input.action); return; }
    if (input.action === "configure_login") { this.showLoginMenu(active); return; }
    if (["navigate", "back", "forward", "reload"].includes(input.action)) this.abandonLogin(active);
    if (input.action === "navigate" && typeof input.url === "string") {
      await this.storageReady;
      active.loginEntryUrl = normalizeAddress(input.url);
      await active.view.webContents.loadURL(normalizeAddress(input.url));
      this.noteTabUsed(active);
    } else if (input.action === "back" && active.view.webContents.navigationHistory.canGoBack()) {
      active.view.webContents.navigationHistory.goBack();
      this.noteTabUsed(active);
    } else if (input.action === "forward" && active.view.webContents.navigationHistory.canGoForward()) {
      active.view.webContents.navigationHistory.goForward();
      this.noteTabUsed(active);
    } else if (input.action === "reload") {
      active.view.webContents.reload();
      this.noteTabUsed(active);
    } else if (input.action === "new_tab") {
      this.noteTabUsed(this.createTab(typeof input.url === "string" ? input.url : "about:blank", true, this.displayedSessionId));
    }
  }

  private changeZoom(tab: BrowserTab, action: "zoom_in" | "zoom_out" | "zoom_reset"): void {
    const contents = this.liveContents(tab);
    if (!contents || !browserOrigin(contents.getURL())) return;
    try {
      const current = this.preferences.zoomLevel(contents.getURL());
      const level = this.preferences.setZoomLevel(contents.getURL(), action === "zoom_reset" ? 0 : current + (action === "zoom_in" ? 0.5 : -0.5));
      for (const candidate of this.tabs) {
        const target = this.liveContents(candidate);
        if (target && browserOrigin(target.getURL()) === browserOrigin(contents.getURL())) target.setZoomLevel(level);
      }
      this.sendState();
    } catch (error) { this.log.warn("Unable to persist browser zoom", error); }
  }

  private readLoginHosts(): string[] {
    try {
      const value: unknown = JSON.parse(readFileSync(join(app.getPath("userData"), "browser-login-hosts.json"), "utf8"));
      return Array.isArray(value) ? [...new Set(value.filter((host): host is string => typeof host === "string" && /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)).map((host) => host.toLowerCase()))].slice(0, 100) : [];
    } catch { return []; }
  }

  private showLoginMenu(tab: BrowserTab): void {
    let host = tab.authHost;
    try { const url = new URL(tab.view.webContents.getURL()); if (!host && url.protocol === "https:") host = url.hostname; } catch { /* Blank page. */ }
    const hosts = this.readLoginHosts();
    const targetHost = host;
    const checked = Boolean(targetHost && hosts.includes(targetHost));
    const menu = Menu.buildFromTemplate([
      { label: "凭据库（设置 → 数据）", enabled: false },

      ...this.credentialVault().candidates(tab.view.webContents.getURL(), false).map(candidate => ({
        label: `填写：${candidate.name}`, enabled: !tab.vaultProtected,
        click: () => { void this.fillCredential(candidate.id, tab).catch(() => {}); },
      })),
      { label: "关闭填写页并恢复智能体", enabled: Boolean(tab.vaultProtected), click: () => { void this.releaseCredentials(); } },
      { label: "重置此站点的网站权限", enabled: Boolean(targetHost), click: () => { this.browserPermissions?.reset(tab.view.webContents.getURL()); } },
      { type: "separator" as const },
      { label: targetHost ?? "请先打开需要登录的网站", enabled: false },
      { label: "允许此站点使用 Windows 免密登录", type: "checkbox", checked, enabled: process.platform === "win32" && Boolean(targetHost), click: () => {
        if (!targetHost || tab.view.webContents.isDestroyed()) return;
        const latest = this.readLoginHosts();
        const next = checked ? latest.filter((value) => value !== targetHost) : [...new Set([...latest, targetHost])];
        try {
          const root = app.getPath("userData"); mkdirSync(root, { recursive: true });
          const file = join(root, "browser-login-hosts.json");
          writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 }); renameSync(`${file}.tmp`, file);
          this.browserSession.allowNTLMCredentialsForDomains(next.join(","));
          tab.view.webContents.reload();
        } catch (error) { this.log.warn("Unable to configure browser integrated authentication", error); }
      } },
      { type: "separator" },
      { label: "使用系统账户认证，仅对选中的域名生效", enabled: false },
      { label: "Chrome 的登录状态和企业插件不会自动共享", enabled: false },
    ]);
    menu.popup({ window: this.window });
  }

  private closeTab(tabId: string, sessionId: string, force = false): void {
    const sessionTabs = this.tabs.filter((tab) => tab.sessionId === sessionId);
    const index = this.tabs.findIndex((tab) => tab.id === tabId && tab.sessionId === sessionId);
    if (index < 0) return;
    if (sessionTabs.length === 1 && !force) {
      const tab = sessionTabs[0]!;
      if (!this.liveContents(tab)) return;
      tab.title = "";
      tab.savedUrl = "about:blank";
      tab.view.webContents.navigationHistory.clear();
      void tab.view.webContents.loadURL("about:blank");
      return;
    }
    const [tab] = this.tabs.splice(index, 1);
    if (!tab) return;
    if (tab.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    tab.attached = false;
    if (this.liveContents(tab)) tab.view.webContents.close();
    if (this.activeTabIds.get(sessionId) === tabId) {
      const remaining = this.tabs.filter((candidate) => candidate.sessionId === sessionId);
      const next = remaining[Math.min(Math.max(sessionTabs.indexOf(tab), 0), Math.max(0, remaining.length - 1))];
      if (next) this.activeTabIds.set(sessionId, next.id);
      else this.activeTabIds.delete(sessionId);
    }
    this.updateVisibility();
    this.sendState();
  }

  private createBrowserView(popupOptions?: BrowserWindowConstructorOptions & { webContents?: WebContents }): WebContentsView {
    const view = new WebContentsView({
      ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}),
      webPreferences: {
        ...popupOptions?.webPreferences,
        ...browserFontPreferences(),
        partition: BROWSER_PARTITION,
        preload: join(__dirname, "browser-login-preload.js"),
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
    return view;
  }

  private liveContents(tab: BrowserTab): WebContents | null {
    if (tab.unloaded) return null;
    try {
      const contents = tab.view.webContents;
      return contents && !contents.isDestroyed() ? contents : null;
    } catch {
      return null;
    }
  }

  private tabUrl(tab: BrowserTab): string {
    const contents = this.liveContents(tab);
    return contents ? browserUrl(contents.getURL()) : (tab.savedUrl || "about:blank");
  }

  private tabTitle(tab: BrowserTab): string {
    return this.liveContents(tab) ? tab.title : (tab.savedTitle || tab.title || "");
  }

  private noteTabUsed(tab: BrowserTab | undefined): void {
    if (tab) this.agentControl?.noteUsed(tab.id);
  }

  private findTab(tabId: string): BrowserTab | undefined {
    return this.tabs.find((tab) => tab.id === tabId);
  }

  private agentBrowserMode(): "builtin" | "background" {
    const directory = this.startup.agentDirectory?.();
    if (!directory) return "builtin";
    try {
      const parsed = JSON.parse(readFileSync(join(directory, "piora", "browser.json"), "utf8")) as { mode?: unknown };
      return parsed.mode === "background" ? "background" : "builtin";
    } catch {
      return "builtin";
    }
  }

  private resolvedAgentBackend(): "desktop" | "playwright" {
    if (this.agentBrowserMode() === "background") return "playwright";
    if (this.reportedAgentBackend === "playwright") return "playwright";
    return "desktop";
  }

  private publishAgentBackend(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(BROWSER_AGENT_BACKEND_CHANNEL, this.resolvedAgentBackend());
  }

  private requireLiveTab(tabId: string): BrowserTab {
    const tab = this.findTab(tabId);
    if (!tab || !this.liveContents(tab)) throw new Error("Browser tab is closed.");
    if (this.loginRecoveries.has(tabId)) throw new Error("Browser login recovery is in progress");
    if (tab.vaultProtected) throw new Error("Credential entry is private. Ask the user to finish login and close the protected tab.");
    return tab;
  }

  private setLoginNotice(tab: BrowserTab, notice: string): void {
    if (tab.loginNotice === notice) return;
    tab.loginNotice = notice;
    this.sendState();
  }

  private abandonLogin(tab: BrowserTab): void {
    for (const [id, pending] of this.rememberedCandidates) if (pending.parentTabId === tab.id) {
      clearInterval(pending.timer);
      this.rememberedCandidates.delete(id);
    }
    this.loginControllers.get(tab.id)?.abort();
    const candidate = this.rememberedCandidates.get(tab.id);
    if (candidate) clearInterval(candidate.timer);
    this.rememberedCandidates.delete(tab.id);
    this.stopProtectedWatch(tab.id);
    delete tab.loginUsername;
    delete tab.loginNotice;
    delete tab.automaticLoginKey;
    if (tab.vaultProtected) tab.releaseAfterNavigation = true;
  }

  private protectCredentialTab(tab: BrowserTab): void {
    tab.protectedDocumentEpoch = tab.documentEpoch ?? 0;
    tab.vaultProtected = true;
    if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach();
    this.sendState();
  }

  private rememberAccount(value: { url: string; username: string; password: string; startUrl?: string }): boolean {
    const store = this.credentialVault();
    store.rememberLogin(value);
    if (value.startUrl && value.startUrl !== value.url && new URL(value.startUrl).origin === new URL(value.url).origin) store.rememberLogin({ ...value, url: value.startUrl });
    return store.rememberedStatus().entries.some(item => item.url === value.url && item.enabled);
  }

  private readonly rememberedCandidates = new Map<string, { value: { url: string; username: string; password: string; startUrl?: string }; timer: ReturnType<typeof setInterval>; parentTabId?: string }>();
  private async loginCookieFingerprint(context: LoginEvidence): Promise<string | null> {
    if (context.rule?.evidence !== "cookie" || !context.rule.cookieName || !context.returnUrl) return null;
    try {
      const cookies = await this.browserSession.cookies.get({ url: context.returnUrl, name: context.rule.cookieName });
      // Only the explicitly configured cookie is inspected. Values never leave main.
      return cookies.length ? createHash("sha256").update(JSON.stringify(cookies.map(item => [item.domain, item.path, item.value]).sort())).digest("hex") : "";
    } catch { return null; }
  }
  private observeRememberedLogin(tab: BrowserTab, value: { url: string; username: string; password: string; startUrl?: string }): void {
    const previous = this.rememberedCandidates.get(tab.id);
    if (previous) clearInterval(previous.timer);
    const contents = tab.view.webContents;
    const context = loginEvidence(value.url, tab.loginEntryUrl, this.credentialVault().ssoRules?.() ?? []);
    const baselineCookie = this.loginCookieFingerprint(context);
    const parent = tab.loginParentTabId ? this.findTab(tab.loginParentTabId) : undefined;
    const parentEpoch = parent?.documentEpoch ?? 0;
    const deadline = Date.now() + 120_000;
    let busy = false;
    const timer = setInterval(() => {
      const parentLive = parent && parent.sessionId === tab.sessionId && !parent.view.webContents.isDestroyed();
      if ((contents.isDestroyed() && !parentLive) || Date.now() > deadline || !this.credentialVault().rememberedStatus().enabled || !this.credentialVault().allowedUrl(value.url)
        || (context.rule && !(this.credentialVault().ssoRules?.() ?? []).some(rule => JSON.stringify(rule) === JSON.stringify(context.rule)))) {
        clearInterval(timer); this.rememberedCandidates.delete(tab.id);
        if (!contents.isDestroyed()) this.setLoginNotice(tab, "unverified");
        return;
      }
      if (busy) return;
      busy = true;
      void (async () => {
        let observed = contents;
        // Only the recorded opener in this chat can complete a popup SSO flow,
        // and it must have navigated since password capture (no pre-existing avatar).
        if (context.returnUrl && parent && parent.sessionId === tab.sessionId && (parent.documentEpoch ?? 0) > parentEpoch && !parent.view.webContents.isDestroyed()
          && matchesLoginReturn(context.returnUrl, parent.view.webContents.getURL())) observed = parent.view.webContents;
        if (observed.isDestroyed()) return;
        const epoch = observed === contents ? tab.documentEpoch : parent?.documentEpoch;
        const raw = await observed.executeJavaScriptInIsolatedWorld(7332, [{ code: BROWSER_LOGIN_STATE_SCRIPT }]);
        const state = readBrowserLoginState(raw);
        if (this.rememberedCandidates.get(tab.id)?.timer !== timer) return;
        const beforeCookie = await baselineCookie;
        const afterCookie = context.rule?.evidence === "cookie" ? await this.loginCookieFingerprint(context) : null;
        if (this.rememberedCandidates.get(tab.id)?.timer !== timer || observed.isDestroyed() || epoch !== (observed === contents ? tab.documentEpoch : parent?.documentEpoch)) return;
        if (!this.credentialVault().rememberedStatus().enabled || !this.credentialVault().allowedUrl(value.url)
          || (context.rule && !(this.credentialVault().ssoRules?.() ?? []).some(rule => JSON.stringify(rule) === JSON.stringify(context.rule)))) return;
        const cookieChanged = beforeCookie !== null && Boolean(afterCookie) && beforeCookie !== afterCookie;
        // A redirect alone can also be a login error. Save only with a signed-in marker.
        if (state && loginEvidenceAccepted(value.url, context, state, cookieChanged)) {
          clearInterval(timer); this.rememberedCandidates.delete(tab.id);
          try { this.setLoginNotice(tab, this.rememberAccount(value) ? "saved" : "disabled"); }
          catch { this.setLoginNotice(tab, "save-failed"); }
          if (observed !== contents && parent) {
            this.setLoginNotice(parent, tab.loginNotice ?? "saved");
            this.agentControl?.replaceLoginTab(tab.id, parent.id);
            if (!contents.isDestroyed()) this.closeTab(tab.id, tab.sessionId, true);
          } else if (tab.vaultProtected) this.finishProtectedLogin(tab.id);
        } else if (state?.challenge) {
          this.setLoginNotice(tab, "challenge");
        } else if (state?.failed) {
          clearInterval(timer); this.rememberedCandidates.delete(tab.id);
          this.setLoginNotice(tab, "failed");
        } else if (state?.ready && context.returnUrl && !state.loginVisible && !matchesLoginReturn(context.returnUrl, state.url)) {
          this.setLoginNotice(tab, "return-mismatch");
        }
      })().catch(() => {}).finally(() => { busy = false; });
    }, 250);
    timer.unref?.();
    this.rememberedCandidates.set(tab.id, { value, timer, ...(parent ? { parentTabId: parent.id } : {}) });
  }
  private finishProtectedLogin(tabId: string, authenticated = false): string {
    this.stopProtectedWatch(tabId);
    const tab = this.findTab(tabId);
    const pending = this.rememberedCandidates.get(tabId);
    if (pending) {
      // The bound observer, including any explicit cookie evidence, owns saving.
      // A generic ready-page signal must not bypass its return-origin checks.
      void authenticated;
      return tabId;
    }
    if (!tab?.vaultProtected || tab.view.webContents.isDestroyed()) return tabId;
    // A committed full navigation discarded the credential document already.
    // Keep the resulting page, its history and sessionStorage instead of opening it again.
    if ((tab.documentEpoch ?? 0) > (tab.protectedDocumentEpoch ?? 0)) {
      tab.vaultProtected = false;
      delete tab.protectedDocumentEpoch;
      this.sendState();
      return tabId;
    }
    const url = tab.view.webContents.getURL();
    const notice = tab.loginNotice;
    this.closeTab(tab.id, tab.sessionId, true);
    const next = this.createTab(url, false, tab.sessionId);
    if (notice) next.loginNotice = notice;
    const replacement = next.id;
    this.agentControl?.replaceLoginTab(tabId, replacement);
    this.sendState();
    return replacement;
  }
  private readonly protectedWatchers = new Map<string, ReturnType<typeof setInterval>>();
  private stopProtectedWatch(tabId: string): void {
    const timer = this.protectedWatchers?.get(tabId);
    if (timer) clearInterval(timer);
    this.protectedWatchers?.delete(tabId);
  }
  private watchProtectedLogin(tab: BrowserTab): void {
    this.stopProtectedWatch(tab.id);
    const contents = tab.view.webContents;
    const deadline = Date.now() + 120_000;
    let busy = false;
    const timer = setInterval(() => {
      if (contents.isDestroyed() || !tab.vaultProtected || Date.now() > deadline) {
        this.stopProtectedWatch(tab.id); return;
      }
      if (busy) return;
      busy = true;
      void contents.executeJavaScriptInIsolatedWorld(7332, [{ code: BROWSER_LOGIN_STATE_SCRIPT }]).then(raw => {
        if (this.protectedWatchers.get(tab.id) !== timer) return;
        const state = readBrowserLoginState(raw);
        if (state?.ready && state.authenticated && !state.loginVisible && !state.challenge && !state.failed) {
          this.setLoginNotice(tab, "restored");
          this.finishProtectedLogin(tab.id, true);
        }
      }).catch(() => {}).finally(() => { busy = false; });
    }, 250);
    timer.unref?.();
    this.protectedWatchers.set(tab.id, timer);
  }
  private readonly loginControllers = new Map<string, AbortController>();
  private readonly originRecoveries = new Map<string, Promise<{ status: string; tabId: string }>>();
  private readonly loginRecoveries = new Map<string, Promise<{ status: string; tabId: string }>>();
  private recoverLogin(tabId: string, signal: AbortSignal): Promise<{ status: string; tabId: string }> {
    const pending = this.loginRecoveries.get(tabId);
    if (pending) {
      const controller = this.loginControllers.get(tabId);
      const abort = () => controller?.abort();
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      return pending.finally(() => signal.removeEventListener("abort", abort));
    }
    const tab = this.findTab(tabId);
    if (!tab || !this.liveContents(tab)) return Promise.resolve({ status: "needs-user", tabId });
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    this.loginControllers.set(tabId, controller);
    const initialUrl = tab.view.webContents.getURL();
    const origin = new URL(initialUrl).origin;
    const predecessor = this.originRecoveries.get(origin);
    const task = (async () => {
      if (predecessor) {
        const previous = await new Promise<{ status: string; tabId: string } | null>((resolve, reject) => {
          const cancel = () => { cleanup(); reject(new Error("Browser action aborted")); };
          const cleanup = () => controller.signal.removeEventListener("abort", cancel);
          if (controller.signal.aborted) { cancel(); return; }
          controller.signal.addEventListener("abort", cancel, { once: true });
          predecessor.then(value => { cleanup(); resolve(value); }, () => { cleanup(); resolve(null); });
        });
        if (controller.signal.aborted || tab.view.webContents.isDestroyed()) throw new Error("Browser action aborted");
        if (tab.view.webContents.getURL() !== initialUrl || tab.vaultProtected) return { status: "needs-user", tabId };
        // Retry only the login-page GET so this tab can consume the shared SSO cookies.
        if (previous?.status === "ready") {
          const state = readBrowserLoginState(await tab.view.webContents.executeJavaScriptInIsolatedWorld(7332, [{ code: BROWSER_LOGIN_STATE_SCRIPT }]));
          if (state?.loginVisible && !state.challenge && !tab.vaultProtected) await tab.view.webContents.loadURL(tab.view.webContents.getURL());
        }
      }
      if (controller.signal.aborted) throw new Error("Browser action aborted");
      return this.runLoginRecovery(tabId, controller.signal);
    })().finally(() => {
      signal.removeEventListener("abort", abort);
      this.loginRecoveries.delete(tabId);
      this.loginControllers.delete(tabId);
      if (this.originRecoveries.get(origin) === task) this.originRecoveries.delete(origin);
    });
    this.loginRecoveries.set(tabId, task);
    this.originRecoveries.set(origin, task);
    return task;
  }
  private async runLoginRecovery(tabId: string, signal: AbortSignal): Promise<{ status: string; tabId: string }> {
    const tab = this.findTab(tabId);
    if (!tab || tab.vaultProtected || tab.unloaded) return { status: "needs-user", tabId };
    const contents = tab.view.webContents;
    this.setLoginNotice(tab, "recovering");
    const result = await executePrivateLogin({
      execute: code => contents.executeJavaScriptInIsolatedWorld(7332, [{ code }]),
      protect: () => {
        this.protectCredentialTab(tab);
      },
    }, this.credentialVault(), signal);
    this.setLoginNotice(tab, result.status === "ready" ? "restored" : (result.reason ?? "unverified"));
    if (result.status === "ready" && result.protectedEntry) {
      return { status: result.status, tabId: this.finishProtectedLogin(tabId) };
    }
    if (result.protectedEntry) this.watchProtectedLogin(tab);
    return { status: result.status, tabId };
  }
  private async autoFillCredential(tab: BrowserTab): Promise<void> {
    if (tab.vaultProtected || !this.liveContents(tab) || this.loginRecoveries.has(tab.id)) return;
    const contents = tab.view.webContents;
    const state = readBrowserLoginState(await contents.executeJavaScriptInIsolatedWorld(7332, [{ code: BROWSER_LOGIN_STATE_SCRIPT }]).catch(() => null));
    if (!state?.ready || !state.loginVisible || tab.vaultProtected || this.loginRecoveries.has(tab.id)) return;
    const key = `${tab.documentEpoch ?? 0}:${state.url}:${state.loginStage ?? ""}:${Boolean(state.challenge)}`;
    if (tab.automaticLoginKey === key) return;
    tab.automaticLoginKey = key;
    if (state.challenge) { this.setLoginNotice(tab, "challenge"); return; }
    if (this.credentialVault().automaticCredential(state.url)) {
      await this.recoverLogin(tab.id, new AbortController().signal);
      return;
    }
    this.setLoginNotice(tab, "no-account");
    const matches = this.credentialVault().candidates(state.url, true);
    if (matches.length === 1) await this.fillCredential(matches[0]!.id, tab).catch(() => {});
  }

  async fillCredential(id: string, tab = this.activeTab(this.displayedSessionId)): Promise<void> {
    if (!tab || tab.unloaded || tab.vaultProtected || tab.view.webContents.isDestroyed()) throw new Error("No eligible login tab");
    const contents = tab.view.webContents;
    const store = this.credentialVault();
    let credential = store.credential(id, contents.getURL());
    const eligible = await contents.executeJavaScriptInIsolatedWorld(7332, [{ code: credentialFillScript(credential.url, "", "", true, false, false, store.allowedOrigins()) }]);
    if (eligible !== true || tab.vaultProtected) throw new Error("No eligible login form");
    credential = store.credential(id, contents.getURL());
    // Block both new operations and results from operations already in flight.
    // Remain protected across redirects and SPA navigation: pages may copy field values.
    this.protectCredentialTab(tab);
    try {
      if (!store.allowedUrl(credential.url)) throw new Error("Credential policy changed");
      const filled = await contents.executeJavaScriptInIsolatedWorld(7332, [{ code: credentialFillScript(credential.url, credential.username, credential.password, false, false, false, store.allowedOrigins()) }]);
      if (filled !== true) throw new Error("No eligible login form");
      store.record(id, credential.url);
    } catch { throw new Error("Credential fill not completed; close the protected tab to resume."); }
  }

  private credentialVault() { return this.startup.credentialVault?.() ?? getCredentialVault(); }

  refreshCredentialState(): void {
    this.sendState();
    const tab = this.activeTab(this.displayedSessionId);
    if (tab) { delete tab.automaticLoginKey; void this.autoFillCredential(tab).catch(() => this.setLoginNotice(tab, "failed")); }
  }

  async releaseCredentials(): Promise<void> {
    const sessionId = this.displayedSessionId;
    for (const tab of [...this.tabs]) if (tab.sessionId === sessionId && tab.vaultProtected) {
      this.abandonLogin(tab);
      this.closeTab(tab.id, sessionId, true);
    }
    this.updateVisibility();
    this.sendState();
  }

  private async credentialGuardedRead<T>(tabId: string, read: (contents: WebContents) => Promise<T>): Promise<T> {
    const tab = this.requireLiveTab(tabId);
    try { return await read(tab.view.webContents); }
    finally { this.requireLiveTab(tabId); }
  }

  private async ensureTabReady(tabId: string): Promise<void> {
    const tab = this.requireLiveTab(tabId);
    if (tab.initialLoad) return tab.initialLoad;
    if (tab.view.webContents.getURL()) return;
    // A new WebContentsView has no committed document. Sending CDP emulation
    // commands before its first load can crash the native Electron process.
    const pending = this.loadTabUrl(tab, "about:blank");
    tab.initialLoad = pending;
    try {
      await pending;
    } finally {
      if (tab.initialLoad === pending) delete tab.initialLoad;
    }
  }

  private tabState(tab: BrowserTab) {
    return {
      id: tab.id,
      sessionId: tab.sessionId,
      webContentsId: this.liveContents(tab)?.id ?? -1,
      closed: false,
      url: tab.vaultProtected ? "about:blank" : this.tabUrl(tab),
      title: tab.vaultProtected ? "Private credential entry" : this.tabTitle(tab),
      unloaded: Boolean(tab.unloaded),
      vaultProtected: Boolean(tab.vaultProtected),
    };
  }

  private discardTab(tabId: string): void {
    const tab = this.findTab(tabId);
    if (!tab || tab.unloaded) return;
    const contents = tab.view.webContents;
    if (contents && !contents.isDestroyed()) {
      tab.savedUrl = browserUrl(contents.getURL());
      tab.savedTitle = tab.title;
    }
    tab.unloaded = true;
    tab.discarding = true;
    if (tab.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    tab.attached = false;
    if (contents && !contents.isDestroyed()) contents.close();
  }

  private async restoreTab(tabId: string): Promise<void> {
    const tab = this.findTab(tabId);
    if (!tab || !tab.unloaded) return;
    const url = tab.savedUrl && tab.savedUrl !== "about:blank" ? tab.savedUrl : "about:blank";
    const view = this.createBrowserView();
    tab.view = view;
    tab.unloaded = false;
    tab.discarding = false;
    tab.attached = false;
    tab.loading = url !== "about:blank";
    this.installTabEvents(tab);
    if (url === "about:blank") return;
    await this.loadTabUrl(tab, url);
  }

  private showingTab(tabId: string): boolean {
    if (this.destroyed || this.window.isDestroyed()) return false;
    const active = this.activeTab(this.displayedSessionId);
    if (!active || active.id !== tabId || active.unloaded) return false;
    return Boolean(
      this.requestedVisible
      && this.bounds
      && this.tabUrl(active) !== "about:blank"
      && this.window.isVisible()
      && !this.window.isMinimized(),
    );
  }

  createAgentHost() {
    return {
      mainWebContentsId: this.window.webContents.id,
      now: () => Date.now(),
      platform: process.platform,
      log: this.log,
      listTabs: () => this.tabs.map((tab) => this.tabState(tab)),
      ensureReady: (tabId: string) => this.ensureTabReady(tabId),
      createTab: (sessionId: string, url: string) => {
        if (this.tabs.length >= MAX_TABS) this.agentControl?.reclaimIdleTab();
        rejectAgentCreateAtCapacity(this.tabs.length, MAX_TABS);
        return this.tabState(this.createTab(url, false, sessionId, undefined, true));
      },
      closeTab: (tabId: string) => {
        const tab = this.findTab(tabId);
        if (tab) this.closeTab(tabId, tab.sessionId, true);
      },
      loadURL: (tabId: string, url: string) => this.loadTabUrl(this.requireLiveTab(tabId), url),
      goBack: async (tabId: string) => {
        const tab = this.requireLiveTab(tabId);
        if (!tab.view.webContents.navigationHistory.canGoBack()) return;
        await this.waitForHistoryNavigation(tab, () => tab.view.webContents.navigationHistory.goBack());
      },
      goForward: async (tabId: string) => {
        const tab = this.requireLiveTab(tabId);
        if (!tab.view.webContents.navigationHistory.canGoForward()) return;
        await this.waitForHistoryNavigation(tab, () => tab.view.webContents.navigationHistory.goForward());
      },
      reload: async (tabId: string) => {
        const tab = this.requireLiveTab(tabId);
        await this.waitForHistoryNavigation(tab, () => tab.view.webContents.reload());
      },
      discardTab: (tabId: string) => this.discardTab(tabId),
      restoreTab: (tabId: string) => this.restoreTab(tabId),
      isShowing: (tabId: string) => this.showingTab(tabId),
      panelBounds: () => (this.bounds ? { ...this.bounds } : null),
      setBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) => {
        const tab = this.findTab(tabId);
        if (!tab || tab.unloaded) return;
        tab.view.setBounds(bounds);
      },
      attach: (tabId: string) => {
        const tab = this.findTab(tabId);
        if (!tab || tab.unloaded || this.destroyed || this.window.isDestroyed() || tab.attached) return;
        this.window.contentView.addChildView(tab.view);
        tab.attached = true;
      },
      detach: (tabId: string) => {
        const tab = this.findTab(tabId);
        if (!tab || !tab.attached || this.window.isDestroyed()) return;
        this.window.contentView.removeChildView(tab.view);
        tab.attached = false;
      },
      setBackgroundThrottling: (tabId: string, allowed: boolean) => {
        this.requireLiveTab(tabId).view.webContents.setBackgroundThrottling(allowed);
      },
      capturePage: async (tabId: string, options: { stayHidden: boolean; stayAwake: boolean }) => {
        const image = await this.credentialGuardedRead(tabId, contents => contents.capturePage(undefined, options));
        const png = image.toPNG();
        return { byteLength: png.length, base64: png.toString("base64") };
      },
      finishLogin: (tabId: string, authenticated?: boolean) => this.finishProtectedLogin(tabId, authenticated),
      recoverLogin: (tabId: string, signal: AbortSignal) => this.recoverLogin(tabId, signal),
      executeIsolated: (tabId: string, worldId: number, code: string) => {
        const tab = this.findTab(tabId);
        if (code === BROWSER_LOGIN_STATE_SCRIPT && tab?.vaultProtected && !tab.view.webContents.isDestroyed()) {
          return tab.view.webContents.executeJavaScriptInIsolatedWorld(worldId, [{ code }]);
        }
        return this.credentialGuardedRead(tabId, contents => contents.executeJavaScriptInIsolatedWorld(worldId, [{ code }]));
      },
      executeMain: (tabId: string, code: string) => (
        this.credentialGuardedRead(tabId, contents => contents.executeJavaScript(`globalThis.eval(${JSON.stringify(code)})`))
      ),
      navigationToken: (tabId: string) => {
        const tab = this.findTab(tabId);
        if (!tab) return formatNavigationToken(tabId, 0, "");
        return formatNavigationToken(tab.id, tab.navigationEpoch ?? 0, tab.vaultProtected ? "about:blank" : this.tabUrl(tab));
      },
      activateSessionTab: (sessionId: string, tabId: string) => {
        const tab = this.findTab(tabId);
        if (!tab || tab.sessionId !== sessionId || tab.unloaded) return;
        this.activeTabIds.set(sessionId, tabId);
        this.noteTabUsed(tab);
        this.updateVisibility();
        this.sendState();
      },
      debuggerAttach: (tabId: string, version: string) => {
        this.requireLiveTab(tabId).view.webContents.debugger.attach(version);
      },
      debuggerDetach: (tabId: string) => {
        const contents = this.requireLiveTab(tabId).view.webContents;
        if (contents.debugger.isAttached()) contents.debugger.detach();
      },
      debuggerIsAttached: (tabId: string) => {
        const tab = this.findTab(tabId);
        if (!tab || !this.liveContents(tab)) return false;
        return tab.view.webContents.debugger.isAttached();
      },
      debuggerSend: (tabId: string, method: string, params?: Record<string, unknown>) => (
        this.credentialGuardedRead(tabId, contents => contents.debugger.sendCommand(method, params))
      ),
      onTabEvent: (tabId: string, event: "render-process-gone" | "debugger-detach" | "destroyed", handler: (payload?: unknown) => void) => {
        const tab = this.findTab(tabId);
        if (!tab || tab.unloaded) return () => undefined;
        const contents = tab.view.webContents;
        if (event === "render-process-gone") {
          const listener = () => handler();
          contents.on("render-process-gone", listener);
          return () => { if (!contents.isDestroyed()) contents.off("render-process-gone", listener); };
        }
        if (event === "destroyed") {
          const listener = () => handler();
          contents.on("destroyed", listener);
          return () => { if (!contents.isDestroyed()) contents.off("destroyed", listener); };
        }
        const listener = (_ipcEvent: Event, reason: string) => {
          const closed = tab.unloaded || contents.isDestroyed() || /closed/i.test(reason);
          if (!closed && !tab.vaultProtected) {
            // DevTools takes the only debugger session. Reattach instead of
            // treating the tab as closed so the agent can continue.
            try {
              if (!contents.isDestroyed() && !contents.debugger.isAttached()) contents.debugger.attach("1.3");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (!/already attached/i.test(message)) this.log.warn("Browser agent debugger reattach failed", error);
            }
            return;
          }
          handler({ reason });
        };
        contents.debugger.on("detach", listener);
        return () => {
          try { contents.debugger.off("detach", listener); } catch { /* The tab is already gone. */ }
        };
      },
      pushActivity: (activity: { sessionId: string; tabId: string | null; operating: boolean; waiting?: boolean; reason?: string; purpose?: "login" | "confirmation" }) => {
        if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
        this.window.webContents.send(BROWSER_AGENT_ACTIVITY_CHANNEL, activity);
        this.sendState();
      },
    };
  }
}
