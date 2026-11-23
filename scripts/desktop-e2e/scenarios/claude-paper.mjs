import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { captureGestureTransitions, recordClaudePaper } from "../claude-paper-capture.mjs";
import { isolatedEnvironment, portOpen, reservePort, startProcess, stopProcess, waitUntil as waitFor } from "../lifecycle.mjs";
import { installWallpaperResourceProbe, verifyWallpaperPause } from "../wallpaper-resources.mjs";

const PRESET = "character-claude-paper";
const puppetCanvas = preset => 'canvas[data-character-background="' + preset + '"][data-puppet-wallpaper]';
const LIVE_ASSETS = "/themes/character-backgrounds/claude-live/";
const assetsFor = preset => ["face-atlas.webp", "parts-atlas.webp", "rig.json", "stage.webp"]
  .map(file => LIVE_ASSETS + preset.replace(/^character-/, "") + "/" + file);
const WORKFLOW_PATH = /^\/api\/agent\/[^/]+\/workflow$/;
const provider = "claude-puppet-qa";
const model = "paper-study-qa";
const fixtureTool = "puppet_qa_turn_page";
const SEND = /^(Send|发送)$/;
const SETTINGS = /^(Settings|设置)$/;
const CLOSE_SETTINGS = /^(Back to Piora|返回 Piora)$/;
const MOTION = /^(Character animation|角色动画)$/;
const READABILITY = /^(Readability overlay|可读性遮罩)/i;
const BACKGROUND = /^(Background|背景)$/;

function sendEventStream(response) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "close" });
  response.flushHeaders();
  return {
    emit(delta, finish_reason = null) {
      const data = { id: "paper-study-qa", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
        model, choices: [{ index: 0, delta, finish_reason }] };
      response.write("data: " + JSON.stringify(data) + "\n\n");
    },
    end() { response.end("data: [DONE]\n\n"); },
  };
}

async function prepareModel({ paths, directory, report, registerCleanup }) {
  const requests = [];
  const countByPrompt = new Map();
  const held = new Map();
  const hold = (response, stage) => new Promise(resolve => {
    held.set(stage, resolve);
    response.once("close", resolve);
  }).finally(() => held.delete(stage));
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      const messages = body.messages ?? [];
      const lastUser = JSON.stringify(messages.findLast(message => message.role === "user")?.content ?? "");
      const utility = lastUser.includes("You are a precise session title editor.") || !lastUser.includes("PUPPET_QA_");
      const tools = (body.tools ?? []).map(tool => tool.function?.name);
      const kind = utility ? "title" : lastUser.includes("PUPPET_QA_RETRY") ? "retry"
        : lastUser.includes("PUPPET_QA_ERROR") ? "error" : lastUser.includes("PUPPET_QA_TOOLS") ? "tools" : "browser";
      const count = (countByPrompt.get(kind) ?? 0) + 1;
      countByPrompt.set(kind, count);
      requests.push({ kind, count, tools, at: Date.now(), path: request.url });
      assert.ok(requests.length < 24, "Model fixture request loop");
      if (kind === "error" || (kind === "retry" && count === 1)) {
        response.writeHead(kind === "retry" ? 503 : 400, { "Content-Type": "application/json", Connection: "close" });
        response.end(JSON.stringify({ error: { message: "PUPPET_QA synthetic provider failure" } }));
        return;
      }
      const stream = sendEventStream(response);
      if (kind === "tools" && !messages.some(message => message.role === "tool")) {
        await hold(response, "think");
        if (response.destroyed) return;
        assert.ok(tools.includes(fixtureTool), "The dev session exposes the approved local fixture tool");
        stream.emit({ role: "assistant", tool_calls: [{ index: 0, id: "paper-study-tool", type: "function",
          function: { name: fixtureTool, arguments: "{}" } }] });
        stream.emit({}, "tool_calls");
      } else {
        stream.emit({ role: "assistant", content: kind === "title" ? "Paper study" : "A page turns in the paper study." });
        if (kind === "tools" || kind === "browser") {
          const deltas = setInterval(() => stream.emit({ content: " ·" }), 350);
          try { await hold(response, kind === "tools" ? "stream" : "web-stream"); }
          finally { clearInterval(deltas); }
          if (response.destroyed) return;
          stream.emit({ content: " The fixture has finished." });
        }
        stream.emit({}, "stop");
      }
      stream.end();
    } catch (error) {
      requests.push({ error: error.message });
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  registerCleanup(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const models = [{ id: model, name: "Paper study test model", reasoning: false, input: ["text"], contextWindow: 65536,
    maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }];
  await writeFile(join(paths.agent, "models.json"), JSON.stringify({ providers: { [provider]: {
    api: "openai-completions", baseUrl: "http://127.0.0.1:" + server.address().port + "/v1", apiKey: "loopback-only", models,
  } } }));
  const extension = join(directory, "puppet-qa-tool.ts");
  await writeFile(extension, [
    'import { Type } from "typebox";',
    'export default function (pi) {',
    '  pi.registerTool({ name: "' + fixtureTool + '", label: "Paper rehearsal", description: "Pause briefly during the local verification, then return a marker.",',
    '    parameters: Type.Object({}),',
    '    async execute() {',
    '      await new Promise(resolve => setTimeout(resolve, 2200));',
    '      return { content: [{ type: "text", text: "PUPPET_QA_TOOL_COMPLETED" }] };',
    '    },',
    '  });',
    '}',
  ].join("\n"));
  const settingsPath = join(paths.agent, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  await writeFile(settingsPath, JSON.stringify({ ...settings, defaultProvider: provider, defaultModel: model,
    extensions: [...settings.extensions, extension],
    enabledModels: [provider + "/" + model], retry: { enabled: true, maxRetries: 1, baseDelayMs: 1_300, provider: { maxRetries: 0 } } }));
  report.fixture = { provider, model, requests, credentials: "synthetic-loopback-only" };
  return held;
}

async function openAppearance(page) {
  const dialog = page.getByRole("dialog", { name: SETTINGS });
  const backgroundTab = dialog.getByRole("tab", { name: BACKGROUND });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!await dialog.isVisible()) await page.getByRole("button", { name: SETTINGS }).press("Enter", { timeout: 12_000 });
      if (!await backgroundTab.isVisible()) {
        await dialog.getByRole("button", { name: /^(Appearance & Language|外观与界面)$/ }).press("Enter", { timeout: 12_000 });
      }
      await backgroundTab.waitFor({ timeout: 12_000 });
      return dialog;
    } catch (error) {
      if (attempt === 2 || page.isClosed()) throw error;
      await page.waitForLoadState("domcontentloaded");
    }
  }
}

