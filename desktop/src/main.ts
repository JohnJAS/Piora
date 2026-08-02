import { randomBytes } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  session as electronSession,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type Session,
} from "electron";
import {
  readPreferredServerPort,
  writePreferredServerPort,
} from "./desktop-state.js";
import { FileLogger, type Logger } from "./logger.js";
import { StandaloneServer, type ServerExit } from "./server-supervisor.js";

const DESKTOP_PARTITION = "persist:pigui";
const DESKTOP_TOKEN_HEADER = "X-Pi-Desktop-Token";
const COMPLETION_NOTIFICATION_CHANNEL = "pi:completion-notification";
const MAX_NOTIFICATION_TASK_TITLE_LENGTH = 80;
const PORTABLE_SMOKE_TEST = process.env.PI_GUI_SMOKE_TEST === "1"
  || process.argv.includes("--smoke-test");

const requestedSmokeUserData = process.env.PI_GUI_SMOKE_USER_DATA?.trim();
if (PORTABLE_SMOKE_TEST && requestedSmokeUserData) {
  app.setPath("userData", resolve(requestedSmokeUserData));
}

let mainWindow: BrowserWindow | null = null;
let logger: FileLogger | undefined;
let server: StandaloneServer | undefined;
let serverUrl: URL | undefined;
let shutdownPromise: Promise<void> | undefined;
let shutdownComplete = false;

function sanitizeNotificationTaskTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return Array.from(normalized).slice(0, MAX_NOTIFICATION_TASK_TITLE_LENGTH).join("");
}

function isTrustedCompletionNotificationSender(event: IpcMainInvokeEvent): boolean {
  if (!serverUrl || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    return false;
  }
  return isAllowedAppUrl(event.senderFrame.url, serverUrl.origin);
}

function getCompletionNotificationCopy(taskTitle: string | undefined): {
  title: string;
  body: string;
} {
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  return {
    title: taskTitle ? `${taskTitle} - piGUI` : "piGUI",
    body: isChinese
      ? "任务已完成，可以回到 piGUI 查看结果。"
      : "Task completed. Open piGUI to review the result.",
  };
}

function registerCompletionNotificationHandler(): void {
  ipcMain.removeHandler(COMPLETION_NOTIFICATION_CHANNEL);
  ipcMain.handle(
    COMPLETION_NOTIFICATION_CHANNEL,
    (event, requestedTaskTitle: unknown): boolean => {
      if (!isTrustedCompletionNotificationSender(event)) {
        logger?.warn("Blocked completion notification from an untrusted renderer");
        return false;
      }
      if (!Notification.isSupported()) return false;

      const copy = getCompletionNotificationCopy(
        sanitizeNotificationTaskTitle(requestedTaskTitle),
      );
      const notification = new Notification({ ...copy, silent: false });
      notification.on("click", () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      });
      notification.show();
      return true;
    },
  );
}

// Apply Chromium's sandbox to every renderer created by this application.
app.enableSandbox();

function sendMenuAction(action: string): void {
  mainWindow?.webContents.send("pi:menu-action", action);
}

