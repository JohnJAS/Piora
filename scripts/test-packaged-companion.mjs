#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  createIsolatedProcessEnvironment,
  prepareIsolatedEnvironment,
} from "./isolated-process-env.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultExecutable = resolve(projectRoot, "desktop", "release", "win-unpacked", "Piora.exe");
const screenshotPath = resolve(
  projectRoot,
  "desktop",
  "release",
  "Piora-0.1.0-companion-ui-test.png",
);
const COMPANION_STORAGE_KEY = "pi-companion-preferences-v1";
const TARGET_WAIT_MS = 45_000;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function assertSafeTemporaryDirectory(directory) {
  const temporaryRoot = resolve(tmpdir());
  const relativePath = relative(temporaryRoot, resolve(directory));
  if (
    !relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to clean an unsafe companion test directory: ${directory}`);
  }
}

async function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Unable to reserve a CDP port")));
        return;
      }
      const { port } = address;
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

async function fetchTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => undefined);
  if (!response?.ok) return [];
  const targets = await response.json();
  return Array.isArray(targets) ? targets : [];
}

async function waitForTarget(port, predicate, description, timeoutMs = TARGET_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = (await fetchTargets(port)).find(predicate);
    if (target) return target;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForTargetToClose(port, predicate, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await fetchTargets(port)).some(predicate)) return;
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${description} to close`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string"
        ? event.data
        : Buffer.from(event.data).toString("utf8");
      const message = JSON.parse(raw);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP connection closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", () => rejectOpen(new Error("Unable to open CDP socket")), { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.exception?.value
      ?? response.exceptionDetails.text;
    throw new Error(`Renderer evaluation failed: ${detail}`);
  }
  return response.result?.value;
}

async function inspectCompanion(client) {
  return evaluate(client, `(() => {
    const root = document.querySelector('[data-testid="desktop-companion-window"]');
    const bubble = document.querySelector('[data-testid="companion-activity-bubble"]');
    const pet = document.querySelector('[data-testid="companion-pet-viewport"]');
    const sprite = document.querySelector('[data-testid="companion-sprite-frame"]');
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    const rootStyle = root ? getComputedStyle(root) : null;
    const bubbleRect = bubble?.getBoundingClientRect();
    const petRect = pet?.getBoundingClientRect();
    return {
      readyState: document.readyState,
      htmlClass: document.documentElement?.className ?? '',
      bodyClass: document.body?.className ?? '',
      bodyBackground: bodyStyle?.backgroundColor ?? null,
      rootBackground: rootStyle?.backgroundColor ?? null,
      rootFound: Boolean(root),
      bubbleFound: Boolean(bubble),
      bubbleVisible: bubble?.dataset.visible ?? null,
      bubbleStatus: bubble?.dataset.status ?? null,
      bubbleText: bubble?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      bubbleRect: bubbleRect ? { width: bubbleRect.width, height: bubbleRect.height } : null,
      petFound: Boolean(pet),
      petRect: petRect ? { width: petRect.width, height: petRect.height } : null,
      spriteFound: Boolean(sprite),
      spriteBackgroundImage: sprite ? getComputedStyle(sprite).backgroundImage : null,
      spriteBackgroundPosition: sprite ? getComputedStyle(sprite).backgroundPosition : null,
      spriteImageRendering: sprite ? getComputedStyle(sprite).imageRendering : null,
      windowBounds: {
        left: window.screenX,
        top: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      },
    };
  })()`);
}

async function waitForMainRendererReady(client) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await evaluate(client, `(() => {
      try {
        const probeKey = '__piora_companion_test_probe__';
        localStorage.setItem(probeKey, '1');
        localStorage.removeItem(probeKey);
        return {
          href: location.href,
          readyState: document.readyState,
          storageAvailable: true,
        };
      } catch (error) {
        return {
          href: location.href,
          readyState: document.readyState,
          storageAvailable: false,
          error: String(error),
        };
      }
    })()`);
    if (
      state.storageAvailable
      && state.readyState === "complete"
      && /^http:\/\/127\.0\.0\.1:\d+\//.test(state.href)
    ) {
      return state;
    }
    await delay(150);
  }
  throw new Error("Packaged Piora main renderer did not become ready with local storage");
}

