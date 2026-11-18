import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const source = main.slice(main.indexOf("async function startApplication("), main.indexOf("async function stopApplication("));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  let rejectClipboard, finishIntro;
  const logs = [], loaded = [], warmed = [], stages = [], trayPolls = [];
  const window = { isDestroyed: () => false };
  const env = {
    join, logger: undefined, recordStartupStage: value => stages.push(value), piAgentDirectoryPath: undefined, mainWindow: undefined,
    applicationToken: undefined, serverUrl: undefined, clipboardController: undefined, quitRequested: false,
    PI_AGENT_DIRECTORY_ENV: "PI_CODING_AGENT_DIR", harmonyWindows: undefined, __dirname: "fixture",
    HarmonyWindows: class { constructor(dependencies) { this.dependencies = dependencies; } },
    app: { whenReady: async () => {}, setAppUserModelId() {}, getPath: () => "fixture", getVersion: () => "beta.28" },
    process: Object.assign(new EventEmitter(), { env: {}, versions: { electron: "test" }, connected: true, send() {} }),
    FileLogger: class { debug() {} info() {} warn(message) { logs.push(message); } },
    desktopDevelopmentRuntime: { url: new URL("http://127.0.0.1:30141"), token: "fixture" },
    clearObsoleteDesktopWebCaches: async () => {}, resolvePiAgentDirectory: () => "fixture",
    createStartupWindow: () => ({ window, ready: Promise.resolve(0), ensureVisible() {}, finish: () => { stages.push("finish-intro"); finishIntro(); },
      finished: new Promise(resolve => { finishIntro = resolve; }) }),
    waitForDesktopDevelopmentServer: async () => {}, electronSession: { fromPartition: () => ({}) },
    DESKTOP_PARTITION: "fixture", PORTABLE_SMOKE_TEST: false,
    ClipboardController: class {
      start() { return new Promise((_resolve, reject) => { rejectClipboard = reject; }); }
      setShortcut() {} warm() { warmed.push(true); return Promise.resolve(); }
    },
    isTrustedMainWindowSender: () => true,
    initializeDesktopAnalytics: async () => {},
    observeFirstComposer: async (_window, _origin, onReady) => onReady(),
    setImmediate,
    syncSavedDesktopNetworkProxy: async () => {},
    keyboardShortcutBindings: { "companion.clipboard": "Alt+C" }, toElectronAccelerator: value => value,
    loadApplicationWindow: async (_window, url) => { loaded.push(url.origin); },
  };
  for (const name of [
    "createMainWindowShell", "installTray", "configureSession", "warmInitialModelCatalog", "registerCompletionNotificationHandler",
    "registerCompanionWindowHandlers", "registerAutoLaunchHandlers", "registerRuntimeLogHandler", "registerGlobalShortcutHandler",
    "registerKeyboardShortcutHandler", "registerNetworkProxyHandler", "registerHarmonyRuntimePickerHandler",
    "attachDesktopBrowserManager", "registerDirectoryPickerHandler", "registerAgentDataDirectoryHandlers",
    "installApplicationMenu", "registerApplicationMenuPopupHandler", "initializeDesktopUpdater",
    "registerFileShellHandlers", "installDisplayReconciliation", "writeLastLaunchedVersion", "initializeDshPet", "initializeDshMeme", "bindDesktopExtensionsIpc",
  ]) env[name] = () => {};
  env.startTrayTaskPolling = () => trayPolls.push(loaded.length);
  runInNewContext(compiled + ";globalThis.start = startApplication;", env);
  return { env, logs, loaded, warmed, stages, trayPolls, finish: () => finishIntro(), failClipboard: () => rejectClipboard(new Error("migration failed")) };
}

test("slow clipboard initialization does not prevent the main window from opening", { timeout: 2000 }, async () => {
  const f = fixture();
  const navigationStarted = Promise.withResolvers();
  const navigationFinished = Promise.withResolvers();
  const loadApplicationWindow = f.env.loadApplicationWindow;
  f.env.loadApplicationWindow = async (...args) => {
    navigationStarted.resolve();
    await navigationFinished.promise;
    await loadApplicationWindow(...args);
  };
  const running = f.env.start();
  await navigationStarted.promise;
  assert.deepEqual(f.trayPolls, [], "dev tray should not compete with initial compilation");
  navigationFinished.resolve();
  await running;
  assert.equal(f.loaded.length, 1);
  assert.deepEqual(f.trayPolls, [1], "dev tray starts checking tasks after the navigation");
  assert.equal(f.warmed.length, 0, "startup keeps clipboard capture active without creating a hidden renderer");
  f.failClipboard(); await Promise.resolve();
  assert.ok(f.logs.includes("Clipboard startup failed; application remains available"));
});

