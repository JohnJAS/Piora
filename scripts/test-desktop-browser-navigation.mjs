#!/usr/bin/env node
// Exercise real Electron/CDP startup with an isolated profile; no app build.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

if (!process.versions.electron) {
  const directory = mkdtempSync(join(tmpdir(), "piora-browser-navigation-"));
  const sourceNames = ["browser-manager", "browser-agent-control", "browser-agent-logic", "browser-cookie-store"];
  for (const name of sourceNames) {
    const source = readFileSync(join(projectRoot, "desktop", "src", `${name}.ts`), "utf8");
    writeFileSync(join(directory, `${name}.js`), ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText);
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [scriptPath, directory, ...process.argv.slice(2)], {
    env, windowsHide: true, stdio: "inherit",
  });
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
    response.end("<title>Navigation fixture</title><p>Browser startup succeeded</p><button>Ready</button>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const localUrl = `http://127.0.0.1:${server.address().port}/`;
  const url = process.argv[3] || localUrl;
  const window = new BrowserWindow({ show: false, width: 1200, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const manager = new DesktopBrowserManager(window, { info() {}, warn() {} }, () => false);
  manager.bindAgentControl(createBrowserAgentControl(manager.createAgentHost()));
  const call = (args) => manager.handleAgentRequest({ type: "pi-desktop:browser-agent-request",
    requestId: randomUUID(), sessionId: "navigation-test", ...args,
  });
  let exitCode = 0;
  try {
    const opened = await call({ action: "open", url: `${url}\u00a0` });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const snapshot = await call({ action: "snapshot" });
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    assert.ok(snapshot.value.title);
    if (url === localUrl) assert.match(snapshot.value.text, /Ready/);
    console.log(`PASS Electron ${process.versions.electron}: open and snapshot ${opened.value.url} (${snapshot.value.title})`);
    const failed = await call({ action: "open", url: "http://127.0.0.1:1/" });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /failed|ERR_UNSAFE_PORT/i);
    const recovered = await call({ action: "open", url: localUrl });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    console.log("PASS: navigation failure returns an error, process survives, and the next page opens.");
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
