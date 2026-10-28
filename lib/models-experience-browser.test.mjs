import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("newcomer connects a custom provider, fills missing limits, saves and manages models", { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-model-experience-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "css.cjs"), 'module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))');
    await writeFile(path.join(root, "entry.tsx"), `import React from 'react';import{createRoot}from'react-dom/client';import{I18nProvider}from'@/hooks/useI18n';import{ModelsExperience}from'@/components/ModelsExperience';import{ConfirmationHost}from'@/components/ConfirmDialog';createRoot(document.getElementById('root')).render(<I18nProvider><ModelsExperience embedded onClose={()=>{}} onModelsChanged={()=>window.changes=(window.changes||0)+1}/><ConfirmationHost/></I18nProvider>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js", publicPath: "/" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }, { test: /\.css$/, use: path.join(root, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "zh-CN"); });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const css = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "") + await readFile(path.join(repo, "components/ModelsExperience.module.css"), "utf8");
    const screenshot = async name => { if (process.env.PIORA_EXPERIENCE_SCREENSHOTS) { await mkdir(path.join(repo, ".verification"), { recursive: true }); await page.screenshot({ path: path.join(repo, `.verification/model-experience-${name}.png`) }); } };
    let config = { extra: "keep", providers: { legacy: { api: "openai-completions", baseUrl: "https://old.test/v1", models: [{ id: "old", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, compat: { store: false } }] } } };
    const initialLegacy = structuredClone(config.providers.legacy);
    let scope = { models: [], warnings: [], enabledPatterns: null, projectOverride: false, enabledCount: 0, totalCount: 0, configuredDefault: null, effectiveDefault: null };
    const catalogs = []; let tests = 0; const savedBodies = []; let failDiscovery = false; let failRestore = false; let configured = false;
    await page.route("http://model-experience.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(root, path.basename(url.pathname))) });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body,#root{height:100%;margin:0}${css}</style><div id="root"></div><script src="/bundle.js"></script></html>` });
      if (url.pathname === "/api/models-config") {
        if (request.method() === "PUT") { config = request.postDataJSON(); savedBodies.push(structuredClone(config)); return route.fulfill({ json: { success: true } }); }
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
      if (url.pathname === "/api/models-config/discover") return failDiscovery ? route.fulfill({ status: 401, json: { error: "Unauthorized" } }) : route.fulfill({ json: { models: [{ id: "ready", name: "Ready", contextWindow: 32000, maxTokens: 4096 }, { id: "catalog", contextWindow: 64000 }, { id: "missing" }] } });
      if (url.pathname === "/api/models-config/catalog") { catalogs.push(url.toString()); const q = url.searchParams.get("q"); return route.fulfill({ json: { recommendation: q === "catalog" ? { metadataMethod: "base-url", exactMatches: 1, preset: { contextWindow: 99999, maxTokens: 8000 } } : q === "ready" ? { metadataMethod: "base-url", exactMatches: 1, preset: { reasoning: true, input: ["text", "image"], contextWindow: 99999 } } : { metadataMethod: "none", exactMatches: 0, preset: {} } } }); }
      if (url.pathname === "/api/models-config/test") { tests++; return route.fulfill({ json: { ok: true } }); }
      if (url.pathname === "/api/auth/all-providers") return route.fulfill({ json: { providers: [{ id: "fixture", displayName: "Fixture API", configured, modelCount: 1, canRemoveStoredCredential: configured }] } });
      if (url.pathname === "/api/auth/api-key/fixture") { configured = request.method() === "POST"; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { providers: [] } });
    });
    await page.goto("http://model-experience.test/");
    await page.getByRole("heading", { name: "模型设置" }).waitFor();
    await screenshot("home");
    await page.getByRole("button", { name: /添加渠道/ }).click();
    await page.getByRole("button", { name: /自定义渠道/ }).click();
    await page.getByLabel("渠道名称").fill("新渠道");
    await page.getByLabel("接口地址").fill("https://provider.test/v1");
    await page.getByLabel("访问密钥").fill("secret-fixture");
    await screenshot("connect");
    await page.getByRole("button", { name: /获取可用模型/ }).click();
    await page.getByRole("checkbox", { name: /Ready/ }).check();
    await page.getByRole("checkbox", { name: /catalog/ }).check();
    await page.getByRole("checkbox", { name: /missing/ }).check();
    await screenshot("choose");
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByRole("heading", { name: "补全模型信息" }).waitFor();
    assert.equal(catalogs.length, 3);
    assert.ok(catalogs.every(url => !url.includes("secret-fixture")), "catalog requests do not contain the API key");
    await page.getByLabel("上下文长度").fill("10000");
    await page.getByLabel("最大输出").fill("2000");
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByText("上下文长度: 渠道 · 最大输出: 模型目录", { exact: true }).waitFor();
    await page.getByRole("button", { name: "测试模型" }).first().click();
    await page.getByText("测试通过").waitFor();
    assert.equal(tests, 1, "tests run only on explicit request");
    await page.getByRole("button", { name: "保存并完成" }).click();
    await page.getByRole("heading", { name: /配置已保存/ }).waitFor();
    assert.equal(savedBodies.length, 1);
    assert.deepEqual(config.providers.legacy, initialLegacy, "unrelated legacy model and advanced fields survive");
    assert.deepEqual(config.providers["新渠道"].models.map(model => [model.id, model.contextWindow, model.maxTokens]), [["ready", 32000, 4096], ["catalog", 64000, 8000], ["missing", 10000, 2000]]);
    assert.equal(config.providers["新渠道"].models[0].reasoning, true);
    assert.deepEqual(config.providers["新渠道"].models[0].input, ["text", "image"]);
    assert.ok(await page.evaluate(() => window.changes > 0));
    await page.getByRole("button", { name: "返回模型设置" }).click();
    await page.getByText("新渠道", { exact: true }).waitFor();
    const card = page.locator("section").filter({ hasText: "新渠道" }).filter({ has: page.getByRole("button", { name: "管理模型" }) });
    await card.getByRole("button", { name: "管理模型" }).click();
    await page.getByRole("button", { name: "设为默认" }).first().click();
    await page.getByText("默认", { exact: true }).waitFor();
    await page.getByRole("button", { name: /返回/ }).first().click();
    const legacyCard = page.locator("section").filter({ hasText: "legacy" }).filter({ has: page.getByRole("button", { name: "管理模型" }) });
    await legacyCard.getByRole("button", { name: "管理模型" }).click();
    await page.getByRole("button", { name: "编辑模型" }).click();
    assert.equal(await page.getByText("高级设置", { exact: true }).count(), 0, "advanced editing is not shown in the new interface");
    await page.getByLabel("上下文长度").fill("16000");
    await page.getByLabel("最大输出").fill("4000");
    await page.getByRole("button", { name: "保存修改" }).click();
    await page.getByRole("button", { name: "编辑模型" }).waitFor();
    assert.deepEqual(config.providers.legacy.models[0].compat, initialLegacy.models[0].compat);
    assert.deepEqual(config.providers.legacy.models[0].cost, initialLegacy.models[0].cost);
    await page.getByRole("button", { name: /返回/ }).first().click();
    await page.getByRole("button", { name: /添加渠道/ }).click();
    await page.getByRole("button", { name: /Fixture API/ }).click();
    const apiKey = page.getByPlaceholder("sk-…");
    await apiKey.fill("fixture-key");
    const beforeAuth = await page.evaluate(() => window.changes);
    await apiKey.locator("../..").getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(previous => window.changes > previous, beforeAuth);
    assert.equal(configured, true, "authentication refreshes the chat catalog");
    await page.getByRole("button", { name: /返回/ }).first().click();
    await page.getByRole("button", { name: /添加渠道/ }).click();
    await page.getByRole("button", { name: /自定义渠道/ }).click();
    await page.getByLabel("渠道名称").fill("手动渠道");
    await page.getByLabel("接口地址").fill("https://manual.test/v1");
    await page.getByRole("button", { name: /返回/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
    assert.equal(await page.getByLabel("渠道名称").inputValue(), "手动渠道", "canceling navigation retains the draft");
    failDiscovery = true;
    await page.getByRole("button", { name: /获取可用模型/ }).click();
    await page.getByRole("alert").filter({ hasText: "获取模型失败" }).waitFor();
    await page.getByRole("button", { name: "手动添加模型", exact: true }).click();
    await page.getByLabel("找不到模型？手动添加").fill("manual-model");
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByLabel("上下文长度").fill("16000");
    await page.getByLabel("最大输出").fill("2000");
    await page.getByRole("button", { name: "继续" }).click();
    failRestore = true;
    await page.getByRole("button", { name: "保存并完成" }).click();
    await page.getByRole("heading", { name: /配置已保存/ }).waitFor();
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