test("tray polling does not queue overlapping task-status requests", async () => {
  const pollingSource = main.slice(main.indexOf("function startTrayTaskPolling("), main.indexOf("function installTray("));
  const polling = ts.transpileModule(pollingSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let scheduled, finishPoll;
  let requests = 0;
  const env = {
    tray: {}, trayPollTimer: undefined, quitRequested: false,
    setInterval(poll, interval) { assert.equal(interval, 2_500); scheduled = poll; return { unref() {} }; },
    refreshTrayTaskCount() { requests++; return new Promise(resolve => { finishPoll = resolve; }); },
  };
  runInNewContext(polling + ";globalThis.start = startTrayTaskPolling;", env);
  env.start();
  env.start();
  scheduled();
  scheduled();
  assert.equal(requests, 1);
  finishPoll();
  await Promise.resolve();
  scheduled();
  assert.equal(requests, 2);
  finishPoll();
});

test("analytics import or initialization failure leaves desktop startup available", async () => {
  const helper = main.slice(main.indexOf("async function initializeDesktopAnalytics("), main.indexOf("async function observeFirstComposer("));
  const js = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const logs = [], window = {};
  const env = { desktopAnalytics: undefined, mainWindow: window, quitRequested: false, logger: { warn: message => logs.push(message) } };
  runInNewContext(js + ";globalThis.initialize = initializeDesktopAnalytics;", env);
  await env.initialize(async () => { throw new Error("module unavailable"); });
  await env.initialize(async () => ({ startDesktopAnalytics: async () => { throw new Error("storage unavailable"); } }));
  assert.equal(logs.length, 2);
  assert.ok(logs.every(message => message === "Organization analytics startup failed; application remains available"));
  assert.equal(env.desktopAnalytics, undefined);
  const collector = {};
  await env.initialize(async () => ({ startDesktopAnalytics: async getWindow => {
    assert.equal(getWindow(), window); return collector;
  } }));
  assert.equal(env.desktopAnalytics, collector);
  await env.initialize(async () => { assert.fail("a running collector must not be initialized again"); });
});

test("quitting during the intro never loads a cleared service URL", { timeout: 2000 }, async () => {
  const f = fixture();
  let releaseService;
  f.env.waitForDesktopDevelopmentServer = () => new Promise(resolve => { releaseService = resolve; });
  const running = f.env.start();
  await new Promise(resolve => setImmediate(resolve));
  f.env.quitRequested = true; f.env.serverUrl = undefined;
  releaseService(); await running;
  assert.equal(f.loaded.length, 0);
});

test("service readiness releases a still-playing intro, while analytics cannot delay navigation", { timeout: 2000 }, async () => {
  const f = fixture();
  f.env.initializeDesktopAnalytics = () => new Promise(() => {});
  await f.env.start();
  assert.equal(f.loaded.length, 1);
  assert.ok(f.stages.indexOf("local-service-ready") < f.stages.indexOf("finish-intro"));
  assert.ok(f.stages.indexOf("finish-intro") < f.stages.indexOf("loading-main-window"));
  assert.ok(f.stages.indexOf("loading-main-window") < f.stages.indexOf("composer-interactive"));
});

test("desktop does not navigate until authenticated development assets are ready", { timeout: 2000 }, async () => {
  const f = fixture();
  let releaseAssets;
  f.env.waitForDesktopDevelopmentServer = async (url, token) => {
    assert.equal(url.origin, "http://127.0.0.1:30141");
    assert.equal(token, "fixture");
    await new Promise(resolve => { releaseAssets = resolve; });
  };
  const running = f.env.start();
  await new Promise(resolve => setImmediate(resolve));
  f.finish();
  assert.deepEqual(f.loaded, []);
  releaseAssets();
  await running;
  assert.equal(f.loaded.length, 1);
});

test("development compilation proceeds during cache cleanup but navigation waits for both", { timeout: 2000 }, async () => {
  const scenario = fixture();
  let releaseCache, compiled = false, configured = false;
  scenario.env.clearObsoleteDesktopWebCaches = () => new Promise(resolve => { releaseCache = resolve; });
  scenario.env.waitForDesktopDevelopmentServer = async () => { compiled = true; };
  scenario.env.configureSession = () => { configured = true; };
  const startup = scenario.env.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(compiled, true);
  assert.equal(configured, false);
  scenario.finish();
  assert.deepEqual(scenario.loaded, []);
  releaseCache();
  await startup;
  assert.equal(configured, true);
  assert.equal(scenario.loaded.length, 1);
});

test("desktop development refuses startup without a connected IPC launcher", async () => {
  for (const missing of ["send", "connected"]) {
    const f = fixture();
    f.env.process[missing] = undefined;
    await assert.rejects(f.env.start(), /requires the dev:desktop IPC launcher/);
    assert.deepEqual(f.loaded, []);
  }
});

test("desktop development dispatches IPC and responds only while connected", async () => {
  const f = fixture();
  const requests = [], responses = [];
  const response = { type: "pi-desktop:browser-agent-response", requestId: "fixture", ok: true };
  f.env.handleStandaloneMessage = async message => { requests.push(message); return response; };
  f.env.process.send = message => responses.push(message);
  const running = f.env.start();
  await new Promise(resolve => setImmediate(resolve));
  f.finish();
  await running;
  const request = { type: "pi-desktop:browser-agent-request", requestId: "fixture" };
  f.env.process.emit("message", request);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [request]);
  assert.deepEqual(responses, [response]);
  f.env.process.emit("message", request);
  f.env.process.connected = false;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responses.length, 1);
});
