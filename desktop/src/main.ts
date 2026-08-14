import { randomBytes } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  session as electronSession,
  shell,
  globalShortcut,
  Tray,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type Session,
} from "electron";
import {
  readCompanionWindowPosition,
  readMainWindowState,
  readPiAgentDirectory,
  readPreferredServerPort,
  runtimeProfileDataDirectory,
  writeCompanionWindowPosition,
  writeMainWindowState,
  writePiAgentDirectory,
  writePreferredServerPort,
  type RuntimeProfile,
} from "./desktop-state.js";
import { FileLogger, type Logger } from "./logger.js";
import { StandaloneServer, type ServerExit } from "./server-supervisor.js";
import { fitBoundsToVisibleDisplays } from "./window-bounds.js";
import { directoryHasData, migratePiDataDirectory } from "./pi-data-migration.js";

const DESKTOP_PARTITION = "persist:piora";
const DESKTOP_TOKEN_HEADER = "X-Pi-Desktop-Token";
const COMPLETION_NOTIFICATION_CHANNEL = "pi:completion-notification";
const APPLICATION_MENU_CHANNEL = "pi:open-application-menu";
const REVEAL_PATH_CHANNEL = "pi:reveal-path";
const OPEN_PATH_CHANNEL = "pi:open-path";
const COMPANION_VISIBILITY_CHANNEL = "pi:companion-window-visible";
const COMPANION_ACTION_CHANNEL = "pi:companion-window-action";
const COMPANION_LAYOUT_CHANNEL = "pi:companion-window-expanded";
const GLOBAL_SHORTCUT_CHANNEL = "pi:set-global-shortcut";
const RUNTIME_PROFILE_SWITCH_CHANNEL = "pi:runtime-profile-switch";
const HARMONY_RUNTIME_PICKER_CHANNEL = "pi:harmony-runtime-picker";
const DESKTOP_TITLE_BAR_HEIGHT = 40;
const COMPANION_COMPACT_WIDTH = 156;
const COMPANION_COMPACT_HEIGHT = 184;
const COMPANION_EXPANDED_WIDTH = 236;
const COMPANION_EXPANDED_HEIGHT = 360;
const MAX_NOTIFICATION_TASK_TITLE_LENGTH = 80;
const PORTABLE_SMOKE_TEST = process.env.PIORA_SMOKE_TEST === "1"
  || process.argv.includes("--smoke-test");
const STARTUP_SHELL_BACKGROUND = "#111318";
const PI_AGENT_DIRECTORY_ENV = "PI_CODING_AGENT_DIR";

const requestedSmokeUserData = process.env.PIORA_SMOKE_USER_DATA?.trim();
const requestedCompanionUiTestUserData = process.env.PIORA_COMPANION_UI_TEST === "1"
  ? process.env.PIORA_COMPANION_UI_TEST_USER_DATA?.trim()
  : undefined;
if (PORTABLE_SMOKE_TEST && requestedSmokeUserData) {
  app.setPath("userData", resolve(requestedSmokeUserData));
} else if (requestedCompanionUiTestUserData) {
  // Packaged companion E2E checks run beside an already-open user instance.
  // An explicit test-only profile keeps the instance lock, state, and storage
  // completely isolated from the user's real Piora data.
  app.setPath("userData", resolve(requestedCompanionUiTestUserData));
} else {
  // The on-disk profile directory follows the product name (Piora). It is set
  // explicitly so it stays stable and independent of Electron's derived app name.
  app.setPath("userData", join(app.getPath("appData"), "Piora"));
}

let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let logger: FileLogger | undefined;
let server: StandaloneServer | undefined;
let serverUrl: URL | undefined;
let shutdownPromise: Promise<void> | undefined;
let shutdownComplete = false;
let applicationMenu: Menu | null = null;
let companionMoveTimer: NodeJS.Timeout | undefined;
let companionShouldBeVisible = false;
let mainWindowStateTimer: NodeJS.Timeout | undefined;
let tray: Tray | null = null;
let trayPollTimer: NodeJS.Timeout | undefined;
let applicationToken: string | undefined;
let runningTaskCount = 0;
let quitRequested = false;
let currentRuntimeProfile: RuntimeProfile = "normal";
let serverEntryPath: string | undefined;
let serverHostEntryPath: string | undefined;
let piAgentDirectoryPath: string | undefined;
let runtimeProfileSwitchPromise: Promise<{ accepted: boolean; profile: RuntimeProfile; error?: string }> | undefined;

function prepareWritableDirectory(directory: string): string {
  const resolvedDirectory = resolve(directory);
  mkdirSync(resolvedDirectory, { recursive: true });
  accessSync(resolvedDirectory, fsConstants.R_OK | fsConstants.W_OK);
  return resolvedDirectory;
}

