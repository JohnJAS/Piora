import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url), { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("chat right-click actions copy the intended target, reveal files, and preserve normal interaction", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-chat-context-"));
  let browser;
  try {
    await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, "css.cjs"), 'module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))');
    const markdown = "文件在 C:\\My Project\\报告.browser.test.mjs:42:3。\n\n`src/main.ts#L12C2`\n\n[文档链接](https://example.test/docs?q=one#part)\n\n[`文档代码标签`](https://example.test/code)\n\n[`别名.ts`](src/actual.ts:8)\n\n[file URL](file:///C:/My%20Project/report.md:3)\n\n`../outside.ts:4`\n\n`C:\\My Project\\Reports`\n\n可复制的普通文字。";
    await writeFile(path.join(directory, "entry.tsx"), `
import {createRoot} from "react-dom/client";
import {ChatContentContextMenu} from "@/components/ChatContentContextMenu";
import {MarkdownBody} from "@/components/MarkdownBody";
import {FileToolResultView} from "@/components/FileToolResultView";
import {DisclosurePath} from "@/components/ChatDisclosure";
import {I18nProvider} from "@/hooks/useI18n";
window.copied=[];window.revealed=[];window.opened=[];window.clicks=0;
window.piDesktop={clipboard:{writeText:async text=>{if(window.failCopy)throw Error("denied");window.copied.push(text)}},revealPath:async path=>{window.revealed.push(path);return !window.failReveal}};
createRoot(document.getElementById("root")).render(<I18nProvider><ChatContentContextMenu cwd="C:/repo">
<MarkdownBody className="markdown-assistant-message" cwd="C:/repo" onOpenFile={path=>window.opened.push(path)}>{${JSON.stringify(markdown)}}</MarkdownBody>
<FileToolResultView toolCallId="list" model={{kind:"ls",entries:[{path:"reports/",directory:true,openPath:"C:/repo/reports"},{path:"src/tool.ts",directory:false,openPath:"C:/repo/src/tool.ts"}]}} onOpenFile={path=>window.opened.push(path)}/>
<button onClick={()=>window.clicks++}><DisclosurePath path="src/change.ts" filePath="src/change.ts"/></button>
<textarea aria-label="draft" defaultValue="keep this draft"/>
<a id="edge" href="https://example.test/edge" style={{position:"fixed",right:1,bottom:1}}>edge</a>
</ChatContentContextMenu><button id="outside">outside</button></I18nProvider>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const css = await readFile(path.join(repo, "components/ChatContentContextMenu.module.css"), "utf8");
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
    await page.route("http://context.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(url.pathname))) });
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><style>:root{--bg-panel:white;--bg-hover:#eee;--border:#ccc;--text:#222;--text-muted:#666;--accent:blue}body{margin:24px}${css}</style><div id="root"></div><script src="/bundle.js"></script>` });
    });
    await page.goto("http://context.test/");
    const menu = page.getByRole("menu", { name: "对话内容菜单" });
    const item = name => menu.getByRole("menuitem", { name, exact: true });
    const copy = async (link, label, expected) => {
      await link.click({ button: "right" });
      await item(label).click();
      await menu.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.copied.at(-1)), expected);
    };
    const absolute = page.getByRole("link", { name: "C:\\My Project\\报告.browser.test.mjs:42:3", exact: true });
    await copy(absolute, "复制路径", "C:/My Project/报告.browser.test.mjs");
    await copy(absolute, "复制文字", "C:\\My Project\\报告.browser.test.mjs:42:3");
    await absolute.click({ button: "right" });
    await item("在文件资源管理器中打开").click();
    await menu.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.revealed), ["C:/My Project/报告.browser.test.mjs"]);
    assert.deepEqual(await page.evaluate(() => window.opened), [], "right-click never opens the file preview");
    await absolute.click();
    assert.equal(await page.evaluate(() => window.opened.at(-1)), "C:/My Project/报告.browser.test.mjs:42:3");
    await copy(page.getByRole("link", { name: "src/main.ts#L12C2", exact: true }).locator("code"), "复制路径", "C:/repo/src/main.ts");
    await copy(page.getByRole("link", { name: "file URL", exact: true }), "复制路径", "C:/My Project/report.md");
    await copy(page.getByRole("link", { name: "文档代码标签", exact: true }).locator("code"), "复制链接地址", "https://example.test/code");
    await copy(page.getByRole("link", { name: "别名.ts", exact: true }).locator("code"), "复制路径", "C:/repo/src/actual.ts");
    const web = page.getByRole("link", { name: "文档链接", exact: true });
    await copy(web, "复制链接地址", "https://example.test/docs?q=one#part");
    await web.click({ button: "right" });
    assert.equal(await item("在文件资源管理器中打开").count(), 0, "web URLs are never treated as local files");
    await page.keyboard.press("Escape");
    await copy(page.getByText("reports/", { exact: true }), "复制路径", "C:/repo/reports");
    await copy(page.getByRole("button", { name: "src/tool.ts", exact: true }), "复制路径", "C:/repo/src/tool.ts");
    await copy(page.locator(".chat-disclosure-basename", { hasText: "change.ts" }), "复制路径", "C:/repo/src/change.ts");
    assert.equal(await page.evaluate(() => window.clicks), 0, "right-click on a nested path does not toggle a disclosure");
    await copy(page.getByText("C:\\My Project\\Reports", { exact: true }), "复制路径", "C:/My Project/Reports");
    await page.getByRole("link", { name: "../outside.ts:4", exact: true }).click({ button: "right" });
    assert.equal(await item("在文件资源管理器中打开").isDisabled(), true, "unresolved traversal never reaches the desktop bridge");
    await page.keyboard.press("Escape");

    const prose = page.getByText("可复制的普通文字。", { exact: true });
    await prose.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await copy(prose, "复制选中文字", "可复制的普通文字。");
    await page.evaluate(() => getSelection().removeAllRanges());
    await web.focus();
    await page.keyboard.press("Shift+F10");
    await menu.waitFor();
    assert.equal(await item("复制链接地址").evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("End");
    assert.equal(await item("复制文字").evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    assert.equal(await item("复制文字").evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await web.evaluate(el => el === document.activeElement), true);
    await web.click({ button: "right" });
    await page.locator("#outside").click();
    await menu.waitFor({ state: "hidden" });
    await page.getByLabel("draft").click({ button: "right" });
    assert.equal(await menu.count(), 0, "editable input keeps native menu");
    assert.equal(await page.getByLabel("draft").inputValue(), "keep this draft");

    await page.evaluate(() => window.failReveal = true);
    await absolute.click({ button: "right" });
    await item("在文件资源管理器中打开").click();
    await menu.getByRole("alert").filter({ hasText: "无法打开文件位置" }).waitFor();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await page.evaluate(() => window.failCopy = true);
    await web.click({ button: "right" });
    await item("复制链接地址").click();
    await menu.getByRole("alert").filter({ hasText: "复制失败" }).waitFor();
    await page.evaluate(() => window.failCopy = false);
    await item("复制链接地址").click();
    await menu.waitFor({ state: "hidden" });

    await page.setViewportSize({ width: 360, height: 420 });
    await page.locator("#edge").click({ button: "right" });
    const bounds = await menu.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 360 && bounds.y + bounds.height <= 420, "menu stays within a narrow viewport");
    await page.keyboard.press("Escape");
    await page.evaluate(() => { delete window.piDesktop; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => window.copied.push(text) } }); });
    await absolute.click({ button: "right" });
    assert.equal(await item("在文件资源管理器中打开").isDisabled(), true, "browser mode accurately disables native file reveal");
    await item("复制路径").click();
    await menu.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.copied.at(-1)), "C:/My Project/报告.browser.test.mjs");
    assert.equal(page.url(), "http://context.test/");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), "piora-chat-context-")));
    await rm(directory, { recursive: true, force: true });
  }
});
