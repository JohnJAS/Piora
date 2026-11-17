import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
const require = createRequire(import.meta.url), { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");
const { GET: readLocalFile } = await createJiti(import.meta.url, { alias: { "@": repo } }).import("../app/api/files/[...path]/route.ts");
const { GET: searchLocalFiles } = await createJiti(import.meta.url, { alias: { "@": repo } }).import("../app/api/file-index/route.ts");

test("reply references open real source rows, preserve locations and expose missing-file errors", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-file-reference-")); let browser;
  const previousRoots = globalThis.__piAllowedRootsCache;
  try {
    const workspace = path.join(directory, "Workspace").replaceAll("\\", "/");
    await mkdir(path.join(workspace, "src"), { recursive: true });
    const relativeFile = path.join(workspace, "src/generated.browser.test.mjs");
    await writeFile(relativeFile, "export const relativeReplyFile = true;\n");
    const proposals = ["openspec/change-a/proposal.md", "openspec/change-a/design.md", "openspec/change-b/design.md"].map(file => path.join(workspace, file));
    for (const file of proposals) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `# ${file}\nunique-file-recovery-${path.basename(path.dirname(file))}`); }
    const generatedDirectory = path.join(directory, "Generated Files");
    await mkdir(generatedDirectory);
    const generatedFile = path.join(generatedDirectory, "reply.browser.test.mjs");
    await writeFile(generatedFile, "export const generatedReplyFile = true;\n");
    globalThis.__piAllowedRootsCache = { roots: new Set([directory.replaceAll("\\", "/")]), expiresAt: Date.now() + 300_000 };
    await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, "css.cjs"), 'module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))');
    const reply = "逻辑在 features/voice/PushTalkComponent.ets:236。\n\n`common/corebase/VoiceReportConstNew.ets:216:5`\n\n[C:/My Project/src/absolute.ts:42:3](C:/My%20Project/src/absolute.ts:42:3)\n\n`../outside.ts:2`\n\n`src/missing.ts:9`"
      + `\n\n文件在 ${process.platform === "win32" ? generatedFile : `\`${generatedFile}\``}，请打开。\n\n相对文件在 src/generated.browser.test.mjs，请打开。\n\n\`proposal.md:2\`\n\n\`design.md:2\``;
    await writeFile(path.join(directory, "entry.tsx"), `
import {useState} from "react";import {createRoot} from "react-dom/client";
import {MarkdownBody} from "@/components/MarkdownBody";import {FileViewer} from "@/components/FileViewer";
import {I18nProvider} from "@/hooks/useI18n";import {resolveFileReferenceTarget} from "@/lib/file-references";
const cwd=${JSON.stringify(workspace)};
function App(){const [target,setTarget]=useState(null),[error,setError]=useState("");const open=value=>{const next=resolveFileReferenceTarget(value,cwd);if(!next){setError("路径超出当前工作区："+value);return;}setError("");window.opened=next;setTarget({...next,key:Date.now()});};
return <I18nProvider><main><article><MarkdownBody className="markdown-assistant-message" cwd={cwd} onOpenFile={open}>{${JSON.stringify(reply)}}</MarkdownBody><textarea aria-label="Message draft" defaultValue="keep my draft"/>{error&&<p role="alert">{error}</p>}</article><aside>{target&&<FileViewer key={target.filePath} filePath={target.filePath} cwd={cwd} revealLine={target.line} revealColumn={target.column} revealKey={target.key} active initialDisplayMode={target.filePath.endsWith(".md")?undefined:"source"} onOpenFile={(filePath,location)=>{window.recovered={filePath,...location};setTarget({filePath,...location,key:Date.now()})}}/>}</aside></main></I18nProvider>;}
createRoot(document.getElementById("root")).render(<App/>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const css = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "") + await readFile(path.join(repo, "components/FileEditor.module.css"), "utf8");
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { window.EventSource = class { close() {} addEventListener() {} removeEventListener() {} }; localStorage.setItem("pi-locale", "zh-CN"); });
    await page.route("http://references.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/file-index") {
        const response = await searchLocalFiles(new NextRequest(route.request().url()));
        return route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
      }
      if (url.pathname.startsWith("/api/files/")) {
        const filename = decodeURIComponent(url.pathname);
        if ([generatedFile, relativeFile, ...proposals].some(file => filename.slice("/api/files/".length) === file.replaceAll("\\", "/").replace(/^\/+/, ""))) {
          const response = await readLocalFile(new NextRequest(route.request().url()), { params: Promise.resolve({ path: url.pathname.slice("/api/files/".length).split("/").map(decodeURIComponent) }) });
          return route.fulfill({ status: response.status, contentType: response.headers.get("content-type") ?? "application/json", body: Buffer.from(await response.arrayBuffer()) });
        }
        return route.fulfill(filename.includes("missing.ts") || filename.endsWith("/proposal.md") || filename.endsWith("/design.md") ? { status: 404, json: { error: "File not found" } } : { json: { content: Array.from({ length: 300 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n"), language: "typescript", size: 9000, version: "fixture", mtime: new Date().toISOString() } });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { supported: false, shortcuts: [], commands: [] } });
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(url.pathname))) });
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}main{display:grid;grid-template-columns:1fr 1fr;height:760px}article{padding:24px}aside{height:600px;min-width:0}</style><div id="root"></div><script src="/bundle.js"></script>` });
    });
    await page.goto("http://references.test/");
    const originalUrl = page.url();
    for (const [label, filePath, line, column] of [["features/voice/PushTalkComponent.ets:236", `${workspace}/features/voice/PushTalkComponent.ets`, 236], ["common/corebase/VoiceReportConstNew.ets:216:5", `${workspace}/common/corebase/VoiceReportConstNew.ets`, 216, 5], ["C:/My Project/src/absolute.ts:42:3", "C:/My Project/src/absolute.ts", 42, 3]]) {
      await page.getByRole("link", { name: label, exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.opened), { filePath, line, ...(column ? { column } : {}) });
      // Highlight expires after 1.6s; assert highlighting and scroll position in
      // one browser observation so a slow host cannot lose it between calls.
      const visibleHighlight = () => page.waitForFunction(expectedLine => {
        const row = document.querySelector(`.file-source-line[data-line-number="${expectedLine}"].search-reveal-line`);
        if (!row) return false;
        const viewport = row.closest(".file-viewer-content").getBoundingClientRect(), rect = row.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      }, line, { timeout: 15000 });
      try { await visibleHighlight(); }
      catch (error) { console.error({ errors, state: await page.evaluate(() => ({ text: document.body.innerText.slice(0, 500), rows: document.querySelectorAll(".file-source-line").length, highlights: document.querySelectorAll(".search-reveal-line").length, editors: document.querySelectorAll(".cm-editor").length })) }); throw error; }
      assert.equal(page.url(), originalUrl); assert.equal(await page.getByLabel("Message draft").inputValue(), "keep my draft");
    }
    await page.getByRole("link", { name: generatedFile, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.opened), { filePath: generatedFile.replaceAll("\\", "/") });
    await page.waitForFunction(() => document.querySelector('.file-source-line[data-line-number="1"]')?.textContent.includes("export const generatedReplyFile = true;"));
    assert.equal(page.url(), originalUrl, "a real generated file opens in the side pane");
    assert.equal(await page.getByLabel("Message draft").inputValue(), "keep my draft");
    await page.getByRole("link", { name: "src/generated.browser.test.mjs", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.opened), { filePath: relativeFile.replaceAll("\\", "/") });
    await page.waitForFunction(() => document.querySelector('.file-source-line[data-line-number="1"]')?.textContent.includes("export const relativeReplyFile = true;"));
    await page.getByRole("link", { name: "../outside.ts:2", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "路径超出当前工作区" }).waitFor();
    await page.getByRole("link", { name: "src/missing.ts:9", exact: true }).click();
    await page.getByText("引用的文件在此路径下不存在。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "在项目中搜索此文件名", exact: true }).waitFor();
    await page.getByRole("link", { name: "proposal.md:2", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.file-source-line[data-line-number="2"]')?.textContent.includes("unique-file-recovery-change-a"));
    await page.getByRole("link", { name: "design.md:2", exact: true }).click();
    const choices = page.getByRole("group", { name: "选择要打开的文件" });
    await choices.waitFor();
    assert.equal(await choices.getByRole("button").count(), 2, "duplicate basenames require an explicit choice");
    await choices.getByRole("button", { name: "openspec/change-b/design.md", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.file-source-line[data-line-number="2"]')?.textContent.includes("unique-file-recovery-change-b"));
    assert.deepEqual(await page.evaluate(() => window.recovered), { filePath: proposals[2].replaceAll("\\", "/"), line: 2, column: undefined });
    assert.equal(await page.getByLabel("Message draft").inputValue(), "keep my draft");
    assert.deepEqual(errors, []);
  } finally { globalThis.__piAllowedRootsCache = previousRoots; await browser?.close(); await rm(directory, { recursive: true, force: true }); }
});
