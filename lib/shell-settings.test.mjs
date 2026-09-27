import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(import.meta.dirname, "..") } });
const { ShellStore } = await jiti.import("./shell/store.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { handleShellRequest } = await jiti.import("./shell/http.ts");
const { createShell, getShell } = await jiti.import("./shell/registry.ts");

test("history source settings recover from deleted files without allowing unvalidated re-enabling", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-shell-settings-"));
  const store = new ShellStore(directory, false);
  globalThis.__pioraShellStore = store;
  allowFileRoot(directory);
  const file = path.join(directory, "history.txt");
  const source = { id: "custom:history", path: file, kind: "bash", enabled: true };
  const save = sources => handleShellRequest(new Request("http://localhost/api/shell/settings", {
    method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" },
    body: JSON.stringify({ importSystemHistory: false, importPiHistory: false, sources }),
  }), ["settings"]);
  try {
    await writeFile(file, "echo history\n");
    assert.equal((await save([source])).status, 200);
    await store.recordHistory([{ id: "saved-command", command: "echo history", source: "bash", sourceId: source.id, importedAt: Date.now() }]);
    await unlink(file);
    assert.equal((await save([{ ...source, enabled: false }])).status, 200, "a previously valid source can be disabled after its file disappears");
    assert.equal((await save([source])).status, 403, "re-enabling requires a readable existing file again");
    assert.equal((await save([{ ...source, path: path.join(directory, "another-missing.txt"), enabled: false }])).status, 403, "the exception cannot introduce a different unvalidated path");
    assert.equal((await save([{ ...source, path: directory }])).status, 403, "a directory is not a history file");
    assert.equal((await save([])).status, 200);
    assert.equal((await store.history({ query: "history" })).records[0].id, "saved-command", "removing a source preserves its previously imported commands");
    assert.deepEqual((await store.call("getValue", { key: "settings" })).sources, []);
  } finally {
    await store.close(); delete globalThis.__pioraShellStore;
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("piora-shell-settings-"));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("native shell defaults are independent, new tabs can override them, and restored tabs keep their shell", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-shell-choice-"));
  const store = new ShellStore(directory, false);
  globalThis.__pioraShellStore = store;
  allowFileRoot(directory);
  const request = (method, body) => handleShellRequest(new Request("http://localhost/api/shell/native-settings", {
    method, headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), ["native-settings"]);
  try {
    const initial = await (await request("GET")).json();
    assert.equal(initial.executable, null);
    assert.ok(initial.profiles.length);
    assert.ok(initial.profiles.every(profile => profile.native && !profile.integrated));
    const firstProfile = initial.profiles[0];
    const otherExecutable = process.execPath;
    assert.equal((await request("POST", { executable: firstProfile.executable })).status, 200);
    const first = await createShell(directory, null, directory, true);
    assert.equal(first.state.profile.executable, firstProfile.executable);
    const explicit = await createShell(directory, otherExecutable, directory, true);
    assert.equal(explicit.state.profile.executable, otherExecutable);
    assert.equal((await request("POST", { executable: otherExecutable })).status, 200);
    const next = await createShell(directory, null, directory, true);
    assert.equal(next.state.profile.executable, otherExecutable);
    await first.dispose(); globalThis.__pioraManagedShells.delete(first.state.id);
    const restored = await getShell(first.state.id);
    assert.equal(restored.state.profile.executable, firstProfile.executable, "saved tabs do not adopt the new default");
    assert.equal(await store.call("getValue", { key: "settings" }), null, "legacy shell preferences are untouched");
    assert.notEqual((await request("POST", { executable: path.join(directory, "missing-shell") })).status, 200);
    assert.equal((await (await request("GET")).json()).executable, otherExecutable);
    assert.equal((await request("POST", { executable: null })).status, 200);
    assert.equal((await (await request("GET")).json()).executable, null);
  } finally {
    for (const shell of globalThis.__pioraManagedShells?.values() || []) await shell.dispose();
    globalThis.__pioraManagedShells?.clear();
    await store.close(); delete globalThis.__pioraShellStore;
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("piora-shell-choice-"));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
