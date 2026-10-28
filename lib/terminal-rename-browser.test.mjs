import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("terminal names save independently without replaying output, survive reload, and retain failed drafts", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-terminal-rename-"));
  let browser;
  const waiting = new Set();
  try {
    await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, "css.cjs"), 'module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))');
    await writeFile(path.join(directory, "entry.tsx"), `import React from 'react';import{createRoot}from'react-dom/client';import{I18nProvider}from'@/hooks/useI18n';import{SmartShellPanel}from'@/components/workspace/SmartShellPanel';function App(){const[cwd,setCwd]=React.useState('/workspace/sample');window.setCwd=setCwd;return <I18nProvider><SmartShellPanel cwd={cwd}/></I18nProvider>}createRoot(document.getElementById('root')).render(<App/>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "http://terminal-rename.test/" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const [panelCss, terminalCss, xtermCss] = await Promise.all(["components/workspace/SmartShell.module.css", "components/workspace/TerminalPanel.module.css", "node_modules/@xterm/xterm/css/xterm.css"].map(file => readFile(path.join(repo, file), "utf8")));
    const css = [panelCss, terminalCss.split("\n").filter(line => line.startsWith(".surface")).join("\n"), xtermCss].join("\n").replace(/:global\(([^)]+)\)/g, "$1");
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
    page.setDefaultTimeout(10000);
    const errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("pi-locale", "zh-CN");
      window.streams = new Set();
      window.EventSource = class {
        constructor(url) { this.id = url.split("/").at(-2); window.streams.add(this); }
        close() { window.streams.delete(this); }
      };
      window.emitTerminal = event => { for (const stream of window.streams) if (stream.id === event.terminalId) stream.onmessage?.({ data: JSON.stringify(event) }); };
    });
    const profile = { executable: "/bin/bash", kind: "bash", label: "Bash", integrated: false, native: true };
    const make = (id, title, createdAt, cwd = "/workspace/sample") => ({ id, title, initialCwd: cwd, cwd, profile, createdAt, updatedAt: createdAt, generation: 1, connected: true, integration: "unavailable", integrationError: null, owner: "human", activeCommandId: null, activeRunId: null, model: null, draft: "", closed: false });
    let sessions = [make("first", "已有名称", 1), make("second", "sample", 2), make("other", "其他项目", 3, "/workspace/other")];
    const sequences = new Map();
    const snapshot = session => ({ session: { ...session }, commands: [], runs: [], output: "READY\r\n", sequence: sequences.get(session.id) || 1 });
    let holdSave, holdInventory, holdStart, observedSave, observedInventory, observedStart, failSave = false;
    await page.route("http://terminal-rename.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(url.pathname))) });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<html><meta charset="utf-8"><style>:root{--ui-font-size:14px;--text:#ddd;--bg:#171b21;--bg-panel:#202832;--border:#444;--accent:#80d4c4}*{box-sizing:border-box}html,body,#root{height:100%;margin:0}${css}</style><div id="root"></div><script src="/bundle.js"></script></html>` });
      if (url.pathname === "/api/shell/native-settings") return route.fulfill({ json: { executable: null, profiles: [profile] } });
      if (url.pathname === "/api/shell/sessions") {
        const result = sessions.filter(session => session.initialCwd === url.searchParams.get("cwd")).map(session => ({ ...session }));
        if (holdInventory) { const gate = holdInventory; holdInventory = null; observedInventory.resolve(); await gate.promise; }
        return route.fulfill({ json: { sessions: result } }).catch(() => {});
      }
      const id = url.pathname.split("/")[4], session = sessions.find(item => item.id === id);
      if (request.method() === "DELETE") { sessions = sessions.filter(item => item.id !== id); return route.fulfill({ json: { success: true } }); }
      if (!session) return route.fulfill({ status: 404, json: { error: "Terminal is closed" } });
      if (request.method() === "PATCH") {
        const title = request.postDataJSON().title;
        writes.push({ id, title });
        if (holdSave) { const gate = holdSave; holdSave = null; observedSave.resolve(); await gate.promise; }
        if (failSave) return route.fulfill({ status: 503, json: { error: "Storage unavailable" } });
        session.title = title;
        sequences.set(id, (sequences.get(id) || 1) + 8);
        return route.fulfill({ json: snapshot(session) }).catch(() => {});
      }
      if (url.pathname.endsWith("/actions") && request.postDataJSON().action === "start" && holdStart) { const gate = holdStart; holdStart = null; observedStart.resolve(); await gate.promise; }
      if (url.pathname.endsWith("/actions") && request.postDataJSON().action !== "start") return route.fulfill({ json: { success: true } });
      return route.fulfill({ json: snapshot(session) });
    });
    const tab = name => page.getByRole("tab", { name, exact: true });
    const rename = number => page.getByRole("button", { name: `重命名终端 ${number}`, exact: true });
    const input = () => page.getByRole("textbox", { name: "终端名称", exact: true });
    const save = () => page.getByRole("button", { name: "保存终端名称", exact: true });
    const waitCount = count => page.waitForFunction(count => document.querySelectorAll('[role="tab"]').length === count, count);
    await page.goto("http://terminal-rename.test/");
    await tab("已有名称 · 1").waitFor();
    await page.waitForFunction(() => document.querySelector(".xterm-rows")?.textContent.includes("READY"));
    assert.equal(await tab("已有名称 · 1").getAttribute("aria-selected"), "true");
    await rename(2).click();
    assert.equal(await input().evaluate(el => el === document.activeElement), true);
    await input().fill("  中文后端  ");
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      await input().dispatchEvent("keydown", { key: "Enter", code: "Enter", ...composition });
      assert.equal(writes.length, 0, "IME confirmation must not submit a rename");
    }
    await input().press("Enter");
    await tab("中文后端 · 2").waitFor();
    assert.deepEqual(writes, [{ id: "second", title: "中文后端" }]);
    assert.equal(await tab("已有名称 · 1").getAttribute("aria-selected"), "true", "renaming a background tab preserves selection");
    await page.reload();
    await tab("中文后端 · 2").waitFor();
    await tab("已有名称 · 1").press("F2");
    await input().fill("discarded");
    await input().press("Escape");
    await tab("已有名称 · 1").waitFor();
    assert.equal(writes.length, 1);
    await tab("已有名称 · 1").dblclick();
    await input().fill("   ");
    assert.equal(await save().isDisabled(), true);
    assert.equal(await input().getAttribute("maxlength"), "100");
    await input().fill("失败后重试");
    failSave = true;
    await save().click();
    await page.getByRole("alert").filter({ hasText: "Storage unavailable" }).waitFor();
    assert.equal(await input().inputValue(), "失败后重试");
    assert.equal(sessions[0].title, "已有名称");
    failSave = false;
    await save().click();
    await tab("失败后重试 · 1").waitFor();

    // A slow save must neither apply a stale inventory nor replay its old output.
    const oldInventory = deferred(); waiting.add(oldInventory); holdInventory = oldInventory; observedInventory = deferred();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await observedInventory.promise;
    const slowSave = deferred(); waiting.add(slowSave); holdSave = slowSave; observedSave = deferred();
    await rename(1).click(); await input().fill("服务终端"); await save().click();
    await observedSave.promise;
    const count = writes.length;
    await page.locator(".tabRename").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    assert.equal(writes.length, count, "repeated submission while saving is deduplicated");
    await page.evaluate(() => { window.terminalNode = document.querySelector(".xterm-helper-textarea"); window.emitTerminal({ type: "output", terminalId: "first", generation: 1, sequence: 10, commandId: null, data: "NEW_OUTPUT\r\n" }); });
    await page.waitForFunction(() => document.querySelector(".xterm-rows")?.textContent.includes("NEW_OUTPUT"));
    const oldSession = { ...sessions[0] };
    slowSave.resolve(); await tab("服务终端 · 1").waitFor(); oldInventory.resolve();
    await page.evaluate(session => window.emitTerminal({ type: "session", terminalId: "first", generation: 1, sequence: 11, session }), oldSession);
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".xterm-rows").innerText().then(text => text.includes("NEW_OUTPUT")), true);
    assert.equal(await page.evaluate(() => window.terminalNode === document.querySelector(".xterm-helper-textarea")), true);
    await tab("服务终端 · 1").waitFor();
    // Selecting a background tab starts its surface asynchronously. Opening
    // the inline editor must keep focus even when that startup completes.
    const slowStart = deferred(); waiting.add(slowStart); holdStart = slowStart; observedStart = deferred();
    await tab("中文后端 · 2").dblclick(); await observedStart.promise;
    await input().fill("do not save"); slowStart.resolve();
    await page.waitForFunction(() => document.querySelector(".xterm-rows")?.textContent.includes("READY"));
    assert.equal(await input().evaluate(el => el === document.activeElement), true);
    await page.getByRole("button", { name: "取消重命名", exact: true }).click();
    await tab("中文后端 · 2").waitFor();
    assert.equal(writes.length, count);
    await tab("服务终端 · 1").click();

    // Closing a tab while its save is pending cannot resurrect it on completion.
    const closingSave = deferred(); waiting.add(closingSave); holdSave = closingSave; observedSave = deferred();
    await tab("中文后端 · 2").click();
    await rename(2).click(); await input().fill("closed tab"); await save().click(); await observedSave.promise;
    const closeInventory = deferred(); waiting.add(closeInventory); holdInventory = closeInventory; observedInventory = deferred();
    await page.getByRole("button", { name: "关闭终端 2", exact: true }).click(); await observedInventory.promise;
    closingSave.resolve(); await tab("closed tab · 2").waitFor();
    closeInventory.resolve(); await waitCount(1);
    assert.equal(await tab("服务终端 · 1").getAttribute("aria-selected"), "true");

    const navigationSave = deferred(); waiting.add(navigationSave); holdSave = navigationSave; observedSave = deferred();
    await rename(1).click(); await input().fill("old workspace"); await save().click(); await observedSave.promise;
    await page.evaluate(() => window.setCwd("/workspace/other")); await tab("其他项目 · 1").waitFor();
    navigationSave.resolve(); await page.waitForTimeout(100);
    assert.equal(await input().count(), 0);
    assert.equal(await tab("其他项目 · 1").getAttribute("aria-selected"), "true");
    await page.setViewportSize({ width: 360, height: 600 });
    await rename(1).click(); await input().fill("终".repeat(100)); await save().click();
    await tab("终".repeat(100) + " · 1").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally {
    for (const gate of waiting) gate.resolve();
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
