import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("composer shrinks within a wide window and keeps menus and actions usable", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-composer-layout-"));
  let browser;
  try {
    await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    // Load production CSS modules with isolated names, including their real styles.
    await writeFile(path.join(directory, "css.cjs"), `const postcss=require(${JSON.stringify(require.resolve("postcss"))});module.exports=function(source){
      const prefix=require("node:path").basename(this.resourcePath).replace(/[^a-zA-Z]/g,"")+"_";
      const names={};const root=postcss.parse(source);root.walkRules(rule=>{rule.selector=rule.selector.replace(/\\.([a-zA-Z_][\\w-]*)/g,(_,name)=>"."+(names[name]=prefix+name))});
      return "const s=document.createElement('style');s.textContent="+JSON.stringify(root.toString())+";document.head.append(s);export default "+JSON.stringify(names);
    }`);
    await writeFile(path.join(directory, "entry.tsx"), `
import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider} from "@/hooks/useI18n";
import {ChatInput} from "@/components/ChatInput";
import {NewSessionProjectPicker} from "@/components/NewSessionProjectPicker";
import {SystemPromptSelector} from "@/components/SystemPromptSelector";
function App(){
  const [busy,setBusy]=useState(false);window.setBusy=setBusy;
  return <I18nProvider><main>
    <section id="launcher"><NewSessionProjectPicker activeCwd="/workspace/a-very-long-project-name-for-layout-checks" onLaunch={()=>{window.launched=true}}/></section>
    <section id="conversation"><ChatInput onSend={()=>{window.sent=true;return true}} onAbort={()=>{window.stopped=true;setBusy(false)}}
      onSteer={()=>true} onFollowUp={()=>true} isStreaming={busy} onModelChange={async()=>true} onThinkingLevelChange={()=>{}}
      model={{provider:"deepseek",modelId:"deepseek-v4.1-flash"}} modelList={[{provider:"deepseek",id:"deepseek-v4.1-flash",name:"DeepSeek V4.1 Flash Very Long Model Name"}]}
      thinkingLevel="high" extensionStatuses={[{key:"fixture",text:"Ready"}]}
      contextControl={<SystemPromptSelector selection={{mode:"default"}} onChange={()=>{}}/>}/></section>
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")).render(<App/>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false,
      entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const css = (await readFile(path.join(repo, "node_modules/tailwindcss/preflight.css"), "utf8"))
      + (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "");
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    for (const locale of ["zh-CN", "en"]) {
      const context = await browser.newContext({ locale, viewport: { width: 1440, height: 1100 } });
      const errors = [];
      await context.route("http://composer.test/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/api/models") return route.fulfill({ json: { models: {}, modelList: [{ provider: "deepseek", id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash Very Long Model Name" }] } });
        if (pathname === "/api/system-prompt") return route.fulfill({ json: { selectorVisible: true, templates: [{ id: "long", name: "Very long system prompt template name", prompt: "Be helpful" }], defaultTemplateId: "long" } });
        if (pathname === "/api/chat-workspace" || pathname === "/api/cwd/validate") return route.fulfill({ json: { cwd: "/workspace/a-very-long-project-name-for-layout-checks", valid: true } });
        if (pathname.startsWith("/api/")) return route.fulfill({ json: { sessions: [], success: true } });
        if (pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(pathname))) });
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><meta charset="utf-8"><style>${css}
          body{background:var(--bg);color:var(--text);font-family:var(--ui-font-family)}#root>main{padding:24px}#launcher,#conversation{width:900px;margin-bottom:32px}
          #launcher{height:650px}#conversation{padding-top:32px}#conversation>[data-composer-variant]{padding:0!important}
          </style><div id="root"></div><script src="/bundle.js"></script></html>` });
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://composer.test/");
      await page.locator("#launcher .model-settings-trigger").waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-haspopup="listbox"]')].some(el => el.textContent.includes("Very long system")));
      // Select a real project so its production chip must also truncate.
      await page.locator('#launcher button[aria-haspopup="listbox"]').first().click();
      await page.getByRole("option").filter({ hasText: "a-very-long-project-name" }).click();
      for (const width of [900, 590, 480, 420, 320]) {
        await page.locator("#launcher, #conversation").evaluateAll((sections, width) => sections.forEach(section => { section.style.width = width + "px"; }), width);
        // Let container queries and React's resize handling settle.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        for (const id of ["launcher", "conversation"]) {
          const geometry = await page.locator(`#${id} .chat-composer-footer`).evaluate(footer => {
            const rect = footer.getBoundingClientRect();
            const children = [...footer.children].filter(el => el.getBoundingClientRect().width > 0);
            const bounds = children.map(el => { const box = el.getBoundingClientRect(); return { left: box.left, right: box.right, center: box.top + box.height / 2 }; });
            const send = footer.querySelector(".composer-submit-controls > :last-child").getBoundingClientRect();
            const label = footer.querySelector(".model-settings-trigger-label");
            return { width: rect.width, left: rect.left, right: rect.right, bounds, sendWidth: send.width, labelWidth: label.clientWidth, labelScroll: label.scrollWidth };
          });
          assert.ok(geometry.bounds.every(box => box.left >= geometry.left - 1 && box.right <= geometry.right + 1), `${locale}/${id}/${width}: controls overflow ${JSON.stringify(geometry)}`);
          assert.ok(geometry.sendWidth >= 31, `${locale}/${id}/${width}: action shrank`);
          if (geometry.width > 420) {
            const centers = geometry.bounds.map(box => box.center);
            assert.ok(Math.max(...centers) - Math.min(...centers) < 2, `${locale}/${id}/${width}: toolbar wrapped`);
          }
          if (width === 480) assert.ok(geometry.labelWidth < geometry.labelScroll, "long model name should truncate");
        }
        if (process.env.PIORA_COMPOSER_SCREENSHOTS) {
          const output = path.join(repo, "test-results", "composer-layout");
          await mkdir(output, { recursive: true });
          await page.screenshot({ path: path.join(output, `${locale}-${width}.png`), fullPage: true });
        }
      }
      await page.locator("#launcher, #conversation").evaluateAll(sections => sections.forEach(section => { section.style.width = "590px"; }));
      const conversation = page.locator("#conversation");
      await conversation.locator(".model-settings-trigger").click();
      await page.locator(".model-settings-popover").waitFor();
      await page.keyboard.press("Escape");
      await conversation.locator('button[aria-haspopup="listbox"]').click();
      await page.getByRole("listbox").waitFor();
      await page.keyboard.press("Escape");
      await conversation.locator("textarea").fill("Check layout");
      await conversation.locator(".composer-submit-controls > button").click();
      assert.equal(await page.evaluate(() => window.sent), true);
      await page.evaluate(() => window.setBusy(true));
      await conversation.locator(".streaming-stop-button").click();
      assert.equal(await page.evaluate(() => window.stopped), true);
      for (const width of [480, 420, 320]) {
        await conversation.evaluate((section, width) => { section.style.width = width + "px"; }, width);
        await page.evaluate(() => window.setBusy(true));
        await conversation.locator("textarea").fill("Follow up");
        await conversation.locator(".streaming-action-split").waitFor();
        const overflow = await conversation.locator(".chat-composer-footer").evaluate(footer => footer.scrollWidth - footer.clientWidth);
        assert.ok(overflow <= 1, `${locale}/${width}: streaming actions overflow by ${overflow}px`);
        await page.evaluate(() => window.setBusy(false));
        await conversation.locator("textarea").fill("/reload");
        await page.keyboard.press("Escape");
        const commandOverflow = await conversation.locator(".chat-composer-footer").evaluate(footer => footer.scrollWidth - footer.clientWidth);
        assert.ok(commandOverflow <= 1, `${locale}/${width}: command action overflows by ${commandOverflow}px`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close();
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), "piora-composer-layout-")));
    await rm(directory, { recursive: true, force: true });
  }
});