async function choosePiAgentDirectory(log: Logger): Promise<string> {
  const configuredByEnvironment = process.env[PI_AGENT_DIRECTORY_ENV]?.trim();
  if (configuredByEnvironment) return prepareWritableDirectory(configuredByEnvironment);

  const userDataDirectory = app.getPath("userData");
  const savedDirectory = readPiAgentDirectory(userDataDirectory, log);
  if (savedDirectory) {
    try {
      return prepareWritableDirectory(savedDirectory);
    } catch (error) {
      log.warn("Saved Pi data directory is unavailable; asking again", error);
    }
  }

  if (PORTABLE_SMOKE_TEST || requestedCompanionUiTestUserData) {
    return prepareWritableDirectory(join(app.getPath("home"), ".pi", "agent"));
  }

  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  const legacyDirectory = resolve(app.getPath("home"), ".pi", "agent");
  const hasLegacyData = directoryHasData(legacyDirectory);
  const selection = await dialog.showOpenDialog({
    title: isChinese ? "选择 Pi 数据存储目录" : "Choose Pi data storage directory",
    buttonLabel: isChinese ? "使用此目录" : "Use this folder",
    message: isChinese
      ? hasLegacyData
        ? "检测到现有 Pi 数据。选择新目录后，可将会话、登录信息、模型配置和技能迁移过去。"
        : "会话、登录信息、模型配置和技能都将保存在所选目录中。"
      : hasLegacyData
        ? "Existing Pi data was found. Sessions, credentials, model settings, and skills can be migrated to the selected folder."
        : "Sessions, credentials, model settings, and skills will be stored in the selected folder.",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory", "promptToCreate"],
  });

  if (!selection.canceled && selection.filePaths[0]) {
    try {
      const selectedDirectory = prepareWritableDirectory(selection.filePaths[0]);
      const usesLegacyDirectory = process.platform === "win32"
        ? selectedDirectory.toLowerCase() === legacyDirectory.toLowerCase()
        : selectedDirectory === legacyDirectory;
      if (hasLegacyData && !usesLegacyDirectory) {
        const migrationChoice = await dialog.showMessageBox({
          type: "question",
          title: "Piora",
          message: isChinese ? "是否迁移现有 Pi 数据？" : "Migrate your existing Pi data?",
          detail: isChinese
            ? `将从 ${legacyDirectory} 复制到 ${selectedDirectory}。迁移验证成功后，旧目录仍会保留作为备份。`
            : `Data will be copied from ${legacyDirectory} to ${selectedDirectory}. The old folder is retained as a backup after verification.`,
          buttons: isChinese
            ? ["迁移并使用新目录", "使用空的新目录", "重新选择"]
            : ["Migrate and use new folder", "Use empty new folder", "Choose again"],
          defaultId: 0,
          cancelId: 2,
        });
        if (migrationChoice.response === 2) return choosePiAgentDirectory(log);
        if (migrationChoice.response === 0) {
          const migrated = migratePiDataDirectory(legacyDirectory, selectedDirectory);
          log.info("Migrated existing Pi data", {
            source: legacyDirectory,
            destination: selectedDirectory,
            files: migrated.files,
            bytes: migrated.bytes,
          });
        }
      }
      writePiAgentDirectory(userDataDirectory, selectedDirectory, log);
      return selectedDirectory;
    } catch (error) {
      log.warn("Selected Pi data directory is not writable", error);
      await dialog.showMessageBox({
        type: "error",
        title: "Piora",
        message: isChinese ? "无法使用所选目录" : "The selected folder cannot be used",
        detail: isChinese ? "请确认该目录存在且具有读写权限。" : "Make sure the folder exists and is writable.",
      });
      return choosePiAgentDirectory(log);
    }
  }

  // Cancelling keeps the current default for this launch, but does not persist
  // it, so the chooser is offered again next time.
  return prepareWritableDirectory(join(app.getPath("home"), ".pi", "agent"));
}

type ApplicationMenuId = "file" | "edit" | "view" | "window" | "help";

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
    title: taskTitle ? `${taskTitle} - Piora` : "Piora",
    body: isChinese
      ? "任务已完成，可以回到 Piora 查看结果。"
      : "Task completed. Open Piora to review the result.",
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
      id: "app-menu-file",
      label: "文件",
      submenu: [
        { label: "新对话", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new-session") },
        { label: "选择项目", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("choose-project") },
        { type: "separator" },
        { label: "设置", accelerator: "CmdOrCtrl+,", click: () => sendMenuAction("settings") },
        { type: "separator" },
        { role: "quit", label: "退出 Piora" },
      ],
    },
    { id: "app-menu-edit", label: "编辑", submenu: editRoles },
    {
      id: "app-menu-view",
      label: "视图",
      submenu: [
        { label: "显示/隐藏侧栏", accelerator: "CmdOrCtrl+Shift+B", click: () => sendMenuAction("toggle-sidebar") },
        { label: "显示/隐藏文件面板", accelerator: "CmdOrCtrl+Shift+E", click: () => sendMenuAction("toggle-files") },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "切换全屏", role: "togglefullscreen" },
        { type: "separator" },
        { label: "重新加载", role: "reload" },
      ],
    },
    {
      id: "app-menu-window",
      label: "窗口",
      submenu: [
        { label: "显示/隐藏桌面宠物", click: () => sendMenuAction("toggle-companion") },
        { type: "separator" },
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭窗口" },
      ],
    },
    {
      id: "app-menu-help",
      label: "帮助",
      submenu: [
        { label: "打开项目主页", click: () => shell.openExternal("https://github.com/kexijiang/piora") },
        {
          label: "关于 Piora",
          click: () => {
            const options: MessageBoxOptions = {
              type: "info",
              title: "关于 Piora",
              message: `Piora ${app.getVersion()}`,
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

  applicationMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(applicationMenu);
}

function registerApplicationMenuPopupHandler(): void {
  ipcMain.removeHandler(APPLICATION_MENU_CHANNEL);
  ipcMain.handle(
    APPLICATION_MENU_CHANNEL,
    async (event, requestedMenu: unknown, requestedX: unknown, requestedY: unknown): Promise<boolean> => {
      if (
        !serverUrl
        || !event.senderFrame
        || event.senderFrame !== event.sender.mainFrame
        || !isAllowedAppUrl(event.senderFrame.url, serverUrl.origin)
      ) {
        logger?.warn("Blocked application menu request from an untrusted renderer");
        return false;
      }

      const allowedMenus: readonly ApplicationMenuId[] = ["file", "edit", "view", "window", "help"];
      if (typeof requestedMenu !== "string" || !allowedMenus.includes(requestedMenu as ApplicationMenuId)) {
        return false;
      }
      const window = mainWindow;
      const submenu = applicationMenu?.getMenuItemById(`app-menu-${requestedMenu}`)?.submenu;
      if (!window || window.isDestroyed() || !submenu) return false;

      const x = Number.isFinite(requestedX) ? Math.max(0, Math.round(requestedX as number)) : undefined;
      const y = Number.isFinite(requestedY) ? Math.max(0, Math.round(requestedY as number)) : DESKTOP_TITLE_BAR_HEIGHT;
      await new Promise<void>((resolvePopup) => {
        submenu.popup({ window, ...(x === undefined ? {} : { x }), y, callback: resolvePopup });
      });
      return true;
    },
  );
}

function isTrustedMainWindowSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    serverUrl
    && mainWindow
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame
    && event.senderFrame === event.sender.mainFrame
    && isAllowedAppUrl(event.senderFrame.url, serverUrl.origin),
  );
}

function isTrustedCompanionWindowSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    serverUrl
    && companionWindow
    && !companionWindow.isDestroyed()
    && event.sender === companionWindow.webContents
    && event.senderFrame
    && event.senderFrame === event.sender.mainFrame
    && isAllowedAppUrl(event.senderFrame.url, serverUrl.origin),
  );
}

function resolveExistingRendererPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) return null;
  const target = resolve(value);
  return existsSync(target) ? target : null;
}

function registerFileShellHandlers(): void {
  ipcMain.removeHandler(REVEAL_PATH_CHANNEL);
  ipcMain.removeHandler(OPEN_PATH_CHANNEL);

  ipcMain.handle(REVEAL_PATH_CHANNEL, async (event, requestedPath: unknown): Promise<boolean> => {
    if (!isTrustedMainWindowSender(event)) {
      logger?.warn("Blocked reveal-path request from an untrusted renderer");
      return false;
    }
    const target = resolveExistingRendererPath(requestedPath);
    if (!target) return false;
    try {
      if (statSync(target).isDirectory()) {
        return (await shell.openPath(target)) === "";
      }
      shell.showItemInFolder(target);
      return true;
    } catch (error) {
      logger?.warn("Unable to reveal local path", error);
      return false;
    }
  });

  ipcMain.handle(OPEN_PATH_CHANNEL, async (event, requestedPath: unknown): Promise<boolean> => {
    if (!isTrustedMainWindowSender(event)) {
      logger?.warn("Blocked open-path request from an untrusted renderer");
      return false;
    }
    const target = resolveExistingRendererPath(requestedPath);
    if (!target) return false;
    try {
      return (await shell.openPath(target)) === "";
    } catch (error) {
      logger?.warn("Unable to open local path", error);
      return false;
    }
  });
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
  const isAllowedOrigin = (rawOrigin: string | undefined): boolean => {
    if (!rawOrigin) return false;
    try {
      return new URL(rawOrigin).origin === origin;
    } catch {
      return false;
    }
  };

  runtimeSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      if (!details.isMainFrame || !isAllowedOrigin(requestingOrigin)) return false;
      if (permission === "clipboard-sanitized-write") return true;
      // Voice input only needs the headset microphone. Keep camera and any
      // unknown media permission denied by default.
      return permission === "media" && details.mediaType === "audio";
    },
  );
  runtimeSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = "requestingUrl" in details ? details.requestingUrl : undefined;
    const securityOrigin = "securityOrigin" in details ? details.securityOrigin : undefined;
    const rawOrigin = securityOrigin ?? requestingUrl;
    if (!details.isMainFrame || !isAllowedOrigin(rawOrigin)) {
      callback(false);
      return;
    }
    if (permission === "clipboard-sanitized-write") {
      callback(true);
      return;
    }
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    callback(
      permission === "media"
      && Boolean(mediaTypes?.length)
      && mediaTypes?.every((mediaType) => mediaType === "audio") === true,
    );
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

function getCompanionWindowPosition(): { x: number; y: number } {
  const saved = logger ? readCompanionWindowPosition(app.getPath("userData"), logger) : undefined;
  const display = saved
    ? screen.getDisplayNearestPoint(saved)
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const defaultX = area.x + area.width - COMPANION_EXPANDED_WIDTH - 24;
  const defaultY = area.y + area.height - COMPANION_EXPANDED_HEIGHT - 24;
  return {
    x: Math.min(Math.max(saved?.x ?? defaultX, area.x), area.x + Math.max(0, area.width - COMPANION_EXPANDED_WIDTH)),
    y: Math.min(Math.max(saved?.y ?? defaultY, area.y), area.y + Math.max(0, area.height - COMPANION_EXPANDED_HEIGHT)),
  };
}

function getNormalizedCompanionPosition(bounds: Electron.Rectangle): { x: number; y: number } {
  return {
    x: Math.round(bounds.x + (bounds.width - COMPANION_EXPANDED_WIDTH) / 2),
    y: Math.round(bounds.y + bounds.height - COMPANION_EXPANDED_HEIGHT),
  };
}

