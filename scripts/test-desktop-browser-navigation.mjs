#!/usr/bin/env node
// Exercise real Electron/CDP startup with an isolated profile; no app build.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

if (!process.versions.electron) {
  const directory = mkdtempSync(join(tmpdir(), "piora-browser-navigation-"));
  const compiler = resolve(require.resolve("@typescript/native/package.json"), "../lib/tsc.js");
  const built = spawnSync(
    process.execPath,
    [compiler, "-p", join(projectRoot, "desktop/tsconfig.json"), "--outDir", directory],
    { cwd: projectRoot, windowsHide: true, stdio: "inherit" },
  );
  if (built.error) throw built.error;
  if (built.status !== 0) throw new Error("Unable to compile the real desktop browser fixture");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const scale = process.argv
    .slice(2)
    .find((arg) => /^--dpi=(1\.25|1\.5)$/.test(arg))
    ?.split("=")[1];
  const urls = process.argv.slice(2).filter((arg) => !arg.startsWith("--dpi="));
  if (scale) env.PIORA_BROWSER_FIXTURE_DPI = scale;
  const child = spawn(
    require("electron"),
    [scriptPath, directory, ...urls, ...(scale ? ["--force-device-scale-factor=" + scale] : [])],
    {
      env,
      windowsHide: true,
      stdio: "inherit",
    },
  );
  const timer = setTimeout(() => {
    console.error("Native browser navigation test timed out after 60 seconds.");
    child.kill();
  }, 60_000);
  try {
    const [code] = await once(child, "exit");
    process.exitCode = code ?? 1;
  } finally {
    clearTimeout(timer);
    assert.match(relative(resolve(tmpdir()), resolve(directory)), /^piora-browser-navigation-[\w-]+$/);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
} else {
  void runNativeTest().catch((error) => {
    console.error(error);
    require("electron").app.exit(1);
  });
}

async function runNativeTest() {
  const { app, BrowserWindow } = require("electron");
  const directory = process.argv[2];
  assert.match(relative(resolve(tmpdir()), resolve(directory)), /^piora-browser-navigation-[\w-]+$/);
  const profile = join(directory, "profile");
  mkdirSync(profile);
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  await app.whenReady();
  const { DesktopBrowserManager } = require(join(directory, "browser-manager.js"));
  const { createBrowserAgentControl } = require(join(directory, "browser-agent-control.js"));
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<title>Navigation fixture</title><p>Browser startup succeeded</p>
      <style>button{position:fixed;left:225px;top:220px;width:100px;height:36px}</style>
      <button onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Ready</button>
      <script>document.addEventListener("pointerdown",e=>document.documentElement.dataset.pointer=[e.clientX,e.clientY].join(","))</script>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const localUrl = `http://127.0.0.1:${server.address().port}/`;
  const url = process.argv.slice(3).find((arg) => /^https?:\/\//.test(arg)) || localUrl;
  const preload = join(directory, "fixture-preload.cjs");
  writeFileSync(
    preload,
    `const {contextBridge,ipcRenderer} = require("electron");
    contextBridge.exposeInMainWorld("fixtureBrowser", {
      action: value => ipcRenderer.invoke("pi:browser-action", value),
      device: value => ipcRenderer.invoke("pi:browser-tools", "device", value),
      menu: value => ipcRenderer.invoke("pi:browser-tools", "menu", value),
      viewport: (bounds, visible) => ipcRenderer.invoke("pi:browser-viewport", bounds, visible)
    });`,
  );
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const manager = new DesktopBrowserManager(
    window,
    { info() {}, warn() {} },
    (event) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame,
  );
  const host = manager.createAgentHost();
  manager.bindAgentControl(createBrowserAgentControl(host));
  await window.loadURL(
    "data:text/html," +
      encodeURIComponent(
        '<title>Piora navigation fixture</title><button id="anchor" style="position:fixed;right:12px;top:8px">Browser menu</button>',
      ),
  );
  const call = (args) =>
    manager.handleAgentRequest({
      type: "pi-desktop:browser-agent-request",
      requestId: randomUUID(),
      sessionId: "navigation-test",
      ...args,
    });
  let exitCode = 0;
  try {
    const opened = await call({ action: "open", url: `${url}\u00a0` });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const snapshot = await call({ action: "snapshot" });
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    assert.ok(snapshot.value.title);
    if (url === localUrl) assert.match(snapshot.value.text, /Ready/);
    console.log(
      `PASS Electron ${process.versions.electron}: open and snapshot ${opened.value.url} (${snapshot.value.title})`,
    );
    const failed = await call({ action: "open", url: "http://127.0.0.1:1/" });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /failed|ERR_UNSAFE_PORT/i);
    const recovered = await call({ action: "open", url: localUrl });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    console.log("PASS: navigation failure returns an error, process survives, and the next page opens.");
    await verifyDeviceControl(window, host, call, recovered.value.tabId);
    if (process.env.PIORA_BROWSER_FIXTURE_DPI)
      await verifyScaledMenu(window, recovered.value.tabId, Number(process.env.PIORA_BROWSER_FIXTURE_DPI));
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    manager.destroy();
    window.destroy();
    server.close();
    app.exit(exitCode);
  }
}

async function verifyDeviceControl(window, host, call, tabId) {
  const target = { sessionId: "navigation-test", tabId };
  const panel = { x: 12, y: 20, width: 575, height: 450 };
  const device = { enabled: true, preset: "iPhone SE", width: 375, height: 667, preview: 0.5 };
  const invoke = (action, ...args) =>
    window.webContents.executeJavaScript(`fixtureBrowser[${JSON.stringify(action)}](...${JSON.stringify(args)})`);
  const observe = () =>
    host.executeIsolated(
      tabId,
      1250,
      "({ width: innerWidth, height: innerHeight, mobile: matchMedia('(max-width: 500px)').matches, clicks: Number(document.querySelector('button').dataset.clicks || 0), pointer: document.documentElement.dataset.pointer })",
    );
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 6000;
    let last;
    do {
      last = await observe();
      if (predicate(last)) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    } while (Date.now() < deadline);
    assert.fail(message + " " + JSON.stringify(last));
  };
  window.showInactive();
  await invoke("action", { action: "set_session", sessionId: target.sessionId });
  await invoke("action", { action: "switch_tab", tabId });
  await invoke("viewport", panel, true);
  await invoke("device", { target, viewport: device });
  await waitFor((state) => state.width === 375 && state.height === 667 && state.mobile, "visible phone viewport");
  const guest = window.contentView.children.find((view) =>
    view.webContents?.getURL().startsWith("http://127.0.0.1:"),
  );
  assert.ok(guest, "visible isolated test guest");
  guest.webContents.focus();
  // Place a native mouse event in the displayed surface, half the CSS coordinates.
  guest.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: 138, y: 119 });
  guest.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: 138, y: 119 });
  await waitFor((state) => state.clicks === 1, "manual mouse click hit the device preview control");
  let clicks = 1;
  const clickFromSnapshot = async () => {
    const snapshot = await call({ action: "snapshot" });
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    const ref = /\[([^\]]+)\] button — Ready/.exec(snapshot.value.text)?.[1];
    assert.ok(ref, snapshot.value.text);
    const result = await call({ action: "click", ref });
    assert.equal(result.ok, true, JSON.stringify(result));
    clicks++;
    await waitFor(
      (state) => state.clicks === clicks && state.mobile && state.width === 375,
      "agent click reached the selected control",
    );
  };
  await clickFromSnapshot();
  await invoke("viewport", panel, false);
  await clickFromSnapshot();
  await invoke("viewport", panel, true);
  await clickFromSnapshot();
  await invoke("device", { target, viewport: { ...device, enabled: false } });
  await waitFor((state) => state.width === panel.width && !state.mobile, "panel dimensions restored");
  console.log("PASS: the real browser agent hit the same button in visible, hidden and restored phone previews.");
}

