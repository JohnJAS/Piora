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

test("provider panel detects endpoint models, requests only missing limits and preserves configuration", { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-model-experience-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "css.cjs"), `module.exports=function(s){const prefix=require('path').basename(this.resourcePath).replace(/[^a-zA-Z]/g,'')+'__';const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+m[1]]));const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(_,n)=>'.'+prefix+n);return 'const sheet=document.createElement("style");sheet.textContent='+JSON.stringify(css)+';document.head.appendChild(sheet);export default '+JSON.stringify(names)}`);
    await writeFile(path.join(root, "entry.tsx"), `import React from 'react';import{createRoot}from'react-dom/client';import{I18nProvider}from'@/hooks/useI18n';import{ModelsExperience}from'@/components/ModelsExperience';import{ConfirmationHost}from'@/components/ConfirmDialog';createRoot(document.getElementById('root')).render(<I18nProvider><ModelsExperience embedded onClose={()=>{}} onModelsChanged={()=>window.changes=(window.changes||0)+1}/><ConfirmationHost/></I18nProvider>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js", publicPath: "/" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }, { test: /\.css$/, use: path.join(root, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "zh-CN"); });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const css = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "");
    let config = { extra: "keep", providers: { legacy: { api: "openai-completions", baseUrl: "https://old.test/v1", models: [{ id: "old", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, compat: { store: false } }] } } };
    const initialLegacy = structuredClone(config.providers.legacy);
    let scope = { models: [{ id: "unconfigured", provider: "anthropic", enabled: true }], warnings: [], enabledPatterns: null, projectOverride: false, enabledCount: 0, totalCount: 0, configuredDefault: null, effectiveDefault: null };
    const catalogs = []; let tests = 0; let failSave = false; const savedBodies = []; let failDiscovery = false; let manyModels = false; let failRestore = false; let configured = false;
    await page.route("http://model-experience.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(root, path.basename(url.pathname))) });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body,#root{height:100%;margin:0}${css}</style><div id="root"></div><script src="/bundle.js"></script></html>` });
      if (url.pathname === "/api/models-config") {
        if (request.method() === "PUT") { if (failSave) return route.fulfill({ status: 500, json: { error: "Save unavailable" } }); config = request.postDataJSON(); savedBodies.push(structuredClone(config)); return route.fulfill({ json: { success: true } }); }
        return route.fulfill({ json: config });
      }
      if (url.pathname === "/api/models/scope") {
        if (request.method() === "PATCH") {
          const body = request.postDataJSON();
          if (body.action === "restore" && failRestore) return route.fulfill({ status: 409, json: { error: "project scope override" } });
          if (body.action === "set-default") scope.effectiveDefault = { provider: body.provider, modelId: body.id };
          else if (body.action === "restore") { const m = config.providers[body.provider].models.find(m => m.id === body.id); scope.models.push({ id: m.id, name: m.name ?? m.id, provider: body.provider, enabled: true }); }
        }
        return route.fulfill({ json: scope });
      }
      if (url.pathname === "/api/models-config/discover") return failDiscovery ? route.fulfill({ status: 401, json: { error: "Unauthorized" } }) : route.fulfill({ json: { models: [{ id: "ready", name: "Ready", contextWindow: 32000, maxTokens: 4096 }, { id: "catalog", contextWindow: 64000 }, { id: "missing" }, ...(manyModels ? Array.from({ length: 30 }, (_, i) => ({ id: `extra-${i}`, contextWindow: 10000, maxTokens: 2000 })) : [])] } });
      if (url.pathname === "/api/models-config/catalog") { catalogs.push(url.toString()); const q = url.searchParams.get("q"); return route.fulfill({ json: { recommendation: q === "catalog" ? { metadataMethod: "base-url", exactMatches: 1, preset: { contextWindow: 99999, maxTokens: 8000 } } : q === "ready" ? { metadataMethod: "base-url", exactMatches: 1, preset: { reasoning: true, input: ["text", "image"], contextWindow: 99999 } } : { metadataMethod: "none", exactMatches: 0, preset: {} } } }); }
      if (url.pathname === "/api/models-config/test") { tests++; return route.fulfill({ json: { ok: true } }); }
      if (url.pathname === "/api/auth/all-providers") return route.fulfill({ json: { providers: [{ id: "fixture", displayName: "Fixture API", configured, modelCount: 1, canRemoveStoredCredential: configured }] } });
      if (url.pathname === "/api/auth/api-key/fixture") { configured = request.method() === "POST"; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { providers: [] } });
    });

    await page.goto("http://model-experience.test/");
    await page.getByRole("heading", { name: "模型设置" }).waitFor();
    await page.getByLabel("供应商名称").waitFor();
    assert.equal(await page.getByRole("navigation", { name: "服务商" }).getByRole("button", { name: "anthropic", exact: true }).count(), 0, "unconfigured built-in models do not create a default provider");
    const addProvider = () => page.getByRole("button", { name: "添加供应商", exact: true }).first();
    await addProvider().click();
    await page.getByRole("button", { name: /创建自定义供应商/ }).click();
    await page.getByLabel("供应商名称").fill("新渠道");
    await page.getByLabel("Base URL", { exact: true }).fill("https://provider.test/v1");
    await page.getByLabel("API Key", { exact: true }).fill("secret-fixture");
    await page.getByRole("button", { name: /一键识别可用模型/ }).click();
    const imports = page.getByRole("dialog", { name: "识别可用模型" });
    await imports.waitFor();
    const bodyBounds = await imports.locator('[class*="__dialogBody"]').evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, scroll: getComputedStyle(el).overflowY }));
    const inputBounds = await imports.getByLabel("上下文窗口").first().boundingBox();
    assert.ok(inputBounds.x >= bodyBounds.left && inputBounds.x + inputBounds.width <= bodyBounds.right, "model fields stay inside the dialog body");
    assert.equal(bodyBounds.scroll, "auto", "long model lists can scroll");
    assert.equal(await imports.getByRole("checkbox", { checked: true }).count(), 3);
    assert.equal(await imports.getByLabel("上下文窗口").count(), 2, "complete endpoint models require no manual fields");
    const partial = imports.locator('[class*="__importRow"]').filter({ has: page.getByRole("checkbox", { name: /catalog/ }) });
    assert.equal(await partial.getByLabel("上下文窗口").inputValue(), "64000");
    assert.equal(await partial.getByLabel("最大输出 Token").inputValue(), "", "no fabricated or external catalogue output");
    await partial.getByLabel("最大输出 Token").fill("8000");
    const missing = imports.locator('[class*="__importRow"]').filter({ has: page.getByRole("checkbox", { name: /missing/ }) });
    await imports.getByRole("button", { name: "添加所选模型" }).click();
    await imports.getByRole("alert").waitFor();
    assert.equal(savedBodies.length, 0, "incomplete model limits cannot be saved");
    await missing.getByLabel("上下文窗口").fill("10000");
    await missing.getByLabel("最大输出 Token").fill("2000");
    failSave = true;
    await imports.getByRole("button", { name: "添加所选模型" }).click();
    await imports.getByRole("alert").filter({ hasText: "Save unavailable" }).waitFor();
    failSave = false;
    await imports.getByRole("button", { name: "添加所选模型" }).click();
    await imports.waitFor({ state: "detached" });
    assert.equal(savedBodies.length, 1);
    assert.deepEqual(config.providers.legacy, initialLegacy, "untouched legacy model, costs and compatibility survive");
    assert.deepEqual(config.providers["新渠道"].models.map(model => [model.id, model.contextWindow, model.maxTokens]), [["ready", 32000, 4096], ["catalog", 64000, 8000], ["missing", 10000, 2000]]);
    assert.equal(catalogs.length, 0, "all model metadata comes only from the configured endpoint");
    assert.equal(tests, 0, "discovery never silently sends paid inference requests");
    manyModels = true;
    await page.getByRole("button", { name: /一键识别可用模型/ }).click();
    await imports.waitFor();
    const longBody = imports.locator('[class*="__dialogBody"]');
    assert.ok(await longBody.evaluate(el => el.scrollHeight > el.clientHeight), "long results overflow a scrollable body");
    await imports.getByRole("checkbox", { name: /extra-29/ }).scrollIntoViewIfNeeded();
    assert.ok(await longBody.evaluate(el => el.scrollTop > 0), "the last model is reachable by scrolling");
    await imports.getByRole("button", { name: "取消" }).click();
    manyModels = false;
    assert.ok(await page.evaluate(() => window.changes > 0));
    await page.getByRole("navigation", { name: "服务商" }).getByRole("button", { name: "新渠道", exact: true }).waitFor();
    await page.getByRole("button", { name: "测试模型 ready", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "测试通过" }).waitFor();
    assert.equal(tests, 1);
    await page.getByRole("button", { name: "设为默认 ready", exact: true }).click();
    await page.getByTitle("默认模型", { exact: true }).waitFor();
    await page.getByRole("button", { name: "编辑模型配置 ready", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑模型配置" });
    await edit.getByLabel("显示名称").waitFor({ state: "hidden" });
    await edit.getByText("高级配置", { exact: true }).click();
    await edit.getByLabel("显示名称").fill("Ready renamed");
    await edit.getByLabel("支持图片输入").check();
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    await edit.waitFor({ state: "detached" });
    assert.deepEqual(config.providers["新渠道"].models[0].input, ["text", "image"]);
    await page.getByRole("navigation", { name: "服务商" }).getByRole("button", { name: "legacy", exact: true }).click();
    await page.getByRole("button", { name: "编辑模型配置 old" }).click();
    await edit.getByLabel("上下文窗口").fill("16000");
    await edit.getByLabel("最大输出 Token").fill("4000");
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    await edit.waitFor({ state: "detached" });
    assert.deepEqual(config.providers.legacy.models[0].compat, initialLegacy.models[0].compat);
    assert.deepEqual(config.providers.legacy.models[0].cost, initialLegacy.models[0].cost);
    await addProvider().click();
    await page.getByRole("button", { name: /Fixture API/ }).click();
    const apiKey = page.getByPlaceholder("sk-…");
    await apiKey.fill("fixture-key");
    const beforeAuth = await page.evaluate(() => window.changes);
    await apiKey.locator("../..").getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(previous => window.changes > previous, beforeAuth);
    assert.equal(configured, true, "credential changes immediately refresh the chat catalogue");
    await page.getByRole("button", { name: "删除渠道", exact: true }).click();
    await page.getByRole("dialog", { name: "删除渠道" }).getByRole("button", { name: "删除渠道" }).click();
    await page.waitForFunction(() => !document.querySelector('nav button[aria-current="page"]') || !document.querySelector('nav button[aria-current="page"]').textContent.includes('Fixture API'));
    assert.equal(configured, false, "deleting a stored built-in provider removes its credential");
    await addProvider().click();
    await page.getByRole("button", { name: /创建自定义供应商/ }).click();
    await page.getByLabel("供应商名称").fill("手动渠道");
    await page.getByLabel("Base URL", { exact: true }).fill("https://manual.test/v1");
    await addProvider().click();
    await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "取消" }).click();
    assert.equal(await page.getByLabel("供应商名称").inputValue(), "手动渠道", "cancelled navigation retains connection draft");
    failDiscovery = true;
    await page.getByRole("button", { name: /一键识别可用模型/ }).click();
    await page.getByRole("alert").filter({ hasText: "获取模型失败" }).waitFor();
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    const manual = page.getByRole("dialog", { name: "添加模型", exact: true });
    await manual.getByLabel("模型 ID", { exact: true }).fill("manual-model");
    await manual.getByLabel("上下文窗口").fill("16000");
    await manual.getByLabel("最大输出 Token").fill("2000");
    await manual.getByRole("button", { name: "保存", exact: true }).waitFor();
    failRestore = true;
    await manual.getByRole("button", { name: "保存", exact: true }).click();
    await manual.waitFor({ state: "detached" });
    assert.equal(config.providers["手动渠道"].models[0].id, "manual-model");
    await page.getByRole("status").filter({ hasText: "部分模型无法启用" }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
    await page.reload();
    await page.getByRole("heading", { name: "Model settings" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(root, { recursive: true, force: true }); }
});
