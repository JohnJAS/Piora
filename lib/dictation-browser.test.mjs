import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");

test("new chat drafts are independent and live dictation replaces partials without late writes", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-dictation-"));
  const repo = path.resolve("."); let browser;
  try {
    await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, "css.cjs"), `module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))`);
    await writeFile(path.join(directory, "entry.tsx"), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ChatInput}from'@/components/ChatInput';import{ChatWindow}from'@/components/ChatWindow';import{I18nProvider}from'@/hooks/useI18n';
      window.sent=[];function Fixture(){const[n,setN]=useState(0);return <><button onClick={()=>setN(n+1)}>New chat</button>{location.hash==='#new'?<ChatWindow key={n} session={null} newSessionCwd="F:/same-project"/>:<ChatInput draftKey={'voice:'+n} isStreaming={false} onAbort={()=>{}} onSend={async text=>{window.sent.push(text);return true}}/>}</>};localStorage.setItem('pi-locale','zh-CN');createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } }, module: { parser: { javascript: { dynamicImportMode: "eager" } }, rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify("test") })] });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const bundle = await readFile(path.join(directory, "bundle.js"));
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage(); const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.stopped = 0;
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => window.stopped++ }] }) } });
      const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
      window.AudioContext = class { sampleRate = 16000; destination = {}; resume() { return Promise.resolve(); } close() { return Promise.resolve(); } createGain() { return node(); } createMediaStreamSource() { return node(); } createScriptProcessor() { const processor = node(); window.feed = seconds => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(Math.round(seconds * 16000)).fill(.08) } }); return processor; } };
    });
    await page.route("https://dictation.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (url.pathname === "/api/speech/transcribe" && route.request().method() === "POST") { requests.push(route); return; }
      if (url.pathname === "/api/speech/transcribe") return route.fulfill({ json: { available: true } });
      if (url.pathname === "/api/system-prompt") return route.fulfill({ json: { templates: [], defaultTemplateId: null, selectorVisible: false } });
      if (url.pathname.startsWith("/api/models")) return route.fulfill({ json: { models: {}, modelList: [], defaultModel: null, thinkingLevels: {}, thinkingLevelPins: {} } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { commands: [], sessions: [], prompts: [], entries: [], models: [] } });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>' });
    });
    await page.goto("https://dictation.test/#new");
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ timeout: 5000 }).catch(async error => { throw new Error(`${error.message}\n${JSON.stringify(errors)}\n${(await page.locator('body').innerText()).slice(0, 2000)}`); });
    await textarea.fill("上一条新聊天的 query");
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    await textarea.fill("第二次的新草稿");
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    await page.goto("https://dictation.test/#voice"); await page.reload();
    const start = () => page.getByRole("button", { name: "开始语音输入", exact: true }).click();
    const respond = async text => { await assertEventually(() => requests.length > 0); await requests.shift().fulfill({ json: { text } }); };
    const voiceButton = page.getByRole("button", { name: "开始语音输入", exact: true });
    await voiceButton.waitFor();
    assert.match(await voiceButton.getAttribute("title"), /Ctrl\+Shift\+M/);
    await textarea.fill("前缀"); await textarea.press("Control+Shift+M"); await page.evaluate(() => window.feed(1));
    await respond("今天"); await page.waitForFunction(() => document.querySelector('textarea').value === '前缀今天');
    assert.equal(await page.evaluate(() => window.stopped), 0, "text arrives before recording stops");
    await page.evaluate(() => window.feed(1)); await respond("今天天气很好");
    await page.waitForFunction(() => document.querySelector('textarea').value === '前缀今天天气很好');
    await page.evaluate(() => window.feed(.3));
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await respond("今天天气很好。");
    await page.waitForFunction(() => window.sent.length === 1);
    assert.deepEqual(await page.evaluate(() => window.sent), ["前缀今天天气很好。"]);
    await start(); await page.evaluate(() => window.feed(1));
    await assertEventually(() => requests.length > 0);
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await respond("迟到的结果");
    await page.waitForTimeout(100);
    assert.equal(await textarea.inputValue(), "");
    await start(); await page.evaluate(() => window.feed(1));
    await assertEventually(() => requests.length > 0); await textarea.fill("手动输入"); await respond("覆盖手动输入");
    await page.waitForTimeout(100); assert.equal(await textarea.inputValue(), "手动输入");
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(directory, { recursive: true, force: true }); }
});
async function assertEventually(check) { const until = Date.now() + 5000; while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(check()); }
