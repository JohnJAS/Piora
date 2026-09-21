import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("Harmony screen workspace supports passive media, copy feedback, zoom, focus and separate manual control", { timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-harmony-panel-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "css.cjs"), 'module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))');
    await writeFile(path.join(root, "stubs.tsx"), `import {useEffect} from "react";export const useI18n=()=>({locale:"zh-CN"});export const useHarmonyLiveFrame=options=>{useEffect(()=>{if(!options.enabled)return;const canvas=options.canvasRef.current;if(!canvas)return;canvas.width=1080;canvas.height=2400;const context=canvas.getContext("2d");context.fillStyle="#f7f8fa";context.fillRect(0,0,1080,2400);context.fillStyle="#15181d";context.font="600 92px sans-serif";context.fillText("设置",80,230);context.fillStyle="#e8ebef";for(let y=340;y<2100;y+=250)context.fillRect(65,y,950,180);context.fillStyle="#333942";context.font="48px sans-serif";["无线网络","蓝牙","移动网络","显示和亮度","声音和振动","通知和状态栏","应用和服务"].forEach((text,index)=>context.fillText(text,105,445+index*250));},[options.canvasRef,options.enabled,options.serial]);return{status:"live",mode:"video",frame:{width:1080,height:2400,serial:"phone",generation:1},refresh:()=>{}}};export const AliIcon=({name})=><span aria-hidden="true" style={{display:"inline-block",fontSize:10,lineHeight:1}}>{name==="mobile"?"▯":"◆"}</span>;export const HarmonyLogViewer=()=>null;export const HarmonyCheckPanel=()=>null;`);
    await writeFile(path.join(root, "entry.tsx"), `import React,{useState} from "react";import {createRoot} from "react-dom/client";import {HarmonyPanel} from "@/components/workspace/HarmonyPanel";function Fixture(){const[maximized,setMaximized]=useState(false);window.maximized=maximized;return <HarmonyPanel active maximized={maximized} onMaximizedChange={setMaximized}/>};createRoot(document.getElementById("root")).render(<Fixture/>);`);
    const aliases = Object.fromEntries(["@/hooks/useI18n", "@/hooks/useHarmonyLiveFrame", "../AliIcon", "./HarmonyLogViewer", "./HarmonyCheckPanel"].map(name => [name, path.join(root, "stubs.tsx")]));
    const compiler = webpack({ mode: "development", target: "web", devtool: false,
      entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { ...aliases, "@": repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }, { test: /\.css$/, use: path.join(root, "css.cjs") }] },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.copies = [];
      window.piDesktop = { clipboard: {
        copyHarmonyMedia: async media => { if (window.failMedia) throw Error("clipboard busy"); window.copies.push(media); },
        writeText: async text => { if (window.failPath) throw Error("clipboard busy"); window.copiedPath = text; },
      } };
      window.EventSource = class { close() {} };
    });
    let recording = null;
    const screenshot = { kind: "screenshot", path: "C:\\保存目录\\手机截图.png", filename: "手机截图.png", size: 123 };
    const video = { kind: "recording", path: "C:\\保存目录\\手机录屏.mp4", filename: "手机录屏.mp4", size: 456 };
    const bundle = await readFile(path.join(root, "bundle.js"));
    const css = await readFile(path.join(repo, "components/workspace/HarmonyPanel.module.css"), "utf8");
    await page.route("https://harmony-panel.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<meta charset="utf-8"><style>:root{--bg:#fff;--bg-panel:#f7f7f8;--bg-hover:#f0f0f1;--border:#e4e4e7;--border-soft:#ececef;--text:#18181b;--text-muted:#52525b;--text-dim:#71717a;--accent:#2563eb;--surface-raised:#fafafa;--surface-muted:#f4f4f5;--btn-primary-bg:#18181b;--btn-primary-fg:#fff;--status-ready:#16a34a;--status-attention:#d97706;--status-failed:#dc2626;--control-height:34px;--control-height-compact:30px;--radius-control:8px;--radius-surface:12px;--focus-ring:#93b4ff;--shadow-popover:0 8px 24px rgba(0,0,0,.1);--text-xs:11.5px;--text-sm:12.5px;--font-mono:Consolas,monospace}html,body,#root{height:100%;margin:0}body{font:14px system-ui,sans-serif}${css}</style><div id="root"></div><script src="/bundle.js"></script>` });
      let data = {};
      const input = request.postDataJSON();
      if (input) requests.push(input);
      if (url.pathname.endsWith("/profile")) data = { profile: "normal" };
      if (url.pathname.endsWith("/devices")) data = { devices: [{ serial: "phone", name: "HUAWEI Mate 70 Pro", state: "online", generation: 1, capabilities: { screenshot: true } }] };
      if (url.pathname.endsWith("/manual")) data = input?.action === "acquire" ? { lease: { token: "lease", serial: "phone", expiresAt: "2099-01-01T00:00:00Z" } } : {};
      if (url.pathname.endsWith("/media")) {
        if (input?.action === "capture_screenshot") data = { artifact: screenshot };
        else if (input?.action === "start_recording") { recording = { recordingId: "rec", serial: "phone", ownerId: input.ownerId, startedAt: new Date().toISOString() }; data = { recording }; }
        else if (input?.action === "stop_recording") { recording = null; data = { artifact: video }; }
        else data = { recording };
      }
      return route.fulfill({ json: data });
    });
    await page.goto("https://harmony-panel.test/");
    await page.getByRole("button", { name: "截图", exact: true }).click();
    await page.getByText("截图已保存并复制到剪贴板", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.copies), [{ kind: "screenshot", path: screenshot.path }]);
    assert.equal(await page.locator(".mediaPath code").textContent(), screenshot.path);
    const fitViewport = await page.locator(".frameViewport").boundingBox();
    const fitCanvas = await page.locator("canvas").boundingBox();
    assert.ok(fitViewport && fitCanvas);
    assert.ok(fitCanvas.width <= fitViewport.width + 1 && fitCanvas.height <= fitViewport.height + 1, "fit mode keeps the whole device screen visible");
    assert.ok(Math.abs(fitCanvas.width / fitCanvas.height - 1080 / 2400) < 0.01, "fit mode preserves the device aspect ratio");
    if (process.env.PIORA_HARMONY_SCREENSHOT_DIR) {
      await mkdir(process.env.PIORA_HARMONY_SCREENSHOT_DIR, { recursive: true });
      await page.locator("#root").screenshot({ path: path.join(process.env.PIORA_HARMONY_SCREENSHOT_DIR, "workspace.png") });
    }
    await page.getByRole("button", { name: "复制路径", exact: true }).click();
    await page.getByRole("button", { name: "路径已复制", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.copiedPath), screenshot.path);
    await page.evaluate(() => { window.failPath = true; });
    await page.getByRole("button", { name: "路径已复制", exact: true }).click();
    await page.getByText("路径复制失败，请重试", { exact: true }).waitFor();
    await page.getByRole("button", { name: "开始录屏", exact: true }).click();
    await page.getByRole("button", { name: /停止录屏/ }).click();
    await page.getByText("录屏文件已保存并复制到剪贴板", { exact: true }).waitFor();
    await page.getByRole("button", { name: "开始录屏", exact: true }).click();
    await page.evaluate(() => { window.failMedia = true; });
    await page.getByRole("button", { name: /停止录屏/ }).click();
    await page.getByText("录屏文件已保存，但复制失败，可重试或复制路径。", { exact: true }).waitFor();
    const mediaRequests = requests.filter(request => ["capture_screenshot", "start_recording", "stop_recording"].includes(request.action));
    assert.ok(mediaRequests.every(request => request.leaseToken === undefined), "passive media does not require a control lease");
    assert.equal(await page.locator(".mediaPath code").textContent(), video.path);
    await page.evaluate(() => { window.failMedia = false; });
    await page.getByRole("button", { name: "重新复制", exact: true }).click();
    await page.getByText("录屏文件已保存并复制到剪贴板", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.copies.length), 3);
    await page.getByRole("combobox", { name: "画面缩放" }).selectOption("150");
    assert.equal(await page.getByRole("combobox", { name: "画面缩放" }).inputValue(), "150");
    assert.equal(await page.locator("canvas").evaluate(canvas => canvas.style.width), "1620px");
    const resizeHandle = page.locator(".drawerResizeHandle");
    const resizeBox = await resizeHandle.boundingBox();
    const drawerBefore = await page.locator(".toolDrawer").boundingBox();
    assert.ok(resizeBox && drawerBefore);
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y - 60);
    await page.mouse.up();
    const drawerAfter = await page.locator(".toolDrawer").boundingBox();
    assert.ok(drawerAfter.height > drawerBefore.height + 40);
    assert.ok(Math.abs(Number(await page.evaluate(() => localStorage.getItem("piora-harmony-drawer-height-v1"))) - drawerAfter.height) < 1);
    await page.getByRole("button", { name: "专注投屏" }).click();
    assert.equal(await page.evaluate(() => window.maximized), true);
    await page.getByRole("button", { name: "手动控制", exact: true }).click();
    await page.getByRole("button", { name: "结束控制", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "输入到手机" }).waitFor();
    await page.getByRole("button", { name: "结束控制", exact: true }).click();
    assert.equal(requests.at(-1).action, "release");
    await page.setViewportSize({ width: 360, height: 900 });
    assert.equal(await page.locator("#root").evaluate(root => root.scrollWidth > root.clientWidth), false);
    if (process.env.PIORA_HARMONY_SCREENSHOT_DIR) {
      await page.locator("#root").screenshot({ path: path.join(process.env.PIORA_HARMONY_SCREENSHOT_DIR, "workspace-narrow.png") });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
