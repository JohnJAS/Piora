import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { SessionControlStore, resetSessionControlStoreForTests } = await jiti.import("./session-control-store.ts");

function command(sessionId, suffix, acceptedAt = Date.now()) {
  return {
    commandId: `cmd-${suffix}`,
    idempotencyKey: `key-${suffix}`,
    targetSessionId: sessionId,
    content: `message-${suffix}`,
    delivery: "next_turn",
    source: "remote",
    acceptedAt,
    status: "accepted",
  };
}

test("session control journals tolerate a damaged tail and preserve event cursors", async () => {
  const root = mkdtempSync(join(tmpdir(), "piora-control-store-"));
  try {
    const store = new SessionControlStore({ root });
    const first = command("session-a", "one");
    await store.appendCommand(first);
    await store.appendStatus(first, "queued", { queuedAt: Date.now() });
    appendFileSync(store.commandsPath("session-a"), "{damaged tail\n", "utf8");
    const loaded = store.loadCommands("session-a");
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].status, "queued");
    assert.equal(store.findByIdempotencyKey("key-one", "session-a")?.commandId, "cmd-one");

    const events = await Promise.all([1, 2, 3].map((index) => store.appendEvent({
      type: "command_queued",
      sessionId: "session-a",
      commandId: first.commandId,
      status: "queued",
      timestamp: Date.now() + index,
    })));
    assert.deepEqual(events.map((event) => event.cursor).sort((a, b) => a - b), [1, 2, 3]);
    assert.equal(store.listEvents("session-a").length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compaction removes only old terminal commands", async () => {
  const root = mkdtempSync(join(tmpdir(), "piora-control-compact-"));
  try {
    const store = new SessionControlStore({ root, retentionDays: 1 });
    const old = command("session-a", "old", Date.now() - 3 * 24 * 60 * 60 * 1000);
    const current = command("session-a", "current");
    await store.appendCommand(old);
    await store.appendStatus(old, "completed");
    await store.appendCommand(current);
    const stoppedUi = { ...command("session-a", "stopped-ui", old.acceptedAt), source: "ui" };
    await store.appendCommand(stoppedUi);
    await store.appendStatus(stoppedUi, "cancelled");
    await store.appendStatus(current, "queued");
    await store.compact("session-a");
    assert.equal(store.findByCommandId("cmd-old"), undefined);
    assert.equal(store.findByCommandId("cmd-current")?.status, "queued");
    assert.equal(store.findByCommandId("cmd-stopped-ui")?.content, "message-stopped-ui");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounded operation reads preserve old active work and exact receipts across restart and replacement", async t => {
  const root = mkdtempSync(join(tmpdir(), "piora-indexed-commands-"));
  assert.equal(dirname(root), resolve(tmpdir()));
  t.after(() => { resetSessionControlStoreForTests(); rmSync(root, { recursive: true, force: true }); });
  const store = new SessionControlStore({ root });
  const session = "indexed";
  const file = store.commandsPath(session);
  const older = { ...command(session, "older", 0), source: "ui", status: "running" };
  const history = Array.from({ length: 60 }, (_, index) => ({
    ...command(session, "done-" + index, index + 1), source: "ui", status: "completed",
    content: "/capture " + index, operation: { steps: [] },
  }));
  const line = value => JSON.stringify({ kind: "command", command: value });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, [older, ...history].map(line).join("\n") + "\n");
  const [first, activeBefore, receiptsBefore] = await Promise.all([
    store.operationWindow(session), store.loadActiveCommands(session),
    store.queryCompletedSlashPromptIds(session, new Set(["key-done-0", "key-older", "unknown"])),
  ]);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.commands.map(item => item.commandId), [older, ...history.slice(-50)].map(item => item.commandId));
  assert.deepEqual(activeBefore.map(item => item.commandId), [older.commandId]);
  assert.deepEqual(receiptsBefore, ["key-done-0"]);
  await store.appendStatus(history[0], "completed", { inputMode: "text" });
  assert.deepEqual(store.completedSlashPromptIds(session, new Set(["key-done-0", "key-done-1"])), ["key-done-1"]);
  assert.equal(store.findByIdempotencyKey("key-done-0", session).inputMode, "text");

  resetSessionControlStoreForTests();
  assert.deepEqual(await new SessionControlStore({ root }).operationWindow(session), first);
  const changed = { ...older, content: "changed" };
  writeFileSync(file + ".next", line(changed) + "\n");
  renameSync(file + ".next", file);
  assert.equal(await store.queryByIdempotencyKey(session, history[0].idempotencyKey), undefined);
  assert.deepEqual(store.loadCommands(session), [changed]);
  assert.equal(store.findByIdempotencyKey(history[0].idempotencyKey, session), undefined);
  assert.deepEqual(store.completedSlashPromptIds(session), []);
});

test("events recover the last cursor without replay and isolate an invalid unfinished line before appending", async t => {
  const root = mkdtempSync(join(tmpdir(), "piora-indexed-events-"));
  assert.equal(dirname(root), resolve(tmpdir()));
  t.after(() => { resetSessionControlStoreForTests(); rmSync(root, { recursive: true, force: true }); });
  const store = new SessionControlStore({ root });
  const event = { type: "command_queued", sessionId: "indexed", commandId: "id", status: "queued", timestamp: 1 };
  const file = store.eventsPath(event.sessionId);
  mkdirSync(dirname(file), { recursive: true });
  const history = Array.from({ length: 12_000 }, (_, index) => JSON.stringify({ event: { ...event, cursor: index + 1 } })).join("\n");
  writeFileSync(file, history + "\n{\"torn\":");
  assert.equal(store.lastEventCursor(event.sessionId), 12_000);
  assert.equal((await store.appendEvent({ ...event, preview: "文" })).cursor, 12_001);
  resetSessionControlStoreForTests();
  assert.equal(store.lastEventCursor(event.sessionId), 12_001);
  const suffix = store.listEvents(event.sessionId, 11_998);
  assert.deepEqual(suffix.map(item => item.cursor), [11_999, 12_000, 12_001]);
  assert.equal(suffix.at(-1).preview, "文");
  assert.ok(readFileSync(file, "utf8").includes('{"torn":\n{'));
});