function setCompanionWindowExpanded(expanded: boolean): boolean {
  if (!companionWindow || companionWindow.isDestroyed()) return false;
  const width = expanded ? COMPANION_EXPANDED_WIDTH : COMPANION_COMPACT_WIDTH;
  const height = expanded ? COMPANION_EXPANDED_HEIGHT : COMPANION_COMPACT_HEIGHT;
  const current = companionWindow.getBounds();
  if (current.width === width && current.height === height) return true;

  const display = screen.getDisplayNearestPoint({
    x: current.x + Math.round(current.width / 2),
    y: current.y + current.height,
  });
  const area = display.workArea;
  const target = {
    x: Math.round(current.x + (current.width - width) / 2),
    y: current.y + current.height - height,
    width,
    height,
  };
  target.x = Math.min(Math.max(target.x, area.x), area.x + Math.max(0, area.width - width));
  target.y = Math.min(Math.max(target.y, area.y), area.y + Math.max(0, area.height - height));
  companionWindow.setBounds(target);
  return true;
}

function createCompanionWindow(url: URL, log: Logger): BrowserWindow {
  const position = getCompanionWindowPosition();
  const window = new BrowserWindow({
    ...position,
    width: COMPANION_EXPANDED_WIDTH,
    height: COMPANION_EXPANDED_HEIGHT,
    minWidth: COMPANION_COMPACT_WIDTH,
    minHeight: COMPANION_COMPACT_HEIGHT,
    maxWidth: COMPANION_EXPANDED_WIDTH,
    maxHeight: COMPANION_EXPANDED_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
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

  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, requestedUrl) => {
    if (!isAllowedAppUrl(requestedUrl, url.origin)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, requestedUrl) => {
    if (!isAllowedAppUrl(requestedUrl, url.origin)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("context-menu", () => {
    if (window.isDestroyed()) return;
    Menu.buildFromTemplate([
      { label: "打开 Piora", click: () => { focusMainWindow(); } },
      { label: "桌宠设置", click: () => { focusMainWindow("companion-settings"); } },
      { type: "separator" },
      {
        label: "隐藏桌宠",
        click: () => {
          closeCompanionWindow();
          mainWindow?.webContents.send("pi:menu-action", "hide-companion");
        },
      },
    ]).popup({ window });
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame) log.error("Companion page failed to load", { errorCode, errorDescription, validatedUrl });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    log.error("Companion renderer exited", details);
    if (companionWindow === window) {
      companionWindow = null;
      window.destroy();
    }
  });
  window.once("ready-to-show", () => {
    if (companionWindow === window && companionShouldBeVisible) window.showInactive();
  });
  window.on("move", () => {
    if (companionMoveTimer) clearTimeout(companionMoveTimer);
    companionMoveTimer = setTimeout(() => {
      if (!companionWindow || companionWindow.isDestroyed() || !logger) return;
      writeCompanionWindowPosition(
        app.getPath("userData"),
        getNormalizedCompanionPosition(companionWindow.getBounds()),
        logger,
      );
    }, 180);
  });
  window.on("closed", () => {
    if (companionMoveTimer) clearTimeout(companionMoveTimer);
    companionMoveTimer = undefined;
    if (companionWindow === window) companionWindow = null;
  });
  void window.loadURL(new URL("/desktop-pet", url).toString());
  return window;
}

function showCompanionWindow(): boolean {
  if (!serverUrl || !logger) return false;
  companionShouldBeVisible = true;
  if (!companionWindow || companionWindow.isDestroyed()) {
    companionWindow = createCompanionWindow(serverUrl, logger);
    return true;
  }
  companionWindow.showInactive();
  return true;
}

function closeCompanionWindow(): void {
  companionShouldBeVisible = false;
  if (!companionWindow || companionWindow.isDestroyed()) return;
  if (logger) {
    writeCompanionWindowPosition(
      app.getPath("userData"),
      getNormalizedCompanionPosition(companionWindow.getBounds()),
      logger,
    );
  }
  companionWindow.destroy();
  companionWindow = null;
}

function focusMainWindow(action?: string): boolean {
  if ((!mainWindow || mainWindow.isDestroyed()) && serverUrl && logger) {
    mainWindow = createMainWindow(serverUrl, logger);
  }
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (action) mainWindow.webContents.send("pi:menu-action", action);
  return true;
}

function persistMainWindowState(window: BrowserWindow): void {
  if (!logger || window.isDestroyed()) return;
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  writeMainWindowState(app.getPath("userData"), { ...bounds, maximized: window.isMaximized() }, logger);
}

function getInitialMainWindowState(log: Logger): { x?: number; y?: number; width: number; height: number; maximized: boolean } {
  const saved = readMainWindowState(app.getPath("userData"), log);
  if (!saved) return { width: 1440, height: 920, maximized: false };
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const fitted = fitBoundsToVisibleDisplays(
    saved,
    screen.getAllDisplays().map((display) => display.workArea),
    primaryWorkArea,
    { width: 640, height: 480 },
  );
  return { ...fitted, maximized: saved.maximized };
}

function reconcileWindowToDisplays(window: BrowserWindow, minimumSize: { width: number; height: number }): void {
  if (window.isDestroyed()) return;
  const wasMaximized = window.isMaximized();
  const current = wasMaximized ? window.getNormalBounds() : window.getBounds();
  const fitted = fitBoundsToVisibleDisplays(
    current,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
    minimumSize,
  );
  if (fitted === current) return;
  if (wasMaximized) window.unmaximize();
  window.setBounds(fitted);
  if (wasMaximized) window.maximize();
}

function handleDisplayConfigurationChanged(): void {
  if (mainWindow) reconcileWindowToDisplays(mainWindow, { width: 640, height: 480 });
  if (companionWindow && !companionWindow.isDestroyed()) {
    const bounds = companionWindow.getBounds();
    reconcileWindowToDisplays(companionWindow, { width: bounds.width, height: bounds.height });
  }
}

function installDisplayReconciliation(): void {
  screen.on("display-added", handleDisplayConfigurationChanged);
  screen.on("display-removed", handleDisplayConfigurationChanged);
  screen.on("display-metrics-changed", handleDisplayConfigurationChanged);
}

function removeDisplayReconciliation(): void {
  screen.removeListener("display-added", handleDisplayConfigurationChanged);
  screen.removeListener("display-removed", handleDisplayConfigurationChanged);
  screen.removeListener("display-metrics-changed", handleDisplayConfigurationChanged);
}

function installNativeContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    const template: MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: "undo" }, { role: "redo" }, { type: "separator" },
          { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
        ]
      : params.selectionText ? [{ role: "copy" }, { role: "selectAll" }] : [];
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });
}

