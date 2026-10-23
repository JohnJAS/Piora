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
import {ChatCommandCard,ChatCommandQueue} from "@/components/ChatCommandCard";
import {createChatCommandCatalog} from "@/lib/chat-command-input";
const catalog=createChatCommandCatalog([{name:"workflow",source:"extension",description:"Start a workflow and continue until complete"}]);
const record={commandId:"sample-command",idempotencyKey:"sample",targetSessionId:"sample",acceptedAt:1792483200000,status:"completed",operation:{version:1,rawText:"/name 项目检查",catalogRevision:catalog.revision,command:catalog.commands.find(c=>c.name==="name"),arguments:"项目检查",phase:"settling",steps:[{id:"command",kind:"command",status:"completed",startedAt:1792483200000,completedAt:1792483200200}],result:{title:"chatCommands.renameCompleted",rename:{before:"新会话",after:"项目检查"}}}};
import { DefaultToolPermissionSetting } from "${path.join(repo, "components/ToolPermissionControl.tsx").replaceAll("\\", "/")}";
function App(){
  const [busy,setBusy]=useState(false);window.setBusy=setBusy;
  const [queued,setQueued]=useState([]);window.setQueued=setQueued;
  const [permission,setPermission]=useState({mode:"auto",revision:1});
  return <I18nProvider><main>
    <section id="command-results"><ChatCommandCard record={record} actions={{retry:async()=>{},restore:async()=>{},cancel:async()=>{},copy:async()=>{}}}/></section>
    <section id="launcher"><NewSessionProjectPicker activeCwd="/workspace/a-very-long-project-name-for-layout-checks" onLaunch={request=>{window.launched=true;window.launchRequest=request}}/></section>
    <section id="conversation"><ChatInput onSend={(text,...args)=>{window.sent=true;window.submission={text,args};return true}} onAbort={()=>{window.stopped=true;setBusy(false)}}
      queueContent={<ChatCommandQueue records={queued} onCancel={async record=>{window.cancelled=record.commandId;setQueued(current=>current.filter(item=>item.commandId!==record.commandId))}}/>}
      commandCatalog={catalog} onLoadSlashCommands={()=>{}} onQueueInput={async(text,images,files,onDurable,options)=>{(window.queuedInputs??=[]).push({text,delivery:options?.delivery});return true}}
      onSteer={()=>true} onFollowUp={()=>true} isStreaming={busy} onModelChange={async()=>true} onThinkingLevelChange={()=>{}}
      model={{provider:"deepseek",modelId:"deepseek-v4.1-flash"}} modelList={[{provider:"deepseek",id:"deepseek-v4.1-flash",name:"DeepSeek V4.1 Flash Very Long Model Name"}]}
      toolPermission={permission} onToolPermissionChange={mode=>{setPermission({mode,revision:permission.revision+1});window.permission=mode}}
      thinkingLevel="high" extensionStatuses={[{key:"fixture",text:"Ready"}]}
      contextControl={<SystemPromptSelector selection={{mode:"default"}} onChange={()=>{}}/>}/></section>
    <section id="permission-settings"><DefaultToolPermissionSetting/></section>
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
      let defaultMode = "auto", failPermissionSave = false;
      const savedModes = [];
      await context.route("http://composer.test/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/api/tool-permissions") {
          if (route.request().method() === "PUT") {
            if (failPermissionSave) return route.fulfill({ status: 500, json: { error: "save failed" } });
            defaultMode = route.request().postDataJSON().mode;
            savedModes.push(defaultMode);
          }
          return route.fulfill({ json: { mode: defaultMode } });
        }
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
      await page.locator("#launcher .model-settings-trigger:not([data-permission-trigger])").waitFor();
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
            const label = footer.querySelector(".model-settings-control .model-settings-trigger-label");
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
      const permission = conversation.locator("[data-permission-trigger]");
      for (const mode of ["full", "ask", "auto"]) {
        await permission.click();
        assert.equal(await page.getByRole("menuitemradio").count(), 3);
        if (process.env.PIORA_COMPOSER_SCREENSHOTS && mode === "full") {
          await page.getByRole("menu").screenshot({ path: path.join(repo, "test-results/composer-layout", `${locale}-permissions.png`) });
        }
        await page.locator(`[role="menuitemradio"][data-mode="${mode}"]`).click();
        assert.equal(await page.evaluate(() => window.permission), mode);
        assert.equal(await permission.getAttribute("aria-expanded"), "false");
      }
      await conversation.locator(".model-settings-trigger:not([data-permission-trigger])").click();
      await page.locator(".model-settings-popover").waitFor();
      await page.keyboard.press("Escape");
      await conversation.locator('button[aria-haspopup="listbox"]').click();
      await page.getByRole("listbox").waitFor();
      await page.keyboard.press("Escape");
      await conversation.locator("textarea").fill("Check layout");
      await conversation.locator(".composer-submit-controls > button:not([data-permission-trigger])").click();
      assert.equal(await page.evaluate(() => window.sent), true);
      // Commands use the same editor; optional controls stay out of the way.
      const editor = conversation.locator("textarea").first();
      await editor.fill("/work");
      await page.getByRole("option").filter({ hasText: "/workflow" }).waitFor();
      const listId = await editor.getAttribute("aria-controls");
      assert.ok(listId);
      await page.keyboard.press("Tab");
      assert.equal(await editor.inputValue(), "/workflow ");
      await page.keyboard.type("Check the workspace");
      assert.equal(await conversation.locator("details[open]").count(), 0);
      await conversation.locator("summary").click();
      await conversation.getByRole("button", { name: locale === "zh-CN" ? "完成后再提问" : "Ask after completion" }).click();
      const query = conversation.getByRole("textbox", { name: locale === "zh-CN" ? "后续提问" : "Follow-up question", exact: true });
      await query.fill("Verify the result");
      await conversation.locator(".composer-submit-controls > button:not([data-permission-trigger])").click();
      const submission = await page.evaluate(() => window.submission);
      assert.equal(submission.text, "/workflow Check the workspace");
      assert.equal(submission.args[4].afterPrompt, "Verify the result");
      await editor.fill("/workflow Keep this as literal text");
      await conversation.locator("summary").click();
      await conversation.getByRole("button", { name: locale === "zh-CN" ? "作为普通消息发送" : "Send as plain message" }).click();
      assert.equal(await editor.inputValue(), "/workflow Keep this as literal text");
      await conversation.locator(".composer-submit-controls > button:not([data-permission-trigger])").click();
      assert.equal((await page.evaluate(() => window.submission)).args[4].inputMode, "text");
      const result = page.locator("#command-results");
      assert.equal(await result.locator("pre").count(), 0);
      await result.getByRole("button", { name: locale === "zh-CN" ? "查看详情" : "View details" }).click();
      assert.equal(await result.locator("pre").innerText(), "/name 项目检查");
      await result.getByRole("button", { name: locale === "zh-CN" ? "收起详情" : "Hide details" }).click();
      // The pending list shares the composer's width and follows its context controls.
      const chatWindowSource = await readFile(path.join(repo, "components/ChatWindow.tsx"), "utf8");
      assert.match(chatWindowSource, /queueContent=\{composerQueueContent\}/);
      assert.match(chatWindowSource, /const composerQueueContent = useMemo\(\(\) => \(\s*<ChatCommandQueue records=\{chatCommands\.records\} onCancel=\{chatCommands\.cancel\} \/>/);
      await page.evaluate(() => window.setQueued([
        { commandId: "queued-first", status: "queued", preview: "Check this after the current task" },
        { commandId: "queued-second", status: "accepted", preview: "Long queued message ".repeat(20) },
      ]));
      const pendingQueue = conversation.getByRole("region", { name: locale === "zh-CN" ? "接下来执行" : "Up next" });
      await pendingQueue.waitFor();
      await conversation.evaluate(section => section.style.setProperty("--chat-column-width", "520px"));
      for (const width of [900, 590, 320]) {
        await conversation.evaluate((section, width) => { section.style.width = width + "px"; }, width);
        const boxes = await conversation.evaluate(section => {
          const queue = section.querySelector('section[aria-label]');
          const rect = element => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom }; };
          return { queue: rect(queue), surface: rect(section.querySelector(".chat-composer-surface")), context: rect(section.querySelector(".chat-composer-context")), overflow: queue.scrollWidth - queue.clientWidth };
        });
        assert.ok(Math.abs(boxes.queue.left - boxes.surface.left) < 1 && Math.abs(boxes.queue.right - boxes.surface.right) < 1, `${locale}/${width}: queue must align with composer ${JSON.stringify(boxes)}`);
        assert.ok(boxes.queue.top >= boxes.context.bottom && boxes.surface.top >= boxes.queue.bottom + 7, "queue belongs between context controls and input with a visible gap");
        assert.ok(boxes.overflow <= 1, "long queued text must wrap without hiding Cancel");
        assert.equal(await pendingQueue.getByRole("button").count(), 2);
      }
      await conversation.evaluate(section => { section.style.width = "590px"; section.style.removeProperty("--chat-column-width"); });
      if (process.env.PIORA_COMPOSER_SCREENSHOTS) {
        await conversation.locator(".composer-column").screenshot({ path: path.join(repo, "test-results/composer-layout", `${locale}-queue.png`) });
      }
      await pendingQueue.getByRole("button").first().click();
      assert.equal(await page.evaluate(() => window.cancelled), "queued-first");
      assert.equal(await pendingQueue.getByRole("button").count(), 1);
      await pendingQueue.getByRole("button").click();
      await pendingQueue.waitFor({ state: "hidden" });
      assert.equal(await conversation.locator("textarea").count(), 1);
      await page.evaluate(() => window.setBusy(true));
      await conversation.locator(".streaming-stop-button").click();
      assert.equal(await page.evaluate(() => window.stopped), true);
      await page.evaluate(() => window.setBusy(true));
      const primary = conversation.locator(".streaming-action-primary");
      const streamingMenu = conversation.locator(".streaming-action-menu");
      let queuedCount = 0;
      // Mouse and keyboard must both ask before sending when no default is enabled.
      for (const trigger of ["click", "Enter"]) {
        for (const delivery of ["steer", "next_turn"]) {
          const text = `${trigger} ${delivery}`;
          await editor.fill(text);
          assert.equal(await primary.innerText(), locale === "zh-CN" ? "发送" : "Send");
          if (trigger === "click") await primary.click();
          else await editor.press("Enter");
          await streamingMenu.waitFor();
          assert.equal(await streamingMenu.getByRole("menuitem").count(), 2);
          assert.equal(await primary.getAttribute("aria-expanded"), "true");
          assert.equal(await page.evaluate(() => window.queuedInputs?.length ?? 0), queuedCount);
          assert.equal(await editor.inputValue(), text);
          await streamingMenu.getByRole("menuitem").nth(delivery === "steer" ? 0 : 1).click();
          await page.waitForFunction(count => window.queuedInputs?.length === count, ++queuedCount);
          assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text, delivery });
          assert.equal(await editor.inputValue(), "");
          await streamingMenu.waitFor({ state: "hidden" });
        }
      }
      // Escape dismisses the choice without sending or losing the draft.
      await editor.fill("Keep this draft");
      await primary.click();
      await primary.press("Escape");
      await streamingMenu.waitFor({ state: "hidden" });
      assert.equal(await editor.inputValue(), "Keep this draft");
      assert.equal(await page.evaluate(() => window.queuedInputs.length), queuedCount);
      for (const behavior of ["steer", "followup"]) {
        await page.evaluate(behavior => {
          const key = "piora-streaming-send-preference:v1";
          const newValue = JSON.stringify({ schemaVersion: 1, enabled: true, behavior });
          localStorage.setItem(key, newValue);
          window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
        }, behavior);
        const delivery = behavior === "steer" ? "steer" : "next_turn";
        for (const trigger of ["click", "Enter"]) {
          const text = `Default ${behavior} ${trigger}`;
          await editor.fill(text);
          assert.equal(await primary.innerText(), behavior === "steer" ? (locale === "zh-CN" ? "引导" : "Steer") : (locale === "zh-CN" ? "排队" : "Queue"));
          if (trigger === "click") await primary.click();
          else await editor.press("Enter");
          await page.waitForFunction(count => window.queuedInputs?.length === count, ++queuedCount);
          assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text, delivery });
          await streamingMenu.waitFor({ state: "hidden" });
        }
        await editor.fill("Override default");
        const toggle = conversation.locator(".streaming-action-toggle");
        await toggle.click();
        await streamingMenu.waitFor();
        if (behavior === "steer") await toggle.press("ArrowDown");
        await toggle.press("Enter");
        await page.waitForFunction(count => window.queuedInputs?.length === count, ++queuedCount);
        assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text: "Override default", delivery: behavior === "steer" ? "next_turn" : "steer" });
        assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("piora-streaming-send-preference:v1"))).behavior, behavior);
      }
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
      if (process.env.PIORA_COMPOSER_SCREENSHOTS) {
        const output = path.join(repo, "test-results", "composer-layout");
        await page.addStyleTag({ content: "#launcher{display:none}#root>main{padding:28px;max-width:780px;margin:auto}#conversation,#command-results{width:100%!important}#conversation{padding-top:12px}body{min-height:500px}" });
        await conversation.evaluate(section => { section.style.width = "100%"; });
        // Switching away from the literal submission starts a new command draft.
        await editor.fill("Hello");
        await editor.fill("/workflow Check the workspace and verify the changes");
        await page.keyboard.press("Escape");
        await page.locator("#root>main").screenshot({ path: path.join(output, `${locale}-commands.png`) });
        await conversation.locator("summary").click();
        await page.locator("#root>main").screenshot({ path: path.join(output, `${locale}-command-options.png`) });
        await conversation.locator("summary").click();
        await page.evaluate(() => document.documentElement.classList.add("dark"));
        await page.locator("#root>main").screenshot({ path: path.join(output, `${locale}-commands-dark.png`) });
      }
      await page.locator("#launcher").evaluate(el => { el.style.display = "block"; });
      await page.locator("#launcher [data-permission-trigger]").click();
      await page.locator('[role="menuitemradio"][data-mode="full"]').click();
      await page.locator("#launcher textarea").fill("Start with full access");
      await page.locator("#launcher .composer-submit-controls > button:not([data-permission-trigger])").click();
      await page.waitForFunction(() => window.launchRequest);
      assert.equal((await page.evaluate(() => window.launchRequest)).prompt.permissionMode, "full");
      assert.equal(defaultMode, "full");
      assert.deepEqual(savedModes, ["full"]);
      const settingsTrigger = page.locator("#permission-settings [data-permission-trigger]");
      await page.waitForFunction(() => document.querySelector('#permission-settings [data-permission-trigger]').textContent.match(/Full access|完全访问/));
      // A fresh page (new launcher) reads the persisted choice without writing it.
      await page.reload();
      const launcherTrigger = page.locator("#launcher [data-permission-trigger]");
      await page.waitForFunction(() => document.querySelector('#launcher [data-permission-trigger]')?.textContent.match(/Full access|完全访问/));
      assert.deepEqual(savedModes, ["full"]);
      await settingsTrigger.click();
      await page.locator('[role="menuitemradio"][data-mode="ask"]').click();
      await page.waitForFunction(() => document.querySelector('#launcher [data-permission-trigger]').textContent.match(/Ask before actions|操作前询问/));
      assert.equal(defaultMode, "ask");
      // Failure keeps the last confirmed mode and is visible to the user.
      failPermissionSave = true;
      await launcherTrigger.click();
      await page.locator('[role="menuitemradio"][data-mode="full"]').click();
      await page.locator('#launcher [role="alert"]').filter({ hasText: "HTTP 500" }).waitFor();
      assert.match(await launcherTrigger.innerText(), /Ask before actions|操作前询问/);
      assert.equal(defaultMode, "ask");
      failPermissionSave = false;
      await launcherTrigger.click();
      await page.locator('[role="menuitemradio"][data-mode="auto"]').click();
      await page.waitForFunction(() => document.querySelector('#permission-settings [data-permission-trigger]').textContent.match(/Ask as needed|按需询问/));
      assert.equal(defaultMode, "auto");

      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close();
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), "piora-composer-layout-")));
    await rm(directory, { recursive: true, force: true });
  }
});