async function waitForCompanionReady(client) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await inspectCompanion(client);
    if (state.rootFound && state.petFound && state.spriteFound) return state;
    await delay(150);
  }
  throw new Error("Packaged companion renderer did not become ready with its bundled sprite");
}

async function publishActivity(mainClient, status, cause) {
  const payload = JSON.stringify({ type: "activity", activity: { status, cause } });
  await evaluate(mainClient, `(() => {
    const channel = new BroadcastChannel('pi-companion-runtime-v1');
    channel.postMessage(${payload});
    channel.close();
    return true;
  })()`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill();
  await Promise.race([exited, delay(8_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function main() {
  const executable = resolve(process.argv[2] ?? defaultExecutable);
  if (!(await stat(executable).catch(() => undefined))?.isFile()) {
    throw new Error(`Packaged Piora executable does not exist: ${executable}`);
  }

  const temporaryDirectory = await mkdtemp(join(resolve(tmpdir()), "piora-companion-ui-test-"));
  assertSafeTemporaryDirectory(temporaryDirectory);
  const paths = await prepareIsolatedEnvironment(temporaryDirectory);
  await mkdir(join(temporaryDirectory, "agent"), { recursive: true });
  const port = await reservePort();
  let child;
  let mainClient;
  let companionClient;

  try {
    child = spawn(executable, [`--remote-debugging-port=${port}`], {
      cwd: dirname(executable),
      env: createIsolatedProcessEnvironment(temporaryDirectory, {
        PIORA_COMPANION_UI_TEST: "1",
        PIORA_COMPANION_UI_TEST_USER_DATA: paths.userData,
        PI_CODING_AGENT_DIR: join(temporaryDirectory, "agent"),
        NEXT_TELEMETRY_DISABLED: "1",
      }),
      shell: false,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_384); });

    const mainTargetPredicate = (target) => (
      target.type === "page"
      && /^http:\/\/127\.0\.0\.1:\d+\/?(?:[?#].*)?$/.test(target.url)
    );
    const companionTargetPredicate = (target) => target.type === "page" && target.url.includes("/desktop-pet");
    const mainTarget = await waitForTarget(port, mainTargetPredicate, "packaged Piora main renderer");
    mainClient = await CdpClient.connect(mainTarget.webSocketDebuggerUrl);
    await waitForMainRendererReady(mainClient);

    const preferences = {
      version: 1,
      open: true,
      selectedPetId: "pekka-pal.codex-pet",
      todos: [],
      phrases: [],
    };
    await evaluate(
      mainClient,
      `localStorage.setItem(${JSON.stringify(COMPANION_STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(preferences))}); true`,
    );
    await mainClient.send("Page.reload", { ignoreCache: true });
    mainClient.close();

    const reloadedMainTarget = await waitForTarget(port, mainTargetPredicate, "reloaded Piora main renderer");
    mainClient = await CdpClient.connect(reloadedMainTarget.webSocketDebuggerUrl);
    const companionTarget = await waitForTarget(port, companionTargetPredicate, "standalone companion renderer");
    companionClient = await CdpClient.connect(companionTarget.webSocketDebuggerUrl);

    const ready = await waitForCompanionReady(companionClient);
    assert.match(ready.htmlClass, /desktop-pet-document/);
    assert.match(ready.bodyClass, /desktop-pet-document/);
    assert.equal(ready.bodyBackground, "rgba(0, 0, 0, 0)");
    assert.equal(ready.rootBackground, "rgba(0, 0, 0, 0)");
    assert.equal(ready.bubbleFound, false);
    assert.ok(ready.petRect.width >= 120 && ready.petRect.height >= 130);
    assert.match(ready.spriteBackgroundImage, /companion-pets/);
    assert.notEqual(ready.spriteImageRendering, "pixelated");

    const activityStates = ["running", "waiting", "review", "failed"];
    const observedStates = [];
    for (const status of activityStates) {
      const cause = `packaged-ui-${status}`;
      await publishActivity(mainClient, status, cause);
      await delay(220);
      const observed = await inspectCompanion(companionClient);
      assert.equal(observed.bubbleVisible, "true");
      assert.equal(observed.bubbleStatus, status);
      assert.match(observed.bubbleText, new RegExp(cause));
      observedStates.push(status);
    }

    await publishActivity(mainClient, "running", "packaged-ui-animation");
    await delay(80);
    const animationPositions = [];
    for (let index = 0; index < 5; index += 1) {
      animationPositions.push((await inspectCompanion(companionClient)).spriteBackgroundPosition);
      await delay(150);
    }
    assert.ok(new Set(animationPositions).size > 1, "Running pet animation did not advance frames");

    await publishActivity(mainClient, "review", "请确认打包后的桌宠气泡");
    await delay(250);
    const screenshot = await companionClient.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const screenshotBytes = Buffer.from(screenshot.data, "base64");
    const screenshotStats = await sharp(screenshotBytes).stats();
    const alpha = screenshotStats.channels[3];
    assert.ok(alpha && alpha.min === 0 && alpha.max === 255, "Companion screenshot did not preserve transparent pixels");
    await writeFile(screenshotPath, screenshotBytes);

    assert.equal(ready.windowBounds.width, 156);
    assert.equal(ready.windowBounds.height, 184);
    const movedLeft = Number(ready.windowBounds.left ?? 0) + 12;
    const movedTop = Number(ready.windowBounds.top ?? 0) + 12;
    await evaluate(companionClient, `window.moveTo(${movedLeft}, ${movedTop}); true`);
    await delay(500);
    const movedWindow = await inspectCompanion(companionClient);
    assert.equal(movedWindow.windowBounds.left, movedLeft);
    assert.equal(movedWindow.windowBounds.top, movedTop);
    const desktopState = JSON.parse(await readFile(join(paths.userData, "desktop-state.json"), "utf8"));
    assert.deepEqual(desktopState.companionWindowPosition, { x: movedLeft, y: movedTop });

    await publishActivity(mainClient, "idle", "packaged-ui-idle");
    await delay(200);
    const idle = await inspectCompanion(companionClient);
    assert.equal(idle.bubbleFound, false);
    assert.equal(idle.windowBounds.width, 156);
    assert.equal(idle.windowBounds.height, 184);

    assert.equal(
      await evaluate(mainClient, "window.piDesktop.setCompanionWindowVisible(false)"),
      true,
    );
    companionClient.close();
    companionClient = undefined;
    await waitForTargetToClose(port, companionTargetPredicate, "standalone companion renderer");
    assert.equal(
      await evaluate(mainClient, "window.piDesktop.setCompanionWindowVisible(true)"),
      true,
    );
    const reopenedTarget = await waitForTarget(port, companionTargetPredicate, "reopened companion renderer");
    companionClient = await CdpClient.connect(reopenedTarget.webSocketDebuggerUrl);
    const reopened = await waitForCompanionReady(companionClient);
    assert.equal(reopened.bodyBackground, "rgba(0, 0, 0, 0)");

    await evaluate(mainClient, "window.close(); true").catch(() => undefined);
    await delay(1_000);

    console.log(JSON.stringify({
      executable,
      isolatedUserData: true,
      transparentWindow: true,
      bundledSpriteLoaded: true,
      animationAdvanced: true,
      activityStates: observedStates,
      idleBubbleHidden: true,
      positionPersisted: true,
      hideAndWakePassed: true,
      screenshot: screenshotPath,
      screenshotAlpha: { min: alpha.min, max: alpha.max },
      stderr: stderr || undefined,
    }));
  } finally {
    companionClient?.close();
    mainClient?.close();
    await stopChild(child);
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
