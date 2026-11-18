// Exercise the production startup barrier with a real pending Electron navigation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const output = path.resolve('.verification/startup-handoff');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(path.join(output, 'run-'));
const coordinator = await readFile(path.resolve('desktop/src/startup-coordinator.ts'), 'utf8');
const source = coordinator.slice(coordinator.indexOf('function createStartupWindow('));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
await mkdir(path.join(directory, "generated"), { recursive: true });
for (const name of ["startup-scene", "startup-tasks", "branding", "generated/brand"]) {
  const compiledModule = ts.transpileModule(await readFile(path.resolve("desktop/src", name + ".ts"), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  await writeFile(path.join(directory, name + ".js"), compiledModule.outputText);
}
const reportPath = path.join(directory, 'report.json');
const script = path.join(directory, 'main.cjs');
await writeFile(script, `
const {app,BrowserWindow}=require('electron');const {createServer}=require('node:http');
const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');const {writeFileSync}=require('node:fs');
app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
const STARTUP_MEDIA_TIMEOUT_MS=60000;
const {isStartupDocumentUrl,STARTUP_CONTINUE_CHANNEL}=require('./startup-scene.js');
const {runOptionalStartupTask}=require('./startup-tasks.js');
const readLastLaunchedVersion=()=>null,loadStartupMedia=()=>({video:'fixture'}),createStartupDocument=()=>'<title>Fixture</title>';
let window,base,pendingResponse,requestedResolve;
const requested=new Promise(resolve=>requestedResolve=resolve);
function createMainWindowShell(){window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});window.loadFile=()=>window.loadURL(base+'/slow');return {window,initialState:{maximized:false}};}
${compiled}
setTimeout(()=>{console.error('Native startup handoff probe timed out');app.exit(1)},30000).unref();
app.whenReady().then(async()=>{
 const server=createServer((req,res)=>{if(req.url==='/slow'){pendingResponse=res;requestedResolve()}else{res.end('<title>Application ready</title>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 const startup=createStartupWindow({warn(){},info(){}},createMainWindowShell,false);await requested;
 startup.finish();
 await startup.finished;
 await window.loadURL(base+'/app');
 if(window.webContents.getURL()!==base+'/app')throw Error('App navigation was displaced');
 pendingResponse?.end('<title>Late intro</title>');
 await new Promise(resolve=>setTimeout(resolve,300));
 if(window.webContents.getURL()!==base+'/app')throw Error('Late intro displaced app navigation');
 writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({realElectron:true,pendingNavigationCancelled:true,lateIntroCannotReplaceApp:true,systemClipboardWritten:false}));
 window.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const code = await new Promise((done, reject) => {
  const child = spawn(require('electron'), [script], { env, windowsHide: true, stdio: 'pipe' });
  const timer = setTimeout(() => {
    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
    } else child.kill();
    reject(new Error("Electron did not exit after the startup probe"));
  }, 35_000);
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', exitCode => { clearTimeout(timer); done(exitCode); });
});
assert.equal(code, 0); console.log(await readFile(reportPath, 'utf8'));
