import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("quick-access IPC checks every sender, broadcasts changes, and owns native picker lifecycle", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-quick-access-ipc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folders = Object.fromEntries(["downloads", "desktop", "documents", "userData"].map(key => [key, path.join(root, key)]));
  await Promise.all(Object.values(folders).map(directory => mkdir(directory)));
  const electron = path.join(root, "electron.cjs");
  await writeFile(electron, `
const handlers=new Map(),calls=[];
let picker={canceled:true,filePaths:[]};
module.exports={handlers,calls,setPicker:value=>{picker=value},app:{getPath:key=>(${JSON.stringify(folders)})[key],getLocale:()=>"zh-CN"},
ipcMain:{removeHandler:key=>handlers.delete(key),handle:(key,handler)=>handlers.set(key,handler)},
dialog:{showOpenDialog:async(owner,options)=>{calls.push({owner,options});return picker}},
shell:{openPath:async target=>{calls.push({open:target});return ""},showItemInFolder:target=>calls.push({reveal:target})},
clipboard:{writeText:target=>calls.push({copy:target})}};
`);
  const jiti = createJiti(import.meta.url, { alias: { electron }, moduleCache: false });
  const { registerQuickAccessHandlers } = await jiti.import("../desktop/src/quick-access-ipc.ts");
  const stub = await jiti.import(electron);
  const sent = [];
  const owner = { isDestroyed: () => false, show() {}, focus() {}, webContents: { send: channel => sent.push(channel) } };
  let depth = 0;
  registerQuickAccessHandlers({
    owner: event => event.trusted ? owner : null,
    windows: () => [owner],
    nativeDialog: async (_owner, task) => { depth++; try { return await task(); } finally { depth--; } },
    pickFile: async (pickerOwner, systemRoot, title) => { assert.equal(depth, 1); stub.calls.push({ pickerOwner, systemRoot, title }); return null; },
  });
  assert.equal(stub.handlers.size, 4);
  for (const handler of stub.handlers.values()) await assert.rejects(async () => handler({ trusted: false }), /Untrusted/);
  const invoke = (name, ...args) => stub.handlers.get(`pi:quick-access-${name}`)({ trusted: true }, ...args);
  const initial = await invoke("list");
  assert.ok(initial.items.length >= 3);
  assert.equal(await invoke("pick", "file"), null);
  if (process.platform === "win32") assert.equal(stub.calls.at(-1).title, "选择文件或快捷方式");
  else assert.deepEqual(stub.calls.at(-1).options.properties, ["openFile", "noResolveAliases"]);
  assert.equal(depth, 0);
  stub.setPicker({ canceled: false, filePaths: [folders.documents] });
  assert.equal(await invoke("pick", "folder"), folders.documents);
  assert.deepEqual(stub.calls.at(-1).options.properties, ["openDirectory"]);
  await assert.rejects(invoke("pick", "command"), /invalidInput/);
  const changed = await invoke("mutate", { type: "remove", id: initial.items[0].id });
  assert.equal(changed.items.length, initial.items.length - 1);
  assert.deepEqual(sent, ["pi:quick-access-change"]);
  await invoke("open", changed.items[0].id, "copy");
  assert.deepEqual(stub.calls.at(-1), { copy: changed.items[0].path });
  await assert.rejects(invoke("open", changed.items[0].id, "edit-admin"), /invalidInput/);
  assert.equal(depth, 0);
});

