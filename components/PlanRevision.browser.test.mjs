import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("plan revision retains feedback after a failed send and retries the same input", { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "piora-plan-revision-ui-"));
  let browser;
  try {
    await writeFile(path.join(dir, "ts.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(dir, "css.cjs"), `module.exports=s=>'export default '+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))`);
    await writeFile(path.join(dir, "empty.tsx"), `import React from 'react'; export const FloatingStepProgressPill=()=>null, GoalComposerRail=()=>null, EditGoalDialog=()=>null, ReplaceGoalDialog=()=>null, ResumePausedGoalDialog=()=>null, InlineUserInputCard=()=>null, AliIcon=()=>null, ToolPermissionControl=()=>null;`);
    await writeFile(path.join(dir, "entry.tsx"), `
import React from 'react';import{createRoot}from'react-dom/client';
import{I18nProvider}from'@/hooks/useI18n';import{ChatWorkflowDock}from'@/components/workflow/ChatWorkflowDock';
function App(){
 const[running,setRunning]=React.useState(false),[sid,setSid]=React.useState('one'),[busy,setBusy]=React.useState(false),[mode,setMode]=React.useState('plan');
 const run={id:mode+'-'+sid,kind:mode,status:mode==='plan'?'awaiting_approval':'budget_exhausted',objective:'Objective',title:'Plan',markdown:'Plan',criteria:[],progress:'',reason:'',turnBudget:10,turnsUsed:1,version:1,createdAt:1,updatedAt:1,noProgressTurns:0};
 const snapshot={sessionId:sid,revision:1,mode,turnBudget:10,current:run,history:[]};
 const action=async(name,extra)=>{(window.calls??=[]).push({name,extra});setRunning(true);const ok=await new Promise(resolve=>window.release=resolve);setRunning(false);return ok};
 return <><button id='switch' onClick={()=>setSid(sid==='one'?'two':'one')}>Switch</button><button id='busy' onClick={()=>setBusy(!busy)}>Toggle loading</button><button id='goal' onClick={()=>setMode('goal')}>Goal</button><ChatWorkflowDock sessionId={sid} snapshot={snapshot} busy={busy} running={running} enabled={true} settingsReady={true} error={null} onAction={action} onRespondUserInput={()=>{}} onAcceptSnapshot={()=>{}} onRefresh={async()=>{}} onFocusComposer={()=>{}} onEnterGoalDraft={()=>{}} replaceGoalRequest={null} onClearReplaceGoalRequest={()=>{}} pausedGoalSubmission={null} onClearPausedGoalSubmission={()=>{}} /></>;
}window.panelEvents=[];window.addEventListener('piora:open-workflow-panel',event=>window.panelEvents.push(event.detail));createRoot(document.getElementById('root')).render(<I18nProvider><App/></I18nProvider>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(dir, "entry.tsx"), output: { path: dir, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } },
      plugins: [new webpack.NormalModuleReplacementPlugin(/^(\.\/FloatingStepProgressPill|\.\/GoalDialogs|\.\/InlineUserInputCard|\.\.\/AliIcon|\.\.\/ToolPermissionControl)$/, path.join(dir, "empty.tsx"))],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(dir, "ts.cjs") }, { test: /\.css$/, use: path.join(dir, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("http://plan-revision.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(dir, path.basename(pathname))) });
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
    });
    await page.goto("http://plan-revision.test/");
    const input = page.getByTestId("workflow-plan-revise-input"), revise = page.getByTestId("workflow-plan-revise");
    await input.fill("  Add the missing test  ");
    await revise.click();
    await page.getByTestId("implement-plan-card").waitFor({ state: "hidden" });
    await page.evaluate(() => window.release(false));
    await input.waitFor({ state: "visible" });
    assert.equal(await input.inputValue(), "  Add the missing test  ", "a failed submission retains the untrimmed edit");
    await revise.click();
    await page.getByTestId("implement-plan-card").waitFor({ state: "hidden" });
    await page.evaluate(() => window.release(true));
    await input.waitFor({ state: "visible" });
    assert.equal(await input.inputValue(), "", "successful admission clears the saved edit");
    assert.deepEqual(await page.evaluate(() => window.calls), [
      { name: "revise", extra: { feedback: "Add the missing test" } },
      { name: "revise", extra: { feedback: "Add the missing test" } },
    ]);
    await input.fill("Private to first session");
    await page.locator("#switch").click();
    assert.equal(await input.inputValue(), "", "feedback does not carry to another session");
    await input.fill("Private to second session");
    await page.locator("#switch").click();
    assert.equal(await input.inputValue(), "Private to first session", "each session retains its own unsent feedback");
    await page.locator("#busy").click();
    assert.equal(await page.getByTestId("workflow-plan-open-editor").isDisabled(), true);
    await page.locator("#goal").click();
    const details = page.getByTestId("goal-rail-open-panel");
    assert.equal(await details.isDisabled(), true, "Goal details wait for session hydration");
    assert.deepEqual(await page.evaluate(() => window.panelEvents), []);
    await page.locator("#busy").click();
    await details.click();
    assert.deepEqual(await page.evaluate(() => window.panelEvents), [{ tab: "goal", sessionId: "one", runId: "goal-one" }]);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
