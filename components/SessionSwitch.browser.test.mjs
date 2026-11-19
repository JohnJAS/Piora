import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import ts from "typescript";

const require=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,"..");
const {webpack}=require("next/dist/compiled/webpack/webpack.js");
const shell=ts.createSourceFile("AppShell.tsx",await readFile(path.join(repo,"components/AppShell.tsx"),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let selection;
function collect(node){if(ts.isVariableDeclaration(node)&&node.name.getText(shell)==="handleSelectSession")selection=node.initializer.arguments[0].getText(shell);ts.forEachChild(node,collect);}collect(shell);
assert.ok(selection);

test("session selection and drafting stay responsive with slow history, running tasks and long Markdown",{timeout:180000},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),"piora-session-switch-"));let browser, server;
  const gates=new Map(),requests=[];
  let broken=true, backgroundReply="b";
  const longReply = [
    "# Start of the long reply",
    ...Array.from({ length: 2100 }, (_, index) =>
      `## Section ${index + 1}\n\n- **An important value** with a [reference][destination].\n- A second item with \`inline code\` and enough text to produce a structured long reply.`),
    "<mark>Preserved highlight</mark> and $x^2$.",
    "Character entity &copy; and a note[^reply].",
    "The complete long reply ends here.",
    "[destination]: https://example.com/reference",
    "[^reply]: Full note text.",
  ].join("\n\n");
  try{
    await writeFile(path.join(root,"loader.cjs"),`const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root,"css.cjs"),'module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))');
    await writeFile(path.join(root,"entry.tsx"),`
import{useRef,useState}from"react";import{createRoot}from"react-dom/client";
import{ChatWindow}from"@/components/ChatWindow";import{I18nProvider}from"@/hooks/useI18n";
import{prefetchSession}from"@/lib/session-prefetch";
const noop=()=>{},sessions=Object.fromEntries(["a","b","c","broken","long"].map(id=>[id,{id,path:"",cwd:"C:/"+id,created:"",modified:"sidebar-"+id,messageCount:2,firstMessage:id,name:"Chat "+id}]));
window.sources=[];window.EventSource=class{static OPEN=1;static CLOSED=2;readyState=1;constructor(url){this.url=location.origin+url;window.sources.push(this);setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:"connected"})}),0)}close(){this.readyState=2}};
window.stream=text=>window.sources.filter(source=>source.readyState===1&&source.url.includes("/api/agent/b/events")).forEach(source=>source.onmessage?.({data:JSON.stringify({type:"message_update",message:{role:"assistant",content:[{type:"text",text}],timestamp:Date.now()}})}));
function App(){const[selectedSession,setSelectedSession]=useState(sessions.a),[sessionKey,setSessionKey]=useState(0),[focused,setFocusedEntryId]=useState(null);
  const selectedSessionIdRef=useRef(null);selectedSessionIdRef.current=selectedSession.id;
  const workspaceNavigationVersionRef=useRef(0),suppressCwdBumpRef=useRef(false),chatInputRef=useRef(null);
  const isMobile=false,setSettingsDialogOpen=noop,setHistoryDialogOpen=noop,setHistoryLocation=noop,setSelectedRoom=noop,setActiveTopPanel=noop,setNewSessionCwd=noop,setNewSessionInitialModel=noop,setNewSessionInitialPrompt=noop,setSystemPrompt=noop,setInitialSessionRestored=noop,setSidebarOpen=noop;
  const replaceUrlWithoutNextNavigation=url=>history.replaceState(null,"",url);
  const select=${selection};
  window.prefetch=id=>prefetchSession(sessions[id]);
  return <><nav>{Object.keys(sessions).map(id=><button key={id} data-target={id} onClick={()=>void select(sessions[id])}>Chat {id}</button>)}</nav>
    <h1>Chat {selectedSession.id}</h1><div id="view">
      <ChatWindow key={sessionKey} session={selectedSession} initialRunning={selectedSession.id==="b"} newSessionCwd={null} focusEntryId={focused} chatInputRef={chatInputRef}/>
    </div></>;
}createRoot(document.getElementById("root")).render(<I18nProvider><App/></I18nProvider>);`);
    const compiler=webpack({
      mode:"development",target:"web",devtool:false,entry:path.join(root,"entry.tsx"),
      output:{path:root,filename:"bundle.js",publicPath:"/"},
      resolve:{
        extensions:[".tsx",".ts",".js"],modules:[path.join(repo,"node_modules"),"node_modules"],
        alias:{
          "@":repo,
          "decode-named-character-reference$":require.resolve("decode-named-character-reference"),
          "hast-util-from-html-isomorphic$":require.resolve("hast-util-from-html-isomorphic"),
        },
      },
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(root,"loader.cjs")},{test:/\.css$/,use:path.join(root,"css.cjs")}]},
    });
    await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve())));
    const css=(await readFile(path.join(repo,"node_modules/tailwindcss/preflight.css"),"utf8"))+(await readFile(path.join(repo,"app/globals.css"),"utf8")).replace(/^@import.*$/gm,"");
    // Worker module chunks are fetched independently of page-level routing.
    server = createServer(async (request, response) => {
      if (request.url === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><meta charset="utf-8"><style>${css}
          body{margin:0;background:var(--bg);color:var(--text)}nav{display:flex;gap:12px;padding:12px}h1{margin:0;padding:8px;font-size:16px}#view{height:calc(100vh - 110px);width:900px;margin:auto}#view>.flex{height:100%}
          .flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.h-full{height:100%}.relative{position:relative}.absolute{position:absolute}.overflow-hidden{overflow:hidden}.overflow-y-auto{overflow-y:auto}.pt-4{padding-top:16px}
          </style><div id="root"></div><script src="/bundle.js"></script>`);
        return;
      }
      try {
        const asset = new URL(request.url, "http://127.0.0.1").pathname;
        if (!asset.endsWith(".js")) throw new Error("Unknown test asset");
        const body = await readFile(path.join(root, path.basename(asset)));
        response.setHeader("Content-Type", "text/javascript");
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    browser=await chromium.launch({channel:process.platform==="win32"?"msedge":"chromium",headless:true});
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
    page.on("pageerror",error=>errors.push(error.stack||error.message));
    await page.addInitScript(() => {
      localStorage.setItem("pi-locale", "zh-CN");
      window.markdownStarted = 0;
      window.markdownFinished = 0;
      window.markdownWorkerErrors = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          if (options?.name === "piora-markdown") {
            window.markdownStarted++;
            this.addEventListener("message", event => {
              if (event.data.chunks) window.markdownFinished++;
              if (event.data.error) window.markdownWorkerErrors.push("Markdown parse failed");
            });
            this.addEventListener("error", event => window.markdownWorkerErrors.push(event.message || String(url)));
          }
        }
      };
    });
    const runtime=id=>({running:id==="b",state:{runtime:id==="b"?"running":"idle",isStreaming:id==="b",isPromptRunning:id==="b"}});
    await page.route(origin + "/api/**",async route=>{
      const request=route.request(),url=new URL(request.url()),pathname=url.pathname;requests.push(pathname);
      const match=pathname.match(/^\/api\/sessions\/(a|b|c|broken|long)$/);
      if(match){
        const id=match[1];
        await gates.get(id)?.promise;
        if(id==="broken"&&broken)return route.fulfill({status:503,json:{error:"fixture offline"}});
        const reply=id==="long"?longReply:Array.from({length:24},(_,i)=>"ANSWER_"+(id==="b"?backgroundReply:id)+" · paragraph "+i).join("\n\n");
        const now=Date.now(),messages=[{role:"user",content:"QUESTION_"+id,timestamp:now-5000},{role:"assistant",content:[{type:"thinking",thinking:"THINKING_"+id},{type:"text",text:reply}],timestamp:now-4000}];
        return route.fulfill({json:{sessionId:id,info:{id,cwd:"C:/"+id,modified:"server-"+id},context:{messages,entryIds:[id+"-user",id+"-assistant"],model:{provider:"fixture",modelId:"fixture-model"},thinkingLevel:"auto"},tree:[],leafId:id+"-assistant",persistedPromptIds:[]}});
      }
      const state=pathname.match(/^\/api\/(?:sessions\/([^/]+)\/state|agent\/([^/]+))$/);
      if(state&&request.method()==="GET"){
        const id=state[1]??state[2];
        await gates.get("state:"+id)?.promise;
        return route.fulfill({json:runtime(id)});
      }
      if(pathname.endsWith("/submissions"))return route.fulfill({json:{items:[],nextOffset:null,taskTimings:[]}});
      if(pathname==="/api/models")return route.fulfill({json:{models:{},modelList:[{id:"fixture-model",provider:"fixture",name:"Fixture model",input:["text","image"]}],defaultModel:{provider:"fixture",modelId:"fixture-model"}}});
      if(pathname==="/api/settings/laboratory")return route.fulfill({json:{planGoalEnabled:false}});
      if(pathname==="/api/system-prompt")return route.fulfill({json:{templates:[],defaultTemplateId:null,selectorVisible:false,maxPromptLength:100000,maxNameLength:80}});
      return route.fulfill({json:{success:true,data:{commands:[],catalog:{revision:"fixture",commands:[]}},files:[],enabled:false,available:false,items:[],commands:[],records:[],operations:[],taskTimings:[],submissions:[],hasMore:false}});
    });
    const hold = id => {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      gates.set(id, { promise, resolve });
    };
    const release = id => { gates.get(id)?.resolve(); gates.delete(id); };
    const select = async id => {
      await page.getByRole("button", { name: "Chat " + id, exact: true }).click();
      await page.locator(`[data-chat-surface][data-session-id="${id}"]`).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("session"), id);
    };
    const composer = page.locator("#view textarea");
    const loading = page.locator(".session-loading-indicator");
    const lastReply = id => page.getByText(`ANSWER_${id} · paragraph 23`, { exact: true });
    const processToggle = page.locator(".compact-process-toggle");
    await page.goto(origin);
    await lastReply("a").waitFor();
    await composer.fill("DRAFT_A_PRESERVED");
    await page.evaluate(() => {
      window.switchFrames = [];
      window.switchTimings = [];
      window.sampleSwitch = true;
      let click;
      document.addEventListener("click", event => {
        const id = event.target.closest("button[data-target]")?.dataset.target;
        if (id) click = { id, at: performance.now() };
      }, true);
      const sample = () => {
        const view = document.querySelector("[data-chat-surface]");
        const id = view?.dataset.sessionId;
        if (click?.id === id) {
          window.switchTimings.push({ id, elapsedMs: performance.now() - click.at });
          click = undefined;
        }
        window.switchFrames.push({
          id, composer: Boolean(view?.querySelector("textarea")), loading: Boolean(view?.querySelector(".session-loading-indicator")),
          alert: Boolean(view?.querySelector('[role="alert"]')), rows: view?.querySelectorAll("[data-chat-entry-id]").length,
          at: performance.now(),
          expanded: view?.querySelector(".compact-process-toggle")?.getAttribute("aria-expanded"),
        });
        if (window.sampleSwitch) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    hold("b");
    hold("state:b");
    await select("b");
    await loading.waitFor();
    assert.equal(await lastReply("a").count(), 0, "the previous message leaves on the first selection");
    assert.equal(await composer.inputValue(), "", "drafts are scoped to the target");
    await composer.fill("DRAFT_B_WHILE_LOADING");
    await composer.press("Enter");
    assert.equal(await composer.inputValue(), "DRAFT_B_WHILE_LOADING", "the pending composer accepts editing and defers submission");

    hold("c");
    hold("state:c");
    await select("c");
    await composer.fill("DRAFT_C_WHILE_LOADING");
    await page.evaluate(() => { window.pendingComposer = document.querySelector("#view textarea"); });
    release("b");
    release("state:b");
    await loading.waitFor();
    assert.ok(page.url().endsWith("session=c"));
    assert.equal(await lastReply("b").count(), 0, "late history and state do not change the selected chat");
    release("c");
    await lastReply("c").waitFor();
    assert.ok(gates.has("state:c"), "history is visible before the runtime response");
    assert.equal(await page.evaluate(() => window.pendingComposer === document.querySelector("#view textarea")), true);
    assert.equal(await composer.inputValue(), "DRAFT_C_WHILE_LOADING");
    release("state:c");

    await select("b");
    await lastReply("b").waitFor();
    assert.equal(await processToggle.getAttribute("aria-expanded"), "true", "active process starts expanded");
    assert.equal(await composer.inputValue(), "DRAFT_B_WHILE_LOADING");
    const aRequests = requests.filter(url => url === "/api/sessions/a").length;
    await select("a");
    await lastReply("a").waitFor();
    assert.equal(await loading.count(), 0);
    assert.equal(requests.filter(url => url === "/api/sessions/a").length, aRequests);
    assert.equal(await composer.inputValue(), "DRAFT_A_PRESERVED");

    const prefetch = page.waitForResponse(response => new URL(response.url()).pathname === "/api/sessions/b");
    await page.evaluate(() => window.prefetch("b"));
    await (await prefetch).finished();
    hold("state:b");
    await select("b");
    await lastReply("b").waitFor();
    assert.equal(await loading.count(), 0);
    assert.equal(await processToggle.getAttribute("aria-expanded"), "true");
    backgroundReply = "b_updated";
    release("state:b");
    await lastReply("b_updated").waitFor();

    await select("broken");
    await page.getByRole("alert").filter({ hasText: "会话加载失败" }).waitFor();
    assert.equal(await composer.inputValue(), "");
    await composer.fill("RETRY_DRAFT");
    await page.evaluate(() => { window.pendingComposer = document.querySelector("#view textarea"); });
    broken = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await lastReply("broken").waitFor();
    assert.equal(await page.evaluate(() => window.pendingComposer === document.querySelector("#view textarea")), true);
    assert.equal(await composer.inputValue(), "RETRY_DRAFT");

    await select("long");
    await page.waitForFunction(() => window.markdownStarted === 1);
    await composer.fill("DRAFT_DURING_LONG_MARKDOWN");
    await select("c");
    assert.equal(await composer.inputValue(), "DRAFT_C_WHILE_LOADING");
    await select("long");
    await page.waitForFunction(() => window.markdownWorkerErrors.length > 0 || (window.markdownFinished > 0 && document.querySelector('[data-session-id="long"] .markdown-body h2')))
      .catch(async error => {
        const diagnostics = await page.evaluate(() => ({
          workers: window.markdownStarted, completed: window.markdownFinished, errors: window.markdownWorkerErrors,
          replyStart: document.querySelector('[data-session-id="long"] .markdown-body')?.textContent?.slice(0, 120),
          headings: document.querySelectorAll('[data-session-id="long"] .markdown-body h2').length,
        }));
        throw new Error(JSON.stringify({ diagnostics, errors }), { cause: error });
      });
    assert.deepEqual(await page.evaluate(() => window.markdownWorkerErrors), []);
    const answer = page.locator('[data-chat-entry-id="long-assistant"] .markdown-body');
    assert.equal(await answer.locator("h2").filter({ hasText: /^Section \d+$/ }).count(), 2100);
    assert.equal(await answer.locator("ul > li").count(), 4200);
    assert.equal(await answer.getByText("The complete long reply ends here.", { exact: true }).count(), 1);
    assert.equal(await answer.locator('a[href="https://example.com/reference"]').count(), 2100, "definitions are visible across rendering groups");
    assert.equal(await answer.locator("mark").textContent(), "Preserved highlight");
    assert.equal(await answer.locator(".katex").count(), 1);
    assert.match(await answer.locator("p").filter({ hasText: "Character entity" }).textContent(), /Character entity © and a note/);
    assert.match(await answer.locator("ol > li").textContent(), /^Full note text\./);
    assert.equal(await composer.inputValue(), "DRAFT_DURING_LONG_MARKDOWN");
    await select("a");
    assert.equal(await composer.inputValue(), "DRAFT_A_PRESERVED");

    await select("b");
    await page.waitForFunction(() => window.sources.some(source => source.readyState === 1 && source.url.includes("/api/agent/b/events")));
    const streamed = "# Streaming reply\n\n" + "A still-running reply. ".repeat(3100);
    await page.evaluate(text => window.stream(text), streamed);
    const live = page.getByRole("heading", { name: "Streaming reply", exact: true });
    await live.waitFor();
    await composer.press("End");
    await composer.pressSequentially("live-draft");
    await page.evaluate(text => window.stream(text + "\n\nFinal streamed sentence."), streamed);
    await page.getByText("Final streamed sentence.", { exact: true }).waitFor();
    assert.match(await composer.inputValue(), /live-draft/);
    await select("c");
    assert.equal(await composer.inputValue(), "DRAFT_C_WHILE_LOADING");

    const evidence = await page.evaluate(() => {
      window.sampleSwitch = false;
      return { frames: window.switchFrames, timings: window.switchTimings, workersCompleted: window.markdownFinished };
    });
    assert.ok(evidence.frames.length > 10);
    assert.ok(evidence.frames.every(frame => frame.composer && (frame.loading || frame.alert || frame.rows > 0)), "every frame has the selected composer's controls and its own history, loading state or error");
    assert.ok(evidence.frames.filter(frame => frame.id === "b" && frame.rows > 0).every(frame => frame.expanded === "true"));
    assert.ok(evidence.timings.length >= 9);
    assert.ok(evidence.timings.every(({ elapsedMs }) => elapsedMs < 500), JSON.stringify(evidence.timings));
    const maxFrameGapMs = Math.max(...evidence.frames.slice(1).map((frame, index) => frame.at - evidence.frames[index].at));
    t.diagnostic(JSON.stringify({ frames: evidence.frames.length, switches: evidence.timings, markdownBytes: Buffer.byteLength(longReply), workersCompleted: evidence.workersCompleted, maxFrameGapMs }));
    assert.deepEqual(errors, []);
    const output = path.join(repo, ".verification/session-switch");
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "frames.json"), JSON.stringify(evidence, null, 2));
  } finally {
    for (const gate of gates.values()) gate.resolve();
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("piora-session-switch-"));
    await rm(root, { recursive: true, force: true });
  }
});
