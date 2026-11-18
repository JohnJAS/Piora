import { app, type BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readLastLaunchedVersion } from "./desktop-state.js";
import type { Logger } from "./logger.js";
import { createStartupDocument, isStartupDocumentUrl, loadStartupMedia, STARTUP_MEDIA_TIMEOUT_MS, STARTUP_CONTINUE_CHANNEL } from "./startup-scene.js";
import { runOptionalStartupTask } from "./startup-tasks.js";

interface StartupHandoff {
  window: BrowserWindow;
  ready: Promise<number>;
  finished: Promise<void>;
  finish(): void;
  ensureVisible(): void;
}

export function createStartupWindow(
  log: Logger,
  createMainWindowShell: (log: Logger) => { window: BrowserWindow; initialState: { maximized: boolean } },
  portableSmoke: boolean,
): StartupHandoff {
  const { window, initialState } = createMainWindowShell(log);
  // Retain the EventEmitter while the native window is alive. Accessing
  // window.webContents from "closed" throws, even just to remove a listener.
  const webContents = window.webContents;
  const previousVersion = readLastLaunchedVersion(app.getPath("userData"), log);
  const firstLaunchOfVersion = previousVersion !== app.getVersion();
  const updated = Boolean(previousVersion) && firstLaunchOfVersion;
  const mediaDirectory = app.isPackaged ? join(process.resourcesPath, "startup") : resolve(__dirname, "../../.branding/resources/startup");
  const playIntro = firstLaunchOfVersion && !portableSmoke;
  // Live development already waits for its server. Packaged startup always
  // uses the local media policy, even when a development URL is in the environment.
  const media = !app.isPackaged && process.env.PI_DESKTOP_DEV_SERVER_URL
    ? {} : loadStartupMedia(mediaDirectory, playIntro, true);
  const startupPath = join(app.getPath("userData"), "startup.html");
  let finishIntro!: () => void;
  const finished = new Promise<void>((resolveIntro) => { finishIntro = () => { resolveIntro(); }; });
  // Start the watchdog before loading: a failed navigation never emits
  // ready-to-show, so it must not be responsible for releasing startup.
  const introTimer = setTimeout(finishIntro, STARTUP_MEDIA_TIMEOUT_MS);
  introTimer.unref();
  void finished.then(() => { clearTimeout(introTimer); });
  const blockIntroNavigation = (event: Electron.Event) => {
    // Keep the old document from replacing an in-flight application load.
    // Main-process loadURL does not emit will-navigate.
    event.preventDefault();
  };
  const continueIntro = (event: Electron.IpcMainEvent, channel: string) => {
    if (channel !== STARTUP_CONTINUE_CHANNEL || webContents.isDestroyed() || !event.senderFrame
      || event.senderFrame !== webContents.mainFrame || !isStartupDocumentUrl(event.senderFrame.url, startupPath)) return;
    finishIntro();
  };
  const cleanupNavigationGuard = () => {
    if (!webContents.isDestroyed()) {
      webContents.removeListener("will-navigate", blockIntroNavigation);
      webContents.removeListener("did-navigate", onNavigation);
    }
    if (!window.isDestroyed()) window.removeListener("closed", onClosed);
  };
  const onNavigation = (_event: Electron.Event, target: string) => {
    if (isStartupDocumentUrl(target, startupPath)) return;
    cleanupNavigationGuard();
    finishIntro();
  };
  const onClosed = () => { cleanupNavigationGuard(); finishIntro(); };
  webContents.on("will-navigate", blockIntroNavigation);
  webContents.on("ipc-message", continueIntro);
  webContents.on("did-navigate", onNavigation);
  window.once("closed", onClosed);
  let ensureVisible!: () => void;
  const ready = new Promise<number>((resolveReady) => {
    let shown = false;
    ensureVisible = () => {
      if (shown || window.isDestroyed()) return;
      shown = true;
      window.removeListener("ready-to-show", ensureVisible);
      const readyAt = Date.now();
      if (!portableSmoke) {
        if (initialState.maximized) window.maximize();
        window.show();
      }
      const startupMarker = process.env.PIORA_SMOKE_STARTUP_MARKER?.trim();
      if (portableSmoke && startupMarker) {
        writeFileSync(resolve(startupMarker), `${JSON.stringify({ schema: "piora-startup-v1", ready: true, surface: "electron-shell" })}\n`, { encoding: "utf8", flag: "wx" });
      }
      resolveReady(readyAt);
      if (!playIntro || !media.video) finishIntro();
    };
    window.once("ready-to-show", ensureVisible);
  });
  const startupDocument = createStartupDocument({ chinese: app.getLocale().toLocaleLowerCase().startsWith("zh"), version: app.getVersion(), updated, ...media });
  let navigation: Promise<void> = Promise.resolve();
  try {
    writeFileSync(startupPath, startupDocument, { encoding: "utf8", mode: 0o600 });
    navigation = window.loadFile(startupPath).catch((error) => {
      log.warn("Unable to load startup animation; continuing to the application", error);
      finishIntro();
    });
  } catch (error) {
    log.warn("Unable to prepare startup animation; continuing to the application", error);
    finishIntro();
  }
  const handedOff = finished.then(async () => {
    log.info("Releasing startup animation");
    if (!webContents.isDestroyed()) webContents.removeListener("ipc-message", continueIntro);
    // Leave the Chromium/IPC callback before starting another native operation.
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
    if (!window.isDestroyed() && !webContents.isDestroyed()) {
      // The watchdog may expire while loadFile is still navigating. Settle that
      // navigation before loadURL, but a broken optional document cannot hold
      // the application hostage even if Chromium never settles its promise.
      try { webContents.stop(); }
      catch (error) { log.warn("Unable to stop startup animation; continuing to the application", error); }
    }
    await runOptionalStartupTask("Startup animation navigation cleanup", () => navigation, log, 1_000);
    // A rejected loadFile settles inside did-stop-loading. Loading the app in
    // that same event can let old completion events settle the new navigation.
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
    log.info("Startup animation handoff is complete");
  });
  return { window, ready, finished: handedOff, finish: finishIntro, ensureVisible };
}
