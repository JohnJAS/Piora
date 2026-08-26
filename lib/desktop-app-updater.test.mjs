import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { DesktopUpdateController } = await jiti.import("../desktop/src/app-updater.ts");

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  logger = null;
  checkCount = 0;
  downloadCount = 0;
  installArguments = null;

  async checkForUpdates() {
    this.checkCount += 1;
    this.emit("checking-for-update");
    this.emit("update-available", { version: "0.4.12" });
    return {};
  }

  async downloadUpdate() {
    this.downloadCount += 1;
    this.emit("download-progress", { percent: 42.4 });
    this.emit("update-downloaded", { version: "0.4.12" });
    return ["Piora-0.4.12-win-x64-setup.exe"];
  }

  quitAndInstall(isSilent, isForceRunAfter) {
    this.installArguments = [isSilent, isForceRunAfter];
  }
}

function createLogger() {
  return {
    entries: [],
    info(message, details) { this.entries.push(["info", message, details]); },
    warn(message, details) { this.entries.push(["warn", message, details]); },
    error(message, details) { this.entries.push(["error", message, details]); },
  };
}

test("installed desktop updates are user-controlled from check through restart", async () => {
  const backend = new FakeUpdater();
  const controller = new DesktopUpdateController(backend, "v0.4.11", createLogger());
  const states = [];
  controller.subscribe((state) => states.push(state));

  assert.equal(controller.getState().status, "idle");
  assert.equal(backend.autoDownload, false);
  assert.equal(backend.autoInstallOnAppQuit, false);
  assert.equal(backend.autoRunAppAfterInstall, true);
  assert.equal(backend.allowPrerelease, false);

  await controller.checkForUpdates();
  assert.deepEqual(controller.getState(), {
    status: "available",
    currentVersion: "0.4.11",
    availableVersion: "0.4.12",
  });

  await controller.downloadUpdate();
  assert.deepEqual(controller.getState(), {
    status: "downloaded",
    currentVersion: "0.4.11",
    availableVersion: "0.4.12",
    progressPercent: 100,
  });
  assert.equal(controller.quitAndInstall(), true);
  assert.deepEqual(backend.installArguments, [false, true]);
  assert.ok(states.some((state) => state.status === "downloading" && state.progressPercent === 42));
});

test("portable builds expose an unsupported state and never contact an updater", async () => {
  const controller = new DesktopUpdateController(null, "0.4.11", createLogger());
  assert.deepEqual(controller.getState(), {
    status: "unsupported",
    currentVersion: "0.4.11",
  });
  await controller.checkForUpdates();
  await controller.downloadUpdate();
  assert.equal(controller.quitAndInstall(), false);
});

test("update failures become a retryable visible state", async () => {
  const backend = new FakeUpdater();
  backend.checkForUpdates = async function checkForUpdates() {
    this.emit("checking-for-update");
    throw new Error("offline");
  };
  const logger = createLogger();
  const controller = new DesktopUpdateController(backend, "0.4.11", logger);
  await controller.checkForUpdates();
  assert.deepEqual(controller.getState(), {
    status: "error",
    currentVersion: "0.4.11",
    error: "offline",
  });
  assert.ok(logger.entries.some(([level, message]) => level === "error" && message === "Desktop update failed"));
});