async function verifyScaledMenu(parent, tabId, scale) {
  const { app, screen } = require("electron");
  const measured = await parent.webContents.executeJavaScript(`(() => {
    const rect = document.getElementById("anchor").getBoundingClientRect();
    return { x: rect.right, y: rect.bottom, dpr: devicePixelRatio };
  })()`);
  assert.equal(measured.dpr, scale, "requested display density applied to the Electron renderer");
  const [result, popup] = await (async () => {
    const created = once(app, "browser-window-created");
    const outcome = parent.webContents.executeJavaScript(
      `fixtureBrowser.menu(${JSON.stringify({
        target: { sessionId: "navigation-test", tabId },
        x: measured.x,
        y: measured.y,
        locale: "zh-CN",
        dark: scale === 1.5,
      })})`,
    );
    const [, child] = await created;
    return [outcome, child];
  })();
  const waitFor = async (predicate) => {
    const end = Date.now() + 6000;
    do {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < end);
    assert.fail("the native menu did not reach the expected state");
  };
  await waitFor(() =>
    popup.webContents.executeJavaScript('Boolean(document.querySelector("[data-sub=devices]"))'),
  );
  const bounds = popup.getBounds(),
    anchor = parent.getContentBounds();
  const physicalAnchor = { x: Math.round(anchor.x + measured.x), y: Math.round(anchor.y + measured.y) };
  const work = screen.getDisplayNearestPoint(physicalAnchor).workArea;
  assert.ok(
    Math.abs(
      bounds.x - Math.max(work.x, Math.min(work.x + work.width - bounds.width, physicalAnchor.x - bounds.width)),
    ) <= 2,
  );
  assert.ok(
    Math.abs(bounds.y - Math.max(work.y, Math.min(work.y + work.height - bounds.height, physicalAnchor.y + 4))) <=
      2,
  );
  await popup.webContents.executeJavaScript('document.querySelector("[data-sub=devices]").focus()');
  const key = (name) => {
    popup.webContents.sendInputEvent({ type: "keyDown", keyCode: name });
    popup.webContents.sendInputEvent({ type: "keyUp", keyCode: name });
  };
  key("Right");
  await waitFor(() => popup.getBounds().width > bounds.width);
  const aligned = await popup.webContents.executeJavaScript(`(() => {
    const source = document.querySelector("[data-sub=devices]").getBoundingClientRect();
    const submenu = document.querySelector(".sub").getBoundingClientRect();
    return Math.abs(source.top - submenu.top) < 2 && submenu.bottom <= innerHeight;
  })()`);
  assert.equal(aligned, true, "submenu aligned with its trigger inside the work area");
  key("Left");
  await waitFor(() => popup.getBounds().width === bounds.width);
  key("Escape");
  assert.equal(await result, null);
  console.log("PASS Windows display scale " + scale + ": menu anchor, keyboard submenu, dismissal.");
}
