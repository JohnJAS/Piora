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

async function waitForEvaluation(client, expression, description, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression);
    if (value) return value;
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function clickButtonByText(client, text) {
  return evaluate(client, `(() => {
    const text = ${JSON.stringify(text)};
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === text && !candidate.disabled);
    if (!button) throw new Error('Enabled button not found: ' + text);
    button.click();
    return true;
  })()`);
}

async function setControlValue(client, selector, value, blur = false) {
  return evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      throw new Error('Editable control not found: ' + ${JSON.stringify(selector)});
    }
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
    descriptor?.set?.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (${blur}) element.blur();
    return element.value;
  })()`);
}

async function setLabeledControlValue(client, labelText, value, blur = false) {
  return evaluate(client, `(() => {
    const labelText = ${JSON.stringify(labelText)};
    const label = [...document.querySelectorAll('label')]
      .find((candidate) => candidate.textContent?.trim().startsWith(labelText));
    const element = label?.querySelector('input, textarea, select');
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      throw new Error('Labeled editable control not found: ' + labelText);
    }
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
    descriptor?.set?.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (${blur}) element.blur();
    return element.value;
  })()`);
}

async function readPanelRuntime(client) {
  return evaluate(client, `fetch('/api/companion/state', { cache: 'no-store' }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'HTTP ' + response.status);
    return payload;
  })`);
}

async function waitForPanelRuntime(client, predicateSource, description, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(client, `fetch('/api/companion/state', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'HTTP ' + response.status);
      return (${predicateSource})(payload) ? payload : null;
    })`);
    if (state) return state;
    await delay(120);
  }
  const diagnostics = await evaluate(client, `Promise.all([
    fetch('/api/companion/state', { cache: 'no-store' }).then((response) => response.json()),
    Promise.resolve({
      busy: document.querySelector('.companion-panel-root')?.getAttribute('aria-busy'),
      textareaValue: document.querySelector('textarea')?.value ?? null,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent?.trim()),
    }),
  ])`).catch((error) => ({ diagnosticError: String(error) }));
  throw new Error(`Timed out waiting for panel runtime: ${description}; diagnostics=${JSON.stringify(diagnostics)}`);
}

async function waitForPanelIdle(client) {
  return waitForEvaluation(
    client,
    `document.querySelector('.companion-panel-root')?.getAttribute('aria-busy') === 'false'`,
    "companion panel mutation to settle",
  );
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
    const channel = window.__pioraCompanionTestChannel ??= new BroadcastChannel('pi-companion-runtime-v1');
    channel.postMessage(${payload});
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
  const isolatedAgentDirectory = join(temporaryDirectory, "agent");
  await mkdir(isolatedAgentDirectory, { recursive: true });
  await writeFile(join(isolatedAgentDirectory, "models.json"), `${JSON.stringify({
    providers: {
      "companion-ui-test": {
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "isolated-ui-test-key",
        models: [
          { id: "pet-model-a", name: "Pet Model A", api: "openai-completions", reasoning: false },
          { id: "pet-model-b", name: "Pet Model B", api: "openai-completions", reasoning: false },
        ],
      },
    },
  }, null, 2)}\n`, "utf8");
  const port = await reservePort();
  let child;
  let mainClient;
  let companionClient;
  let bubbleClient;
  let panelClient;

  try {
    child = spawn(executable, [`--remote-debugging-port=${port}`], {
      cwd: dirname(executable),
      env: createIsolatedProcessEnvironment(temporaryDirectory, {
        PIORA_COMPANION_UI_TEST: "1",
        PIORA_COMPANION_UI_TEST_USER_DATA: paths.userData,
        PI_CODING_AGENT_DIR: isolatedAgentDirectory,
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
    const bubbleTargetPredicate = (target) => target.type === "page" && target.url.includes("/desktop-companion-bubble");
    const panelTargetPredicate = (target) => target.type === "page" && target.url.includes("/desktop-companion-panel");
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
    const bubbleTarget = await waitForTarget(port, bubbleTargetPredicate, "standalone companion timer bubble renderer");
    bubbleClient = await CdpClient.connect(bubbleTarget.webSocketDebuggerUrl);
    await companionClient.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });

    let ready;
    try {
      ready = await waitForCompanionReady(companionClient);
    } catch (error) {
      const companionSnapshot = await inspectCompanion(companionClient).catch((snapshotError) => ({
        inspectionError: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
      }));
      const companionDiagnostics = await evaluate(companionClient, `Promise.all([
        fetch('/api/companion-pets', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
          .then(async (response) => ({ status: response.status, body: (await response.text()).slice(0, 1000) }))
          .catch((error) => ({ fetchError: String(error) })),
        Promise.resolve({
          preferences: localStorage.getItem(${JSON.stringify(COMPANION_STORAGE_KEY)}),
          bodyText: document.body?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 1000) ?? '',
        }),
      ])`).catch((diagnosticError) => ({
        evaluationError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n` +
        `Companion snapshot: ${JSON.stringify(companionSnapshot)}\n` +
        `Companion diagnostics: ${JSON.stringify(companionDiagnostics)}\n` +
        `Packaged stderr: ${stderr || "(empty)"}`,
        { cause: error },
      );
    }
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
      const deadline = Date.now() + 3_000;
      let observed;
      while (Date.now() < deadline) {
        await publishActivity(companionClient, status, cause);
        await delay(100);
        observed = await inspectCompanion(companionClient);
        if (observed.bubbleStatus === status) break;
      }
      assert.ok(observed, `No companion activity was observed for ${status}`);
      assert.equal(observed.bubbleVisible, "true");
      assert.equal(observed.bubbleStatus, status);
      assert.ok(observed.bubbleText.length > 0, `Companion activity bubble was empty for ${status}`);
      observedStates.push(status);
    }

    await publishActivity(companionClient, "running", "packaged-ui-animation");
    await waitForEvaluation(
      companionClient,
      `document.querySelector('[data-testid="companion-activity-bubble"]')?.getAttribute('data-status') === 'running'`,
      "running companion activity before animation sampling",
    );
    await delay(80);
    const animationPositions = new Set();
    const animationDeadline = Date.now() + 3_000;
    while (Date.now() < animationDeadline && animationPositions.size < 2) {
      // The main renderer may publish a newer context snapshot while the
      // packaged app settles. Keep the synthetic activity current, and count
      // frames only while the companion still reports the running state.
      await publishActivity(companionClient, "running", "packaged-ui-animation");
      await delay(150);
      const observed = await inspectCompanion(companionClient);
      if (observed.bubbleStatus === "running" && observed.spriteBackgroundPosition) {
        animationPositions.add(observed.spriteBackgroundPosition);
      }
    }
    assert.ok(
      animationPositions.size > 1,
      `Running pet animation did not advance frames: ${JSON.stringify([...animationPositions])}`,
    );

    await publishActivity(companionClient, "review", "请确认打包后的桌宠气泡");
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

    assert.equal(await evaluate(companionClient, "window.piDesktop.companionAction('open-panel')"), true);
    const panelTarget = await waitForTarget(port, panelTargetPredicate, "companion panel renderer");
    panelClient = await CdpClient.connect(panelTarget.webSocketDebuggerUrl);
    await waitForEvaluation(
      panelClient,
      `document.querySelector('.companion-panel-root')?.getAttribute('aria-busy') === 'false'`,
      "interactive companion panel",
      20_000,
    );

    await clickButtonByText(panelClient, "番茄钟");
    await waitForEvaluation(panelClient, `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '开始')`, "focus timer controls");
    await clickButtonByText(panelClient, "开始");
    const runningTimer = await waitForPanelRuntime(panelClient, "state => state.focusTimer.status === 'running'", "focus timer to start");
    assert.ok(runningTimer.focusTimer.endsAt > Date.now());
    await waitForEvaluation(
      bubbleClient,
      `document.querySelector('[data-testid="companion-focus-timer-bubble"]')?.getAttribute('data-status') === 'running'`,
      "focus timer on the pet bubble",
    );
    await delay(1_250);
    const tickingValue = await evaluate(panelClient, `document.querySelector('strong[class*="timerValue"]')?.textContent?.trim()`);
    assert.notEqual(tickingValue, "25:00", "Focus timer display did not tick after starting");
    await clickButtonByText(panelClient, "暂停");
    const pausedTimer = await waitForPanelRuntime(panelClient, "state => state.focusTimer.status === 'paused'", "focus timer to pause");
    await waitForEvaluation(
      bubbleClient,
      `document.querySelector('[data-testid="companion-focus-timer-bubble"]')?.getAttribute('data-status') === 'paused'`,
      "paused focus timer on the pet bubble",
    );
    await delay(1_100);
    assert.equal((await readPanelRuntime(panelClient)).focusTimer.remainingSeconds, pausedTimer.focusTimer.remainingSeconds);
    await clickButtonByText(panelClient, "继续");
    await waitForPanelRuntime(panelClient, "state => state.focusTimer.status === 'running'", "focus timer to resume");
    await clickButtonByText(panelClient, "重置");
    await waitForPanelRuntime(panelClient, "state => state.focusTimer.status === 'idle' && state.focusTimer.remainingSeconds === 1500", "focus timer to reset");

    await setLabeledControlValue(panelClient, "专注", "20");
    await waitForPanelRuntime(panelClient, "state => state.focusTimer.durations.focus === 1200", "focus duration setting");
    await setLabeledControlValue(panelClient, "长休息间隔", "3");
    await waitForPanelRuntime(panelClient, "state => state.focusTimer.longBreakEvery === 3", "long break interval setting");
    await clickButtonByText(panelClient, "短休息");
    await waitForPanelRuntime(panelClient, "state => state.focusTimer.phase === 'short-break'", "short break phase selection");
    await clickButtonByText(panelClient, "专注");
    await waitForPanelRuntime(panelClient, "state => state.focusTimer.phase === 'focus'", "focus phase selection");

    await clickButtonByText(panelClient, "任务");
    await setControlValue(panelClient, `input[placeholder="添加一个待办任务"]`, "packaged-ui-task");
    await clickButtonByText(panelClient, "添加");
    await waitForPanelRuntime(panelClient, "state => state.todos.some((item) => item.text === 'packaged-ui-task')", "task creation");
    await evaluate(panelClient, `(() => {
      const row = [...document.querySelectorAll('article')].find((item) => item.textContent?.includes('packaged-ui-task'));
      const button = row?.querySelector('button');
      if (!button) throw new Error('Task completion button not found');
      button.click();
      return true;
    })()`);
    await waitForPanelRuntime(panelClient, "state => state.todos.some((item) => item.text === 'packaged-ui-task' && item.completed && item.progress === 100)", "task completion");
    await waitForPanelIdle(panelClient);
    await evaluate(panelClient, `(() => {
      const row = [...document.querySelectorAll('article')].find((item) => item.textContent?.includes('packaged-ui-task'));
      const button = [...(row?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === '删除');
      if (!button) throw new Error('Task delete button not found');
      button.click();
      return true;
    })()`);
    await waitForPanelRuntime(panelClient, "state => !state.todos.some((item) => item.text === 'packaged-ui-task')", "task deletion");

    await clickButtonByText(panelClient, "资料");
    await setControlValue(panelClient, `input[placeholder="标题"]`, "packaged-ui-note");
    await setControlValue(panelClient, `textarea[placeholder="保存一段文字、代码或命令"]`, "verified companion library content");
    await clickButtonByText(panelClient, "保存到资料架");
    await waitForPanelRuntime(panelClient, "state => state.library.some((item) => item.title === 'packaged-ui-note')", "library item creation");
    await waitForPanelIdle(panelClient);
    await evaluate(panelClient, `(() => {
      const item = [...document.querySelectorAll('article')].find((entry) => entry.textContent?.includes('packaged-ui-note'));
      const button = [...(item?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent?.trim() === '删除');
      if (!button) throw new Error('Library delete button not found');
      button.click();
      return true;
    })()`);
    await waitForPanelRuntime(panelClient, "state => !state.library.some((item) => item.title === 'packaged-ui-note')", "library item deletion");

    await clickButtonByText(panelClient, "记忆");
    await setControlValue(panelClient, `input[placeholder="例如：提醒我每 90 分钟休息"]`, "packaged-ui-memory");
    await clickButtonByText(panelClient, "记住");
    await waitForPanelRuntime(panelClient, "state => state.memories.some((item) => item.text === 'packaged-ui-memory')", "memory creation");
    await waitForPanelIdle(panelClient);
    await evaluate(panelClient, `(() => {
      const item = [...document.querySelectorAll('article')].find((entry) => entry.textContent?.includes('packaged-ui-memory'));
      const button = [...(item?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent?.trim() === '忘记');
      if (!button) throw new Error('Memory delete button not found');
      button.click();
      return true;
    })()`);
    await waitForPanelRuntime(panelClient, "state => !state.memories.some((item) => item.text === 'packaged-ui-memory')", "memory deletion");

    await clickButtonByText(panelClient, "心智");
    const selectedModel = await evaluate(panelClient, `(() => {
      const select = document.querySelector('select');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Model selector not found');
      const option = [...select.options].find((candidate) => candidate.value && candidate.value !== select.value);
      if (!option) throw new Error('No alternate interaction model is available');
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      descriptor?.set?.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.parse(option.value);
    })()`);
    await waitForEvaluation(panelClient, `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '保存模型' && !button.disabled)`, "enabled model save button");
    await clickButtonByText(panelClient, "保存模型");
    const modelState = await waitForPanelRuntime(panelClient, `state => state.settings.interactionModel?.provider === ${JSON.stringify(selectedModel.provider)} && state.settings.interactionModel?.modelId === ${JSON.stringify(selectedModel.modelId)}`, "model selection save");
    assert.deepEqual(modelState.settings.interactionModel, selectedModel);
    await waitForEvaluation(panelClient, `document.body.textContent.includes('模型已保存。')`, "model saved status");

    await setLabeledControlValue(panelClient, "自主程度", "active");
    await waitForPanelRuntime(panelClient, "state => state.settings.autonomyLevel === 'active'", "autonomy level save");
    await waitForPanelIdle(panelClient);
    await evaluate(panelClient, `(() => {
      const element = document.querySelector('textarea');
      if (!(element instanceof HTMLTextAreaElement)) throw new Error('Personality textarea not found');
      element.focus();
      element.select();
      return true;
    })()`);
    await panelClient.send("Input.insertText", { text: "packaged-ui-personality" });
    await waitForEvaluation(panelClient, `document.querySelector('textarea')?.value === 'packaged-ui-personality'`, "personality input");
    await evaluate(panelClient, `document.querySelector('textarea')?.blur(); true`);
    await waitForPanelRuntime(panelClient, "state => state.settings.personality === 'packaged-ui-personality'", "personality save");
    await evaluate(panelClient, `(() => {
      const label = [...document.querySelectorAll('label')].find((item) => item.textContent?.includes('允许宠物自主随机移动'));
      const input = label?.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Movement toggle not found');
      input.click();
      return true;
    })()`);
    await waitForPanelRuntime(panelClient, "state => state.settings.allowMovement === false", "movement toggle save");
    await evaluate(panelClient, `(() => {
      const label = [...document.querySelectorAll('label')].find((item) => item.textContent?.includes('启用安静时段'));
      const input = label?.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Quiet hours toggle not found');
      input.click();
      return true;
    })()`);
    await waitForPanelRuntime(panelClient, "state => state.settings.quietHours.enabled === true", "quiet hours toggle save");

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

    await publishActivity(companionClient, "idle", "packaged-ui-idle");
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
      panelMutationsPassed: true,
      focusTimerTicked: true,
      focusTimerLinkedToPet: true,
      modelSavePassed: true,
      screenshot: screenshotPath,
      screenshotAlpha: { min: alpha.min, max: alpha.max },
      stderr: stderr || undefined,
    }));
  } finally {
    panelClient?.close();
    bubbleClient?.close();
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
