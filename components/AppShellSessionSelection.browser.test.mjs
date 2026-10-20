import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");
const source = ts.createSourceFile("AppShell.tsx", await readFile(path.join(repo, "components/AppShell.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map(), helpers = new Map();
function collect(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
    const callback = node.initializer.arguments[0];
    if (callback && ts.isArrowFunction(callback)) callbacks.set(node.name.text, callback.getText(source));
  }
  if (ts.isFunctionDeclaration(node) && node.name) helpers.set(node.name.text, node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
const sessions = [
  { id: "a", cwd: "F:\\Alpha", projectRoot: "F:\\Alpha", name: "Alpha existing chat" },
  { id: "a2", cwd: "F:\\Alpha", projectRoot: "F:\\Alpha", name: "Alpha second chat" },
  { id: "b", cwd: "F:\\Beta", projectRoot: "F:\\Beta", name: "Beta existing chat" },
  { id: "aw", cwd: "F:\\Alpha-worktrees\\feature", projectRoot: "F:\\Alpha", name: "Alpha worktree chat" },
  { id: "p", cwd: "C:\\Users\\user\\pi-cwd-chat", projectless: true, name: "Projectless existing chat" },
].map(item => ({ ...item, path: `${item.cwd}\\${item.id}.jsonl`, created: "2026-10-20T00:00:00Z", modified: "2026-10-20T01:00:00Z", messageCount: 2, firstMessage: item.name }));

test("one project-session click keeps the chosen chat through cwd effects and delayed confirmations", { timeout: 120000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-sidebar-selection-"));
  let browser;
  t.after(async () => {
    await browser?.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("piora-sidebar-selection-"));
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(path.join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
  await writeFile(path.join(directory, "css.cjs"), `const path=require('node:path');module.exports=function(s){const prefix=path.basename(this.resourcePath).replace(/\\W/g,'_');const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+'_'+m[1]]));const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(m,n)=>'.'+names[n]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.append(style);export default '+JSON.stringify(names)};`);
  await writeFile(path.join(directory, "stub.tsx"), "export const DirectoryPicker=()=>null;export const WorktreeSection=()=>null;export const RoomSidebarSection=()=>null;export const ConversationSearchDialog=()=>null;");
  await writeFile(path.join(directory, "entry.tsx"), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {SessionSidebar} from '@/components/SessionSidebar'; import {I18nProvider} from '@/hooks/useI18n';
import {parseWorkspaceContinuity,workspaceContinuityStorageKey} from '@/lib/workspace-continuity';
${["getSelectionHistoryState", "replaceUrlWithoutNextNavigation"].map(name => helpers.get(name)).join("\n")}
const sessions=${JSON.stringify(sessions)};
window.states=[]; window.confirmations=[];
function App(){
  const [selectedSession,setSelectedSession]=React.useState(sessions[0]);
  const [selectedRoom,setSelectedRoom]=React.useState(null);
  const [newSessionCwd,setNewSessionCwd]=React.useState(null);
  const [sessionKey,setSessionKey]=React.useState(0);
  const [activeCwd,setActiveCwd]=React.useState(sessions[0].cwd);
  const [activeProjectRoot,setActiveProjectRoot]=React.useState(sessions[0].projectRoot);
  const activeProjectRootRef=React.useRef(sessions[0].projectRoot);
  const selectedSessionIdRef=React.useRef(null); selectedSessionIdRef.current=selectedSession?.id??null;
  const suppressCwdBumpRef=React.useRef(false),chatInputRef=React.useRef({focus(){}});
  const workspaceNavigationVersionRef=React.useRef(0);
  const [fileTabs,setFileTabs]=React.useState([]),[activeFileTabId,setActiveFileTabId]=React.useState(null);
  const [,setRightPanelOpen]=React.useState(false),rightPanelTab='files',isMobile=false;
  const [,setSettingsDialogOpen]=React.useState(false),[,setHistoryDialogOpen]=React.useState(false),[,setHistoryLocation]=React.useState(null);
  const [,setActiveTopPanel]=React.useState(null),[,setNewSessionInitialModel]=React.useState(null),[,setNewSessionInitialPrompt]=React.useState(null);
  const [,setFocusedEntryId]=React.useState(null),[,setSystemPrompt]=React.useState(null),[,setInitialSessionRestored]=React.useState(true),[,setSidebarOpen]=React.useState(true);
  const translate=React.useCallback(key=>key,[]);
  const requestConfirmation=()=>new Promise(resolve=>{window.confirmations.push(resolve)});
  const handleCwdChange=React.useCallback(${callbacks.get("handleCwdChange")},[activeFileTabId,fileTabs,rightPanelTab,selectedRoom,selectedSession,translate]);
  const handleSelectSession=React.useCallback(${callbacks.get("handleSelectSession")},[isMobile]);
  const handleNewSession=React.useCallback(${callbacks.get("handleNewSession")},[isMobile]);
  window.navigation=()=>({id:selectedSession?.id??null,cwd:activeCwd,project:activeProjectRoot,sessionKey,newSessionCwd,tabs:fileTabs.map(tab=>tab.id)});
  window.startCwdChange=(cwd)=>{window.pendingCwdChange=handleCwdChange(cwd,cwd)};
  window.makeDirty=()=>setFileTabs([{id:'dirty',filePath:'F:\\\\Alpha\\\\edited.ts',isDirty:true}]);
  React.useLayoutEffect(()=>{window.states.push(window.navigation())},[selectedSession,sessionKey,newSessionCwd]);
  return <I18nProvider><aside style={{width:320,height:800}}><SessionSidebar selectedSessionId={selectedSession?.id??null}
    selectedCwd={selectedSession?.projectless?null:selectedSession?.cwd??newSessionCwd??null} activeProjectRoot={activeProjectRoot} onSelectSession={handleSelectSession}
    onNewSession={handleNewSession} onCwdChange={handleCwdChange} /></aside>
    <main><output>{selectedSession?selectedSession.name:'New session'}</output><textarea key={sessionKey} aria-label="composer" defaultValue={selectedSession?.id??'new'}/></main></I18nProvider>
}
createRoot(document.getElementById('root')).render(<App/>);`);
  const compiler = webpack({ mode: "development", target: "web", devtool: false,
    entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "/" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
    plugins: [new webpack.NormalModuleReplacementPlugin(/[/\\](DirectoryPicker|WorktreeSection|RoomSidebarSection|ConversationSearchDialog)$/, path.join(directory, "stub.tsx"))],
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "loader.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] },
  });
  await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve())));
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.route("http://selection.test/**",async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/sessions')return route.fulfill({json:{sessions,runningSessionIds:[]}});
    if(url.pathname==='/api/sessions/flags')return route.fulfill({json:{flags:{}}});
    if(url.pathname==='/api/home')return route.fulfill({json:{home:'C:\\Users\\user'}});
    if(url.pathname==='/api/worktrees'){const cwd=url.searchParams.get('cwd');return route.fulfill({json:{projectRoot:cwd?.includes('Alpha')?'F:\\Alpha':cwd,isGit:false,worktrees:[]}})}
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{rooms:[],snapshots:[],sessions:[],sessionIds:[]}});
    if(url.pathname.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:await readFile(path.join(directory,path.basename(url.pathname)))});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="display:flex;margin:0"><div id="root" style="display:flex"></div><script src="/bundle.js"></script></body></html>'});
  });
  await page.goto("http://selection.test/");
  await page.getByRole("treeitem",{name:"Beta existing chat",exact:true}).waitFor();
  for(const id of ['b','p','a2','aw','a']){
    await page.evaluate(()=>{window.states=[]});
    await page.getByRole('treeitem',{name:sessions.find(s=>s.id===id).name,exact:true}).click({timeout:5000}).catch(async cause=>{throw new Error(cause.message+' | '+await page.locator('body').innerText()+' | '+JSON.stringify(await page.evaluate(()=>window.navigation())))});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>window.navigation().id),id,JSON.stringify(await page.evaluate(()=>window.states)));
    const target=sessions.find(s=>s.id===id);
    await page.waitForFunction(cwd=>window.navigation().cwd===cwd,target.projectless?null:target.cwd);
    assert.ok((await page.evaluate(()=>window.states)).every(state=>state.id===id),JSON.stringify(await page.evaluate(()=>window.states)));
    assert.equal(new URL(page.url()).searchParams.get('session'),id);
  }
  // An older project transition must not overwrite a session chosen while its
  // unsaved-file question is pending.
  await page.evaluate(()=>window.makeDirty());
  await page.evaluate(()=>{void window.startCwdChange('F:\\Beta')});
  await page.waitForFunction(()=>window.confirmations.length>0);
  await page.getByRole('treeitem',{name:'Beta existing chat',exact:true}).click();
  await page.waitForFunction(()=>window.navigation().id==='b');
  await page.evaluate(async()=>{
    window.confirmations[0](false); await window.pendingCwdChange;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  assert.equal(await page.evaluate(()=>window.navigation().id),'b');
  assert.equal(new URL(page.url()).searchParams.get('session'),'b');
  assert.deepEqual(errors,[]);
});