test("Windows file picker preserves shortcuts, unicode paths, cancellation and window ownership", async () => {
  const { EventEmitter } = await import("node:events");
  const jiti = createJiti(import.meta.url);
  const { pickQuickAccessFile, quickAccessFilePickerCommand } = await jiti.import("../desktop/src/quick-access-pick.ts");
  const owner = new EventEmitter();
  owner.getNativeWindowHandle = () => Buffer.from([42, 0, 0, 0, 0, 0, 0, 0]);
  const command = quickAccessFilePickerCommand("C:\\Windows", owner.getNativeWindowHandle(), "选择 '快捷方式'");
  const script = Buffer.from(command.args.at(-1), "base64").toString("utf16le");
  assert.match(script, /DereferenceLinks = \$false/);
  assert.match(script, /PioraQuickAccessPickerOwner\]::new\(\[long\]42\)/);
  assert.match(script, /Title = '选择 ''快捷方式'''/);
  assert.ok(command.args.includes("-STA"));
  const shortcut = "D:\\常用入口\\带 参数.lnk";
  const execute = response => (file, args, options, done) => {
    assert.equal(file, command.executable);
    assert.equal(options.windowsHide, true);
    assert.equal(options.encoding, "utf8");
    queueMicrotask(() => done(null, response));
  };
  assert.equal(await pickQuickAccessFile(owner, "C:\\Windows", "Files", execute(JSON.stringify(shortcut))), shortcut);
  assert.equal(await pickQuickAccessFile(owner, "C:\\Windows", "Files", execute("null\r\n")), null);
  await assert.rejects(pickQuickAccessFile(owner, "C:\\Windows", "Files", execute('"relative.lnk"')), /pickerFailed/);
  await assert.rejects(pickQuickAccessFile(owner, "C:\\Windows", "Files", execute("not JSON")), /pickerFailed/);
  assert.equal(owner.listenerCount("closed"), 0);
  assert.equal(await pickQuickAccessFile(owner, "C:\\Windows", "Files", (_file, _args, options, done) => {
    options.signal.addEventListener("abort", () => done(new Error("aborted")));
    queueMicrotask(() => owner.emit("closed"));
  }), null);
  assert.equal(owner.listenerCount("closed"), 0);
});

test("the hosts process adapter returns launch and UAC cancellation outcomes without waiting for an editor", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-hosts-launch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const processes = path.join(root, "processes.cjs");
  await writeFile(processes, `
const {EventEmitter}=require('node:events');const calls=[];let code=0;
module.exports={calls,setCode:value=>{code=value},execFile:(file,args,options,done)=>{calls.push({file,args,options});queueMicrotask(()=>done(code?{code}:null));},
spawn:(file,args,options)=>{calls.push({file,args,options});const child=new EventEmitter();child.unref=()=>calls.push('unref');queueMicrotask(()=>child.emit(code?'error':'spawn',code?new Error('failed'):undefined));return child;}};
`);
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const { launchHostsEditor } = await jiti.import("../desktop/src/quick-access-open.ts");
  const stub = await jiti.import(processes);
  assert.equal(await launchHostsEditor("C:\\Windows", false, stub), "opened");
  assert.equal(stub.calls.at(-1), "unref");
  assert.equal(stub.calls[0].options.windowsHide, true);
  assert.equal(await launchHostsEditor("C:\\Windows", true, stub), "opened");
  stub.setCode(1223);
  assert.equal(await launchHostsEditor("C:\\Windows", true, stub), "cancelled");
  stub.setCode(1);
  await assert.rejects(launchHostsEditor("C:\\Windows", true, stub), /openFailed/);
  await assert.rejects(launchHostsEditor("C:\\Windows", false, stub), /openFailed/);
});

test("Windows parses the production file picker and initializes its shortcut-preserving native options", { skip: process.platform !== "win32", timeout: 90000 }, async () => {
  const { execFile } = await import("node:child_process");
  const jiti = createJiti(import.meta.url);
  const { quickAccessFilePickerCommand } = await jiti.import("../desktop/src/quick-access-pick.ts");
  const command = quickAccessFilePickerCommand(process.env.SystemRoot || "C:\\Windows", Buffer.alloc(8), "选择快捷方式");
  const script = Buffer.from(command.args.at(-1), "base64").toString("utf16le");
  // Exercise the real .NET types without showing a dialog or touching a user's files.
  const withoutUI = script.replace("$picker.ShowDialog($owner)", "[System.Windows.Forms.DialogResult]::Cancel");
  assert.notEqual(withoutUI, script);
  command.args[command.args.length - 1] = Buffer.from(withoutUI, "utf16le").toString("base64");
  const output = await new Promise((resolve, reject) => execFile(command.executable, command.args, { windowsHide: true, encoding: "utf8", timeout: 60000 }, (error, stdout, stderr) => error ? reject(new Error(`Native picker initialization failed (${error.code ?? error.signal}): ${stderr}`)) : resolve(stdout)));
  assert.equal(JSON.parse(output.trim()), null);
});
