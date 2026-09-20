import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const { FileLogger } = await createJiti(import.meta.url).import("../desktop/src/logger.ts");
const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const functionSource = (start, end) => main.slice(main.indexOf(`function ${start}(`), main.indexOf(`function ${end}(`));
const source = ts.transpileModule(
  functionSource("isTrustedMainWindowSender", "isTrustedCompanionWindowSender")
  + functionSource("registerRuntimeLogHandler", "registerAutoLaunchHandlers"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

test("runtime log IPC exposes the active fallback path and live write status only to the app main frame", t => {
  const root = mkdtempSync(join(tmpdir(), "piora-runtime-log-"));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  writeFileSync(join(root, "logs"), "force fallback");
  const logger = new FileLogger(root, join(root, "fallback"));
  const mainFrame = { url: "http://127.0.0.1:30141/" };
  const webContents = { mainFrame };
  let destroyed = false;
  const mainWindow = { webContents, isDestroyed: () => destroyed };
  const handlers = new Map();
  const ipcMain = { removeHandler: channel => handlers.delete(channel), handle: (channel, handler) => handlers.set(channel, handler) };
  const register = new Function("ipcMain", "logger", "mainWindow", "serverUrl", "isAllowedAppUrl",
    source + "; return registerRuntimeLogHandler;")(
    ipcMain, logger, mainWindow, new URL(mainFrame.url), (url, origin) => new URL(url).origin === origin,
  );
  register();
  const read = handlers.get("pi:runtime-log-get");
  const event = { sender: webContents, senderFrame: mainFrame };
  const expectedPath = join(root, "fallback", `piora-startup-${process.pid}.log`);
  assert.deepEqual(read(event), { filePath: expectedPath, fileLoggingAvailable: true });
  assert.equal(read({ sender: {}, senderFrame: mainFrame }), null, "another window cannot read the path");
  assert.equal(read({ sender: webContents, senderFrame: { ...mainFrame } }), null, "a subframe cannot read the path");
  mainFrame.url = "https://example.com/";
  assert.equal(read(event), null, "a navigated renderer cannot read the path");
  mainFrame.url = "http://127.0.0.1:30141/";
  destroyed = true;
  assert.equal(read(event), null);
  destroyed = false;
  logger.fileLoggingAvailable = false;
  assert.deepEqual(read(event), { filePath: expectedPath, fileLoggingAvailable: false });
  logger.info("logging recovered");
  assert.equal(read(event).fileLoggingAvailable, true, "refresh sees the latest logging status");
  assert.match(readFileSync(expectedPath, "utf8"), /logging recovered/);
});