async function openBackground(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const dialog = await openAppearance(page);
    const slider = dialog.getByRole("slider", { name: READABILITY });
    try {
      if (!await slider.isVisible()) {
        await dialog.getByRole("tab", { name: BACKGROUND }).press("Enter", { timeout: 8_000 });
      }
      await slider.waitFor({ timeout: 8_000 });
      return dialog;
    } catch (error) {
      // A newly persisted session can replace the shell while opening settings.
      if (attempt === 2 || await dialog.isVisible()) throw error;
      await page.waitForLoadState("domcontentloaded");
    }
  }
}

async function closeSettings(dialog) {
  const back = dialog.getByRole("button", { name: CLOSE_SETTINGS });
  if (await dialog.isVisible()) {
    try { await back.press("Enter", { timeout: 8_000 }); }
    catch (error) { if (await dialog.isVisible()) throw error; }
  }
  await dialog.waitFor({ state: "hidden" });
}

async function enableDebug(page) {
  await page.evaluate(() => sessionStorage.setItem("piora-claude-wallpaper-debug", "1"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function selectSkin(page, preset) {
  const options = { timeout: 4_000 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const dialog = await openAppearance(page);
    const look = dialog.locator('[data-appearance-look="' + preset + '"]');
    try {
      if (!await look.isVisible()) await dialog.getByRole("tab", { name: /^(Theme & colors|主题与配色)$/i }).press("Enter", options);
      await look.press("Enter", options);
      await closeSettings(dialog);
      break;
    } catch (error) {
      if (await dialog.isVisible() || attempt === 2) throw error;
    }
  }
}

async function enableSkin(page, preset = PRESET) {
  await selectSkin(page, preset);
  const canvas = preset === "character-gpt-cloud"
    ? 'canvas[data-character-background="character-gpt-cloud"]' : puppetCanvas(preset);
  await page.locator(canvas + '[data-ready="true"]').waitFor();
}

async function captureWallpaperFocusChain({ page, directory }, requests) {
  await page.evaluate(installWallpaperResourceProbe);
  const samples = [];
  const state = () => page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    preset: document.documentElement.dataset.appBackgroundPreset,
    overlay: document.documentElement.style.getPropertyValue("--app-background-overlay"),
    position: getComputedStyle(document.body, "::before").backgroundPosition,
  }));
  try {
    for (const preset of [PRESET, "character-claude-lamp", "character-claude-autumn", "character-gpt-cloud", PRESET]) {
      // Keep the real canvas loader pending while the already selected skin's
      // original WebP is visible. Both screenshots use the same UI and wash.
      const asset = preset === "character-gpt-cloud"
        ? "/themes/character-backgrounds/motion/gpt-cloud.png"
        : LIVE_ASSETS + preset.replace(/^character-/, "") + "/rig.json";
      const pattern = "**" + asset;
      const release = Promise.withResolvers(), requested = Promise.withResolvers();
      let routeError;
      const hold = async route => {
        requested.resolve();
        await release.promise;
        try { await route.continue(); }
        catch (error) { routeError = error; }
      };
      const prefix = "switch-" + (samples.length + 1) + "-" + preset;
      const files = { static: prefix + "-static.png", first: prefix + "-first.png" };
      await page.route(pattern, hold);
      let before;
      try {
        const seen = Promise.race([requested.promise, delay(15_000, undefined, { ref: false }).then(() => {
          throw new Error("Wallpaper loader was not intercepted: " + asset);
        })]);
        await Promise.all([selectSkin(page, preset), seen]);
        await page.waitForFunction(preset => document.documentElement.dataset.appBackgroundPreset === preset
          && !document.querySelector("body > canvas[data-character-background][data-ready=true]"), preset);
        await page.evaluate(async preset => {
          const image = new Image();
          image.src = "/themes/character-backgrounds/" + preset.replace(/^character-/, "") + ".webp";
          await image.decode();
        }, preset);
        before = await state();
        await page.screenshot({ path: join(directory, files.static), animations: "disabled" });
        await page.evaluate(preset => window.__pioraWallpaperProbe.freezeWhenReady(preset), preset);
        release.resolve();
        await page.waitForFunction(preset => window.__pioraWallpaperProbe.isFrozen()
          && window.__pioraWallpaperProbe.ready(preset), preset);
        if (routeError) throw routeError;
      } finally {
        release.resolve();
        await page.unroute(pattern, hold);
      }
      const history = await page.evaluate(() => window.__pioraWallpaperProbe.snapshot());
      const last = history.at(-1);
      assert.equal(last.id, preset);
      assert.equal(last.created, preset === "character-gpt-cloud" ? 2 : 3);
      assert.equal(last.live, last.created);
      assert.ok(last.position.split(",").every(layer => layer.trim() === "80% 50%"), last.position);
      assert.ok(last.drawCalls > 0);
      const firstFrame = preset === "character-gpt-cloud" ? last.drawCalls : (await snapshot(page)).framesDrawn;
      assert.equal(firstFrame, 1, "only the first GPU frame was submitted");
      for (const old of history.slice(0, -1)) {
        assert.ok(old.lost && !old.connected && old.live === 0 && old.deleted === old.created);
      }
      assert.deepEqual(await state(), before, "identical viewport, DPR and wash in the pair");
      const bounds = await page.locator(`canvas[data-character-background="${preset}"][data-ready=true]`).evaluate(canvas => ({
        rect: canvas.getBoundingClientRect().toJSON(), cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight,
        backingWidth: canvas.width, backingHeight: canvas.height,
      }));
      await page.screenshot({ path: join(directory, files.first), animations: "disabled" });
      const after = await page.evaluate(() => window.__pioraWallpaperProbe.snapshot().at(-1));
      assert.equal(after.drawCalls, last.drawCalls, "capture did not advance into the next GPU frame");
      samples.push({ at: Date.now(), target: preset, ...before, firstFrame, bounds, files, history });
      await page.evaluate(() => window.__pioraWallpaperProbe.resume());
    }
    assertClaudeAssets(requests, [PRESET, "character-claude-lamp", "character-claude-autumn"]);
  } finally {
    await page.evaluate(() => window.__pioraWallpaperProbe?.restore());
    await writeFile(join(directory, "hot-switch.json"), JSON.stringify(samples, null, 2));
  }
}