function installApplicationMenu(): void {
  const editRoles: MenuItemConstructorOptions[] = [
    { role: "undo", label: "撤销" },
    { role: "redo", label: "重做" },
    { type: "separator" },
    { role: "cut", label: "剪切" },
    { role: "copy", label: "复制" },
    { role: "paste", label: "粘贴" },
    { role: "selectAll", label: "全选" },
  ];

  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "新对话", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new-session") },
        { label: "选择项目", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("choose-project") },
        { type: "separator" },
        { role: "close", label: "关闭窗口" },
        { role: "quit", label: "退出 piGUI" },
      ],
    },
    { label: "编辑", submenu: editRoles },
    {
      label: "视图",
      submenu: [
        { label: "显示/隐藏侧栏", accelerator: "CmdOrCtrl+Shift+B", click: () => sendMenuAction("toggle-sidebar") },
        { label: "显示/隐藏文件面板", accelerator: "CmdOrCtrl+Shift+E", click: () => sendMenuAction("toggle-files") },
        { type: "separator" },
        { label: "重新加载", role: "reload" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "切换全屏", role: "togglefullscreen" },
      ],
    },
    {
      label: "工具",
      submenu: [
        { label: "设置", accelerator: "CmdOrCtrl+,", click: () => sendMenuAction("settings") },
        { type: "separator" },
        { label: "模型设置", click: () => sendMenuAction("models") },
        { label: "技能管理", click: () => sendMenuAction("skills") },
        { label: "插件管理", click: () => sendMenuAction("plugins") },
        { type: "separator" },
        { label: "外观", click: () => sendMenuAction("appearance") },
        { label: "语言", click: () => sendMenuAction("language") },
        {
          label: "宠物",
          submenu: [
            { label: "显示/隐藏宠物", click: () => sendMenuAction("toggle-companion") },
            { label: "宠物设置", click: () => sendMenuAction("companion-settings") },
          ],
        },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "打开项目主页", click: () => shell.openExternal("https://github.com/kexijiang/pi-gui") },
        {
          label: "关于 piGUI",
          click: () => {
            const options: MessageBoxOptions = {
              type: "info",
              title: "关于 piGUI",
              message: `piGUI ${app.getVersion()}`,
              detail: "基于 Pi Agent 与 pi-web 的开源桌面应用。",
            };
            void (mainWindow
              ? dialog.showMessageBox(mainWindow, options)
              : dialog.showMessageBox(options));
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveConfiguredPath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function resolveStandaloneServerEntry(): string {
  const configuredEntry = process.env.PI_DESKTOP_SERVER_ENTRY?.trim();
  if (configuredEntry) {
    const resolvedEntry = resolveConfiguredPath(configuredEntry);
    if (!isFile(resolvedEntry)) {
      throw new Error(`PI_DESKTOP_SERVER_ENTRY is not a file: ${resolvedEntry}`);
    }
    return resolvedEntry;
  }

  const appPath = app.getAppPath();
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, "web", "server.js"),
        join(process.resourcesPath, "web", "server.cjs"),
      ]
    : [
        join(appPath, "..", ".next", "standalone", "server.js"),
        join(process.cwd(), ".next", "standalone", "server.js"),
        join(appPath, ".next", "standalone", "server.js"),
      ];

  const entry = candidates.find(isFile);
  if (entry) return entry;

  throw new Error(
    [
      "Next standalone output was not found.",
      "Create it in the release pipeline, or set PI_DESKTOP_SERVER_ENTRY to server.js.",
      `Checked: ${candidates.join(", ")}`,
    ].join(" "),
  );
}

function isAllowedAppUrl(rawUrl: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" && parsed.origin === allowedOrigin;
  } catch {
    return false;
  }
}

function openExternalUrl(rawUrl: string, log: Logger): void {
  try {
    const parsed = new URL(rawUrl);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.username
      || parsed.password
    ) {
      log.warn("Blocked unsupported external URL", { protocol: parsed.protocol });
      return;
    }

    void shell.openExternal(parsed.toString()).catch((error) => {
      log.warn("Unable to open external URL", error);
    });
  } catch (error) {
    log.warn("Blocked malformed external URL", error);
  }
}