function updateTrayMenu(): void {
  if (!tray) return;
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  tray.setToolTip(runningTaskCount > 0 ? `Piora · ${runningTaskCount}` : "Piora");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: isChinese ? "显示 Piora" : "Show Piora", click: () => focusMainWindow() },
    { label: isChinese ? "新任务" : "New task", click: () => focusMainWindow("new-session") },
    { label: isChinese ? `运行中任务：${runningTaskCount}` : `Running tasks: ${runningTaskCount}`, enabled: false },
    { type: "separator" },
    {
      label: isChinese ? "彻底退出 Piora" : "Quit Piora completely",
      click: () => {
        quitRequested = true;
        app.quit();
      },
    },
  ]));
}

async function refreshTrayTaskCount(): Promise<void> {
  if (!serverUrl || !applicationToken) return;
  try {
    const response = await fetch(new URL("/api/agent/running", serverUrl), { headers: { [DESKTOP_TOKEN_HEADER]: applicationToken } });
    if (!response.ok) return;
    const payload = await response.json() as { runningSessionIds?: unknown[] };
    const next = Array.isArray(payload.runningSessionIds) ? payload.runningSessionIds.length : 0;
    if (next !== runningTaskCount) { runningTaskCount = next; updateTrayMenu(); }
  } catch { /* The next poll retries after transient server errors. */ }
}

