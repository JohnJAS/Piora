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
import {useState,useRef} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider} from "@/hooks/useI18n";
import {ChatInput} from "@/components/ChatInput";
import {ShortcutSettings} from "@/components/ShortcutSettings";
import {RoomComposer} from "@/components/RoomComposer";
import {useSendShortcut} from "@/hooks/useSendShortcut";
import {NewSessionProjectPicker} from "@/components/NewSessionProjectPicker";
import {SystemPromptSelector} from "@/components/SystemPromptSelector";
import {ChatCommandCard,ChatCommandQueue} from "@/components/ChatCommandCard";
import {useResizablePanel} from "@/hooks/useResizablePanel";
import {createChatCommandCatalog} from "@/lib/chat-command-input";
const catalog=createChatCommandCatalog([{name:"workflow",source:"extension",description:"Start a workflow and continue until complete"}]);
const record={commandId:"sample-command",idempotencyKey:"sample",targetSessionId:"sample",acceptedAt:1792483200000,status:"completed",operation:{version:1,rawText:"/name 项目检查",catalogRevision:catalog.revision,command:catalog.commands.find(c=>c.name==="name"),arguments:"项目检查",phase:"settling",steps:[{id:"command",kind:"command",status:"completed",startedAt:1792483200000,completedAt:1792483200200}],result:{title:"chatCommands.renameCompleted",rename:{before:"新会话",after:"项目检查"}}}};
function ResizableLauncher(){
  const panelRef=useRef(null),widthRef=useRef(820);
  const resize=useResizablePanel({ariaLabel:"Resize new chat",cssVariable:"--chat-column-width",defaultWidth:820,getCurrentWidth:()=>panelRef.current?.querySelector(".chat-column")?.getBoundingClientRect().width??820,getMaxWidth:()=>panelRef.current?.clientWidth-48,growthDirection:"left",dragScale:2,followDefaultWidth:true,proportional:true,minWidth:240,maxWidth:2000,panelRef,widthRef,storageKey:"fixture-chat-width"});
  return <section id="launcher" ref={panelRef} style={{position:"relative"}}><NewSessionProjectPicker activeCwd="/workspace/a-very-long-project-name-for-layout-checks" onLaunch={request=>{window.launched=true;window.launchRequest=request}}/><div {...resize.separatorProps} id="new-chat-resizer" style={{position:"absolute",left:0,top:80,width:12,height:400,touchAction:"none"}}/></section>;
}
function App(){
  const {shortcut,setShortcut}=useSendShortcut();window.setSendShortcut=setShortcut;
  const [busy,setBusy]=useState(false);window.setBusy=setBusy;
  const [queued,setQueued]=useState([]);window.setQueued=setQueued;
  const [runtimeQueue,setRuntimeQueue]=useState(null);window.setRuntimeQueue=setRuntimeQueue;
  const [conversationWorkflowEnabled,setConversationWorkflowEnabled]=useState(false);window.setConversationWorkflowEnabled=setConversationWorkflowEnabled;
  const [workflowBusy,setWorkflowBusy]=useState(false);window.setWorkflowBusy=setWorkflowBusy;
  return <I18nProvider><main>
    <section id="command-results"><ChatCommandCard record={record} actions={{retry:async()=>{},restore:async()=>{},cancel:async()=>{},copy:async()=>{}}}/></section>
    <ResizableLauncher/>
    <section id="conversation"><ChatInput ref={value=>{window.composer=value}} onSend={(text,...args)=>{window.sent=true;window.submission={text,args};return true}} onAbort={()=>{window.stopped=true;setBusy(false)}}
      queueContent={<ChatCommandQueue records={queued} pendingMessages={runtimeQueue} onPendingAction={async(id,action)=>{window.pendingAction={id,action};if(window.failPendingAction)throw new Error("Pending action failed");setRuntimeQueue(current=>{const pendingInputs=current.pendingInputs.filter(item=>item.id!==id);return {pendingInputs,steering:pendingInputs.filter(item=>item.kind==="steer").map(item=>item.text),followUp:pendingInputs.filter(item=>item.kind==="followUp").map(item=>item.text)}})}} actions={{cancel:async record=>{window.cancelled=record.commandId;if(window.failQueueCancel)throw new Error("Queue cancellation failed");setQueued(current=>current.filter(item=>item.commandId!==record.commandId))},steer:async record=>{window.steered=record.commandId;setQueued(current=>current.filter(item=>item.commandId!==record.commandId))},edit:async record=>{window.editing=record.commandId;return record.preview},save:async(record,text)=>{if(window.failQueueEdit)throw new Error("Queue edit failed");window.edited={id:record.commandId,text};setQueued(current=>current.map(item=>item.commandId===record.commandId?{...item,preview:text}:item))},resume:async record=>{window.resumed=record.commandId;setQueued(current=>current.map(item=>item.commandId===record.commandId?{...item,queuePaused:false}:item))}}}/>}
      commandCatalog={catalog} onLoadSlashCommands={()=>{}} onQueueInput={async(text,images,files,onDurable,options)=>{(window.queuedInputs??=[]).push({text,delivery:options?.delivery});window.lastQueuedOptions=options;return true}}
      onSteer={()=>true} onFollowUp={()=>true} isStreaming={busy} onModelChange={async()=>true} onThinkingLevelChange={()=>{}}
      workflow={conversationWorkflowEnabled?{mode:'agent',turnBudget:10}:undefined} workflowBusy={workflowBusy}
      toolPermission={conversationWorkflowEnabled?{mode:'full',legacy:false}:undefined} onToolPermissionChange={conversationWorkflowEnabled?()=>{}:undefined}
      model={{provider:"deepseek",modelId:"deepseek-v4.1-flash"}} modelList={[{provider:"deepseek",id:"deepseek-v4.1-flash",name:"DeepSeek V4.1 Flash Very Long Model Name",isDefault:true}]}
      thinkingLevel="high" extensionStatuses={[{key:"fixture",text:"Ready"}]}
      toolbarControl={conversationWorkflowEnabled?<SystemPromptSelector selection={{mode:"default"}} onChange={()=>{}}/>:undefined}
      contextControl={!conversationWorkflowEnabled?<SystemPromptSelector selection={{mode:"default"}} onChange={()=>{}}/>:undefined}/></section>
    <section id="room" data-send-shortcut={shortcut}><RoomComposer room={{id:"shortcut-room",members:[],coordination:{mode:"manual"}}} actorSessionId="actor" submissions={[]} onSubmit={async input=>{(window.roomInputs??=[]).push(input);return {...input,status:"delivered"}}/></section>
    <section id="shortcut-settings"><ShortcutSettings/></section>
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
      + (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "")
      + await readFile(path.join(repo, "public/themes/codex-dream-skin/skin.css"), "utf8");
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    for (const locale of ["zh-CN", "en"]) {
      const context = await browser.newContext({ locale, viewport: { width: 1440, height: 1100 } });
      const errors = [];
      const retiredRequests = [];
      let laboratoryEnabled = false;
      let approvalEnabled = false;
      await context.route("http://localhost:43191/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/api/tool-permissions") { retiredRequests.push(route.request().method()); return route.fulfill({ json: { mode: "full" } }); }
        if (pathname === "/api/settings/tool-approval") return route.fulfill({ json: { enabled: approvalEnabled } });
        if (pathname === "/api/settings/laboratory") return route.fulfill({ json: { planGoalEnabled: laboratoryEnabled } });
        if (pathname === "/api/models") return route.fulfill({ json: { models: {}, modelList: [{ provider: "deepseek", id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash Very Long Model Name" }] } });
        if (pathname === "/api/system-prompt") return route.fulfill({ json: { selectorVisible: true, templates: [{ id: "long", name: "Very long system prompt template name", prompt: "Be helpful" }], defaultTemplateId: "long" } });
        if (pathname === "/api/chat-workspace" || pathname === "/api/cwd/validate") return route.fulfill({ json: { cwd: "/workspace/a-very-long-project-name-for-layout-checks", valid: true } });
        if (pathname.startsWith("/api/")) return route.fulfill({ json: { sessions: [], success: true } });
        if (pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(pathname))) });
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><meta charset="utf-8"><style>${css}
          body{background:var(--bg);color:var(--text);font-family:var(--ui-font-family)}#root>main{padding:24px}#launcher,#conversation{width:900px;margin-bottom:32px}
          #shortcut-settings{height:360px}#launcher{height:650px}#conversation{padding-top:32px}#conversation>[data-composer-variant]{padding:0!important}
          </style><div id="root"></div><script src="/bundle.js"></script></html>` });
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://localhost:43191/");
      await page.locator("#launcher .model-settings-trigger:not([data-permission-trigger])").waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-haspopup="listbox"]')].some(el => el.textContent.includes("Very long system")));
      assert.equal(await page.getByTestId("workflow-mode-toggle").count(), 0, "disabled laboratory modes do not add a launcher control");
      const column = page.locator("#launcher .chat-column");
      const initialWidth = await column.evaluate(el => el.getBoundingClientRect().width);
      const handle = await page.locator("#new-chat-resizer").boundingBox();
      await page.mouse.move(handle.x + 5, handle.y + 80);
      await page.mouse.down(); await page.mouse.move(handle.x + 65, handle.y + 80, { steps: 5 }); await page.mouse.up();
      const draggedWidth = await column.evaluate(el => el.getBoundingClientRect().width);
      assert.ok(initialWidth - draggedWidth >= 100, `new chat follows the drag: ${initialWidth} -> ${draggedWidth}`);
      await page.reload(); await page.locator("#launcher .model-settings-trigger").waitFor();
      assert.ok(Math.abs(await column.evaluate(el => el.getBoundingClientRect().width) - draggedWidth) < 2, "new-chat width survives reload");
      assert.equal(await page.locator('[data-testid="new-session-mark"]').count(), 0);
      assert.equal(await page.getByRole("heading", { name: locale === "zh-CN" ? "接下来想让 Piora 做什么？" : "What should Piora work on next?", exact: true }).count(), 1);
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
          if (geometry.width > (id === "launcher" ? 560 : 420)) {
            const centers = geometry.bounds.map(box => box.center);
            assert.ok(Math.max(...centers) - Math.min(...centers) < 2, `${locale}/${id}/${width}: toolbar wrapped`);
          } else if (id === "launcher") {
            assert.ok(geometry.bounds.at(-1).center > geometry.bounds[0].center + 15,
              `${locale}/${width}: narrow launcher keeps labels visible by moving model and send controls onto their own row`);
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
      const field = conversation.locator(".chat-composer-textarea");
      await page.evaluate(() => document.documentElement.dataset.theme = "dream");
      await field.focus();
      const fieldStyle = await field.evaluate(element => {
        const css = getComputedStyle(element);
        return [css.borderTopWidth, css.boxShadow, css.outlineStyle, element.closest(".chat-composer-surface").matches(":focus-within")];
      });
      assert.deepEqual(fieldStyle, ["0px", "none", "none", true], "the composer owns the focus ring even with the Dream skin");
      await page.evaluate(() => delete document.documentElement.dataset.theme);
      assert.equal(await conversation.locator(".model-settings-control button").first().getAttribute("title"), "DeepSeek V4.1 Flash Very Long Model Name");
      assert.equal(await conversation.locator(".model-settings-trigger .model-default-badge").count(), 0, "the default model has no extra composer badge");
      assert.equal(await page.locator("[data-permission-trigger]").count(), 0, "disabled approvals hide the control in both composers");
      await conversation.locator(".model-settings-trigger:not([data-permission-trigger])").click();
      await page.locator(".model-settings-popover").waitFor();
      await page.getByRole("menuitem", { name: locale === "zh-CN" ? /^模型/ : /^Model/ }).click();
      await page.locator(".model-settings-choice").first().waitFor();
      assert.equal(await page.locator(".model-settings-choice .model-default-badge").count(), 0, "model choices also omit the redundant badge");
      await page.keyboard.press("Escape");
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
      // Queue strips tuck behind the input while keeping their controls exposed.
      const chatWindowSource = await readFile(path.join(repo, "components/ChatWindow.tsx"), "utf8");
      assert.match(chatWindowSource, /queueContent=\{composerQueueContent\}/);
      assert.match(chatWindowSource, /const composerQueueContent = useMemo\(\(\) => \(\s*<ChatCommandQueue records=\{chatCommands\.records\} actions=\{queueActions\} pendingMessages=\{queuedMessages\} onPendingAction=\{handlePendingInputAction\} \/>/);
      await page.evaluate(() => window.setRuntimeQueue({steering:['same <b>literal</b>','same <b>literal</b>'],followUp:[],pendingInputs:[{id:'first',text:'same <b>literal</b>',kind:'steer'},{id:'second',text:'same <b>literal</b>',kind:'steer'}]}));
      const runtimeRegion = conversation.getByRole('region', { name: locale === 'zh-CN' ? '接下来执行' : 'Up next' });
      const restorePending = runtimeRegion.getByRole('button', { name: locale === 'zh-CN' ? '恢复排队' : 'Move to queue', exact: true });
      await restorePending.first().waitFor();
      assert.equal(await restorePending.count(), 2);
      await page.evaluate(() => window.setQueued([{commandId:'old-first',status:'delivered',preview:'same <b>literal</b>'},{commandId:'old-second',status:'delivered',preview:'same <b>literal</b>'}]));
      assert.equal(await runtimeRegion.locator('[class*="queueItem"]').count(), 2, 'delivered placeholders must not double the runtime rows');
      assert.doesNotMatch(await runtimeRegion.innerText(), /正在保存提交|Saving submission/);
      assert.equal(await runtimeRegion.locator('b').count(), 0);
      assert.equal(await runtimeRegion.getByRole('button', {name: locale === 'zh-CN' ? '移回输入框' : 'Recall to input'}).count(), 0);
      const runtimeBox = await runtimeRegion.boundingBox();
      const surfaceBox = await conversation.locator('.chat-composer-surface').boundingBox();
      assert.ok(runtimeBox.y < surfaceBox.y && runtimeBox.y + runtimeBox.height > surfaceBox.y, 'guidance shares the attached composer strip');
      await page.evaluate(() => window.failPendingAction=true);
      await restorePending.first().click();
      await runtimeRegion.getByRole('alert').waitFor();
      assert.equal(await restorePending.count(), 2, 'failed action preserves both messages');
      await page.evaluate(() => window.failPendingAction=false);
      await restorePending.first().click();
      assert.deepEqual(await page.evaluate(() => window.pendingAction), {id:'first',action:'queue'});
      await page.waitForFunction(() => window.pendingAction.id==='first');
      await runtimeRegion.locator('button').last().click();
      assert.deepEqual(await page.evaluate(() => window.pendingAction), {id:'second',action:'delete'});
      await runtimeRegion.waitFor({state:'hidden'});
      const longPreview = "Long queued message ".repeat(20);
      await page.evaluate(longPreview => window.setQueued([
        { commandId: "queued-first", status: "queued", preview: "我想参考 chatgpt 的设计" },
        { commandId: "queued-second", status: "accepted", preview: longPreview },
      ]), longPreview);
      const pendingQueue = conversation.getByRole("region", { name: locale === "zh-CN" ? "接下来执行" : "Up next" });
      const cancelQueued = pendingQueue.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true });
      await pendingQueue.waitFor();
      assert.equal(await cancelQueued.count(), 1, "accepted submissions are not confirmed queue rows");
      assert.equal(await pendingQueue.getByRole("button", { name: longPreview, exact: true }).count(), 0);
      await page.evaluate(() => window.setQueued(current => current.map(item => item.commandId === "queued-second" ? { ...item, status: "queued" } : item)));
      await cancelQueued.nth(1).waitFor();
      await conversation.evaluate(section => section.style.setProperty("--chat-column-width", "520px"));
      for (const width of [900, 590, 320]) {
        await conversation.evaluate((section, width) => { section.style.width = width + "px"; }, width);
        const boxes = await conversation.evaluate(section => {
          const queue = section.querySelector('section[aria-label]');
          const rect = element => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom }; };
          return { queue: rect(queue), surface: rect(section.querySelector(".chat-composer-surface")), context: rect(section.querySelector(".chat-composer-context")), buttons: [...queue.querySelectorAll('button')].map(rect), overflow: queue.scrollWidth - queue.clientWidth };
        });
        assert.ok(Math.abs(boxes.queue.left - boxes.surface.left - 12) < 1 && Math.abs(boxes.surface.right - boxes.queue.right - 12) < 1, `${locale}/${width}: queue must be inset evenly ${JSON.stringify(boxes)}`);
        assert.ok(boxes.queue.top >= boxes.context.bottom && Math.abs(boxes.queue.bottom - boxes.surface.top - 14) < 1, "queue bottom tucks behind the input");
        assert.ok(boxes.buttons.every(button => button.bottom <= boxes.surface.top && button.left >= boxes.queue.left && button.right <= boxes.queue.right), "input must not cover queue actions");
        assert.ok(boxes.overflow <= 1, "long queued text must truncate without pushing actions out");
        assert.equal(await cancelQueued.count(), 2);
        assert.ok(await pendingQueue.locator('[title]').filter({ hasText: longPreview }).evaluate(element => element.scrollWidth > element.clientWidth), "preview should stay on one line");
      }
      await page.evaluate(()=>window.setQueued(current=>current.map((item,index)=>index===0?{...item,queuePaused:true}:item)));
      const resumeQueue=pendingQueue.getByRole("button",{name:locale==="zh-CN"?"继续排队":"Resume queue",exact:true});
      await resumeQueue.waitFor();
      const resumeBox=await resumeQueue.boundingBox(), pausedBox=await pendingQueue.boundingBox();
      assert.ok(resumeBox.x>=pausedBox.x && resumeBox.x+resumeBox.width<=pausedBox.x+pausedBox.width,"paused recovery controls stay inside the narrow composer");
      await resumeQueue.click();
      await resumeQueue.waitFor({state:"hidden"});
      assert.equal(await page.evaluate(()=>window.resumed),"queued-first");
      await page.evaluate(() => { window.editing = null; window.steered = null; window.cancelled = null; });
      assert.equal(await pendingQueue.getByRole('button', { name: locale === 'zh-CN' ? '选项' : 'Options', exact: true }).count(), 0);
      await pendingQueue.getByRole('button', { name: longPreview, exact: true }).click();
      const queueEditor = pendingQueue.getByRole("textbox", { name: locale === "zh-CN" ? "编辑消息" : "Edit message" });
      await queueEditor.waitFor();
      assert.equal(await queueEditor.inputValue(), longPreview, "edit restores the entire query");
      await queueEditor.fill("Edited queued query");
      await page.evaluate(() => { window.failQueueEdit = true; });
      const saveQueue = pendingQueue.getByRole("button", { name: locale === "zh-CN" ? "保存并排队" : "Save and queue" });
      await saveQueue.click();
      await pendingQueue.getByRole("alert").waitFor();
      assert.equal(await queueEditor.inputValue(), "Edited queued query", "a failed edit keeps the typed query");
      await page.evaluate(() => { window.failQueueEdit = false; });
      await saveQueue.click();
      await queueEditor.waitFor({ state: "hidden" });
      assert.deepEqual(await page.evaluate(() => window.edited), { id: "queued-second", text: "Edited queued query" });
      // A failed cancellation keeps the row and shows the failure locally.
      await page.evaluate(() => { window.failQueueCancel = true; });
      await cancelQueued.first().click();
      await pendingQueue.getByRole("alert").waitFor();
      assert.equal(await pendingQueue.getByRole("alert").innerText(), "Queue cancellation failed");
      assert.equal(await cancelQueued.count(), 2);
      await page.evaluate(() => { window.failQueueCancel = false; });
      await cancelQueued.last().click();
      assert.equal(await page.evaluate(() => window.cancelled), "queued-second");
      assert.equal(await cancelQueued.count(), 1);
      await conversation.evaluate(section => { section.style.width = "590px"; section.style.removeProperty("--chat-column-width"); });
      // Reset the remaining fixture to capture a clean single-row preview.
      await page.evaluate(() => window.setQueued([{ commandId: "queue-preview", status: "queued", preview: "我想参考 chatgpt 的设计" }]));
      await pendingQueue.locator('[data-live-tooltip="queue-preview"]').waitFor();
      if (process.env.PIORA_COMPOSER_SCREENSHOTS) {
        for (const dark of [false, true]) {
          await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
          await conversation.locator(".composer-column").screenshot({ path: path.join(repo, "test-results/composer-layout", `${locale}-queue-${dark ? "dark" : "light"}.png`) });
        }
        await page.evaluate(() => document.documentElement.classList.remove("dark"));
      }
      await pendingQueue.getByRole("button", { name: locale === "zh-CN" ? "切换引导" : "Switch to steering", exact: true }).click();
      assert.equal(await page.evaluate(() => window.steered), "queue-preview");
      await pendingQueue.waitFor({ state: "hidden" });
      assert.equal(await conversation.locator("textarea").count(), 1);
      // Many waiting messages scroll within the strip instead of taking over the chat.
      await page.evaluate(() => window.setQueued(Array.from({ length: 12 }, (_, index) => ({ commandId: "many-" + index, status: "queued", preview: "Pending message " + index }))));
      const queueList = pendingQueue.locator('[class*="queueList"]');
      assert.ok(await queueList.evaluate(element => element.scrollHeight > element.clientHeight && element.clientHeight <= 180));
      await queueList.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await cancelQueued.last().click();
      assert.equal(await page.evaluate(() => window.cancelled), "many-11");
      await page.evaluate(() => window.setQueued([]));
      await pendingQueue.waitFor({ state: "hidden" });
      await page.evaluate(() => window.setBusy(true));
      await conversation.locator(".streaming-stop-button").click();
      assert.equal(await page.evaluate(() => window.stopped), true);
      await page.evaluate(() => window.setBusy(true));
      const primary = conversation.locator(".streaming-action-primary");
      const hoverSendMode = async () => {
        await conversation.locator('.streaming-mode-picker').scrollIntoViewIfNeeded();
        await editor.hover();
        const rect = await conversation.locator('.streaming-mode-picker').boundingBox();
        assert.ok(rect);
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await conversation.locator('.streaming-mode-menu').waitFor({state:'visible'});
      };
      let queuedCount = 0;
      await editor.fill("Check default");
      await hoverSendMode();
      assert.equal(await conversation.locator('[data-mode="steer"]').count(), 1);
      assert.equal(await conversation.locator('[data-mode="next_turn"]').count(), 1);
      const hoverMenu = conversation.locator('.streaming-mode-menu');
      await hoverMenu.waitFor({state:'visible'});
      await conversation.locator('[data-mode="next_turn"]').hover();
      await page.waitForTimeout(230);
      assert.equal(await hoverMenu.isVisible(), true, 'moving into the options keeps the hover panel open');
      assert.equal(await page.evaluate(() => window.queuedInputs?.length ?? 0), 0, 'hover never sends a message');
      await editor.hover();
      await hoverMenu.waitFor({state:'hidden'});
      await conversation.locator('.streaming-mode-picker').focus();
      await page.keyboard.press('ArrowUp');
      await hoverMenu.waitFor({state:'visible'});
      assert.equal(await conversation.locator('[data-mode="next_turn"]').evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Escape');
      await hoverMenu.waitFor({state:'hidden'});

      await editor.click();
      assert.equal(await conversation.locator(".streaming-send-button > .streaming-action-primary").count(), 1);
      for (const behavior of ["steer", "next_turn"]) {
        await page.evaluate(behavior => {
          const key = "piora-running-send-mode:v1";
          localStorage.setItem(key, behavior);
          window.dispatchEvent(new StorageEvent("storage", { key, newValue: behavior }));
        }, behavior);
        for (const trigger of ["click", "Enter"]) {
          const text = "Default " + behavior + trigger;
          await editor.fill(text);
          const label = behavior === "steer" ? (locale === "zh-CN" ? "引导" : "Steer") : (locale === "zh-CN" ? "排队" : "Queue");
          assert.equal(await primary.getAttribute("aria-label"), label);
          assert.ok((await primary.innerText()).includes(label));
          if (trigger === "click") await primary.click(); else await editor.press("Enter");
          await page.waitForFunction(count => window.queuedInputs?.length === count, ++queuedCount);
          assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text, delivery: behavior });
        }
        const override = behavior === "steer" ? "next_turn" : "steer";
        await editor.fill("Temporary override");
        await hoverSendMode();
        await conversation.locator('.streaming-mode-menu').waitFor({ state: 'visible' });
        await conversation.locator('.streaming-mode-menu').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
        const menuBounds = await conversation.locator('.streaming-mode-menu').boundingBox();
        const triggerBounds = await conversation.locator('.streaming-mode-picker').boundingBox();
        assert.ok(menuBounds && triggerBounds && menuBounds.y < triggerBounds.y && Math.abs(menuBounds.y + menuBounds.height - triggerBounds.y - triggerBounds.height) < 1, 'connected panel grows upward from the main button');
        const mainBounds = await conversation.locator('.streaming-send-button').boundingBox();
        assert.ok(Math.abs(menuBounds.width - mainBounds.width) < 1, 'alternative matches the send button width');
        assert.ok(Math.abs(menuBounds.x - mainBounds.x) < 1, 'alternative aligns with the send button');
        assert.equal(await conversation.locator('.streaming-mode-actions > button').count(), 2);
        await conversation.locator('[data-mode="' + override + '"]').click();
        await conversation.locator('.streaming-mode-menu').waitFor({ state: 'hidden' });
        await page.waitForFunction(count => window.queuedInputs?.length === count, ++queuedCount);
        assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text: "Temporary override", delivery: override });
        await editor.fill('Check restored default');
        await hoverSendMode();
        assert.equal(await conversation.locator('[data-mode="' + behavior + '"]').count(), 1);
        assert.equal(await conversation.locator('[data-mode="' + override + '"]').count(), 1);
        await page.keyboard.press('Escape');
        await conversation.locator('.streaming-mode-menu').waitFor({ state: 'hidden' });
        await page.waitForTimeout(230);
        assert.equal(await conversation.locator('.streaming-mode-menu').isVisible(), false, 'Escape stays dismissed while the pointer remains over the arrow');
        assert.equal(await page.evaluate(() => localStorage.getItem('piora-running-send-mode:v1')), behavior);
      }
      await editor.fill('No default guidance binding');
      await editor.press('Control+Enter');
      assert.equal(await page.evaluate(() => window.queuedInputs.length), queuedCount);
      assert.equal(await editor.inputValue(), 'No default guidance binding');
      const shortcutSettings = page.locator('#shortcut-settings');
      const recorder = action => shortcutSettings.locator('[data-settings-id="conversation.' + action + 'Shortcut"] button').first();
      assert.equal(await shortcutSettings.locator('[data-settings-id="conversation.steerShortcut"]').count(), 0);
      // A saved steering binding must no longer intercept a normal send or cause conflicts.
      await page.evaluate(() => {
        const key = 'piora-chat-shortcuts:v2';
        const newValue = JSON.stringify({ version: 2, bindings: { send: 'Enter', steer: 'Control+Enter', newline: 'Shift+Enter' } });
        localStorage.setItem(key, newValue);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
      });
      await editor.fill('Retired guidance shortcut');
      await editor.press('Control+Enter');
      assert.equal(await page.evaluate(() => window.queuedInputs.length), queuedCount);
      await editor.fill('Queue after guidance');
      await editor.press('Enter');
      await page.waitForFunction(count => window.queuedInputs.length === count, ++queuedCount);
      assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text: 'Queue after guidance', delivery: 'next_turn' });
      await editor.fill('Keep newline');
      await editor.press('Shift+Enter');
      assert.equal(await page.evaluate(() => window.queuedInputs.length), queuedCount);
      assert.ok((await editor.inputValue()).includes('\n'));
      // Sending and newline remain independently configurable and reject conflicts.
      await recorder('send').click();
      await recorder('send').press('Shift+Enter');
      await shortcutSettings.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('piora-chat-shortcuts:v2')).bindings.send), 'Enter');
      await recorder('send').press('Escape');
      await recorder('send').click();
      await recorder('send').press('Control+Enter');
      await recorder('newline').click();
      await recorder('newline').press('Alt+Enter');
      await page.waitForFunction(() => document.querySelector('#room').dataset.sendShortcut !== 'Enter');
      await editor.fill('Custom queued message');
      await editor.press('Control+Enter');
      await page.waitForFunction(count => window.queuedInputs.length === count, ++queuedCount);
      assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text: 'Custom queued message', delivery: 'next_turn' });
      await editor.fill('Custom guidance');
      await hoverSendMode();
      await conversation.locator('[data-mode="steer"]').click();
      await page.waitForFunction(count => window.queuedInputs.length === count, ++queuedCount);
      assert.deepEqual(await page.evaluate(() => window.queuedInputs.at(-1)), { text: 'Custom guidance', delivery: 'steer' });
      // Newlines replace the selection and leave the caret after the inserted break.
      const roomEditor = page.locator('#room textarea');
      for (const input of [editor, roomEditor]) {
        await input.fill('before REPLACE after');
        await input.evaluate(element => element.setSelectionRange(7, 14));
        await input.press('Alt+Enter');
        assert.equal(await input.inputValue(), 'before \n after');
        await page.waitForFunction(selector => document.querySelector(selector).selectionStart === 8, input === editor ? '#conversation textarea' : '#room textarea');
        await input.press('Shift+Enter');
        await input.press('Enter');
        assert.equal(await input.inputValue(), 'before \n after', 'old bindings must not remain active after customization');
      }
      assert.equal(await page.evaluate(() => window.queuedInputs.length), queuedCount);
      await roomEditor.fill('Shared group shortcut');
      await roomEditor.press('Control+Enter');
      await page.waitForFunction(() => window.roomInputs?.at(-1)?.content === 'Shared group shortcut');
      await page.waitForFunction(() => document.querySelector('#room textarea').value === '');
      await page.evaluate(() => window.setBusy(false));
      await editor.fill('Custom idle send');
      await editor.press('Control+Enter');
      await page.waitForFunction(() => window.submission?.text === 'Custom idle send');
      // Completing an exact slash command must not bypass a customized send key.
      await editor.fill('/workflow');
      await editor.press('Enter');
      assert.equal((await page.evaluate(() => window.submission)).text, 'Custom idle send');
      await editor.press('Control+Enter');
      await page.waitForFunction(() => window.submission?.text.trim() === '/workflow');
      // Custom shortcuts stay inert during IME composition, including a non-Enter binding.
      await recorder('send').click();
      await recorder('send').press('Control+Shift+S');
      await editor.fill('Composing message');
      await editor.dispatchEvent('compositionstart');
      await editor.press('Control+Shift+S');
      assert.equal((await page.evaluate(() => window.submission)).text.trim(), '/workflow');
      await editor.dispatchEvent('compositionend');
      await page.waitForTimeout(100);
      await editor.press('Control+Shift+S');
      await page.waitForFunction(() => window.submission?.text === 'Composing message');
      // A second tab loads all preferences and propagates edits back to both composers.
      const otherPage = await context.newPage();
      await otherPage.goto('http://localhost:43191/');
      const otherRecorder = otherPage.locator('#shortcut-settings [data-settings-id="conversation.sendShortcut"] button').first();
      await otherPage.waitForFunction(() => document.querySelector('#room').dataset.sendShortcut === JSON.parse(localStorage.getItem('piora-chat-shortcuts:v2')).bindings.send);
      assert.equal(await otherRecorder.locator('[role="img"]').getAttribute("aria-label"), "Ctrl+Shift+S");
      assert.deepEqual(await otherRecorder.locator("kbd").allTextContents(), ["⌃", "⇧", "S"]);
      await otherRecorder.click();
      await otherRecorder.press('Enter');
      await page.waitForFunction(() => document.querySelector('#room').dataset.sendShortcut === 'Enter');
      await otherPage.close();
      // Resetting newline does not change the send shortcut.
      await shortcutSettings.locator('[data-settings-id="conversation.newlineShortcut"] button').last().click();
      await editor.fill('Restored newline');
      await editor.press('Shift+Enter');
      assert.equal(await editor.inputValue(), 'Restored newline\n');
      assert.equal(await shortcutSettings.locator('[aria-labelledby="shortcut-group-input"] [data-settings-id^="conversation."]').count(), 2);
      await recorder('send').click();
      await recorder('send').press('Control+Enter');
      const resetAll = shortcutSettings.getByRole('button', { name: /Reset all|全部恢复默认/ });
      assert.equal(await resetAll.isEnabled(), true);
      await resetAll.click();
      assert.deepEqual(await recorder('newline').locator('kbd').allTextContents(), ['⇧', '↵']);
      assert.equal(await recorder('send').locator('[role="img"]').getAttribute('aria-label'), 'Enter');
      assert.equal(await resetAll.isEnabled(), false);
      if (process.env.PIORA_COMPOSER_SCREENSHOTS) {
        await shortcutSettings.evaluate(element => { element.style.height = 'auto'; });
        await shortcutSettings.screenshot({ path: path.join(repo, 'test-results/composer-layout', `${locale}-chat-shortcuts.png`) });
        await shortcutSettings.locator('section').filter({ has: page.locator('[data-settings-id="conversation.sendShortcut"]') }).screenshot({ path: path.join(repo, 'test-results/composer-layout', `${locale}-input-shortcuts.png`) });
        await shortcutSettings.evaluate(element => { element.style.height = ''; });
      }
      // Recovered ordinary drafts cannot carry a stale steering delivery into idle sends.
      await page.evaluate(() => window.setBusy(false));
      await editor.fill('');
      await page.evaluate(() => window.composer.restoreCommandDraft({value:'Recovered idle message',files:[],images:[],commandInput:{delivery:'steer'}}));
      await page.waitForFunction(() => document.querySelector('#conversation textarea').value === 'Recovered idle message');
      await editor.press('Enter');
      await page.waitForFunction(() => window.submission?.text === 'Recovered idle message');
      assert.equal((await page.evaluate(() => window.submission)).args[4].delivery, 'next_turn');
      for (const width of [480, 420, 320]) {
        await conversation.evaluate((section, width) => { section.style.width = width + "px"; }, width);
        await page.evaluate(() => window.setBusy(true));
        await conversation.locator("textarea").fill("Follow up");
        await conversation.locator(".streaming-action-primary").waitFor();
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
      await page.locator("#launcher textarea").fill("Start without permission setup");
      await page.locator("#launcher .composer-submit-controls > button").click();
      await page.waitForFunction(() => window.launchRequest);
      assert.equal((await page.evaluate(() => window.launchRequest)).prompt.permissionMode, "full");
      assert.ok(retiredRequests.includes("GET"), "saved permission preferences remain readable while controls are hidden");

      // Reload restores the saved running-send choice, including keyboard sends.
      assert.equal(await page.evaluate(() => localStorage.getItem('piora-running-send-mode:v1')), 'next_turn');
      await page.reload();
      await conversation.locator('textarea').waitFor();
      await page.evaluate(() => window.setBusy(true));
      await editor.fill('Persisted queue preference');
      assert.equal(await primary.getAttribute('aria-label'), locale === 'zh-CN' ? '排队' : 'Queue');
      await editor.press('Enter');
      await page.waitForFunction(() => window.queuedInputs?.length === 1);
      assert.deepEqual(await page.evaluate(() => window.queuedInputs[0]), { text: 'Persisted queue preference', delivery: 'next_turn' });

      // Exercise the approved launcher layout with the real production components.
      // Only API data is synthetic; all mode, project, template and send actions use UI.
      const disabledLauncher = page.locator("#launcher");
      for (const width of [900, 320]) {
        await disabledLauncher.evaluate((section, width) => {
          section.style.width = width + "px";
          section.style.setProperty("--chat-column-width", "100%");
        }, width);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const disabledContext = await disabledLauncher.locator(".chat-composer-topbar").evaluate(topbar => {
          const rect = topbar.getBoundingClientRect();
          const rowStarts = new Map();
          for (const control of topbar.querySelector(".chat-composer-context").children) {
            const box = control.getBoundingClientRect();
            const row = Math.round(box.top + box.height / 2);
            rowStarts.set(row, Math.min(rowStarts.get(row) ?? Infinity, box.left));
          }
          return { count: topbar.querySelectorAll("button").length,
            hasPrompt: Boolean(topbar.querySelector('[class*="SystemPromptSelector"][aria-haspopup="listbox"]')),
            left: rect.left + 2, rowStarts: [...rowStarts.values()] };
        });
        assert.equal(await disabledLauncher.getByTestId("workflow-mode-toggle").count(), 0, "disabled laboratory features hide the mode controls");
        assert.equal(disabledContext.count, 1, "the project picker is the only control above the launcher input");
        assert.equal(disabledContext.hasPrompt, false, "the system prompt no longer occupies the project row");
        assert.ok(disabledContext.rowStarts.length > 0 && disabledContext.rowStarts.every(left => Math.abs(left - disabledContext.left) < 1),
          `${locale}/${width}: the project picker stays left when laboratory modes are disabled`);
        const disabledFooterPromptOrder = await disabledLauncher.locator(".chat-composer-footer").evaluate(footer => {
          const prompt = footer.querySelector('[class*="SystemPromptSelector"][aria-haspopup="listbox"]');
          const optimize = footer.querySelector(".prompt-optimize-button");
          return Boolean(prompt && optimize && prompt.compareDocumentPosition(optimize) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        assert.equal(disabledFooterPromptOrder, true, "the footer keeps the system prompt before optimization when laboratory modes are disabled");
      }
      laboratoryEnabled = true;
      approvalEnabled = true;
      await page.reload();
      const launcher = page.locator("#launcher");
      const topbar = launcher.locator(".chat-composer-topbar");
      const modeToggle = launcher.getByTestId("workflow-mode-toggle");
      const projectTrigger = launcher.locator('[class*="projectTrigger"]');
      const templateTrigger = launcher.locator('.chat-composer-footer [class*="SystemPromptSelector"][aria-haspopup="listbox"]');
      await modeToggle.waitFor();
      await templateTrigger.waitFor();
      await launcher.locator('[data-permission-trigger]').waitFor();
      await page.addStyleTag({ content: "#command-results,#conversation,#room,#shortcut-settings{display:none}#launcher{margin-inline:auto;height:680px}#root>main{padding:24px}" });
      assert.equal(await launcher.locator('[class*="eyebrow"]').count(), 0, "the redundant new-task eyebrow is removed");
      assert.equal(await modeToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await topbar.locator("button").count(), 1, "the enabled laboratory also leaves only the project picker above the input");
      assert.equal(await topbar.locator(".chat-composer-workflow").count(), 0, "mode controls remain in the footer");
      assert.equal(await launcher.locator(".chat-composer-footer .chat-composer-workflow").count(), 1);
      assert.equal(await topbar.locator(".chat-composer-context").count(), 1);
      const assertFooterWorkflowOrder = async (composer, hasFooterPrompt = false) => {
        const order = await composer.locator(".chat-composer-footer").evaluate(footer => {
          const permission = footer.querySelector("[data-permission-trigger]");
          const workflow = footer.querySelector(".chat-composer-workflow");
          const optimize = footer.querySelector(".prompt-optimize-button");
          const prompt = footer.querySelector('[class*="SystemPromptSelector"][aria-haspopup="listbox"]');
          return { permissionBeforeWorkflow: Boolean(permission && workflow && permission.compareDocumentPosition(workflow) & Node.DOCUMENT_POSITION_FOLLOWING),
            workflowBeforeOptimize: Boolean(workflow && optimize && workflow.compareDocumentPosition(optimize) & Node.DOCUMENT_POSITION_FOLLOWING),
            workflowBeforePrompt: prompt ? Boolean(workflow && workflow.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
            promptBeforeOptimize: prompt ? Boolean(optimize && prompt.compareDocumentPosition(optimize) & Node.DOCUMENT_POSITION_FOLLOWING) : null };
        });
        assert.deepEqual(order, { permissionBeforeWorkflow: true, workflowBeforeOptimize: true, workflowBeforePrompt: hasFooterPrompt ? true : null,
          promptBeforeOptimize: hasFooterPrompt ? true : null }, "footer controls follow permission, mode, system prompt and optimization order");
      };
      await assertFooterWorkflowOrder(launcher, true);
      for (const width of [900, 720, 480, 320]) {
        await launcher.evaluate((node, value) => { node.style.width = value + "px"; }, width);
        const layout = await launcher.locator(".chat-composer-footer").evaluate(footer => {
          const label = footer.querySelector(".model-settings-control .model-settings-trigger-label");
          const original = label.textContent;
          const controls = [footer.querySelector("[data-permission-trigger]"), footer.querySelector(".chat-composer-workflow"), footer.querySelector(".prompt-optimize-button"), footer.querySelector(".composer-submit-controls")];
          const rows = () => controls.map(node => Math.round(node.getBoundingClientRect().top - footer.getBoundingClientRect().top));
          label.textContent = "maas-deepseek-v4.1-flash-volcengine-" + "production".repeat(12);
          const long = rows(), truncated = label.scrollWidth > label.clientWidth;
          label.textContent = "Mini";
          const short = rows();
          label.textContent = original;
          return { long, short, truncated };
        });
        assert.deepEqual(layout.long, layout.short, `${locale}/${width}: changing only model length must not move actions to another row`);
        assert.equal(layout.truncated, true);
      }
      const capture = process.env.PIORA_COMPOSER_SCREENSHOTS
        ? path.join(repo, ".verification", "launcher-composer-ux") : null;
      if (capture) await mkdir(capture, { recursive: true });
      const settleLayout = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const modeMenu = page.getByTestId("workflow-mode-menu");
      const finishModeAnimation = async () => {
        await settleLayout();
        if (await modeMenu.isVisible()) await modeMenu.evaluate(async menu => {
          await Promise.all(menu.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
        });
      };
      const assertModeMenu = async (trigger, placement = "above") => {
        await modeMenu.waitFor();
        const menuBox = await modeMenu.boundingBox();
        const triggerBox = await trigger.boundingBox();
        assert.ok(placement === "above" ? menuBox.y + menuBox.height <= triggerBox.y - 4 : menuBox.y >= triggerBox.y + triggerBox.height + 4,
          `the mode menu opens ${placement} its trigger: ${JSON.stringify({ menuBox, triggerBox })}`);
        assert.ok(menuBox.x >= 7 && menuBox.x + menuBox.width <= page.viewportSize().width - 7, "the menu respects horizontal viewport bounds");
        assert.equal(await modeMenu.evaluate(menu => menu.parentElement === document.body), true, "the menu portal avoids composer clipping");
        const options = await modeMenu.locator('button[data-testid^="workflow-mode-"]').evaluateAll(buttons => buttons.map(button => {
          const box = button.getBoundingClientRect();
          const label = button.querySelector("span");
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
            readable: Boolean(label && label.clientWidth > 0 && label.scrollWidth <= label.clientWidth + 1) };
        }));
        assert.equal(options.length, 3, "all three modes are directly visible in the menu");
        assert.ok(options.every(option => option.width >= 40 && option.height >= 28 && option.readable
          && option.left >= menuBox.x && option.right <= menuBox.x + menuBox.width + 1
          && option.top >= menuBox.y && option.bottom <= menuBox.y + menuBox.height + 1), "mode options fit the menu without clipping");
      };
      await launcher.locator("textarea").click();
      const restingMode = await modeToggle.boundingBox();
      assert.equal(await modeToggle.locator("svg").count(), 1, "the trigger retains only its mode icon, without an expansion arrow");
      await modeToggle.hover();
      await page.waitForTimeout(250);
      assert.deepEqual(await modeToggle.boundingBox(), restingMode, "hover does not grow an empty arrow slot");
      assert.equal(await modeToggle.getAttribute("aria-expanded"), "false", "opening the menu requires a click");
      await page.mouse.move(0, 0);
      await page.keyboard.press("Tab");
      await modeToggle.focus();
      assert.equal(await modeToggle.evaluate(button => button.matches(":focus-visible")), true);
      assert.equal(await modeToggle.getAttribute("aria-expanded"), "false", "focus alone does not open the menu");
      await launcher.locator("textarea").click();
      const assertProjectLeftAligned = async () => {
        const row = await topbar.boundingBox();
        const project = await projectTrigger.boundingBox();
        assert.ok(Math.abs(project.x - row.x - 2) < 1,
          `${locale}: the project picker stays against the topbar's left padding regardless of laboratory modes`);
      };
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
        for (const [width, fontSize] of [[900, 14], [590, 14], [420, 14], [320, 14], [420, 20], [320, 20]]) {
          await launcher.evaluate((section, width) => {
            section.style.width = width + "px";
            section.style.setProperty("--chat-column-width", "100%");
          }, width);
          await page.evaluate(fontSize => { document.documentElement.style.fontSize = fontSize + "px"; }, fontSize);
          await settleLayout();
          await finishModeAnimation();
          assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)), fontSize, "font-size coverage changes the real root font size");
          assert.ok(Math.abs(await modeToggle.evaluate(element => parseFloat(getComputedStyle(element).fontSize)) - fontSize * 0.821) < 0.1,
            "mode controls inherit the scaled text size");
          const before = await topbar.locator(".chat-composer-context").boundingBox();
          await assertProjectLeftAligned();
          await modeToggle.click();
          await finishModeAnimation();
          await assertModeMenu(modeToggle);
          const after = await topbar.locator(".chat-composer-context").boundingBox();
          await assertProjectLeftAligned();
          assert.ok(Math.abs(before.x - after.x) < 1,
            `${locale}/${dark}/${width}/${fontSize}: footer expansion preserves the context controls' horizontal position`);
          const geometry = await launcher.evaluate(section => {
            const rect = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
            const topbar = section.querySelector(".chat-composer-topbar");
            const surface = section.querySelector(".chat-composer-surface");
            const mode = section.querySelector('[data-testid="workflow-mode-select"]');
            return {
              topbar: rect(topbar), surface: rect(surface),
              context: rect(topbar.querySelector(".chat-composer-context")),
              mode: rect(mode),
              contextButtons: [...topbar.querySelectorAll('.chat-composer-context button')].map(rect),
              footer: rect(surface.querySelector(".chat-composer-footer")),
              footerButtons: [...surface.querySelectorAll('.chat-composer-footer button, .chat-composer-footer input')]
                .filter(control => getComputedStyle(control).visibility !== "hidden" && control.getBoundingClientRect().width > 0).map(rect),
              overflow: topbar.scrollWidth - topbar.clientWidth,
              footerOverflow: surface.querySelector(".chat-composer-footer").scrollWidth - surface.querySelector(".chat-composer-footer").clientWidth,
              optimizeVisible: getComputedStyle(surface.querySelector('.prompt-optimize-button > span')).display !== "none",
            };
          });
          assert.ok(geometry.overflow <= 1, `${locale}/${width}/${fontSize}: topbar overflow ${JSON.stringify(geometry)}`);
          assert.ok(geometry.contextButtons.every(box => box.left >= geometry.topbar.left - 1 && box.right <= geometry.topbar.right + 1),
            `${locale}/${width}/${fontSize}: topbar buttons must fit ${JSON.stringify(geometry)}`);
          assert.ok(geometry.footerButtons.every(box => box.left >= geometry.footer.left - 1 && box.right <= geometry.footer.right + 1), "launcher footer controls stay inside the composer");
          assert.ok(geometry.footerOverflow <= 1, `${locale}/${width}/${fontSize}: footer does not overflow`);
          assert.ok(geometry.footerButtons.every((button, index) => geometry.footerButtons.slice(index + 1).every(other =>
            button.right <= other.left + 1 || other.right <= button.left + 1 || button.bottom <= other.top + 1 || other.bottom <= button.top + 1)),
          "footer controls wrap without overlapping the expanded modes, model or send button");
          assert.equal(geometry.optimizeVisible, true, "launcher optimization remains visible on narrow panels");
          assert.ok(geometry.mode.top >= geometry.topbar.bottom, "mode selection sits below the separate project row");
          await assertFooterWorkflowOrder(launcher, true);
          if (capture && (width === 900 || width === 320)) {
            await launcher.screenshot({ path: path.join(capture, `${locale}-${dark ? "dark" : "light"}-${width}-${fontSize}-expanded.png`) });
          }
          await page.keyboard.press("Escape");
          assert.equal(await modeToggle.getAttribute("aria-expanded"), "false");
          await finishModeAnimation();
        }
      }
      await page.evaluate(() => { document.documentElement.classList.remove("dark"); document.documentElement.style.removeProperty("font-size"); });
      await launcher.evaluate(section => { section.style.width = "900px"; });
      await settleLayout();
      await projectTrigger.click();
      const projectPopup = launcher.locator('[class*="projectPopover"]');
      await projectPopup.waitFor();
      const projectBounds = await projectPopup.boundingBox();
      const projectButtonBounds = await projectTrigger.boundingBox();
      assert.ok(projectBounds.y + projectBounds.height <= projectButtonBounds.y - 8, "desktop project selection still opens above its original trigger");
      assert.ok(projectBounds.x >= 0 && projectBounds.x + projectBounds.width <= page.viewportSize().width, "left-aligned project selection remains inside the viewport");
      const projectSearch = projectPopup.locator("input");
      await page.waitForFunction(element => document.activeElement === element, await projectSearch.elementHandle());
      assert.equal(await projectSearch.evaluate(element => document.activeElement === element), true, "project selection focuses its existing search");
      await projectSearch.fill("a-very-long-project-name");
      await projectPopup.getByRole("option").filter({ hasText: "a-very-long-project-name" }).click();
      await page.waitForFunction(() => document.activeElement === document.querySelector("#launcher textarea"));
      assert.equal(await launcher.locator("textarea").evaluate(element => document.activeElement === element), true, "choosing a project still returns focus to the input");
      assert.equal(await projectPopup.count(), 0);
      const selectedContext = await topbar.evaluate(element => {
        const boxes = [...element.querySelectorAll('.chat-composer-context button')]
          .map(control => { const box = control.getBoundingClientRect(); return { center: box.top + box.height / 2, left: box.left, right: box.right }; });
        return { boxes, width: element.clientWidth, overflow: element.scrollWidth - element.clientWidth };
      });
      assert.equal(selectedContext.boxes.length, 1, "selecting a long project keeps only its picker on the top row");
      await assertProjectLeftAligned();
      await assertFooterWorkflowOrder(launcher, true);
      assert.ok(selectedContext.overflow <= 1, "long selected context fits the launcher");
      if (capture) {
        for (const dark of [false, true]) {
          await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
          await launcher.screenshot({ path: path.join(capture, `${locale}-${dark ? "dark" : "light"}-900-selected-collapsed.png`) });
        }
        await page.evaluate(() => document.documentElement.classList.remove("dark"));
      }
      const composerBeforePopup = await launcher.locator(".chat-composer-surface").boundingBox();
      await templateTrigger.click();
      const templatePopup = page.locator('[class*="SystemPromptSelector"][class*="_popup"]').filter({ has: page.getByRole("listbox") });
      await templatePopup.waitFor();
      await templatePopup.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      assert.equal(await templatePopup.evaluate(element => element.parentElement === document.body), true, "system prompt selection keeps its body portal");
      const templateBounds = await templatePopup.boundingBox();
      const templateButtonBounds = await templateTrigger.boundingBox();
      assert.equal(await templateTrigger.evaluate(button => Boolean(button.closest(".chat-composer-footer"))), true, "the system prompt popup remains anchored to its relocated footer trigger");
      assert.ok(templateBounds.y >= templateButtonBounds.y + templateButtonBounds.height + 5,
        `system prompt selection keeps its default downward placement when space permits: ${JSON.stringify({ templateBounds, templateButtonBounds, viewport: page.viewportSize() })}`);
      assert.ok(templateBounds.x >= 8 && templateBounds.x + templateBounds.width <= page.viewportSize().width - 8, "system prompt popup respects viewport edges");
      assert.deepEqual(await launcher.locator(".chat-composer-surface").boundingBox(), composerBeforePopup, "popups overlay rather than push the composer");
      await templatePopup.getByRole("option").last().click();
      assert.equal(await templateTrigger.evaluate(element => document.activeElement === element), true, "choosing a prompt returns focus to its trigger");
      await templateTrigger.press("Enter");
      await templatePopup.waitFor();
      await page.keyboard.press("Escape");
      await templatePopup.waitFor({ state: "hidden" });
      assert.equal(await templateTrigger.evaluate(element => document.activeElement === element), true, "keyboard dismissal returns focus to the footer prompt trigger");
      await page.setViewportSize({ width: 390, height: 800 });
      await launcher.evaluate(section => { section.style.width = "342px"; });
      await projectTrigger.click();
      await projectPopup.waitFor();
      const mobileProject = await projectPopup.boundingBox();
      assert.equal(await projectPopup.evaluate(element => getComputedStyle(element).position), "fixed", "mobile project selection retains its bottom sheet");
      assert.ok(mobileProject.x >= 9 && mobileProject.x + mobileProject.width <= 381 && mobileProject.y + mobileProject.height <= 791,
        "mobile project sheet stays inside the screen");
      assert.equal(await launcher.locator('[class*="projectBackdrop"]').isVisible(), true, "mobile project selection keeps its dismissing backdrop");
      await page.keyboard.press("Escape");
      await projectPopup.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await launcher.evaluate(section => { section.style.width = "900px"; });
      await modeToggle.click();
      await modeMenu.getByTestId("workflow-mode-plan").click();
      // The real launcher must keep the hit region open beyond the previous
      // 520ms selection deadline while the pointer remains on a choice.
      await page.waitForTimeout(650);
      assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "a selected Plan remains expanded under the pointer");
      assert.equal(await modeMenu.getByTestId("workflow-mode-plan").getAttribute("aria-pressed"), "true");
      await modeMenu.getByTestId("workflow-mode-goal").click();
      await page.waitForTimeout(650);
      assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "Goal budget reflow under a stationary pointer does not dismiss the choices");
      await modeMenu.getByTestId("workflow-mode-agent").hover();
      await page.waitForTimeout(650);
      assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "crossing between mode buttons stays inside the same hover boundary");
      assert.equal(await modeMenu.getByTestId("workflow-mode-goal").getAttribute("aria-pressed"), "true", "hovering another option does not change the selection");
      await launcher.getByTestId("workflow-budget-input").hover();
      await page.waitForFunction(() => document.querySelector('#launcher [data-testid="workflow-mode-toggle"]').getAttribute("aria-expanded") === "false");
      await finishModeAnimation();
      assert.ok((await modeToggle.textContent()).includes("Goal"), "moving to the separate Goal budget closes the menu without changing mode");
      const goalGeometry = () => launcher.getByTestId("workflow-mode-select").evaluate(slot => {
        const mode = slot.getBoundingClientRect();
        const toggle = slot.querySelector('[data-testid="workflow-mode-toggle"]').getBoundingClientRect();
        const budget = slot.parentElement.querySelector("label").getBoundingClientRect();
        return { width: mode.width, toggleWidth: toggle.width, gap: budget.left - mode.right };
      });
      const compactGoal = await goalGeometry();
      assert.ok(Math.abs(compactGoal.width - compactGoal.toggleWidth) <= 1, "the Goal trigger occupies only its visible button width");
      assert.ok(Math.abs(compactGoal.gap - 12) < 1, "Goal budget sits beside the trigger without reserved menu space");
      await assertProjectLeftAligned();
      if (capture) await launcher.screenshot({ path: path.join(capture, locale + "-goal-menu-closed.png") });
      const footerBeforeMenu = await launcher.locator(".chat-composer-footer").boundingBox();
      await modeToggle.click();
      await finishModeAnimation();
      await assertModeMenu(modeToggle);
      assert.deepEqual(await goalGeometry(), compactGoal, "opening the menu does not move or resize the Goal budget");
      assert.deepEqual(await launcher.locator(".chat-composer-footer").boundingBox(), footerBeforeMenu, "the menu overlays content without resizing the toolbar");
      await page.keyboard.press("Escape");
      await modeMenu.waitFor({ state: "hidden" });
      assert.deepEqual(await goalGeometry(), compactGoal, "closing the menu preserves the compact toolbar geometry");
      await launcher.evaluate(section => { section.style.width = "320px"; });
      await settleLayout();
      await projectTrigger.click();
      await projectPopup.waitFor();
      const narrowPopup = await projectPopup.boundingBox();
      const narrowTopbar = await topbar.boundingBox();
      assert.ok(narrowPopup.x >= narrowTopbar.x - 1 && narrowPopup.x + narrowPopup.width <= narrowTopbar.x + narrowTopbar.width + 1,
        "left-aligned project menu stays inside a narrow composer in a wide desktop window");
      await page.keyboard.press("Escape");
      await launcher.evaluate(section => { section.style.width = "900px"; });
      await launcher.getByTestId("workflow-budget-input").fill("7");
      await launcher.locator("textarea").fill("Implement the approved launcher UX");
      await launcher.locator(".composer-submit-controls > button").click();
      await page.waitForFunction(() => window.launchRequest?.prompt.message === "Implement the approved launcher UX");
      const approvedLaunch = await page.evaluate(() => window.launchRequest);
      assert.deepEqual(approvedLaunch.prompt.commandInput.workflow, { mode: "goal", turnBudget: 7 });
      assert.equal(approvedLaunch.prompt.permissionMode, "full");
      assert.equal(approvedLaunch.cwd, "/workspace/a-very-long-project-name-for-layout-checks");

      // Conversation mode controls remain in the footer while streaming or
      // workflow actions are busy; those states only disable editing.
      await page.addStyleTag({ content: "#launcher{display:none}#conversation{display:block!important;margin-inline:auto}" });
      await page.evaluate(() => { window.setBusy(false); window.setConversationWorkflowEnabled(true); });
      const conversationMode = conversation.getByTestId("workflow-mode-toggle");
      const conversationFooter = conversation.locator(".chat-composer-footer");
      await conversationMode.waitFor();
      await conversation.locator("[data-permission-trigger]").waitFor();
      assert.equal(await conversation.locator(".chat-composer-topbar .chat-composer-workflow").count(), 0);
      assert.equal(await conversationFooter.locator(".chat-composer-workflow").count(), 1);
      await assertFooterWorkflowOrder(conversation, true);
      await conversationMode.click();
      await finishModeAnimation();
      // This fixture initially sits at the viewport top; verify the fallback
      // before placing it below chat history as in the application.
      await assertModeMenu(conversationMode, "below");
      await modeMenu.getByTestId("workflow-mode-goal").click();
      await conversation.getByTestId("workflow-budget-input").fill("9");
      await page.addStyleTag({ content: "#conversation{min-height:calc(100vh - 80px);display:flex!important;flex-direction:column;justify-content:flex-end}" });
      const finishConversationModeAnimation = finishModeAnimation;
      const conversationFooterGeometry = () => conversationFooter.evaluate(footer => {
        const rect = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
        return { frame: rect(footer), overflow: footer.scrollWidth - footer.clientWidth,
          controls: [...footer.querySelectorAll("button,input")].filter(control => getComputedStyle(control).visibility !== "hidden" && control.getBoundingClientRect().width > 0).map(rect) };
      });
      const assertConversationFooterFits = async width => {
        const footerLayout = await conversationFooterGeometry();
        assert.ok(footerLayout.overflow <= 1, `${locale}/${width}: conversation footer does not overflow: ${JSON.stringify(footerLayout)}`);
        assert.ok(footerLayout.controls.every(control => control.left >= footerLayout.frame.left - 1 && control.right <= footerLayout.frame.right + 1
          && control.top >= footerLayout.frame.top - 1 && control.bottom <= footerLayout.frame.bottom + 1), "conversation footer keeps all controls inside its bounds");
        assert.ok(footerLayout.controls.every((control, index) => footerLayout.controls.slice(index + 1).every(other =>
          control.right <= other.left + 1 || other.right <= control.left + 1 || control.bottom <= other.top + 1 || other.bottom <= control.top + 1)),
        "conversation footer wraps modes, Goal budget and send controls without overlap");
        return footerLayout;
      };
      for (const width of [900, 420, 320]) {
        await conversation.evaluate((section, width) => { section.style.width = width + "px"; }, width);
        await settleLayout();
        await finishConversationModeAnimation();
        await conversationMode.click();
        await finishConversationModeAnimation();
        await assertConversationFooterFits(width);
        await assertModeMenu(conversationMode);
        if (width === 900) {
          const permission = conversation.locator("[data-permission-trigger]");
          const originalStyle = await permission.getAttribute("style");
          const previousAnchor = await conversationMode.boundingBox();
          const previousFooter = await conversationFooter.boundingBox();
          await permission.evaluate(button => { button.style.paddingRight = (parseFloat(getComputedStyle(button).paddingRight) + 16) + "px"; });
          await finishModeAnimation();
          const movedAnchor = await conversationMode.boundingBox();
          assert.ok(Math.abs(movedAnchor.x - previousAnchor.x - 16) < 1, "changing a preceding control moves the menu anchor");
          assert.deepEqual(await conversationFooter.boundingBox(), previousFooter, "the preceding control can move the anchor without resizing the footer");
          assert.ok(Math.abs((await modeMenu.boundingBox()).x - movedAnchor.x) < 1, "the open menu follows an anchor moved by a preceding control");
          await permission.evaluate((button, originalStyle) => { if (originalStyle === null) button.removeAttribute("style"); else button.setAttribute("style", originalStyle); }, originalStyle);
          await finishModeAnimation();
          await assertModeMenu(conversationMode);
          const orderedControls = await conversationFooter.evaluate(footer => ["[data-permission-trigger]", ".chat-composer-workflow", '[class*="SystemPromptSelector"][aria-haspopup="listbox"]'].map(selector => {
            const { left, right, top, bottom } = footer.querySelector(selector).getBoundingClientRect();
            return { left, right, top, bottom };
          }));
          assert.ok(orderedControls.every((control, index) => index === 0 || orderedControls[index - 1].right <= control.left + 1 || orderedControls[index - 1].bottom <= control.top + 1),
            "conversation footer presents permissions, modes and the system prompt in reading order");
        }
        await page.keyboard.press("Escape");
        await finishConversationModeAnimation();
      }
      const conversationBudget = conversation.getByTestId("workflow-budget-input");
      const preservedDraft = "Continue with visible Goal controls";
      await editor.fill(preservedDraft);
      for (const state of ["streaming", "workflowBusy"]) {
        await conversationMode.click();
        await modeMenu.waitFor();
        await page.evaluate(state => { window.setBusy(state === "streaming"); window.setWorkflowBusy(state === "workflowBusy"); }, state);
        await modeMenu.waitFor({ state: "hidden" });
        assert.equal(await conversationMode.isVisible(), true, `${state} keeps the mode selector visible`);
        assert.equal(await conversationMode.isDisabled(), true, `${state} disables mode changes`);
        assert.equal(await conversationBudget.isVisible(), true, `${state} keeps the Goal budget visible`);
        assert.equal(await conversationBudget.isDisabled(), true, `${state} disables budget changes`);
        assert.ok((await conversationMode.textContent()).includes("Goal"), `${state} preserves the selected mode`);
        assert.equal(await conversationBudget.inputValue(), "9", `${state} preserves the selected budget`);
        assert.equal(await editor.inputValue(), preservedDraft, `${state} preserves the draft`);
        for (const width of [900, 420, 320]) {
          await conversation.evaluate((section, width) => { section.style.width = width + "px"; }, width);
          await settleLayout();
          await assertConversationFooterFits(width);
          assert.equal(await conversationFooter.locator(".chat-composer-workflow").count(), 1, `${state}/${width} retains the complete workflow controls`);
          await assertFooterWorkflowOrder(conversation, true);
          for (const selector of ["[data-permission-trigger]", '[class*="SystemPromptSelector"][aria-haspopup="listbox"]', ".prompt-optimize-button", ".model-settings-control", ".composer-submit-controls"]) {
            assert.equal(await conversationFooter.locator(selector).isVisible(), true, `${state}/${width}: ${selector} remains visible`);
          }
          if (state === "streaming") {
            assert.equal(await conversationFooter.locator(".streaming-action-primary").isVisible(), true);
            assert.equal(await conversationFooter.locator(".streaming-mode-picker").isVisible(), true);
          } else {
            assert.equal(await conversationFooter.locator(".composer-submit-controls > button").isVisible(), true);
          }
        }
        await page.evaluate(() => { window.setBusy(false); window.setWorkflowBusy(false); });
        await page.waitForFunction(() => !document.querySelector('#conversation [data-testid="workflow-mode-toggle"]').disabled);
        assert.equal(await conversationBudget.isDisabled(), false, `${state} completion restores budget editing`);
        assert.ok((await conversationMode.textContent()).includes("Goal"), `${state} completion retains Goal`);
        assert.equal(await conversationBudget.inputValue(), "9", `${state} completion retains the budget`);
        assert.equal(await editor.inputValue(), preservedDraft, `${state} completion retains the draft`);
      }
      await conversation.locator(".model-settings-trigger:not([data-permission-trigger])").click();
      await page.locator(".model-settings-popover").waitFor();
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.setBusy(true));
      await conversationFooter.locator(".streaming-action-primary").click();
      await page.waitForFunction(text => window.queuedInputs?.at(-1)?.text === text, preservedDraft);
      assert.deepEqual(await page.evaluate(() => window.lastQueuedOptions.workflow), { mode: "goal", turnBudget: 9 }, "streaming submissions retain the visible disabled workflow selection");
      assert.equal(await editor.inputValue(), "", "queueing still clears the submitted draft");
      assert.equal(await conversationFooter.locator(".streaming-stop-button").isVisible(), true, "an empty streaming draft retains the stop action");
      await assertConversationFooterFits(320);
      await page.evaluate(() => { window.setBusy(false); window.setWorkflowBusy(true); });
      await editor.fill("Continue while workflow controls are busy");
      await conversation.locator(".composer-submit-controls > button").click();
      await page.waitForFunction(() => window.submission?.text === "Continue while workflow controls are busy");
      assert.deepEqual((await page.evaluate(() => window.submission)).args[4].workflow, { mode: "goal", turnBudget: 9 }, "busy workflow controls do not reset the submitted workflow");
      assert.equal(await editor.inputValue(), "", "sending still clears the submitted draft");
      await page.evaluate(() => window.setWorkflowBusy(false));
      await page.waitForFunction(() => !document.querySelector('#conversation [data-testid="workflow-mode-toggle"]').disabled);
      assert.ok((await conversationMode.textContent()).includes("Goal"), "sending preserves the selected Goal mode for the next draft");
      assert.equal(await conversationBudget.inputValue(), "9", "sending preserves the selected Goal budget for the next draft");
      assert.deepEqual(errors, []);
      await context.close();
    }
  } catch (error) {
    if (process.env.PIORA_COMPOSER_SCREENSHOTS) {
      const lastPage = browser?.contexts().at(-1)?.pages().at(-1);
      if (lastPage) {
        const output = path.join(repo, ".verification", "launcher-composer-ux");
        await mkdir(output, { recursive: true });
        await lastPage.screenshot({ path: path.join(output, `failure-${Date.now()}.png`), fullPage: true }).catch(() => {});
      }
    }
    throw error;
  } finally {
    await browser?.close();
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), "piora-composer-layout-")));
    await rm(directory, { recursive: true, force: true });
  }
});
