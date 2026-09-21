import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("question card countdown dismisses unanswered drafts and synchronizes request lifecycle", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-question-ui-"));
  let browser;
  try {
    await writeFile(path.join(directory, "ts.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, "css.cjs"), `module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))`);
    await writeFile(path.join(directory, "entry.tsx"), `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {I18nProvider} from ${JSON.stringify(path.join(repo, "hooks/useI18n.tsx"))};
      import {useExtensionDialog} from ${JSON.stringify(path.join(repo, "hooks/useExtensionDialog.ts"))};
      import {UserInputCard} from ${JSON.stringify(path.join(repo, "components/UserInputCard.tsx"))};
      function App(){
        const {dialog,setDialog,receiveDialog}=useExtensionDialog();
        React.useEffect(()=>{window.receiveDialog=receiveDialog;window.dismissDialog=()=>setDialog(null);},[receiveDialog,setDialog]);
        return <><button id="composer">Continue working</button>{dialog?.method==='request_user_input'&&<UserInputCard key={dialog.id} request={dialog} onRespond={(request,response)=>{window.responses.push({id:request.id,...response});setDialog(null);}}/></>;
      }
      window.responses=[];if(!localStorage.getItem('pi-locale'))localStorage.setItem('pi-locale','zh-CN');
      createRoot(document.getElementById('root')).render(<I18nProvider><App/></I18nProvider>);
    `);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } }, module: { parser: { javascript: { dynamicImportMode: "eager" } }, rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "ts.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const bundle = await readFile(path.join(directory, "bundle.js"));
    const globals = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace('@import "tailwindcss";', "");
    const css = await readFile(path.join(repo, "components/UserInputCard.module.css"), "utf8");
    browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1050, height: 800 }, reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("http://question-ui.test/**", route => route.fulfill(route.request().url().endsWith("bundle.js") ? { contentType: "text/javascript", body: bundle } : { contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><style>${globals}${css}*{box-sizing:border-box}body{margin:0;font-family:system-ui}</style><div id="root"></div><script src="/bundle.js"></script>` }));
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto("http://question-ui.test/");
    await page.waitForFunction(() => Boolean(window.receiveDialog));
    // Only explicit clock advances should consume the request's timeout budget.
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
    const request = { type: "extension_ui_request", method: "request_user_input", title: "选择实现方式", description: "这个选择会影响页面交互。", questions: [{ id: "choice", question: "你更希望采用哪种方式？", kind: "single_select", required: true, options: [{ label: "保持简洁", description: "采用默认布局" }, { label: "更多选项", description: "展示详细控制" }] }] };
    const open = async (id, duration = 60_000) => {
      await page.evaluate(({ request, id, duration }) => { window.lastRequest = { ...request, id, expiresAt: Date.now() + duration }; window.receiveDialog(window.lastRequest); }, { request, id, duration });
      await page.getByRole("dialog").waitFor();
    };
    await page.locator("#composer").focus();
    await open("expiry");
    const initialRemaining = Number.parseInt(await page.getByRole("timer").innerText(), 10);
    assert.equal(initialRemaining, 60);
    assert.equal(await page.getByRole("timer").getAttribute("aria-live"), "off");
    await page.getByRole("radio", { name: /保持简洁/ }).click();
    await page.getByRole("textbox", { name: "其他", exact: true }).fill("尚未提交的自定义答案");
    assert.equal(await page.getByRole("radio", { name: /保持简洁/ }).getAttribute("aria-checked"), "false");
    await page.clock.fastForward(50_000);
    await page.waitForFunction(() => document.querySelector('[role="timer"]')?.textContent.includes("10 秒"));
    assert.equal(await page.getByRole("timer").getAttribute("data-urgent"), "true");
    await page.clock.runFor(200);
    await mkdir(path.join(repo, ".verification/user-input-timeout"), { recursive: true });
    await page.screenshot({ path: path.join(repo, ".verification/user-input-timeout/desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.getByRole("timer").isVisible());
    const bounds = await page.getByRole("dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
    await page.screenshot({ path: path.join(repo, ".verification/user-input-timeout/mobile.png") });
    await page.clock.fastForward(10_000);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(await page.evaluate(() => window.responses), [], "timeout must not submit choices, text, or fake cancellation");
    assert.equal(await page.locator("#composer").evaluate(node => node === document.activeElement), true);

    await open("reconnect");
    await page.clock.fastForward(20_000);
    await page.evaluate(() => window.dismissDialog());
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.evaluate(() => window.receiveDialog(window.lastRequest));
    await page.getByRole("dialog").waitFor();
    const reconnectRemaining = Number.parseInt(await page.getByRole("timer").innerText(), 10);
    assert.equal(reconnectRemaining, 40);
    await page.clock.fastForward(40_000);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.evaluate(() => window.receiveDialog(window.lastRequest));
    assert.equal(await page.getByRole("dialog").count(), 0, "expired replays do not reopen the card");

    await open("answer");
    await page.getByRole("radio", { name: /保持简洁/ }).click();
    await page.getByRole("button", { name: /提交回答/ }).click();
    assert.deepEqual(await page.evaluate(() => window.responses), [{ id: "answer", answers: { choice: ["保持简洁"] } }]);
    await open("skip");
    await page.getByRole("button", { name: "跳过并继续" }).click();
    assert.deepEqual(await page.evaluate(() => window.responses.at(-1)), { id: "skip", cancelled: true });
    await open("escape");
    await page.getByRole("dialog").press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(await page.evaluate(() => window.responses.at(-1)), { id: "escape", cancelled: true });

    await open("new-question");
    await page.evaluate(() => window.receiveDialog({ type: "extension_ui_request", method: "close", id: "old-question", reason: "timeout" }));
    assert.equal(await page.getByRole("dialog").count(), 1, "old close events cannot dismiss a new question");
    await page.evaluate(() => window.receiveDialog({ type: "extension_ui_request", method: "close", id: "new-question", reason: "answered" }));
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.responses.length), 3, "another client's answer only dismisses UI");

    await page.setViewportSize({ width: 390, height: 540 });
    await page.evaluate(request => window.receiveDialog({ ...request, id: "long-card", expiresAt: Date.now() + 60_000, questions: [0, 1, 2].map(index => ({ ...request.questions[0], id: `choice${index}` })) }), request);
    await page.getByRole("dialog").waitFor();
    for (const control of [page.getByRole("timer"), page.getByRole("button", { name: /提交回答/ })]) {
      const bounds = await control.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 540, "long question bodies must scroll without clipping countdown or actions");
    }
    await page.screenshot({ path: path.join(repo, ".verification/user-input-timeout/long-mobile.png") });

    await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
    await page.reload(); await page.waitForFunction(() => Boolean(window.receiveDialog) && document.documentElement.lang === "en");
    await open("english");
    assert.match(await page.getByRole("timer").innerText(), /Skipping automatically in 60s/);
    await page.getByRole("button", { name: "Skip and continue" }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("piora-question-ui-"));
    await rm(directory, { recursive: true, force: true });
  }
});