function configureSession(runtimeSession: Session, origin: string, token: string): void {
  const isAllowedClipboardWrite = (permission: string, rawOrigin: string | undefined): boolean => {
    if (permission !== "clipboard-sanitized-write" || !rawOrigin) return false;
    try {
      return new URL(rawOrigin).origin === origin;
    } catch {
      return false;
    }
  };

  runtimeSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => (
      details.isMainFrame && isAllowedClipboardWrite(permission, requestingOrigin)
    ),
  );
  runtimeSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = "requestingUrl" in details ? details.requestingUrl : undefined;
    callback(details.isMainFrame && isAllowedClipboardWrite(permission, requestingUrl));
  });

  // The token never enters renderer JavaScript. Electron injects it only for
  // requests to this exact loopback origin; the server can enforce it through
  // PI_DESKTOP_TOKEN without exposing credentials to the page.
  runtimeSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://127.0.0.1/*"] },
    (details, callback) => {
      let isApplicationRequest = false;
      try {
        isApplicationRequest = new URL(details.url).origin === origin;
      } catch {
        // Leave malformed or non-application requests untouched.
      }

      if (isApplicationRequest) {
        details.requestHeaders[DESKTOP_TOKEN_HEADER] = token;
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

function createMainWindow(
  url: URL,
  log: Logger,
  { showWhenReady = true }: { showWhenReady?: boolean } = {},
): BrowserWindow {
  // On Windows we use a standard framed window (no `titleBarStyle: "hidden"`):
  // the OS title bar sits above the native menu bar (autoHideMenuBar: false
  // below), which sits above the in-app top bar. This keeps the always-visible
  // native menu from crowding the web top bar and removes the second, web-drawn
  // title row that `titleBarOverlay` produced. macOS keeps its frameless
  // `hiddenInset` look because its menu lives in the screen menu bar, not the
  // window chrome.
  const integratedTitleBar = process.platform === "darwin"
    ? { titleBarStyle: "hiddenInset" as const }
    : {};

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: "piGUI",
    backgroundColor: "#111318",
    // Show the native menu bar persistently on Windows/Linux so it is visible
    // without pressing Alt. All accelerators still work. Note this adds a
    // native menu row above the in-app top bar; if you prefer it hidden by
    // default, set this back to `true` (Alt reveals it).
    autoHideMenuBar: false,
    ...integratedTitleBar,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      partition: DESKTOP_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      devTools: !app.isPackaged || process.env.PI_DESKTOP_DEVTOOLS === "1",
    },
  });

  const allowedOrigin = url.origin;
  window.webContents.setWindowOpenHandler(({ url: requestedUrl }) => {
    if (!isAllowedAppUrl(requestedUrl, allowedOrigin)) {
      openExternalUrl(requestedUrl, log);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, requestedUrl) => {
    if (!isAllowedAppUrl(requestedUrl, allowedOrigin)) event.preventDefault();
  });

  window.webContents.on("will-redirect", (event, requestedUrl) => {
    if (!isAllowedAppUrl(requestedUrl, allowedOrigin)) event.preventDefault();
  });

  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, details) => {
    log.error("Renderer process exited", details);
  });
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame) {
        log.error("Application page failed to load", {
          errorCode,
          errorDescription,
          validatedUrl,
        });
      }
    },
  );

  if (showWhenReady) window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(url.toString());
  return window;
}

type SmokeRendererState = {
  readyState: string;
  rendererLoaded: boolean;
  preloadBridgeReady: boolean;
  appShellReady: boolean;
};

async function waitForSmokeRenderer(
  window: BrowserWindow,
  timeoutMs = 60_000,
): Promise<SmokeRendererState> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure: unknown;

  while (Date.now() < deadline) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      throw new Error("Portable smoke-test renderer exited before becoming ready.");
    }

    try {
      const state = await window.webContents.executeJavaScript(
        `(() => ({
          readyState: document.readyState,
          rendererLoaded: document.readyState === "complete",
          preloadBridgeReady: Boolean(
            window.piDesktop
            && typeof window.piDesktop.platform === "string"
            && typeof window.piDesktop.onMenuAction === "function"
          ),
          appShellReady: Boolean(document.querySelector(".app-shell")),
        }))()`,
        true,
      ) as SmokeRendererState;

      if (state.rendererLoaded && state.preloadBridgeReady && state.appShellReady) return state;
      lastFailure = new Error(
        `Renderer incomplete (readyState=${state.readyState}, preload=${state.preloadBridgeReady}, shell=${state.appShellReady}).`,
      );
    } catch (error) {
      lastFailure = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }

  throw new Error("Portable smoke-test renderer did not become ready in time.", {
    cause: lastFailure,
  });
}

