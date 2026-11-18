import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "..") } });

async function isolated(context) {
  const root = await mkdtemp(join(tmpdir(), "piora-subagent-observation-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  context.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function record(parentSessionId, agentId, fields = {}) {
  return { version: 1, parentSessionId, agentId, parentToolCallId: "tool", agentType: "Explore", description: "Task " + agentId,
    prompt: "not part of the public DTO", background: false, startedAt: 1000, status: "completed", result: "result",
    totalTokens: 15, totalToolUseCount: 1, ...fields };
}

test("a first child completed between idle polls changes both presence and the bounded refresh cursor", async context => {
  const root = await isolated(context);
  const store = await jiti.import("./subagent-store.ts");
  const first = store.getSubagentPresenceVersion();
  const initial = store.readSubagentChanges(null, -1);
  assert.deepEqual(store.listSubagentParents(["parent", "unrelated"]), []);
  store.saveSubagent(record("parent", "agent"));
  assert.notEqual(store.getSubagentPresenceVersion(), first);
  assert.deepEqual(store.listSubagentParents(["parent", "unrelated"]), ["parent"]);
  const result = store.readSubagentChanges(initial.subagentRefreshEpoch, 0);
  assert.deepEqual(result.subagentChanges, ["parent"]);
  assert.equal(result.subagentRefreshReset, false);
  const presence = store.getSubagentPresenceVersion();
  store.saveSubagent(record("parent", "agent", { result: "changed" }));
  assert.equal(store.getSubagentPresenceVersion(), presence, "progress must not re-index the sidebar catalog");
  for (let update = 0; update < 257; update++) store.saveSubagent(record("parent", "agent", { revision: update }));
  assert.equal(store.readSubagentChanges(initial.subagentRefreshEpoch, 0).subagentRefreshReset, true);
  await writeFile(join(root, "piora", "subagent-runs", "parent", "bad.json"), "{partial");
  await writeFile(join(root, "piora", "subagent-runs", "parent", "undefined.json"), JSON.stringify(record("parent", undefined)));
  await writeFile(join(root, "piora", "subagent-runs", "parent", "bad-time.json"), JSON.stringify(record("parent", "bad-time", { attemptStartedAt: "invalid" })));
  assert.deepEqual(store.listSubagentRecords("parent").map(item => item.agentId), ["agent"]);
  process.env.PI_CODING_AGENT_DIR = join(root, "isolated-profile");
  assert.deepEqual(store.listSubagentParents(["parent"]), []);
  assert.equal(store.readSubagentChanges(initial.subagentRefreshEpoch, result.subagentRefreshCursor).subagentRefreshReset, true);
});

test("old parent history returns only the allowed subagent fields", async () => {
  const { entryToUiMessage } = await jiti.import("./session-reader.ts");
  const oldRecord = record("parent", "agent", { childSessionId: "private", childSessionFile: "fixture.jsonl" });
  const details = { subagent: oldRecord, extra: "private" };
  const output = { role: "toolResult", toolCallId: "tool", toolName: "Agent", content: [{ type: "text", text: "parent-visible result" }], details };
  const notification = { customType: "piora-subagent-completion", content: "completion note", display: true, details };
  const entries = [{ type: "message", message: output }, { type: "custom_message", ...notification }, { type: "message", message: { role: "custom", ...notification } }];
  for (const entry of entries) {
    const projected = entryToUiMessage(entry, { deferThinking: true, deferToolResultImages: true });
    assert.deepEqual(Object.keys(projected.details), ["subagent"]);
    assert.ok(!Object.hasOwn(projected.details.subagent, "prompt"));
    assert.ok(!Object.hasOwn(projected.details.subagent, "childSessionId"));
    assert.ok(!Object.hasOwn(projected.details.subagent, "childSessionFile"));
    assert.equal(projected.details.subagent.attempt, 1);
    assert.equal(projected.details.subagent.result, oldRecord.result);
    assert.deepEqual(projected.content, entry.content ?? entry.message.content);
  }
  assert.equal(output.details.subagent.childSessionFile, "fixture.jsonl", "projection must leave disk/model input intact");
  assert.equal(entryToUiMessage({ type: "message", message: { ...output, toolName: "read" } }, {}).details, details);
});

test("paging the read-only transcript keeps order, handles append and refuses stale ownership or huge output", async context => {
  const root = await isolated(context);
  const { readSubagentTranscript, StaleSubagentTranscript } = await jiti.import("./subagent-transcript.ts");
  const folder = join(root, "piora", "subagent-sessions", "parent", "agent");
  await mkdir(folder, { recursive: true });
  const path = join(folder, "runs.jsonl");
  const line = (index, text = "message " + index, role = "assistant") => JSON.stringify({
    type: "message", id: "row-" + index, message: { role, content: [{ type: "text", text }] },
  }) + "\n";
  await writeFile(path, Array.from({ length: 64 }, (_, index) => line(index)).join("") + '{"partial":');
  const entry = record("parent", "agent", { childSessionFile: path });
  const signal = new AbortController().signal;
  const page = await readSubagentTranscript(entry, null, signal);
  assert.deepEqual(page.entries.map(item => item.id), Array.from({ length: 50 }, (_, index) => "row-" + (index + 14)));
  assert.ok(page.before);
  await appendFile(path, '"still ignored"}\n' + line(64));
  const older = await readSubagentTranscript(entry, page.before, signal);
  assert.deepEqual(older.entries.map(item => item.id), Array.from({ length: 14 }, (_, index) => "row-" + index));
  assert.equal(older.before, null);
  await assert.rejects(readSubagentTranscript({ ...entry, attempt: 2 }, page.before, signal), StaleSubagentTranscript);
  await assert.rejects(readSubagentTranscript({ ...entry, agentId: "another", childSessionFile: path }, page.before, signal), StaleSubagentTranscript);
  await rename(path, path + ".moved");
  await writeFile(path, line(0));
  await assert.rejects(readSubagentTranscript(entry, page.before, signal), StaleSubagentTranscript);
  const huge = "x".repeat(3 * 1024 * 1024);
  await writeFile(path, line(0) + line(1, huge, "toolResult") + line(2, "last"));
  const bounded = await readSubagentTranscript(entry, null, signal);
  assert.deepEqual(bounded.entries.map(item => item.role), ["omitted", "assistant"]);
  assert.ok(bounded.before);
  assert.deepEqual((await readSubagentTranscript(entry, bounded.before, signal)).entries.map(item => item.id), ["row-0"]);
  await writeFile(path, Array.from({ length: 30 }, (_, index) => line(index, "中\n".repeat(8_000), "toolResult")).join(""));
  const limited = await readSubagentTranscript(entry, null, signal);
  assert.ok(limited.entries.length > 0 && limited.entries.length < 30 && limited.before);
  assert.ok(Buffer.byteLength(JSON.stringify(limited.entries)) <= 96 * 1024);
  assert.ok(limited.entries.every(item => item.truncated));

  const linked = join(root, "piora", "subagent-sessions", "parent", "alias");
  await symlink(folder, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(readSubagentTranscript(record("parent", "alias", { childSessionFile: join(linked, "runs.jsonl") }), null, signal), /Invalid subagent transcript location/);
});

test("the HTTP route fences owner and attempts, keeps children private and tolerates a trashed parent", async context => {
  const root = await isolated(context);
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { GET, POST } = await jiti.import("../app/api/agent/[id]/subagents/route.ts");
  const { cacheSessionPath } = await jiti.import("./session-reader.ts");
  const { persistLazySessionManager } = await jiti.import("./session-persistence.ts");
  const { SubagentRuntime, bindSubagentRuntime } = await jiti.import("./subagent-runtime.ts");
  const { DEFAULT_SUBAGENT_SETTINGS } = await jiti.import("./subagent-settings.ts");
  const { saveSubagent } = await jiti.import("./subagent-store.ts");
  const parentFile = SessionManager.create(root);
  parentFile.appendMessage({ role: "user", content: "fixture", timestamp: 1 });
  persistLazySessionManager(parentFile);
  const owner = parentFile.getSessionId();
  const path = parentFile.getSessionFile();
  assert.ok(path);
  cacheSessionPath(owner, path);
  const otherFile = SessionManager.create(root);
  otherFile.appendMessage({ role: "user", content: "other", timestamp: 2 });
  persistLazySessionManager(otherFile);
  const other = otherFile.getSessionId();
  cacheSessionPath(other, otherFile.getSessionFile());
  saveSubagent(record(owner, "continuable", { childSessionFile: "never-exposed.jsonl" }));
  saveSubagent(record(owner, "stranded", { status: "running" }));
  const address = "http://127.0.0.1/api/agent/fixture/subagents";
  const get = (id, query = "") => GET(new Request(address + query), { params: Promise.resolve({ id }) });
  const post = (id, agentId, expectedAttempt) => POST(new Request(address, {
    method: "POST", body: JSON.stringify({ action: "stop", agentId, expectedAttempt }),
  }), { params: Promise.resolve({ id }) });
  const disk = await (await get(owner, "?agentId=stranded")).json();
  assert.equal(disk.records[0].status, "interrupted");
  const settled = await post(owner, "stranded", 1);
  assert.equal(settled.status, 200, "an already interrupted attempt can be confirmed without a live agent");
  assert.equal((await settled.json()).record.status, "interrupted");
  assert.equal((await post(owner, "stranded", 2)).status, 409);
  const needed = await (await get(owner, "?agentId=continuable")).json();
  assert.equal(needed.records[0].attempt, 1);
  assert.equal(Object.hasOwn(needed.records[0], "prompt"), false);
  assert.equal(Object.hasOwn(needed.records[0], "childSessionFile"), false);
  assert.deepEqual((await (await get(other, "?agentId=continuable")).json()).records, []);
  const held = new Map();
  const runtime = new SubagentRuntime(owner, root, {
    async run(item, _profile, signal) { held.set(item.agentId, signal); return new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }); },
    async notify() {},
  }, () => ({ ...DEFAULT_SUBAGENT_SETTINGS, enabled: true }));
  const release = bindSubagentRuntime(runtime);
  context.after(release);
  const followup = runtime.continue("continuable", "the new attempt");
  const sibling = await runtime.launch({ description: "sibling", prompt: "sibling task", run_in_background: true }, "sibling-call");
  assert.equal((await post(other, "continuable", 2)).status, 409);
  assert.equal((await post(owner, "continuable")).status, 400);
  assert.equal((await post(owner, "continuable", 1)).status, 409);
  assert.equal(held.get("continuable").aborted, false);
  assert.equal((await post(owner, "continuable", 2)).status, 202);
  assert.equal((await followup).status, "cancelled");
  assert.equal(held.get(sibling.agentId).aborted, false);
  assert.equal((await post(owner, "continuable", 2)).status, 200);
  await runtime.stopAll();
  for (let index = 0; index < 23; index++) saveSubagent(record(other, "agent-" + index, { startedAt: index }));
  const list = await (await get(other, "?view=list")).json();
  assert.equal(list.records.length, 20);
  assert.equal(list.nextOffset, 20);
  const tail = await (await get(other, "?view=list&offset=20")).json();
  assert.equal(tail.records.length, 3);
  assert.equal(tail.nextOffset, null);
  await rename(path, path + ".trashed");
  assert.equal((await get(owner)).status, 404);
  assert.equal((await post(owner, sibling.agentId, 1)).status, 404);
  await rename(path + ".trashed", path);
  assert.equal((await get(owner)).status, 200);

  const { bindSessionAgentRuntimeProfile } = await jiti.import("./agent-profile-store.ts");
  const { resetAgentRuntimeProfileForTests } = await jiti.import("./agent-runtime-profile.ts");
  const previousProfile = process.env.PIORA_RUNTIME_PROFILE;
  await bindSessionAgentRuntimeProfile(other, "device-control");
  try {
    process.env.PIORA_RUNTIME_PROFILE = "device-control";
    resetAgentRuntimeProfileForTests();
    assert.equal((await get(owner, "?agentId=continuable")).status, 404, "device-control cannot read an unbound parent");
    assert.equal((await post(owner, "continuable", 2)).status, 404, "device-control cannot stop an unbound parent");
    assert.equal((await get(other, "?view=list")).status, 200);
  } finally {
    if (previousProfile === undefined) delete process.env.PIORA_RUNTIME_PROFILE;
    else process.env.PIORA_RUNTIME_PROFILE = previousProfile;
    resetAgentRuntimeProfileForTests();
  }
});