function installTray(): void {
  if (tray) return;
  const candidates = [
    join(process.resourcesPath, "tray-icon.ico"),
    join(app.getAppPath(), "build", "icon.ico"),
    join(__dirname, "..", "build", "icon.ico"),
    process.execPath,
  ];
  const image = candidates.map((candidate) => nativeImage.createFromPath(candidate)).find((candidate) => !candidate.isEmpty());
  if (!image) {
    logger?.warn("Unable to load the system tray icon", { candidates });
    return;
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.on("click", () => focusMainWindow());
  tray.on("double-click", () => focusMainWindow());
  updateTrayMenu();
  trayPollTimer = setInterval(() => { void refreshTrayTaskCount(); }, 2_500);
  trayPollTimer.unref();
  void refreshTrayTaskCount();
}

function registerGlobalShortcutHandler(): void {
  ipcMain.removeHandler(GLOBAL_SHORTCUT_CHANNEL);
  ipcMain.handle(GLOBAL_SHORTCUT_CHANNEL, (event, enabled: unknown): boolean => {
    if (!isTrustedMainWindowSender(event) || typeof enabled !== "boolean") return false;
    globalShortcut.unregister("CommandOrControl+Alt+P");
    return !enabled || globalShortcut.register("CommandOrControl+Alt+P", () => focusMainWindow("new-session"));
  });
}

function createStandaloneForProfile(profile: RuntimeProfile): {
  instance: StandaloneServer;
  dataDirectory: string;
} {
  if (!logger || !serverEntryPath || !serverHostEntryPath || !applicationToken || !piAgentDirectoryPath) {
    throw new Error("Desktop runtime is not ready for a profile switch");
  }
  const dataDirectory = runtimeProfileDataDirectory(app.getPath("userData"), profile);
  mkdirSync(dataDirectory, { recursive: true });
  const preferredPort = readPreferredServerPort(app.getPath("userData"), logger);
  const instance = new StandaloneServer({
    serverEntry: serverEntryPath,
    serverHostEntry: serverHostEntryPath,
    homeDirectory: app.getPath("home"),
    agentDirectory: piAgentDirectoryPath,
    whisperDirectory: app.isPackaged
      ? join(process.resourcesPath, "whisper")
      : join(process.cwd(), "desktop", "build", "whisper"),
    token: applicationToken,
    logger,
    runtimeProfile: profile,
    desktopDataDirectory: dataDirectory,
    ...(preferredPort === undefined ? {} : { preferredPort }),
    onUnexpectedExit: handleUnexpectedServerExit,
  });
  return { instance, dataDirectory };
}

function activateStandaloneProfile(profile: RuntimeProfile, dataDirectory: string, nextUrl: URL): URL {
  if (!logger || !applicationToken) throw new Error("Desktop runtime is not ready to activate a profile");
  currentRuntimeProfile = profile;
  process.env.PIORA_RUNTIME_PROFILE = profile;
  process.env.PIORA_DESKTOP_DATA_DIR = dataDirectory;
  writePreferredServerPort(app.getPath("userData"), Number(nextUrl.port), logger);
  const runtimeSession = electronSession.fromPartition(DESKTOP_PARTITION, { cache: true });
  configureSession(runtimeSession, nextUrl.origin, applicationToken);
  return nextUrl;
}

async function startStandaloneForProfile(profile: RuntimeProfile): Promise<URL> {
  const prepared = createStandaloneForProfile(profile);
  server = prepared.instance;
  const nextUrl = await prepared.instance.start();
  serverUrl = nextUrl;
  return activateStandaloneProfile(profile, prepared.dataDirectory, nextUrl);
}

async function requestHarmonyEmergencyStop(reason: string): Promise<void> {
  if (currentRuntimeProfile !== "device-control" || !serverUrl || !applicationToken) return;
  try {
    const response = await fetch(new URL("/api/harmony/action", serverUrl), {
      method: "POST",
      headers: {
        [DESKTOP_TOKEN_HEADER]: applicationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "emergency_stop", reason }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) logger?.warn("Harmony emergency stop was rejected during runtime shutdown", { status: response.status });
  } catch (error) {
    logger?.warn("Unable to request Harmony emergency stop during runtime shutdown", error);
  }
}

async function restartRuntimeProfile(target: RuntimeProfile): Promise<{ accepted: boolean; profile: RuntimeProfile; error?: string }> {
  if (!logger || !mainWindow || mainWindow.isDestroyed()) {
    return { accepted: false, profile: currentRuntimeProfile, error: "Main window is unavailable" };
  }
  const previousProfile = currentRuntimeProfile;
  const previousServer = server;
  closeCompanionWindow();
  await requestHarmonyEmergencyStop("runtime_profile_switch");
  server = undefined;
  serverUrl = undefined;
  await previousServer?.stop();

  try {
    const nextUrl = await startStandaloneForProfile(target);
    await loadApplicationWindow(mainWindow, nextUrl, logger);
    logger.info("Runtime profile switched", { from: previousProfile, to: target });
    return { accepted: true, profile: target };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Runtime profile switch failed", { from: previousProfile, to: target, error: message });
    try {
      const rollbackUrl = await startStandaloneForProfile(previousProfile);
      await loadApplicationWindow(mainWindow, rollbackUrl, logger);
    } catch (rollbackError) {
      logger.error("Runtime profile rollback failed", rollbackError);
    }
    return { accepted: false, profile: currentRuntimeProfile, error: message };
  }
}

function registerRuntimeProfileSwitchHandler(): void {
  ipcMain.removeHandler(RUNTIME_PROFILE_SWITCH_CHANNEL);
  ipcMain.handle(
    RUNTIME_PROFILE_SWITCH_CHANNEL,
    async (event, requestedProfile: unknown): Promise<{ accepted: boolean; profile: RuntimeProfile; error?: string }> => {
      if (!isTrustedMainWindowSender(event)) {
        return { accepted: false, profile: currentRuntimeProfile, error: "Untrusted renderer" };
      }
      if (requestedProfile === undefined) {
        return { accepted: true, profile: currentRuntimeProfile };
      }
      if (requestedProfile !== "normal" && requestedProfile !== "device-control") {
        return { accepted: false, profile: currentRuntimeProfile, error: "Invalid runtime profile" };
      }
      if (requestedProfile === currentRuntimeProfile) {
        return { accepted: true, profile: currentRuntimeProfile };
      }
      if (runtimeProfileSwitchPromise) return runtimeProfileSwitchPromise;
      const ownerWindow = mainWindow;
      if (!ownerWindow || ownerWindow.isDestroyed()) {
        return { accepted: false, profile: currentRuntimeProfile, error: "Main window is unavailable" };
      }

      const toDeviceControl = requestedProfile === "device-control";
      const isChinese = app.getLocale().toLowerCase().startsWith("zh");
      const result = await dialog.showMessageBox(ownerWindow, {
        type: "warning",
        title: "Piora",
        message: isChinese
          ? (toDeviceControl ? "切换到鸿蒙设备控制模式？" : "退出鸿蒙设备控制模式？")
          : (toDeviceControl ? "Switch to Harmony device-control mode?" : "Leave Harmony device-control mode?"),
        detail: isChinese
          ? "切换会停止当前 AI 任务并重启本地服务。设备控制模式可让 AI 操作已授权的手机；请仅连接测试设备。"
          : "Switching stops current AI tasks and restarts the local service. Device-control mode lets AI operate authorized phones; connect test devices only.",
        buttons: isChinese ? ["切换并重启", "取消"] : ["Switch and restart", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0) return { accepted: false, profile: currentRuntimeProfile };

      runtimeProfileSwitchPromise = restartRuntimeProfile(requestedProfile).finally(() => {
        runtimeProfileSwitchPromise = undefined;
      });
      return runtimeProfileSwitchPromise;
    },
  );
}

function registerHarmonyRuntimePickerHandler(): void {
  ipcMain.removeHandler(HARMONY_RUNTIME_PICKER_CHANNEL);
  ipcMain.handle(HARMONY_RUNTIME_PICKER_CHANNEL, async (event, kind: unknown): Promise<string | null> => {
    if (!isTrustedMainWindowSender(event) || currentRuntimeProfile !== "device-control") return null;
    if (kind !== "sdk" && kind !== "hdc") return null;
    const ownerWindow = mainWindow;
    if (!ownerWindow || ownerWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(ownerWindow, kind === "sdk"
      ? { title: "Select HarmonyOS SDK directory", properties: ["openDirectory"] }
      : {
          title: "Select hdc executable",
          properties: ["openFile"],
          ...(process.platform === "win32"
            ? { filters: [{ name: "Harmony Device Connector", extensions: ["exe"] }] }
            : {}),
        });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}

function registerCompanionWindowHandlers(): void {
  ipcMain.removeHandler(COMPANION_VISIBILITY_CHANNEL);
  ipcMain.removeHandler(COMPANION_LAYOUT_CHANNEL);
  ipcMain.handle(COMPANION_VISIBILITY_CHANNEL, (event, visible: unknown): boolean => {
    if (!isTrustedCompletionNotificationSender(event) || typeof visible !== "boolean") return false;
    if (visible) return showCompanionWindow();
    closeCompanionWindow();
    return true;
  });

  ipcMain.handle(COMPANION_LAYOUT_CHANNEL, (event, expanded: unknown): boolean => {
    if (!isTrustedCompanionWindowSender(event) || typeof expanded !== "boolean") return false;
    return setCompanionWindowExpanded(expanded);
  });

  ipcMain.removeHandler(COMPANION_ACTION_CHANNEL);
  ipcMain.handle(COMPANION_ACTION_CHANNEL, (event, action: unknown): boolean => {
    if (!isTrustedCompletionNotificationSender(event) || typeof action !== "string") return false;
    if (action === "focus-main") return focusMainWindow();
    if (action === "open-settings") return focusMainWindow("companion-settings");
    if (action === "hide") {
      companionWindow?.hide();
      setTimeout(closeCompanionWindow, 0);
      mainWindow?.webContents.send("pi:menu-action", "hide-companion");
      return true;
    }
    return false;
  });
}

interface MainWindowShell {
  window: BrowserWindow;
  initialState: ReturnType<typeof getInitialMainWindowState>;
}

function createMainWindowShell(log: Logger): MainWindowShell {
  // Windows keeps native resize/minimize/maximize/close behavior, but places
  // those controls over the renderer-owned, Codex-style title strip. The full
  // native title and menu rows stay hidden; the installed Menu still owns
  // accelerators and supplies the popup submenus opened by the renderer.
  const integratedTitleBar = process.platform === "win32"
    ? {
        titleBarStyle: "hidden" as const,
        titleBarOverlay: {
          color: "#00000000",
          symbolColor: "#737373",
          height: DESKTOP_TITLE_BAR_HEIGHT,
        },
      }
    : process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : {};

  const initialState = getInitialMainWindowState(log);
  const window = new BrowserWindow({
    ...(initialState.x === undefined ? {} : { x: initialState.x }),
    ...(initialState.y === undefined ? {} : { y: initialState.y }),
    width: initialState.width,
    height: initialState.height,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: "Piora",
    backgroundColor: STARTUP_SHELL_BACKGROUND,
    autoHideMenuBar: true,
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

  const scheduleWindowStateWrite = () => {
    if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
    mainWindowStateTimer = setTimeout(() => persistMainWindowState(window), 180);
  };
  window.on("move", scheduleWindowStateWrite);
  window.on("resize", scheduleWindowStateWrite);
  window.on("maximize", scheduleWindowStateWrite);
  window.on("unmaximize", scheduleWindowStateWrite);
  window.on("close", (event) => {
    if (quitRequested || PORTABLE_SMOKE_TEST) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
    mainWindowStateTimer = undefined;
    if (mainWindow === window) mainWindow = null;
  });

  return { window, initialState };
}

function loadApplicationWindow(window: BrowserWindow, url: URL, log: Logger): Promise<void> {
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
  installNativeContextMenu(window);
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

  return window.loadURL(url.toString()).then(() => undefined);
}

function createMainWindow(
  url: URL,
  log: Logger,
  { showWhenReady = true }: { showWhenReady?: boolean } = {},
): BrowserWindow {
  const { window, initialState } = createMainWindowShell(log);
  if (showWhenReady) window.once("ready-to-show", () => {
    if (initialState.maximized) window.maximize();
    window.show();
  });

  void loadApplicationWindow(window, url, log).catch((error) => {
    log.error("Unable to load the application page", error);
  });
  return window;
}

function createStartupWindow(log: Logger): { window: BrowserWindow; ready: Promise<number> } {
  const { window, initialState } = createMainWindowShell(log);
  const ready = new Promise<number>((resolveReady) => {
    window.once("ready-to-show", () => {
      const readyAt = Date.now();
      if (!PORTABLE_SMOKE_TEST) {
        if (initialState.maximized) window.maximize();
        window.show();
      }
      const startupMarker = process.env.PIORA_SMOKE_STARTUP_MARKER?.trim();
      if (PORTABLE_SMOKE_TEST && startupMarker) {
        writeFileSync(resolve(startupMarker), `${JSON.stringify({ schema: "piora-startup-v1", ready: true, surface: "electron-shell" })}\n`, { encoding: "utf8", flag: "wx" });
      }
      resolveReady(readyAt);
    });
  });
  const startupDocument = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{height:100%;margin:0;background:#111318;color:#e7e7e7;font-family:Segoe UI,system-ui,sans-serif}
    body{display:grid;grid-template-columns:250px 1fr}.sidebar{border-right:1px solid #282b31;padding:58px 14px 20px}.brand{display:flex;align-items:center;gap:10px;font-weight:650}.mark{width:24px;height:24px;border-radius:7px;background:#e7e7e7;color:#111318;display:grid;place-items:center}.lines{margin-top:38px;display:grid;gap:12px}.line{height:9px;border-radius:5px;background:#22252b}.line:nth-child(2){width:78%}.line:nth-child(3){width:62%}.main{display:grid;place-items:center}.loading{display:grid;justify-items:center;gap:14px;color:#9a9da5;font-size:13px}.spinner{width:22px;height:22px;border:2px solid #32363e;border-top-color:#d8d8d8;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  </style></head><body><aside class="sidebar"><div class="brand"><span class="mark">P</span><span>Piora</span></div><div class="lines"><span class="line"></span><span class="line"></span><span class="line"></span></div></aside><main class="main"><div class="loading"><span class="spinner"></span><span>Starting Piora…</span></div></main></body></html>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupDocument)}`);
  return { window, ready };
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
    title: "Piora",
    message: "The local Piora service stopped unexpectedly.",
    ...(logger ? { detail: `See ${logger.filePath} for details.` } : {}),
  };

  const notification = mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
  void notification.finally(() => app.quit());
}

async function startApplication(): Promise<void> {
  const startupStartedAt = Date.now();
  await app.whenReady();
  app.setAppUserModelId("io.github.kexijiang.piora");

  logger = new FileLogger(app.getPath("userData"));
  logger.info("Starting Piora", {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
  });

  piAgentDirectoryPath = await choosePiAgentDirectory(logger);
  logger.info("Using Pi data directory", { directory: piAgentDirectoryPath });

  // Show an app-owned shell immediately while the bundled Next.js service
  // starts in parallel. The same BrowserWindow is then navigated to the app,
  // avoiding the process and rendering cost of creating a second window.
  const startup = createStartupWindow(logger);
  mainWindow = startup.window;
  installTray();
  void startup.ready.then((readyAt) => {
    logger?.info("Startup shell is visible", { elapsedMs: readyAt - startupStartedAt });
  });

  serverEntryPath = resolveStandaloneServerEntry();
  serverHostEntryPath = join(__dirname, "server-host.js");
  if (!existsSync(serverHostEntryPath)) {
    throw new Error(`Desktop server host was not found: ${serverHostEntryPath}`);
  }

  const token = randomBytes(32).toString("base64url");
  applicationToken = token;
  // Runtime mode is intentionally reset on every application launch. Device
  // control can only be entered after an explicit native confirmation.
  const initialRuntime = createStandaloneForProfile("normal");
  server = initialRuntime.instance;
  serverUrl = await server.start();
  activateStandaloneProfile("normal", initialRuntime.dataDirectory, serverUrl);
  logger.info("Bundled service is ready", { elapsedMs: Date.now() - startupStartedAt });

  registerCompletionNotificationHandler();
  registerCompanionWindowHandlers();
  registerGlobalShortcutHandler();
  registerRuntimeProfileSwitchHandler();
  registerHarmonyRuntimePickerHandler();

  if (PORTABLE_SMOKE_TEST) {
    const smokeMarker = process.env.PIORA_SMOKE_MARKER?.trim();
    if (!smokeMarker) {
      throw new Error("PIORA_SMOKE_MARKER is required in portable smoke-test mode.");
    }
    await loadApplicationWindow(mainWindow, serverUrl, logger);
    const rendererState = await waitForSmokeRenderer(mainWindow);
    await startup.ready;
    writeFileSync(
      resolve(smokeMarker),
      `${JSON.stringify({
        schema: "piora-portable-smoke-v1",
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
  registerApplicationMenuPopupHandler();
  registerFileShellHandlers();
  installDisplayReconciliation();

  await loadApplicationWindow(mainWindow, serverUrl, logger);
  logger.info("Application window is ready", { elapsedMs: Date.now() - startupStartedAt });
}

async function stopApplication(): Promise<void> {
  logger?.info("Stopping Piora");
  await requestHarmonyEmergencyStop("desktop_shutdown");
  await server?.stop();
  server = undefined;
  serverUrl = undefined;
  applicationToken = undefined;
  if (trayPollTimer) clearInterval(trayPollTimer);
  trayPollTimer = undefined;
  tray?.destroy();
  tray = null;
  globalShortcut.unregisterAll();
  removeDisplayReconciliation();
  logger?.info("Piora stopped");
}

// Smoke tests run in isolated user-data directories and may execute beside a
// user's installed Piora. They must not lose their startup marker to the
// installed app's single-instance lock.
const hasSingleInstanceLock = PORTABLE_SMOKE_TEST || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.on("activate", () => {
    if (!mainWindow && serverUrl && logger) {
      mainWindow = createMainWindow(serverUrl, logger);
      return;
    }
    focusMainWindow();
  });

  // Closing the main window keeps the desktop process available from the tray.
  // Only an explicit quit (tray/menu/OS shutdown) tears down the local service.
  app.on("window-all-closed", () => {
    if (quitRequested) app.quit();
  });

  app.on("before-quit", (event) => {
    quitRequested = true;
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
    const detail = logger ? `${message}\n\nDiagnostic log: ${logger.filePath}` : message;
    dialog.showErrorBox("Piora could not start", detail);
    await server?.stop().catch((shutdownError) => {
      logger?.error("Unable to stop the web server after a startup failure", shutdownError);
    });
    quitRequested = true;
    shutdownComplete = true;
    app.exit(1);
  });
}
