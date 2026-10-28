import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(import.meta.dirname, "..") } });
const { ManagedShellSession } = await jiti.import("./shell/session.ts");
const { ShellStore } = await jiti.import("./shell/store.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { createShell, getShell } = await jiti.import("./shell/registry.ts");
const { handleShellRequest } = await jiti.import("./shell/http.ts");

const state = () => ({
  id: randomUUID(), title: "Original terminal", initialCwd: tmpdir(), cwd: tmpdir(),
  profile: { executable: process.execPath, kind: "custom", label: "Test shell", integrated: false, native: true },
  createdAt: 1, updatedAt: 1, generation: 3, connected: false, integration: "unavailable", integrationError: null,
  owner: "human", activeCommandId: null, activeRunId: null, model: null, draft: "retained draft", closed: false,
});

test("terminal preferences publish only after durable storage and retain concurrent live changes", async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let durable, writes = 0;
  const store = { async put(_kind, _id, value) {
    if (++writes === 1) { entered.resolve(); await release.promise; }
    durable = structuredClone(value);
  } };
  const session = new ManagedShellSession(state(), store);
  const events = [];
  session.subscribe(event => events.push(event));
  try {
    const saving = session.savePreferences({ title: "中文 · Build logs", model: { provider: "test", modelId: "model" } });
    await entered.promise;
    assert.equal(session.state.title, "Original terminal", "unconfirmed preferences are not exposed by snapshots");
    assert.equal(events.length, 0, "the saved-name event waits for storage");
    session.claim("live-run");
    // Feed the same output path as onData without starting a real child process.
    session.append("new output\u001b]0;shell-owned title\u0007");
    release.resolve(); await saving;
    await session.persistence;
    assert.equal(session.state.title, "中文 · Build logs");
    assert.equal(session.state.owner, "agent");
    assert.equal(session.state.activeRunId, "live-run");
    assert.equal(session.state.generation, 3);
    assert.match(session.snapshot().output, /new output/);
    assert.equal(durable.title, "中文 · Build logs", "queued lifecycle snapshots cannot restore the old title");
    assert.equal(durable.owner, "agent");
    assert.deepEqual(durable.model, { provider: "test", modelId: "model" });
    assert.equal(events.filter(event => event.type === "session" && event.session.title === "中文 · Build logs").length, 1);
  } finally { release.resolve(); await session.dispose(); }
});

test("failed terminal preference writes reject, preserve prior preferences and allow retry", async () => {
  let fail = true, durable;
  const store = { async put(_kind, _id, value) {
    if (fail) { fail = false; throw new Error("TEST: rename storage unavailable"); }
    durable = structuredClone(value);
  } };
  const session = new ManagedShellSession(state(), store);
  const events = [];
  session.subscribe(event => events.push(event));
  try {
    await assert.rejects(session.savePreferences({ title: "Not saved", model: { provider: "test", modelId: "not-saved" } }), /rename storage unavailable/);
    assert.equal(session.state.title, "Original terminal");
    assert.equal(session.state.model, null);
    assert.equal(events.length, 0, "failed preferences must not emit a misleading saved-name event");
    await session.savePreferences({ title: "Retry saved" });
    assert.equal(durable.title, "Retry saved");
    fail = true;
    const unsuccessful = assert.rejects(session.savePreferences({ title: "Later failure" }), /rename storage unavailable/);
    session.claim("new-run");
    await unsuccessful; await session.persistence;
    assert.equal(session.state.title, "Retry saved");
    assert.equal(session.state.owner, "agent", "failure cannot roll back unrelated live state");
    assert.equal(durable.title, "Retry saved");
    assert.equal(durable.activeRunId, "new-run");
    assert.ok(events.every(event => event.type !== "session" || event.session.title !== "Later failure"));
    await Promise.all([session.savePreferences({ title: "First queued name" }), session.savePreferences({ title: "Second queued name" })]);
    assert.equal(session.state.title, "Second queued name");
    assert.equal(durable.title, "Second queued name", "concurrent saves preserve request order");
  } finally { fail = false; await session.dispose(); }
});

test("draft autosave cannot overwrite a concurrently saved terminal title", async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const writes = [];
  let durable;
  const store = { async put(_kind, _id, value) {
    const snapshot = structuredClone(value);
    writes.push(snapshot);
    if (writes.length === 1) { entered.resolve(); await release.promise; }
    durable = snapshot;
  } };
  const session = new ManagedShellSession(state(), store);
  try {
    const rename = session.savePreferences({ title: "Durable title" });
    await entered.promise;
    const draft = session.saveDraft("new draft while renaming");
    release.resolve(); await Promise.all([rename, draft]);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].title, "Durable title", "the draft write waits for committed preferences");
    assert.equal(durable.title, "Durable title");
    assert.equal(durable.draft, "new draft while renaming");
    assert.equal(session.state.draft, durable.draft);
  } finally { release.resolve(); await session.dispose(); }
});

test("terminal rename PATCH validates names, reports write failures and survives store reload", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-shell-rename-"));
  let store = new ShellStore(directory, false);
  globalThis.__pioraShellStore = store;
  allowFileRoot(directory);
  const sessions = [];
  const request = (id, title) => handleShellRequest(new Request(`http://localhost/api/shell/sessions/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" },
    body: JSON.stringify({ title }),
  }), ["sessions", id]);
  try {
    const first = await createShell(directory, process.execPath, directory, true);
    const second = await createShell(directory, process.execPath, directory, true);
    sessions.push(first, second);
    const originalSecond = second.state.title;
    const renamed = await request(first.state.id, "项目构建 · 日志");
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).session.title, "项目构建 · 日志");
    assert.equal((await store.get("session", first.state.id)).title, "项目构建 · 日志");
    assert.equal(second.state.title, originalSecond, "the explicit terminal id owns the rename");
    assert.equal(first.state.generation, 0, "renaming does not start or restart the PTY");
    for (const invalid of ["", "   ", "x".repeat(101), "bad\0name", 42, null]) {
      assert.equal((await request(first.state.id, invalid)).status, 400);
      assert.equal(first.state.title, "项目构建 · 日志");
    }
    const put = store.put.bind(store);
    store.put = async (...args) => {
      if (args[0] === "session" && args[2].title === "Failed title") throw new Error("TEST: title write failed");
      return put(...args);
    };
    const failed = await request(first.state.id, "Failed title");
    assert.equal(failed.status, 500, "failed persistence must not return a successful PATCH");
    assert.match((await failed.json()).error, /title write failed/);
    assert.equal(first.state.title, "项目构建 · 日志");
    assert.equal((await store.get("session", first.state.id)).title, "项目构建 · 日志");
    const finalTitle = "界".repeat(100);
    assert.equal((await request(first.state.id, finalTitle)).status, 200);
    const firstId = first.state.id, secondId = second.state.id;
    for (const session of sessions.splice(0)) { await session.dispose(); globalThis.__pioraManagedShells.delete(session.state.id); }
    await store.close();
    store = new ShellStore(directory);
    globalThis.__pioraShellStore = store;
    const restored = await getShell(firstId), other = await getShell(secondId);
    sessions.push(restored, other);
    assert.equal(restored.state.title, finalTitle);
    assert.equal(other.state.title, originalSecond);
    assert.equal(restored.state.connected, false, "restoring a title does not launch a shell");
  } finally {
    for (const session of sessions) { await session.dispose(); globalThis.__pioraManagedShells?.delete(session.state.id); }
    await store.close(); delete globalThis.__pioraShellStore;
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("piora-shell-rename-"));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
