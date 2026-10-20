import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { QuickAccessStore } = await jiti.import("../desktop/src/quick-access-store.ts");
const { openQuickAccess, hostsEditorCommand } = await jiti.import("../desktop/src/quick-access-open.ts");
const { quickAccessScore, quickAccessName, quickAccessErrorKey } = await jiti.import("./quick-access.ts");

async function fixture(t, platform = process.platform) {
  const root = await mkdtemp(path.join(tmpdir(), "piora-quick-access-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folders = { downloads: path.join(root, "下载"), desktop: path.join(root, "Desktop"), documents: path.join(root, "Documents") };
  await Promise.all(Object.values(folders).map(directory => mkdir(directory)));
  const environment = { platform, systemRoot: root, folders };
  if (platform === "win32") {
    await mkdir(path.join(root, "System32", "drivers", "etc"), { recursive: true });
    await writeFile(path.join(root, "System32", "drivers", "etc", "hosts"), "127.0.0.1 localhost\n");
  }
  const directory = path.join(root, "data");
  return { root, folders, directory, environment, store: new QuickAccessStore(directory, environment) };
}

test("default locations initialize once; removal, names, pins and order survive restart", async t => {
  const { directory, store, environment } = await fixture(t);
  const first = await store.list();
  assert.equal(first.items.length, process.platform === "win32" ? 4 : 3);
  assert.ok(first.items.every(item => item.pinned && item.availability === "available"));
  const [downloads, desktop, documents] = first.items;
  await store.mutate({ type: "remove", id: desktop.id });
  await store.mutate({ type: "update", id: downloads.id, name: "常用下载", pinned: false });
  const ordered = await store.mutate({ type: "reorder", ids: [documents.id, ...first.items.filter(item => ![documents.id, desktop.id].includes(item.id)).map(item => item.id)] });
  const reopened = await new QuickAccessStore(directory, environment).list();
  assert.deepEqual(reopened, ordered);
  assert.equal(reopened.items[0].id, documents.id);
  assert.equal(reopened.items.at(-1).name, "常用下载");
  assert.equal(reopened.items.find(item => item.id === desktop.id), undefined);
  assert.equal(quickAccessName(documents, key => key === "quickAccess.preset.documents" ? "文档" : key), "文档");
  const restored = await store.mutate({ type: "preset", preset: "desktop" });
  assert.equal(restored.items.filter(item => item.preset === "desktop").length, 1);
  await assert.rejects(store.mutate({ type: "preset", preset: "desktop" }), /duplicate/);
});

test("concurrent additions preserve every change and duplicate paths are rejected", async t => {
  const { root, store } = await fixture(t);
  const files = ["中文 空格 #1.txt", "second.txt", "third.txt"].map(name => path.join(root, name));
  await Promise.all(files.map(file => writeFile(file, "sample")));
  await Promise.all(files.map(file => store.mutate({ type: "add", path: file })));
  const added = (await store.list()).items.filter(item => files.includes(item.path));
  assert.equal(added.length, 3);
  assert.equal(added.find(item => item.path === files[0]).name, "中文 空格 #1.txt");
  await assert.rejects(store.mutate({ type: "add", path: path.join(root, ".", "second.txt") }), /duplicate/);
  if (process.platform === "win32") await assert.rejects(store.mutate({ type: "add", path: files[0].toUpperCase() }), /duplicate/);
  for (const target of ["relative/file", "https://example.com", "file:///C:/Windows", "\\\\?\\C:\\Windows", "\nC:\\Windows"]) {
    await assert.rejects(store.mutate({ type: "add", path: target }), /invalidPath/);
  }
  await assert.rejects(store.mutate({ type: "update", id: added[0].id, name: " " }), /invalidName/);
  await assert.rejects(store.mutate({ type: "reorder", ids: [added[0].id] }), /invalidInput/);
});

test("missing and replaced targets are retained, repairable, and safe to remove", async t => {
  const { root, store } = await fixture(t);
  const file = path.join(root, "临时.txt");
  const repair = path.join(root, "renamed.txt");
  await writeFile(file, "original");
  const item = (await store.mutate({ type: "add", path: file })).items.find(item => item.path === file);
  await unlink(file);
  assert.equal((await store.list()).items.find(entry => entry.id === item.id).availability, "missing");
  await assert.rejects(store.get(item.id), /missing/);
  await mkdir(file);
  assert.equal((await store.list()).items.find(entry => entry.id === item.id).availability, "unavailable");
  await writeFile(repair, "kept");
  await store.mutate({ type: "update", id: item.id, path: repair });
  assert.equal((await store.get(item.id)).path, repair);
  await store.mutate({ type: "remove", id: item.id });
  assert.equal(await readFile(repair, "utf8"), "kept");
});

test("corrupt data is reported without overwriting it or restoring removed defaults", async t => {
  const { directory, store } = await fixture(t);
  await store.list();
  const file = path.join(directory, "quick-access.json");
  await writeFile(file, "{broken");
  await assert.rejects(store.list(), /storage/);
  await assert.rejects(store.mutate({ type: "preset", preset: "downloads" }), /storage/);
  assert.equal(await readFile(file, "utf8"), "{broken");
  await writeFile(file, JSON.stringify({ version: 1, items: [] }));
  assert.deepEqual((await store.list()).items, []);
});

test("system opening, reveal, copy and shell failure use stored paths", async t => {
  const { folders, root, store, environment } = await fixture(t);
  const calls = [];
  const deps = { openPath: async target => { calls.push(["open", target]); return ""; }, reveal: target => calls.push(["reveal", target]), copy: target => calls.push(["copy", target]), hostsEditor: async () => { throw new Error("unexpected editor"); } };
  const folder = (await store.list()).items.find(item => item.path === folders.downloads);
  await openQuickAccess(store, environment, deps, folder.id);
  await openQuickAccess(store, environment, deps, folder.id, "reveal");
  const target = path.join(root, "file name.txt");
  await writeFile(target, "text");
  const file = (await store.mutate({ type: "add", path: target })).items.find(item => item.path === target);
  await openQuickAccess(store, environment, deps, file.id, "reveal");
  await unlink(target);
  await openQuickAccess(store, environment, deps, file.id, "copy");
  assert.deepEqual(calls, [["open", folders.downloads], ["open", folders.downloads], ["reveal", target], ["copy", target]]);
  await assert.rejects(openQuickAccess(store, environment, deps, file.id), /missing/);
  await assert.rejects(openQuickAccess(store, environment, { ...deps, openPath: async () => "no association" }, folder.id), /openFailed/);
  await assert.rejects(openQuickAccess(store, environment, deps, folder.id, "edit-admin"), /invalidInput/);
  await assert.rejects(openQuickAccess(store, environment, deps, folder.id, "execute"), /invalidInput/);
  let completeCopy;
  let settled = false;
  const copying = openQuickAccess(store, environment, { ...deps, copy: () => new Promise(resolve => { completeCopy = resolve; }) }, folder.id, "copy").then(() => { settled = true; });
  while (!completeCopy) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(settled, false, "copy success waits for the asynchronous system clipboard");
  completeCopy();
  await copying;
  await assert.rejects(openQuickAccess(store, environment, { ...deps, copy: async () => { throw new Error("clipboard busy"); } }, folder.id, "copy"), /openFailed/);
});

test("saved shortcuts are files and system opening receives the original shortcut path", async t => {
  const { root, store, environment } = await fixture(t);
  const opened = [];
  for (const extension of ["lnk", "url"]) {
    const target = path.join(root, `常用入口.${extension}`);
    await writeFile(target, "shortcut contents");
    const item = (await store.mutate({ type: "add", path: target, name: "常用入口" })).items.find(item => item.path === target);
    assert.equal(item.kind, "file");
    assert.equal(item.pinned, false);
    await openQuickAccess(store, environment, { openPath: async value => { opened.push(value); return ""; } }, item.id);
    assert.equal(opened.at(-1), target);
    await store.mutate({ type: "remove", id: item.id });
    assert.equal(await readFile(target, "utf8"), "shortcut contents");
  }
});

test("hosts uses its fixed editor path; authorization acceptance and cancellation remain distinct", { skip: process.platform !== "win32" }, async t => {
  const { root, store, environment } = await fixture(t, "win32");
  const item = (await store.list()).items.find(item => item.preset === "hosts");
  const calls = [];
  let outcome = "opened";
  const deps = { openPath: async () => { throw new Error("must not use file association"); }, reveal() {}, copy() {}, hostsEditor: async elevated => { calls.push(elevated); return outcome; } };
  assert.deepEqual(await openQuickAccess(store, environment, deps, item.id), { status: "opened" });
  assert.deepEqual(await openQuickAccess(store, environment, deps, item.id, "edit-admin"), { status: "opened" });
  outcome = "cancelled";
  assert.deepEqual(await openQuickAccess(store, environment, deps, item.id, "edit-admin"), { status: "cancelled" });
  assert.deepEqual(calls, [false, true, true]);
  const other = path.join(root, "other.txt");
  await writeFile(other, "other");
  await store.mutate({ type: "update", id: item.id, path: other });
  assert.equal((await store.get(item.id)).preset, undefined);
  await assert.rejects(openQuickAccess(store, environment, deps, item.id, "edit-admin"), /invalidInput/);
});

test("elevated command quotes one fixed hosts argument and recognizes UAC cancellation", () => {
  const root = "C:\\Windows 测试' $value";
  assert.deepEqual(hostsEditorCommand(root, false), { executable: path.win32.join(root, "System32", "notepad.exe"), args: [path.win32.join(root, "System32", "drivers", "etc", "hosts")] });
  const command = hostsEditorCommand(root, true);
  assert.equal(command.args[0], "-NoProfile");
  assert.equal(command.args[3], "Hidden");
  const script = Buffer.from(command.args.at(-1), "base64").toString("utf16le");
  assert.ok(script.includes("-Verb RunAs"));
  assert.ok(script.includes("Windows 测试'' $value"));
  assert.ok(script.includes('"C:\\Windows 测试\'\' $value\\System32\\drivers\\etc\\hosts"'));
  assert.ok(script.includes("NativeErrorCode -eq 1223"));
  assert.ok(!script.includes("-Wait"), "launching must not wait for the editor to close");
});

test("the actual PowerShell command handles success, cancelled authorization and launch failure", { skip: process.platform !== "win32", timeout: 210000 }, async () => {
  const systemRoot = "C:\\Windows 测试' $value";
  const command = hostsEditorCommand(systemRoot, true);
  const script = Buffer.from(command.args.at(-1), "base64").toString("utf16le");
  const literal = value => `'${value.replace(/'/g, "''")}'`;
  const editor = path.win32.join(systemRoot, "System32", "notepad.exe");
  const target = `"${path.win32.join(systemRoot, "System32", "drivers", "etc", "hosts")}"`;
  const powershell = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  for (const [outcome, expected] of [["success", 0], ["cancel", 1223], ["failure", 1]]) {
    // Shadow only the launcher: PowerShell parses and executes the real command,
    // but this test never starts an editor or requests administrator permission.
    const stub = `function Start-Process { param($FilePath, $ArgumentList, $Verb, $WindowStyle, $ErrorAction)
      if ($FilePath -cne ${literal(editor)} -or $ArgumentList -cne ${literal(target)} -or $Verb -cne 'RunAs' -or $WindowStyle -cne 'Normal' -or $ErrorAction -cne 'Stop') { throw 'Incorrect launch arguments' }
      ${outcome === "cancel" ? "throw [System.ComponentModel.Win32Exception]::new(1223)" : outcome === "failure" ? "throw [System.ComponentModel.Win32Exception]::new(5)" : "return"}
    }; `;
    const exitCode = await new Promise((resolve, reject) => {
      execFile(powershell, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(stub + script, "utf16le").toString("base64")], { windowsHide: true, timeout: 60000 }, error => {
        if (error && typeof error.code !== "number") reject(new Error(`PowerShell launcher validation failed (${error.code ?? error.signal})`));
        else resolve(error?.code ?? 0);
      });
    });
    assert.equal(exitCode, expected, outcome);
  }
});

test("location search favors exact names, then pins, and includes full paths", () => {
  const item = { name: "hosts", path: "C:\\Windows\\System32\\drivers\\etc\\hosts", pinned: true };
  assert.ok(quickAccessScore(item, "hosts", "hosts") > quickAccessScore(item, "hosts", "hosts backup"));
  assert.ok(quickAccessScore(item, "etc hosts", "hosts") >= 0);
  assert.equal(quickAccessScore(item, "missing", "hosts"), -1);
  assert.ok(quickAccessScore(item, "hosts", "hosts") > quickAccessScore({ ...item, pinned: false }, "hosts", "hosts"));
  assert.equal(quickAccessErrorKey(new Error("Error invoking remote method 'pi:quick-access-open': Error: quickAccess.error.missing")), "quickAccess.error.missing");
});
