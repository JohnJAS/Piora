import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");
const sources = {
  normal: "flowchart TD\nA[Start] --> B{Ready?}\nB -->|Yes| C[Continue]\nB -->|No| D[Wait]",
  wide: `flowchart LR\n${Array.from({ length: 24 }, (_, i) => `N${i}[Step ${i}]`).join(" --> ")}`,
  tall: `flowchart TD\n${Array.from({ length: 24 }, (_, i) => `T${i}[Step ${i}]`).join(" --> ")}`,
  small: "flowchart TD\nS[OK]",
  sequence: "sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi",
  pie: 'pie title Tasks\n"Done": 3\n"Waiting": 2',
  error: "this is not a diagram",
};

test("Mermaid retains geometry across remounts and opens a viewport-fitted, stable viewer", { timeout: 180000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-mermaid-browser-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    // Keep real Mermaid parsing/layout; delay only its completion to exercise races.
    await writeFile(path.join(root, "mermaid.ts"), `import mermaid from ${JSON.stringify(require.resolve("mermaid"))};
      export default {initialize: (...a)=>mermaid.initialize(...a),parse:(...a)=>mermaid.parse(...a),render:async(...a)=>{
        window.renderCalls=(window.renderCalls||0)+1;
        const result=await mermaid.render(...a);
        if(window.delayRender) await new Promise(resolve=>window.releaseRender=resolve);
        return result;
      }};`);
    await writeFile(path.join(root, "entry.tsx"), `import React,{useState,useRef} from "react";import{createRoot}from"react-dom/client";import{flushSync}from"react-dom";
      import {MermaidBlock} from "@/components/MermaidBlock";import{MarkdownBody}from"@/components/MarkdownBody";import{I18nProvider}from"@/hooks/useI18n";import{useTheme,THEME_PRESETS}from"@/hooks/useTheme";
      import{VirtualList}from"@/components/VirtualList";
      const sources=${JSON.stringify(sources)};
      const rows=Array.from({length:100},(_,i)=>String(i));
      function VirtualChat({session}){const scroll=useRef(null);return <div id="virtual-scroll" ref={scroll} style={{height:"100vh",overflow:"auto"}}><VirtualList key={session} keys={rows} estimate={160} scrollContainer={scroll} renderItem={(_,index)=>index===0?<MermaidBlock code={sources.normal}/>:<div style={{height:160}}>Message {index}</div>}/></div>}
      function App(){const[state,setState]=useState({name:"normal",key:0,visible:true,duplicate:false});const[virtual,setVirtual]=useState(null);const[markdown,setMarkdown]=useState(null);const{setTheme}=useTheme();
        window.streamMarkdown=(text,streaming=true)=>flushSync(()=>{setMarkdown(text);setState(s=>({...s,streaming,duplicate:false}));});
        window.virtualSession=session=>flushSync(()=>setVirtual(session));
        window.selectDiagram=(name,remount=true)=>flushSync(()=>setState(s=>({...s,name,key:s.key+Number(remount),visible:true})));
        window.showDiagram=visible=>flushSync(()=>setState(s=>({...s,visible})));
        window.streamDiagram=streaming=>flushSync(()=>setState(s=>({...s,streaming})));
        window.duplicateDiagram=()=>flushSync(()=>setState(s=>({...s,duplicate:true})));
        window.changeTheme=setTheme;window.themes=THEME_PRESETS.map(p=>p.id);
        return <I18nProvider>{virtual!==null?<VirtualChat session={virtual}/>:<div id="scroll" style={{height:"100vh",overflow:"auto"}}><div style={{height:300}}/><main style={{width:"min(760px,100%)",margin:"auto"}}>
          {markdown!==null?<MarkdownBody isStreaming={state.streaming}>{markdown}</MarkdownBody>:state.visible&&<MermaidBlock key={state.key} code={sources[state.name]} isStreaming={state.streaming}/>}<div id="after">Following message</div>
          {state.duplicate&&<MermaidBlock code={sources[state.name]}/>}</main><div style={{height:1000}}/></div>}</I18nProvider>}
      createRoot(document.getElementById("root")).render(<App/>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false,
      entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "mermaid$": path.join(root, "mermaid.ts"), "@": repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }] },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const css = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "");
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem("pi-locale", "en"); });
    await page.route("http://mermaid.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(root, path.basename(url.pathname))) });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><style>${css}*{box-sizing:border-box}html,body{margin:0}button{font:inherit}</style><div id="root"></div><script src="/bundle.js"></script>` });
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto("http://mermaid.test/");
    const preview = page.locator(".mermaid-preview-button").first();
    await preview.waitFor();
    const evidence = process.env.MERMAID_EVIDENCE_DIR;
    if (evidence) await mkdir(evidence, { recursive: true });
    const capture = async name => { if (evidence) {
      await page.screenshot({ path: path.join(evidence, `${name}.png`) });
      await writeFile(path.join(evidence, `${name}.svg`), await page.locator(".mermaid-zoom-canvas svg").evaluate(el=>el.outerHTML));
    } };
    const geometry = () => page.evaluate(() => ({
      block: document.querySelector(".markdown-code-block").getBoundingClientRect().height,
      after: document.querySelector("#after").getBoundingClientRect().top,
      scroll: document.querySelector("#scroll").scrollTop,
    }));
    await page.locator("#scroll").evaluate(el => { el.scrollTop = 250; });
    const before = await geometry();
    await preview.click();
    await page.locator("dialog[open]").waitFor();
    await capture("normal-open");
    const during = await geometry();
    assert.deepEqual(during, before, "opening must preserve the message height and scroll anchor");
    const assertFit = async () => {
      await page.waitForFunction(() => {
        const svg = document.querySelector(".mermaid-zoom-canvas svg"), viewport = document.querySelector(".mermaid-zoom-viewport"), dialog=document.querySelector("dialog");
        if (!svg || !viewport) return false;
        const r = svg.getBoundingClientRect(), v = viewport.getBoundingClientRect(), d=dialog.getBoundingClientRect();
        const controls=[...dialog.querySelectorAll("button")].every(button=>{const b=button.getBoundingClientRect();return b.left>=d.left && b.right<=d.right && b.top>=d.top && b.bottom<=d.bottom;});
        return controls && v.left>=d.left && v.right<=d.right && v.bottom<=d.bottom && r.width > 0 && r.height > 0 && r.width<=svg.viewBox.baseVal.width+1 && r.left >= v.left && r.top >= v.top && r.right <= v.right+1 && r.bottom <= v.bottom+1;
      });
      const values = await page.locator(".mermaid-zoom-canvas svg").evaluate(el => { const r=el.getBoundingClientRect(),b=el.viewBox.baseVal;return {ratio:r.width/r.height,natural:b.width/b.height,width:r.width,naturalWidth:b.width}; });
      assert.ok(Math.abs(values.ratio / values.natural - 1) < 0.01, "preserve aspect ratio");
      assert.ok(values.width <= values.naturalWidth + 1, "fit must not upscale small diagrams");
      assert.ok(await page.locator(".mermaid-zoom-canvas svg").evaluate(el=>{
        const box=el.getBBox(), view=el.viewBox.baseVal;
        return box.width>0 && box.height>0 && box.x>=view.x-1 && box.y>=view.y-1 && box.x+box.width<=view.x+view.width+1 && box.y+box.height<=view.y+view.height+1;
      }), "actual graph content must fit inside the SVG viewBox, not just its outer frame");
    };
    await assertFit();
    const dragEdge = async (direction, dx, dy) => {
      const start = await page.locator("dialog").evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
      const handle = await page.locator(`.mermaid-resize-handle[data-direction="${direction}"]`).boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy, { steps: 5 });
      await page.mouse.up();
      const expected = { width: start.width + (direction.includes("e") ? dx * 2 : direction.includes("w") ? -dx * 2 : 0), height: start.height + (direction.includes("s") ? dy * 2 : direction.includes("n") ? -dy * 2 : 0) };
      await page.waitForFunction(expected => {
        const rect = document.querySelector("dialog").getBoundingClientRect();
        return Math.abs(rect.width - expected.width) < 2 && Math.abs(rect.height - expected.height) < 2;
      }, expected);
    };
    for (const [direction, dx, dy] of [["e", 30, 0], ["w", -30, 0], ["n", 0, -20], ["s", 0, 20], ["ne", 20, -15], ["se", 20, 15], ["sw", -20, 15], ["nw", -20, -15]]) {
      const beforeResize = await page.locator("dialog").boundingBox();
      await dragEdge(direction, dx, dy);
      const enlarged = await page.locator("dialog").boundingBox();
      if (dx) assert.ok(enlarged.width > beforeResize.width + 20, `${direction} enlarges width`);
      if (dy) assert.ok(enlarged.height > beforeResize.height + 10, `${direction} enlarges height`);
      await assertFit();
      await dragEdge(direction, -dx, -dy);
      const restored = await page.locator("dialog").boundingBox();
      assert.ok(Math.abs(restored.width - beforeResize.width) < 2, `${direction} shrinks width back: ${JSON.stringify({ beforeResize, enlarged, restored })}`);
      assert.ok(Math.abs(restored.height - beforeResize.height) < 2, `${direction} shrinks height back: ${JSON.stringify({ beforeResize, enlarged, restored })}`);
    }
    await dragEdge("se", 45, 30);
    const originalDialog = await page.locator("dialog").boundingBox();
    await page.getByRole("button", { name: "Maximize diagram viewer", exact: true }).click();
    await page.waitForFunction(() => {
      const box = document.querySelector("dialog").getBoundingClientRect();
      return box.x === 0 && box.y === 0 && box.width === innerWidth && box.height === innerHeight;
    });
    await assertFit();
    assert.equal(await page.locator(".mermaid-resize-handle").count(), 0, "maximized viewer has no active resize handles");
    const zoomValue = () => page.locator(".mermaid-zoom-value").textContent();
    const initialZoom = await zoomValue();
    await page.locator(".mermaid-zoom-viewport").hover();
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(previous => parseInt(document.querySelector(".mermaid-zoom-value").textContent) > parseInt(previous), initialZoom);
    const enlargedZoom = await zoomValue();
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(previous => parseInt(document.querySelector(".mermaid-zoom-value").textContent) < parseInt(previous), enlargedZoom);
    assert.deepEqual(await geometry(), before, "wheel zoom must not scroll the underlying chat");
    // Check repeated trackpad/wheel events respect both zoom boundaries and
    // cancel native scrolling, including when already at a boundary.
    for (const [deltaY, expected] of [[-100, "300%"], [100, "10%"]]) {
      assert.equal(await page.locator(".mermaid-zoom-viewport").evaluate((el, deltaY) => {
        const rect = el.getBoundingClientRect();
        return Array.from({ length: 40 }, () => !el.dispatchEvent(new WheelEvent("wheel", {
          deltaY, bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
        }))).every(Boolean);
      }, deltaY), true);
      await page.waitForFunction(expected => document.querySelector(".mermaid-zoom-value").textContent === expected, expected);
    }
    await page.getByRole("button", { name: "Restore diagram viewer", exact: true }).click();
    await page.waitForFunction(expected => {
      const box = document.querySelector("dialog").getBoundingClientRect();
      return box.x === expected.x && box.y === expected.y && box.width === expected.width && box.height === expected.height;
    }, originalDialog);
    assert.deepEqual(await page.locator("dialog").boundingBox(), originalDialog);
    assert.equal(await zoomValue(), "10%", "restoring the window preserves manual zoom");
    await page.getByRole("button", { name: "Fit to view", exact: true }).click();
    await assertFit();
    await page.keyboard.press("Escape");
    assert.deepEqual(await geometry(), before);
    assert.equal(await preview.evaluate(el => document.activeElement === el), true, "restore opener focus");
    const calls = await page.evaluate(() => window.renderCalls);
    const remount = await page.evaluate(() => { window.showDiagram(false); window.showDiagram(true); return {loading:!!document.querySelector(".mermaid-block-loading"),height:document.querySelector(".markdown-code-block").getBoundingClientRect().height}; });
    assert.equal(remount.loading, false);
    assert.equal(remount.height, before.block);
    assert.equal(await page.evaluate(() => window.renderCalls), calls);
    await page.getByRole("button", {name:"Source",exact:true}).click();
    await page.getByRole("button", {name:"Preview",exact:true}).click();
    await preview.waitFor();
    assert.equal(await page.locator(".mermaid-block-loading").count(),0);
    assert.equal(await page.evaluate(() => window.renderCalls),calls);
    for(const roundTrip of ["code","theme"]) {
      await preview.click();
      await page.locator("dialog[open]").waitFor();
      await page.evaluate(kind=>{
        if(kind==="code") window.selectDiagram("small",false);
        if(kind==="theme") window.changeTheme("dark");
        if(kind==="streaming") window.streamDiagram(true);
      },roundTrip);
      await page.locator("dialog[open]").waitFor({state:"detached"});
      await page.evaluate(kind=>{
        if(kind==="code") window.selectDiagram("normal",false);
        if(kind==="theme") window.changeTheme("light");
        if(kind==="streaming") window.streamDiagram(false);
      },roundTrip);
      await preview.waitFor();
      assert.equal(await page.locator("dialog[open]").count(),0,`${roundTrip} round trips cannot resurrect an old viewer`);
    }
    await page.evaluate(() => window.streamDiagram(true));
    await preview.waitFor();
    await preview.click();
    await page.locator("dialog[open]").waitFor();
    const callsBeforeEnd = await page.evaluate(() => window.renderCalls);
    await page.evaluate(() => window.streamDiagram(false));
    assert.equal(await page.locator("dialog[open]").count(), 1, "ending the stream keeps the unchanged preview and viewer mounted");
    assert.equal(await page.evaluate(() => window.renderCalls), callsBeforeEnd);
    await page.keyboard.press("Escape");
    for (const name of ["wide", "tall", "small", "normal", "sequence", "pie"]) {
      await page.evaluate(name => window.selectDiagram(name), name);
      await preview.waitFor();
      await preview.click();
      await assertFit();
      await capture(name);
      for (const viewport of [{ width: 360, height: 600 }, { width: 800, height: 360 }, { width: 1100, height: 800 }]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(({width,height})=>{
          const rect=document.querySelector("dialog").getBoundingClientRect();
          return innerWidth===width && innerHeight===height && rect.x>=0 && rect.y>=0 && rect.right<=width+1 && rect.bottom<=height+1;
        },viewport);
        await assertFit();
        const dialog = await page.locator("dialog").boundingBox();
        assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x+dialog.width <= viewport.width+1 && dialog.y+dialog.height <= viewport.height+1, JSON.stringify({ name,dialog,viewport }));
        if (name === "normal" && viewport.width === 360) await capture("narrow");
      }
      const fitWidth = (await page.locator(".mermaid-zoom-canvas").boundingBox()).width;
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForFunction(width=>document.querySelector(".mermaid-zoom-canvas").getBoundingClientRect().width>width,fitWidth);
      if (name === "tall") {
        const viewport = await page.locator(".mermaid-zoom-viewport").boundingBox();
        await page.mouse.move(viewport.x+viewport.width/2, viewport.y+viewport.height-50);
        await page.mouse.down();
        await page.mouse.move(viewport.x+viewport.width/2, viewport.y+50, { steps: 5 });
        await page.mouse.up();
        assert.ok(await page.locator(".mermaid-zoom-viewport").evaluate(el=>el.scrollTop) > 50, "zoomed diagrams support dragging");
        const zoomIn=page.getByRole("button",{name:"Zoom in",exact:true});
        for(let step=0;step<12 && await zoomIn.isEnabled();step++) {
          const previous=await page.locator(".mermaid-zoom-value").textContent();
          await zoomIn.click();
          await page.waitForFunction(previous=>document.querySelector(".mermaid-zoom-value").textContent!==previous,previous);
        }
        assert.equal(await page.locator(".mermaid-zoom-value").textContent(),"300%");
        // Chromium can expose the new text before its protocol box snapshot has
        // caught up. Establish the actual 3x geometry before testing resize.
        await page.waitForFunction(()=>{
          const canvas=document.querySelector(".mermaid-zoom-canvas");
          const svg=canvas.querySelector("svg"), box=canvas.getBoundingClientRect(), view=svg.viewBox.baseVal;
          return Math.abs(box.width-view.width*3)<0.02 && Math.abs(box.height-view.height*3)<0.02;
        });
        const manualSize=await page.locator(".mermaid-zoom-canvas").boundingBox();
        for(const size of [{width:360,height:600},{width:800,height:360},{width:1100,height:800}]) {
          await page.setViewportSize(size);
          await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,size);
          assert.equal(await page.locator(".mermaid-zoom-value").textContent(),"300%","resize preserves absolute user zoom and the maximum");
          const resized=await page.locator(".mermaid-zoom-canvas").boundingBox();
          assert.equal(resized.width,manualSize.width);
          assert.equal(resized.height,manualSize.height);
          assert.equal(await zoomIn.isDisabled(),true);
        }
      }
      await page.getByRole("button", { name: "Fit to view", exact: true }).click();
      await assertFit();
      if (name === "small") {
        const download=page.waitForEvent("download");
        await page.locator("dialog").getByRole("button", {name:"Export PNG",exact:true}).click();
        const result=await download;
        assert.equal(result.suggestedFilename(),"mermaid-diagram.png");
        assert.equal(await result.failure(),null);
        if(evidence) await result.saveAs(path.join(evidence,"export.png"));
      }
      await page.getByRole("button", { name: "Close", exact: true }).click();
      for (let i=0;i<2;i++) { await preview.dblclick(); assert.equal(await page.locator("dialog[open]").count(),1); await page.keyboard.press("Escape"); }
    }
    await page.evaluate(() => { window.delayRender=true;window.selectDiagram("wide");window.changeTheme("dark"); });
    await page.waitForFunction(() => !!window.releaseRender);
    await page.evaluate(() => { window.selectDiagram("small",false);window.delayRender=false;window.releaseRender(); });
    await preview.waitFor();
    assert.match(await preview.textContent(), /OK/);
    assert.doesNotMatch(await preview.textContent(), /Step 23/);
    await page.evaluate(() => window.duplicateDiagram());
    await page.waitForFunction(() => document.querySelectorAll(".mermaid-preview-button svg").length===2);
    await preview.click();
    const ids=await page.locator("svg [id], svg[id]").evaluateAll(nodes=>nodes.map(n=>n.id));
    assert.equal(new Set(ids).size, ids.length, "cached copies and dialog must have unique SVG IDs");
    await page.keyboard.press("Escape");
    for (const theme of await page.evaluate(() => window.themes)) {
      await page.evaluate(theme => window.changeTheme(theme), theme);
      await preview.waitFor();
      await preview.click();
      await assertFit();
      if (["dark", "sakura", "dream"].includes(theme)) await capture(`theme-${theme}`);
      await page.keyboard.press("Escape");
    }
    await page.evaluate(() => { window.piDesktop={};window.selectDiagram("normal"); });
    await preview.waitFor();
    await preview.click();
    assert.ok((await page.locator("dialog").boundingBox()).y>=36, "desktop chrome remains available");
    await assertFit();
    await page.getByRole("button", { name: "Maximize diagram viewer", exact: true }).click();
    for (const viewport of [{ width: 360, height: 600 }, { width: 1100, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => {
        const box = document.querySelector("dialog").getBoundingClientRect();
        return box.x === 0 && box.y === 36 && box.width === innerWidth && box.bottom === innerHeight;
      });
      await assertFit();
    }
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.selectDiagram("error"));
    await page.locator(".mermaid-block-error").first().waitFor();
    assert.equal(await page.locator("dialog[open]").count(),0);
    assert.equal(await page.locator(".markdown-code-block").first().getByRole("button",{name:"Export PNG",exact:true}).isDisabled(),true);
    await page.evaluate(() => { window.changeTheme("light");window.virtualSession("session-a"); });
    await preview.waitFor();
    const rowHeight=await preview.evaluate(el=>el.closest("[data-virtual-key]").getBoundingClientRect().height);
    await page.locator("#virtual-scroll").evaluate(el=>{el.scrollTop=9000;});
    await preview.waitFor({state:"detached"});
    await page.locator("#virtual-scroll").evaluate(el=>{el.scrollTop=0;});
    await preview.waitFor();
    assert.equal(await preview.evaluate(el=>el.closest("[data-virtual-key]").getBoundingClientRect().height),rowHeight);
    for(const session of ["session-b","session-a","session-b","session-a"]) {
      assert.equal(await page.evaluate(session=>{window.virtualSession(session);return !!document.querySelector(".mermaid-block-loading");},session),false);
      assert.equal(await preview.evaluate(el=>el.closest("[data-virtual-key]").getBoundingClientRect().height),rowHeight);
    }
    // Exercise the actual Markdown path: render valid partial syntax before the
    // fence closes, retain it for an incomplete token, then update before end.
    await page.evaluate(() => { window.virtualSession(null); window.streamMarkdown("```mermaid\nflowchart LR\nLive[Streaming] --> First[First]"); });
    await preview.waitFor();
    assert.match(await preview.textContent(), /Streaming/);
    const partial = await preview.innerHTML();
    await page.evaluate(() => window.streamMarkdown("```mermaid\nflowchart LR\nLive[Streaming] --> First[First]\nFirst --> Second[\""));
    await page.waitForTimeout(250);
    assert.equal(await preview.innerHTML(), partial, "incomplete syntax retains the previous valid diagram");
    assert.equal(await page.locator(".mermaid-block-error").count(), 0);
    const completed = "```mermaid\nflowchart LR\nLive[Streaming] --> First[First]\nFirst --> Second[Second]\n```";
    await page.evaluate(text => window.streamMarkdown(text), completed);
    await page.waitForFunction(() => document.querySelector(".mermaid-preview-button")?.textContent.includes("Second"));
    const completedCalls = await page.evaluate(() => window.renderCalls);
    await preview.evaluate(el => { window.completedPreview = el; });
    for (let i = 1; i <= 4; i++) await page.evaluate(text => window.streamMarkdown(text), completed + "\n\nFollowing output ".repeat(i));
    assert.equal(await preview.evaluate(el => el === window.completedPreview), true);
    assert.equal(await page.evaluate(() => window.renderCalls), completedCalls, "following text does not render the finished diagram again");
    await page.evaluate(() => window.streamMarkdown("```mermaid\ninvalid final diagram\n```", false));
    await page.locator(".mermaid-block-error").first().waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("piora-mermaid-browser-"));
    await rm(root, { recursive: true, force: true });
  }
});