export const claudeWallpaperFocusScenario = {
  id: "claude-wallpaper-first-frame-focus",
  mode: "desktop-ui-and-webgl-observer",
  scope: "same-viewport Electron static originals and first dynamic frames",
  coverage: ["theme switching through settings", "actual first WebGL output and texture disposal"],
  limits: ["held rig/atlas response for the static shot", "first canvas submitted frame paused via the application blur handler"],
  async run(context) {
    const { page, step } = context;
    const requests = watchWallpaperRoutes(page);
    await step("electron-wallpaper-focus-chain", async () => {
      await page.setViewportSize({ width: 1440, height: 920 });
      await enableDebug(page);
      await captureWallpaperFocusChain(context, requests);
    });
  },
};

const snapshot = page => page.evaluate(() => window.__pioraPuppetDebug?.snapshot() ?? null);
const setState = (page, state) => page.evaluate(value => window.__pioraPuppetDebug.setState(value), state);
const waitForState = (page, state, waitUntil) => waitUntil(async () => {
  const stateSnapshot = await snapshot(page);
  return stateSnapshot?.state === state && stateSnapshot.liveState === state && stateSnapshot;
}, "live Claude state " + state);

function watchWallpaperRoutes(page) {
  const requests = [];
  const started = new WeakMap();
  const pathOf = request => new URL(request.url()).pathname;
  page.on("request", request => {
    const path = pathOf(request);
    if (path.startsWith(LIVE_ASSETS) || (request.method() === "GET" && WORKFLOW_PATH.test(path))) {
      started.set(request, performance.now());
    }
  });
  function record(request, outcome) {
    const since = started.get(request);
    if (since !== undefined) requests.push({
      path: pathOf(request), at: Date.now(), elapsedMs: Math.round(performance.now() - since), ...outcome,
    });
  }
  page.on("response", response => record(response.request(), { status: response.status() }));
  page.on("requestfailed", request => record(request, { failure: request.failure()?.errorText }));
  return requests;
}

