import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url), repo = path.resolve(import.meta.dirname, "..");
const { webpack } = require("next/dist/compiled/webpack/webpack.js");

test("live nested summaries batch updates, settle cancellation and restore saved history on reload", { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-nested-ui-")); let browser;
  t.after(async () => { await browser?.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
  await writeFile(path.join(root, "entry.tsx"), `
    import React from "react"; import {createRoot} from "react-dom/client";
    import {NestedToolCalls,useNestedToolCalls,NestedToolCallsContext} from "@/components/NestedToolCalls";
    import {NestedToolCallsStore} from "@/lib/nested-tool-calls";
    import {I18nProvider} from "@/hooks/useI18n";
    const store=new NestedToolCallsStore(); store.beginRun(1); window.store=store; window.renders=0;
    const saved=JSON.parse(localStorage.getItem("saved")??"null");
    function Card(){window.renders++; const snapshot=useNestedToolCalls("root",saved);return <details open><summary>Codemode</summary>{snapshot&&<NestedToolCalls snapshot={snapshot}/>}</details>}
    createRoot(document.getElementById("root")).render(<I18nProvider><NestedToolCallsContext.Provider value={store}><Card/></NestedToolCallsContext.Provider></I18nProvider>);
  `);
  const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }] } });
  await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve())));
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 700 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const styles = await readFile(path.join(repo, "app/globals.css"), "utf8");
  const css = styles.slice(styles.indexOf(".nested-tool-calls"));
  await page.route("http://nested.test/**", async route => {
    if (new URL(route.request().url()).pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: await readFile(path.join(root, "bundle.js"), "utf8") });
    await route.fulfill({ contentType: "text/html", body: `<meta charset="utf-8"><style>body{margin:16px}${css}</style><div id="root"></div><script src="/bundle.js"></script>` });
  });
  await page.goto("http://nested.test/");
  await page.getByText("Codemode", { exact: true }).waitFor();
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) window.store.record({ type: "tool_execution_start", toolCallId: `root/${i}`, parentToolCallId: "root", toolName: `read-${i}` });
    window.store.flush();
  });
  await page.locator("li").last().waitFor();
  assert.equal(await page.locator("li").count(), 100);
  assert.ok(await page.evaluate(() => window.renders < 10), "child updates must be batched");
  await page.evaluate(() => {
    window.store.record({ type: "tool_execution_end", toolCallId: "root/0", parentToolCallId: "root", isError: true, result: { content: [{ type: "text", text: "fixture failure" }] } });
    window.store.finish(); window.store.flush();
    localStorage.setItem("saved", JSON.stringify(window.store.getSnapshot("root")));
  });
  await page.getByText("fixture failure", { exact: true }).waitFor();
  assert.equal(await page.locator(".is-unfinished").count(), 99);
  await page.reload();
  await page.getByText("fixture failure", { exact: true }).waitFor();
  assert.equal(await page.locator(".is-unfinished").count(), 99);
  assert.equal(await page.locator(".is-running").count(), 0);
  await page.getByText("Codemode", { exact: true }).click();
  assert.equal(await page.locator("ul").isVisible(), false);
  assert.deepEqual(errors, []);
});
