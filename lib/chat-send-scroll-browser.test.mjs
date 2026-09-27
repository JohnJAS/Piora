import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");
const hook = await readFile(path.join(repo, "hooks/useAgentSession.ts"), "utf8");
const sendScroll = hook.slice(hook.indexOf("const scrollUserMsgToTop ="), hook.indexOf("const clampLiveTailScroll ="));

test("sending in a long virtual conversation keeps the new prompt visible", { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-chat-send-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "entry.tsx"), `import React,{useCallback} from "react";import {createRoot} from "react-dom/client";
import {VirtualList} from ${JSON.stringify(path.join(repo, "components/VirtualList.tsx"))};
function App(){const scrollContainerRef=React.useRef(null),lastUserMsgRef=React.useRef(null),list=React.useRef(null),pending=React.useRef(false),liveTailPinnedScrollTopRef=React.useRef(null),ignoreProgrammaticScrollUntilRef=React.useRef(0);
const stopInitialBottomPin=useCallback(()=>{},[]),PROGRAMMATIC_SCROLL_IGNORE_MS=1000;
const [count,setCount]=React.useState(400),[busy,setBusy]=React.useState(false);
window.finish=()=>setBusy(false);
const keys=React.useMemo(()=>Array.from({length:count},(_,i)=>"row-"+i),[count]);
${sendScroll}
React.useLayoutEffect(()=>{if(pending.current&&scrollUserMsgToTop())pending.current=false;},[count,scrollUserMsgToTop]);
return <><button id="send" onClick={()=>{pending.current=true;setBusy(true);setCount(c=>c+1);}}>Send</button><div id="chat" ref={scrollContainerRef} style={{height:500,width:600,overflowY:"auto"}}><div><VirtualList initialTail keys={keys} estimate={160} scrollContainer={scrollContainerRef} handleRef={list} pinnedKeys={pending.current?[keys.at(-1)]:[]} renderItem={(key,i)=><article ref={i===count-1?el=>{lastUserMsgRef.current=el;if(el&&pending.current)list.current?.cancelNavigation();}:undefined} style={{height:i>=400?80:60+i%11*60}}>{key}</article>}/>{busy&&<div data-chat-tail-spacer style={{height:500}}/>}</div></div></>};createRoot(document.getElementById("root")).render(<App/>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://send.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><style>body{margin:0}article{box-sizing:border-box}</style><div id="root"></div>' }));
    await page.goto("http://send.test/");
    await page.addScriptTag({ content: await readFile(path.join(root, "bundle.js"), "utf8") });
    await page.locator("#send").waitFor();
    for (const position of [null, 0, 30000, null]) {
      await page.evaluate(() => window.finish());
      await page.locator("#chat").evaluate((el, position) => { el.scrollTop = position ?? el.scrollHeight; }, position);
      await page.waitForTimeout(500);
      await page.locator("#send").click();
      await page.waitForTimeout(1500);
      const state = await page.locator("#chat").evaluate(el => {
        const key = "row-" + (Number(el.querySelector("[data-virtual-total]").dataset.virtualTotal) - 1);
        const row = [...el.querySelectorAll("[data-virtual-key]")].find(row => row.dataset.virtualKey === key);
        return { top: el.scrollTop, offset: row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top : null };
      });
      assert.ok(state.offset !== null && state.offset >= 0 && state.offset < 100, JSON.stringify({ position, ...state }));
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    assert.ok(path.resolve(root).startsWith(`${path.resolve(tmpdir())}${path.sep}piora-chat-send-`));
    await rm(root, { recursive: true, force: true });
  }
});