function assertClaudeAssets(requests, presets = [PRESET]) {
  const assets = requests.filter(row => row.path.startsWith(LIVE_ASSETS));
  const expected = presets.flatMap(assetsFor);
  assert.deepEqual([...new Set(assets.map(row => row.path))].sort(), expected.toSorted());
  for (const path of expected) assert.ok(assets.some(row => row.path === path && row.status === 200), path);
}

async function screenshotSequence({ page, directory, step, screenshot, waitUntil }, requests,
  { preset = PRESET, defaultOverlay = 64, codeFile = false } = {}) {
  const canvas = puppetCanvas(preset);
  const overlay = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--app-background-overlay"));
  const resting = async () => {
    const evidence = await page.evaluate(() => window.__pioraPuppetDebug.stepFrames("idle", 33, true));
    assert.ok(evidence.hand[0] > 0.999 && !evidence.pageTurning);
    return evidence;
  };
  await step("default-overlay-and-static-seam", async () => {
    await waitUntil(async () => await overlay() === defaultOverlay + "%", "default readability overlay");
    const recovering = page.getByText(/^(Delivery unconfirmed|发送状态待确认)/);
    await recovering.first().waitFor({ state: "hidden", timeout: 12_000 });
    const workflowError = page.getByRole("alert").filter({ hasText: /Workflow state could not be loaded|无法加载工作流状态/ });
    await waitUntil(() => requests.some(row => WORKFLOW_PATH.test(row.path) && row.status === 200), "workflow loaded from the real agent route");
    const usedWorkflowRetry = await workflowError.isVisible();
    if (usedWorkflowRetry) await workflowError.getByRole("button", { name: /^(Retry loading|重新加载)$/ }).click();
    await workflowError.waitFor({ state: "hidden", timeout: 15_000 });
    const position = await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundPosition);
    assert.ok(position.split(",").every(layer => layer.trim() === "80% 50%"), position);
    const bounds = await page.locator(canvas).boundingBox();
    assert.ok(bounds && bounds.width > 0);
    const state = await snapshot(page);
    const screenWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const ambientX = (bounds.x + bounds.width * state.ambientStart) / screenWidth;
    assert.ok(ambientX >= 0.62, "ambient effects start to the right of the quiet reading area");
    assert.ok(state.width * state.height <= 1_600_000);
    const restingPose = await resting();
    assert.equal(await workflowError.isVisible(), false, "workflow must be healthy in the default screenshot");
    await screenshot(`overlay-${defaultOverlay}-dynamic.png`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(canvas).waitFor({ state: "detached" });
    assert.equal(await snapshot(page), null);
    assert.equal(await workflowError.isVisible(), false);
    await screenshot(`overlay-${defaultOverlay}-static.png`);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator(canvas + '[data-ready="true"]').waitFor();
    assert.deepEqual(await page.locator(canvas).boundingBox(), bounds);
    await writeFile(join(directory, "static-dynamic-geometry.json"), JSON.stringify({
      staticPosition: position, canvasBounds: bounds, ambientX, restingPose,
      workflowWarningVisible: false, usedWorkflowRetry,
    }));
  });
  await step("low-overlay-and-file-panel", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const dialog = await openBackground(page);
      const slider = dialog.getByRole("slider", { name: READABILITY });
      const options = { timeout: 4_000 };
      try {
        if (await slider.inputValue(options) !== "20") {
          await slider.press("Home", options);
          await slider.press("PageUp", options);
          await slider.press("PageUp", options);
          const difference = 20 - Number(await slider.inputValue(options));
          for (let count = 0; count < Math.abs(difference); count++) {
            await slider.press(difference < 0 ? "ArrowLeft" : "ArrowRight", options);
          }
        }
        assert.equal(await slider.inputValue(options), "20");
        await closeSettings(dialog);
        break;
      } catch (error) {
        // The new chat may still navigate and close settings while the keyboard
        // interaction is underway. Recover the requested value through the UI.
        if (await dialog.isVisible() || attempt === 2) throw error;
      }
    }
    await waitUntil(async () => await overlay() === "20%", "applied 20 percent overlay");
    const restingPose = await resting();
    try {
      await screenshot("overlay-20-dynamic.png");
      await page.getByRole("button", { name: /^(Show file panel|显示文件面板)$/ }).click();
      const panel = page.locator("#file-panel.right-panel-open");
      const files = panel.locator("#workspace-files");
      await files.waitFor({ state: "attached" });
      if (!await files.isVisible()) await panel.getByRole("button").filter({ has: page.getByText(/^(Files|文件)$/) }).press("Enter");
      await files.waitFor({ state: "visible" });
      const viewer = files.locator("#piora-file-viewer");
      const empty = viewer.getByText(/^(No file open|没有打开的文件)$/);
      let fileEvidence;
      if (codeFile) {
        const navigator = files.locator("#piora-file-explorer");
        if (!await navigator.isVisible()) await files.getByRole("button", { name: /^(Explorer|文件浏览器)$/ }).click();
        const entry = files.locator('[role="treeitem"][data-tree-label="next.config.ts"]').first();
        await entry.waitFor({ state: "visible" });
        await entry.click();
        await waitUntil(async () => (await viewer.innerText()).includes("developmentFilesystemCache"), "real code loaded in the file viewer");
        await empty.waitFor({ state: "hidden" });
        fileEvidence = { openFile: true, name: "next.config.ts", checkedContent: "developmentFilesystemCache" };
      } else {
        await empty.waitFor({ state: "visible" });
        fileEvidence = { openFile: false, emptyLabel: await empty.innerText() };
      }
      const filter = await panel.evaluate(element => getComputedStyle(element).backdropFilter);
      assert.equal(filter, "blur(1.5px)");
      await screenshot("overlay-20-file-panel.png");
      await writeFile(join(directory, "file-panel-check.json"), JSON.stringify({
        activeTab: "files", ...fileEvidence, filter, restingPose,
      }));
      await page.getByRole("button", { name: /^(Hide file panel|隐藏文件面板)$/ }).first().click();
    } finally {
      await page.evaluate(() => window.__pioraPuppetDebug?.resume());
    }
  });
}

