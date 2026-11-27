import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");
async function bundleUI(directory) {
  await writeFile(path.join(directory,"loader.cjs"),`const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
  await writeFile(path.join(directory,"css.cjs"),`module.exports=function(s){const prefix=this.resourcePath.replace(/.*[\\\\/]/,'').replace(/\\W/g,'')+'_';const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+m[1]]));const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(m,n)=>'.'+names[n]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.appendChild(style);export default '+JSON.stringify(names)}`);
  await writeFile(path.join(directory,"entry.tsx"),`
    import React,{useState} from "react";import{createRoot}from"react-dom/client";
    import{I18nProvider}from ${JSON.stringify(path.join(repo,"hooks/useI18n.tsx"))};
    import{ChatInput}from ${JSON.stringify(path.join(repo,"components/ChatInput.tsx"))};
    import{readComposerRecord}from ${JSON.stringify(path.join(repo,"lib/reply-storage.ts"))};
    window.readComposerRecord=readComposerRecord;window.sent=[];
    function Fixture(){
      const [session,setSession]=useState('one');
      const [leaf,setLeaf]=useState('a');
      const [busy,setBusy]=useState(false);
      return <main style={{maxWidth:540,margin:'40px auto',padding:20}}>
        <button onClick={()=>setSession(session==='one'?'two':'one')}>切换会话</button>
        <button onClick={()=>setLeaf(leaf==='a'?'branch':'a')}>切换分支</button>
        <button onClick={()=>setBusy(!busy)}>运行状态</button>
        <ChatInput draftKey={'fixture:'+session} isStreaming={busy}
          replySource={busy?null:{sessionId:session,sourceEntryId:'a',leafId:leaf,text:'已完成'}}
          onAbort={()=>setBusy(false)} model={{provider:'fixture',modelId:'chat'}}
          modelList={[{provider:'fixture',id:'chat',name:'Chat model'}]}
          onSend={async(text,images,files,onDurable)=>{window.sent.push(text);onDurable?.('receipt');setBusy(true);return true}}/>
      </main>
    }
    localStorage.setItem('pi-locale','zh-CN');document.documentElement.classList.toggle('dark',location.search.includes('dark'));createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);
  `);
  const compiler=webpack({mode:"development",target:"web",devtool:false,entry:path.join(directory,"entry.tsx"),output:{path:directory,filename:"bundle.js"},resolve:{extensions:[".tsx",".ts",".js"],modules:[path.join(repo,"node_modules"),"node_modules"],alias:{"@":repo}},module:{parser:{javascript:{dynamicImportMode:"eager"}},rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(directory,"loader.cjs")},{test:/\.css$/,use:path.join(directory,"css.cjs")}]},plugins:[new webpack.DefinePlugin({"process.env.NEXT_PUBLIC_APP_VERSION":JSON.stringify("test")})]});
  await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve())));
  return {bundle:await readFile(path.join(directory,"bundle.js")),css:(await readFile(path.join(repo,"app/globals.css"),"utf8")).replace(/@import[^;]+;/g,"")+"\nbody{margin:0;overflow-x:hidden;background:var(--bg);color:var(--text);font-family:Inter,'Microsoft YaHei UI',sans-serif}*{box-sizing:border-box}button{font:inherit}"};
}
test("prediction stays out of drafts until Tab and follows the current branch and session", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-predict-"));
  const original = "请继续补充测试，并解释每个测试场景覆盖了哪一类失败，以及失败时的恢复方式。".repeat(2);
  const branch = "请整理这个分支的修改。";
  const other = "请查看另一个会话里的结果。";
  const requests = [];
  let browser;
  let finishFirst;
  const firstResponse = new Promise(resolve => { finishFirst = resolve; });
  try {
    const { bundle, css } = await bundleUI(directory);
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("piora-input-prediction-v1", JSON.stringify({
        enabled: true, model: { provider: "fixture", modelId: "small" }, timeoutMs: 5_000,
      }));
    });
    await page.route("http://localhost:31997/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/bundle.js") return route.fulfill({ body: bundle, contentType: "text/javascript" });
      if (url.pathname === "/style.css") return route.fulfill({ body: css, contentType: "text/css" });
      if (url.pathname.endsWith("/input-prediction")) {
        const { leafId } = route.request().postDataJSON();
        const session = url.pathname.split("/")[3];
        requests.push({ session, leafId });
        if (requests.length === 1) await firstResponse;
        if (requests.length === 2) return route.fulfill({ status: 409, json: { error: "Stale source" } });
        return route.fulfill({ json: { text: session === "two" ? other : leafId === "branch" ? branch : original } }).catch(() => {});
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>',
      });
    });
    await page.goto("http://localhost:31997");
    const input = page.locator("textarea").first();
    const send = page.getByRole("button", { name: "发送", exact: true });
    await input.waitFor();
    const defaultPlaceholder = await input.getAttribute("placeholder");
    const defaultHeight = await input.evaluate(element => element.clientHeight);
    await page.waitForTimeout(1_000);
    assert.deepEqual(requests, [], "legacy opt-in does not make a new model call");
    await input.press("Tab");
    assert.equal(await input.inputValue(), "");

    const firstRequest = page.waitForRequest(r => r.url().endsWith("/one/input-prediction"));
    await page.evaluate(() => {
      localStorage.setItem("piora-input-prediction-v2", JSON.stringify({
        enabled: true, model: { provider: "fixture", modelId: "small" }, timeoutMs: 5_000,
      }));
      window.dispatchEvent(new Event("piora:input-prediction"));
    });
    await firstRequest;
    await page.getByRole("button", { name: "切换分支" }).click();
    await page.getByPlaceholder(branch, { exact: true }).waitFor();
    finishFirst();
    assert.deepEqual(requests, [
      { session: "one", leafId: "a" },
      { session: "one", leafId: "branch" },
      { session: "one", leafId: "branch" },
    ]);

    await page.getByRole("button", { name: "切换会话" }).click();
    await page.getByPlaceholder(other, { exact: true }).waitFor();
    await page.getByRole("button", { name: "切换会话" }).click();
    await page.getByPlaceholder(branch, { exact: true }).waitFor();
    await page.getByRole("button", { name: "切换分支" }).click();
    await page.getByPlaceholder(original, { exact: true }).waitFor();
    assert.deepEqual(requests.at(-1), { session: "one", leafId: "a" }, "returning to a cancelled branch requests it again");
    assert.ok(await input.evaluate(element => element.clientHeight) > defaultHeight, "long predictions show multiple lines");
    assert.equal(await input.inputValue(), "");
    assert.equal(await send.isDisabled(), true);
    assert.equal(await page.evaluate(async () => (await window.readComposerRecord("drafts", "fixture:one"))?.value ?? ""), "");
    await input.press("Shift+Tab");
    assert.equal(await input.inputValue(), "");
    await input.fill("我的输入");
    await page.waitForFunction(async () => (await window.readComposerRecord("drafts", "fixture:one"))?.value === "我的输入");
    assert.equal(await input.getAttribute("placeholder"), defaultPlaceholder);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "我的输入");
    assert.equal(await input.getAttribute("placeholder"), defaultPlaceholder);
    await input.fill("");
    await page.getByPlaceholder(original, { exact: true }).waitFor();
    await input.press("Tab");
    assert.equal(await input.inputValue(), original);
    assert.deepEqual(await page.evaluate(() => window.sent), []);
    await page.waitForFunction(async value => (await window.readComposerRecord("drafts", "fixture:one"))?.value === value, original);
    await input.fill(`${original} 也请写一份小结。`);
    await send.click();
    assert.deepEqual(await page.evaluate(() => window.sent), [`${original} 也请写一份小结。`]);
  } finally {
    finishFirst();
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
