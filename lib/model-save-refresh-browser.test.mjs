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

test("saved models refresh immediately, resist stale scope responses, and retry failed synchronization", { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-model-refresh-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "css.cjs"), 'module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))');
    await writeFile(path.join(root, "entry.tsx"), `import React from 'react';import{createRoot}from'react-dom/client';import{I18nProvider}from'@/hooks/useI18n';import{ModelsConfig}from'@/components/ModelsConfig';function App(){const[open,setOpen]=React.useState(true);return <I18nProvider><button onClick={()=>setOpen(v=>!v)}>切换设置</button>{open&&<ModelsConfig embedded onClose={()=>{}} onModelsChanged={()=>window.changed=(window.changed||0)+1}/>}</I18nProvider>}createRoot(document.getElementById('root')).render(<App/>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }, { test: /\.css$/, use: path.join(root, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    let saved = { providers: { alpha: { api: "openai-completions", baseUrl: "https://alpha.test/v1", apiKey: "fixture", models: [] } } };
    let releaseOldScope; let heldScope = true; let failPatch = false; let patches = 0; let configured = false;
    const scope = models => ({ models, warnings: [], enabledPatterns: null, projectOverride: false, enabledCount: models.length, totalCount: models.length, configuredDefault: null, effectiveDefault: null });
    await page.route("http://model-refresh.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(root, path.basename(url.pathname))) });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script></html>' });
      if (url.pathname === "/api/models-config") {
        if (request.method() === "PUT") { saved = request.postDataJSON(); return route.fulfill({ json: { success: true } }); }
        return route.fulfill({ json: saved });
      }
      if (url.pathname === "/api/auth/all-providers") return route.fulfill({ json: { providers: [{ id: "fixture", displayName: "Fixture API", configured, modelCount: 1, canRemoveStoredCredential: configured }] } });
      if (url.pathname === "/api/auth/api-key/fixture") { configured = request.method() === "POST"; return route.fulfill({ json: { success: true } }); }
      if (url.pathname === "/api/models/scope") {
        if (request.method() === "GET" && heldScope) {
          heldScope = false;
          await new Promise(resolve => { releaseOldScope = resolve; });
          return route.fulfill({ json: scope([]) });
        }
        if (request.method() === "PATCH") {
          patches++;
          if (failPatch) return route.fulfill({ status: 500, json: { error: "scope unavailable" } });
        }
        return route.fulfill({ json: { ...scope(saved.providers.alpha.models.map(model => ({ ...model, provider: "alpha", enabled: true }))), changed: true } });
      }
      return route.fulfill({ json: { providers: [], imageInput: {} } });
    });
    await page.goto("http://model-refresh.test/");
    const provider = page.locator(".providerRow").filter({ hasText: "alpha" });
    await provider.waitFor();
    await page.getByText(/^\+\s*模型$/).click();
    const id = page.locator('input[placeholder="model-id"]');
    await id.fill("fresh-model");
    await page.locator('[data-model-limit-field="contextWindow"] input').fill("32000");
    await page.locator('[data-model-limit-field="maxTokens"] input').fill("8192");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.changed >= 1), "the chat is notified after saving");
    assert.equal(saved.providers.alpha.models[0].id, "fresh-model");
    const oldResponse = page.waitForResponse(response => response.url().includes("/api/models/scope") && response.request().method() === "GET");
    releaseOldScope();
    await oldResponse;
    await provider.click();
    await page.getByRole("button", { name: "模型管理", exact: true }).click();
    await page.getByRole("button", { name: "测试模型连接: fresh-model" }).waitFor();
    await page.getByRole("button", { name: "切换设置" }).click();
    await page.getByRole("button", { name: "切换设置" }).click();
    await provider.waitFor();
    await page.getByText("fresh-model", { exact: true }).first().waitFor();

    await page.getByText(/^\+\s*模型$/).click();
    await id.fill("retry-model");
    await page.locator('[data-model-limit-field="contextWindow"] input').fill("32000");
    await page.locator('[data-model-limit-field="maxTokens"] input').fill("8192");
    failPatch = true;
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "配置已保存，但模型列表更新失败" }).waitFor();
    assert.equal(saved.providers.alpha.models[1].id, "retry-model");
    const failedPatches = patches;
    failPatch = false;
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
    assert.ok(patches > failedPatches, "retry attempts the failed scope update again");
    await page.getByRole("button", { name: "添加渠道", exact: true }).click();
    await page.getByRole("button", { name: /Fixture API/ }).click();
    const apiKey = page.getByPlaceholder("sk-…");
    await apiKey.fill("fixture-key");
    const beforeAuthentication = await page.evaluate(() => window.changed);
    await apiKey.locator("../..").getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(previous => window.changed > previous, beforeAuthentication);
    assert.equal(configured, true, "adding a built-in provider refreshes the chat catalog");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(root, { recursive: true, force: true });
  }
});