async function verifyOrdinaryBrowser(origin, waitUntil, directory, release, report, preset) {
  const chromiumOptions = process.env.PIORA_BROWSER_EXECUTABLE
    ? { executablePath: process.env.PIORA_BROWSER_EXECUTABLE }
    : process.platform === "win32" ? { channel: "msedge" } : {};
  const browser = await chromium.launch({
    ...chromiumOptions, headless: false, args: ["--enable-unsafe-swiftshader"],
    ignoreDefaultArgs: ["--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1300, height: 810 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    report.wallpaperRoutes = watchWallpaperRoutes(page);
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    report.pageErrors = pageErrors;
    const response = await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 90_000 });
    assert.ok(response?.ok(), "Independent browser Piora server returned " + response?.status());
    await page.bringToFront();
    const skip = page.getByRole("button", { name: /^(Skip guide|跳过引导)$/ });
    await waitUntil(async () => {
      if (await skip.isVisible()) { await skip.press("Enter"); return false; }
      return await page.evaluate(() => {
        const saved = localStorage.getItem("piora-first-run-onboarding:v1");
        return Boolean(saved && ["completed", "dismissed"].includes(JSON.parse(saved).status));
      });
    }, "browser onboarding dismissed");
    await enableDebug(page);
    await enableSkin(page, preset);
    assertClaudeAssets(report.wallpaperRoutes, [preset]);
    assert.equal(await page.locator(".app-shell").evaluate(el => el.classList.contains("desktop-chrome")), false);
    report.observed.push("browser-without-desktop-preload");
    const composer = page.locator(".chat-composer-textarea").first();
    await composer.fill("PUPPET_QA_BROWSER");
    await waitForState(page, "user_typing", waitUntil);
    report.observed.push("user_typing");
    await page.getByRole("button", { name: SEND }).press("Enter");
    await waitForState(page, "streaming", waitUntil);
    report.observed.push("streaming");
    await page.screenshot({ path: join(directory, "browser-streaming.png") });
    const snap = await snapshot(page);
    assert.ok(snap.width * snap.height <= 1_600_000);
    const surface = await page.locator(puppetCanvas(preset)).evaluate(canvas => ({
      width: canvas.clientWidth, height: canvas.clientHeight, devicePixelRatio: devicePixelRatio,
    }));
    assert.ok(snap.width / surface.width <= 1.5 && snap.height / surface.height <= 1.5);
    report.canvas = { ...surface, backingWidth: snap.width, backingHeight: snap.height, pixels: snap.width * snap.height };
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    try {
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
      const nativeSignal = await waitFor(async () => {
        report.hiddenWindow = await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }));
        return report.hiddenWindow.visibility === "hidden" || !report.hiddenWindow.focused;
      }, { timeoutMs: 5_000, label: "minimized browser document hidden or unfocused" }).catch(error => {
        if (!error.message.startsWith("Timed out waiting")) throw error;
        return false;
      });
      if (nativeSignal) {
        const paused = await waitUntil(async () => {
          const state = await snapshot(page);
          return state && !state.running && state;
        }, "minimized browser stopped requesting frames");
        await delay(250);
        assert.equal((await snapshot(page)).framesDrawn, paused.framesDrawn);
        report.observed.push("minimized-window-raf-stopped");
      }
    } finally {
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await cdp.detach();
      await page.bringToFront();
    }
    // Browser automation can leave an OS-minimized window visible to Blink.
    // Exercise the same ordinary DOM handlers and record how the events arrived.
    report.visibilityChecks = await verifyWallpaperPause(page);
    report.observed.push("blur-and-visibility-raf-stop-and-resume");
    await release("web-stream");
    await waitForState(page, "success", waitUntil);
    report.observed.push("success");
    if (preset !== PRESET) {
      await waitForState(page, "idle", waitUntil);
      const canvas = puppetCanvas(preset);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator(canvas).waitFor({ state: "detached" });
      report.observed.push("reduced-motion-static-fallback");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.locator(canvas + '[data-ready="true"]').waitFor();
      let dialog = await openBackground(page);
      await dialog.getByRole("checkbox", { name: MOTION }).uncheck();
      await page.locator(canvas).waitFor({ state: "detached" });
      assert.equal(await snapshot(page), null);
      dialog = await openBackground(page);
      await dialog.getByRole("checkbox", { name: MOTION }).check();
      await closeSettings(dialog);
      await page.locator(canvas + '[data-ready="true"]').waitFor();
      report.observed.push("motion-setting-fallback-and-remount");
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
}