function handleUnexpectedServerExit(exit: ServerExit): void {
  if (shutdownPromise || shutdownComplete) return;

  logger?.error("Web server stopped unexpectedly", exit);
  const options: MessageBoxOptions = {
    type: "error" as const,
    title: "piGUI",
    message: "The local piGUI service stopped unexpectedly.",
    ...(logger ? { detail: `See ${logger.filePath} for details.` } : {}),
  };

  const notification = mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
  void notification.finally(() => app.quit());
}

async function startApplication(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId("io.github.kexijiang.pigui");

  logger = new FileLogger(app.getPath("userData"));
  logger.info("Starting piGUI", {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
  });

  const serverEntry = resolveStandaloneServerEntry();
  const serverHostEntry = join(__dirname, "server-host.js");
  if (!existsSync(serverHostEntry)) {
    throw new Error(`Desktop server host was not found: ${serverHostEntry}`);
  }

  const token = randomBytes(32).toString("base64url");
  const preferredPort = readPreferredServerPort(app.getPath("userData"), logger);
  server = new StandaloneServer({
    serverEntry,
    serverHostEntry,
    homeDirectory: app.getPath("home"),
    token,
    logger,
    ...(preferredPort === undefined ? {} : { preferredPort }),
    onUnexpectedExit: handleUnexpectedServerExit,
  });

  serverUrl = await server.start();
  writePreferredServerPort(app.getPath("userData"), Number(serverUrl.port), logger);

  const runtimeSession = electronSession.fromPartition(DESKTOP_PARTITION, { cache: true });
  configureSession(runtimeSession, serverUrl.origin, token);
  registerCompletionNotificationHandler();

  if (PORTABLE_SMOKE_TEST) {
    const smokeMarker = process.env.PI_GUI_SMOKE_MARKER?.trim();
    if (!smokeMarker) {
      throw new Error("PI_GUI_SMOKE_MARKER is required in portable smoke-test mode.");
    }
    mainWindow = createMainWindow(serverUrl, logger, { showWhenReady: false });
    const rendererState = await waitForSmokeRenderer(mainWindow);
    writeFileSync(
      resolve(smokeMarker),
      `${JSON.stringify({
        schema: "pigui-portable-smoke-v1",
        ok: true,
        appVersion: app.getVersion(),
        rendererLoaded: rendererState.rendererLoaded,
        preloadBridgeReady: rendererState.preloadBridgeReady,
        appShellReady: rendererState.appShellReady,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    logger.info("Portable smoke test reached a healthy bundled service and renderer");
    await stopApplication();
    shutdownComplete = true;
    mainWindow.destroy();
    app.exit(0);
    return;
  }

  installApplicationMenu();

  mainWindow = createMainWindow(serverUrl, logger);
}

async function stopApplication(): Promise<void> {
  logger?.info("Stopping piGUI");
  await server?.stop();
  server = undefined;
  serverUrl = undefined;
  logger?.info("piGUI stopped");
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("activate", () => {
    if (!mainWindow && serverUrl && logger) {
      mainWindow = createMainWindow(serverUrl, logger);
    }
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();

    shutdownPromise ??= stopApplication()
      .catch((error) => logger?.error("Desktop shutdown failed", error))
      .finally(() => {
        shutdownComplete = true;
        app.quit();
      });
  });

  void startApplication().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error("Desktop startup failed", error);
    dialog.showErrorBox("piGUI could not start", message);
    await server?.stop().catch((shutdownError) => {
      logger?.error("Unable to stop the web server after a startup failure", shutdownError);
    });
    shutdownComplete = true;
    app.exit(1);
  });
}