export async function runClaudePaperBrowser(root, signal, preset = PRESET) {
  const verification = join(root, ".verification");
  await mkdir(verification, { recursive: true });
  const directory = await mkdtemp(join(verification, preset.replace(/^character-/, "") + "-web-"));
  const lease = await reservePort();
  const paths = {
    port: lease.port, debugPort: lease.port,
    profile: join(directory, "profile"), agent: join(directory, "agent"),
    dist: relative(root, join(directory, "next")).replaceAll("\\", "/"),
    tsconfig: relative(root, join(directory, "tsconfig.json")).replaceAll("\\", "/"),
  };
  const report = { status: "running", scope: "independent Piora browser server on loopback", preset, observed: [], cleanupErrors: [] };
  const cleanup = [];
  let leased = true;
  const waitUntil = (work, label) => waitFor(work, { label, signal, timeoutMs: 60_000 });
  const origin = "http://127.0.0.1:" + lease.port;
  try {
    await mkdir(paths.agent);
    await writeFile(join(paths.agent, "settings.json"), JSON.stringify({ packages: [], extensions: [], skills: [] }));
    await writeFile(join(directory, "tsconfig.json"), JSON.stringify({
      extends: "../../tsconfig.json", compilerOptions: { tsBuildInfoFile: "./web.tsbuildinfo" },
      include: ["../../**/*.ts", "../../**/*.tsx"],
    }));
    const held = await prepareModel({ paths, directory, report, registerCleanup: close => cleanup.push(close) });
    const log = createWriteStream(join(directory, "web.log"));
    cleanup.push(() => new Promise(resolve => log.end(resolve)));
    await lease.release();
    leased = false;
    const app = startProcess(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"),
      "dev", "-H", "127.0.0.1", "-p", String(lease.port), "--turbopack"],
      { cwd: root, env: isolatedEnvironment(process.env, paths), stdio: ["ignore", "pipe", "pipe"] });
    cleanup.push(() => stopProcess(app));
    app.child.stdout.pipe(log, { end: false });
    app.child.stderr.pipe(log, { end: false });
    await waitFor(async () => {
      if (app.outcome()) throw new Error("Browser service stopped before it was ready");
      return portOpen(lease.port);
    }, { signal, timeoutMs: 90_000, label: "standalone browser service listening" });
    const release = async (key) => (await waitUntil(() => held.get(key), "loopback model " + key))();
    await verifyOrdinaryBrowser(origin, waitUntil, directory, release, report, preset);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
  } finally {
    for (const close of cleanup.reverse()) {
      try { await close(); } catch (error) { report.cleanupErrors.push(error.message); }
    }
    if (leased) await lease.release().catch(error => report.cleanupErrors.push(error.message));
    if (await portOpen(lease.port)) report.cleanupErrors.push("Browser test port is still open");
    if (report.cleanupErrors.length) report.status = "failed";
    await writeFile(join(directory, "result.json"), JSON.stringify(report, null, 2));
  }
  return { directory, report };
}

export function claudePaperScenario({ orderedPreview = false, scene = "paper", hotSwitch = false } = {}) {
  let held;
  let reviewProject;
  const preset = "character-claude-" + scene;
  const canvas = puppetCanvas(preset);
  const defaultOverlay = scene === "lamp" ? 62 : 64;
  return {
    id: "claude-" + scene + (orderedPreview ? "-gate-preview" : ""),
    mode: "loopback-model-fixture",
    scope: `Claude ${scene} in a real Electron development window`,
    coverage: ["real Piora composer, agent SSE, approval and execution of a local extension tool, streaming mouth and completion",
      "four packaged asset responses", `${defaultOverlay}%/20%/file-panel screenshots`,
      ...(orderedPreview ? ["ordered nine-state Gate recording with a live click greeting"] :
        ["10-state and directed-gesture recordings", "retry, failure, reduced motion and cleanup"]),
      ...(hotSwitch ? ["three Claude skins and GPT Cloud hot switched with resource disposal checks"] : [])],
    limits: ["scripted local provider and local fixture tool", "development Electron", "no physical DPI or production provider coverage"],
    async prepare(context) {
      held = await prepareModel(context);
      if (scene !== "paper") {
        reviewProject = join(context.directory, "wallpaper-review-project");
        await mkdir(reviewProject);
        const source = new URL("../../../next.config.ts", import.meta.url);
        await writeFile(join(reviewProject, "next.config.ts"), await readFile(source));
        context.report.fixture.fileViewerProject = reviewProject;
        context.report.fixture.fileViewerSource = "Unmodified next.config.ts copied from the isolated checkout";
      }
    },
    async run(context) {
      const { page, directory, step, screenshot, waitUntil, signal } = context;
      const requests = watchWallpaperRoutes(page);
      const seen = [];
      const observe = async (state) => {
        const evidence = await waitForState(page, state, waitUntil);
        seen.push({ ...evidence, at: Date.now() });
      };
      const release = async (key) => {
        const releaseResponse = await waitUntil(() => held.get(key), "loopback model " + key);
        releaseResponse();
      };
      const composer = page.locator(".chat-composer-textarea").first();
      const submit = async (text) => {
        await composer.fill(text);
        await page.getByRole("button", { name: SEND }).click();
      };
      try {
        await step("activate-claude-" + scene, async () => {
          if (reviewProject) {
            await page.setViewportSize({ width: 1440, height: 820 });
            const url = new URL(page.url());
            url.search = new URLSearchParams({ cwd: reviewProject }).toString();
            await page.goto(url.href, { waitUntil: "domcontentloaded" });
            await composer.waitFor();
          }
          await enableDebug(page);
          await enableSkin(page, preset);
          assertClaudeAssets(requests, [preset]);
          await observe("idle");
        });
        await step("electron-approval-and-streaming-bridge", async () => {
          const permission = page.locator("[data-permission-trigger]").first();
          await permission.click();
          await page.locator('[role="menuitemradio"][data-mode="auto"]').click();
          await composer.fill("PUPPET_QA_TOOLS");
          await observe("user_typing");
          await page.getByRole("button", { name: SEND }).click();
          await observe("thinking");
          await release("think");
          await observe("waiting_approval");
          await screenshot("waiting-approval.png");
          await page.getByRole("button", { name: /^(Allow once|允许本次)$/ }).click();
          await observe("working_tools");
          await observe("streaming");
          await waitUntil(async () => (await snapshot(page))?.mouth[0] < 0.55, "visible lip motion during text streaming");
          await release("stream");
          await observe("success");
          await observe("idle");
        });
        await screenshotSequence(context, requests, { preset, defaultOverlay, codeFile: scene !== "paper" });
        if (orderedPreview) {
          await step("record-ordered-gate-preview", () => recordClaudePaper(page, directory, signal, { orderedPreview, scene }));
          if (scene === "paper") return;
        } else {
          await step("continuous-actual-page-recording", () => recordClaudePaper(page, directory, signal));
        }
        await step("all-directed-arm-transition-keyframes", () => captureGestureTransitions(page, directory, signal));
        await step("retry-and-terminal-error", async () => {
          await submit("PUPPET_QA_RETRY");
          await observe("error");
          await observe("success");
          await observe("idle");
          await submit("PUPPET_QA_ERROR");
          await observe("error");
          await screenshot("terminal-error.png");
          await observe("idle");
        });
        await step("greet-and-context-recovery", async () => {
          const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
          await page.mouse.click(viewport.w * 0.93, viewport.h * 0.49);
          await observe("greet");
          await observe("idle");
          await page.mouse.click(viewport.w * 0.93, viewport.h * 0.49);
          assert.equal((await snapshot(page)).liveState, "idle", "five-second pointer cooldown");
          await page.locator(canvas).evaluate(canvas => {
            window.__pioraTestLostContext = canvas.getContext("webgl").getExtension("WEBGL_lose_context");
            window.__pioraTestLostContext.loseContext();
          });
          await page.locator(canvas + '[data-ready="true"]').waitFor({ state: "detached" });
          assert.equal((await snapshot(page)).running, false);
          await page.evaluate(() => { window.__pioraTestLostContext.restoreContext(); delete window.__pioraTestLostContext; });
          await page.locator(canvas + '[data-ready="true"]').waitFor();
        });
        await step("motion-preference-cleanup", async () => {
          const dialog = await openBackground(page);
          await dialog.getByRole("checkbox", { name: MOTION }).uncheck();
          await page.locator(canvas).waitFor({ state: "detached" });
          assert.equal(await snapshot(page), null);
          await dialog.getByRole("checkbox", { name: MOTION }).check();
          await closeSettings(dialog);
          await page.locator(canvas + '[data-ready="true"]').waitFor();
        });
        if (scene !== "paper") {
          await step("electron-blur-and-visibility", async () => {
            const visibilityChecks = await verifyWallpaperPause(page);
            await writeFile(join(directory, "visibility-check.json"), JSON.stringify(visibilityChecks, null, 2));
          });
        }
        if (hotSwitch) {
          await step("electron-wallpaper-hot-switch", () => captureWallpaperFocusChain(context, requests));
        }
      } finally {
        await writeFile(join(directory, "wallpaper-routes.json"), JSON.stringify(requests, null, 2));
        await writeFile(join(directory, "observed-live-states.json"), JSON.stringify(seen, null, 2));
      }
    },
  };
}
