import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./conversation-search.ts");
}

test("searches only user and assistant text and returns a safe turn anchor", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "piora-conversation-search-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "session.jsonl");
  await writeFile(file, [
    JSON.stringify({ type: "session", id: "s1", cwd: directory, timestamp: "2026-08-30T00:00:00.000Z" }),
    JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: "2026-08-30T00:01:00.000Z", message: { role: "user", content: "Where is the nebula setting?" } }),
    JSON.stringify({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-30T00:02:00.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "secret nebula reasoning" }, { type: "text", text: "The NEBULA setting is under Appearance." }] } }),
    JSON.stringify({ type: "message", id: "t1", parentId: "a1", timestamp: "2026-08-30T00:03:00.000Z", message: { role: "toolResult", content: [{ type: "text", text: "nebula tool output" }] } }),
  ].join("\n"));
  const session = { path: file, id: "s1", cwd: directory, projectRoot: directory, name: "Settings help", created: "2026-08-30T00:00:00.000Z", modified: "2026-08-30T00:03:00.000Z", messageCount: 3, firstMessage: "Where is it?" };
  const { searchConversationSessions } = await loadSubject();
  const response = await searchConversationSessions([session], {}, { query: "nebula", archive: "all", limit: 20 });

  assert.equal(response.results.length, 2);
  assert.deepEqual(response.results.map((result) => result.role).sort(), ["assistant", "user"]);
  assert.equal(response.results.find((result) => result.role === "assistant")?.entryId, "u1");
  assert.ok(response.results.every((result) => !result.snippet.includes("secret") && !result.snippet.includes("tool output")));
});

test("filters archived sessions and projects without accepting file paths from the query", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "piora-conversation-filter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const makeSession = async (id, projectRoot) => {
    const path = join(directory, `${id}.jsonl`);
    await writeFile(path, `${JSON.stringify({ type: "message", id: `${id}-u`, parentId: null, message: { role: "user", content: "shared phrase" } })}\n`);
    return { path, id, cwd: projectRoot, projectRoot, created: "2026-08-30T00:00:00.000Z", modified: "2026-08-30T00:00:00.000Z", messageCount: 1, firstMessage: id };
  };
  const sessions = [await makeSession("active", "C:\\one"), await makeSession("archived", "C:\\two")];
  const { searchConversationSessions } = await loadSubject();

  const response = await searchConversationSessions(sessions, { archived: { archived: true } }, {
    query: "shared",
    archive: "archived",
    project: "C:\\two",
  });
  assert.deepEqual(response.results.map((result) => result.sessionId), ["archived"]);
  assert.equal("path" in response.results[0], false);
});

test("searches the active conversation branch so every result can be opened", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "piora-conversation-branch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "branch.jsonl");
  await writeFile(path, [
    JSON.stringify({ type: "message", id: "root", parentId: null, message: { role: "user", content: "root text" } }),
    JSON.stringify({ type: "message", id: "inactive", parentId: "root", message: { role: "assistant", content: [{ type: "text", text: "orphaned branch phrase" }] } }),
    JSON.stringify({ type: "message", id: "active", parentId: "root", message: { role: "assistant", content: [{ type: "text", text: "visible branch phrase" }] } }),
  ].join("\n"));
  const session = { path, id: "branch", cwd: directory, created: "2026-08-30T00:00:00.000Z", modified: "2026-08-30T00:00:00.000Z", messageCount: 3, firstMessage: "root" };
  const { searchConversationSessions } = await loadSubject();
  assert.equal((await searchConversationSessions([session], {}, { query: "orphaned", archive: "all" })).results.length, 0);
  assert.equal((await searchConversationSessions([session], {}, { query: "visible", archive: "all" })).results.length, 1);
});

test("normalizes query and result limits", async () => {
  const { normalizeConversationSearchOptions, CONVERSATION_SEARCH_QUERY_LIMIT, CONVERSATION_SEARCH_RESULT_LIMIT } = await loadSubject();
  const result = normalizeConversationSearchOptions({ query: `  ${"x".repeat(500)}  `, archive: "invalid", limit: 999 });
  assert.equal(result.query.length, CONVERSATION_SEARCH_QUERY_LIMIT);
  assert.equal(result.archive, "all");
  assert.equal(result.limit, CONVERSATION_SEARCH_RESULT_LIMIT);
});

test("reuses unchanged JSONL indexes and invalidates them after a file change", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "piora-conversation-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "cache.jsonl");
  await writeFile(path, `${JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: "first value" } })}\n`);
  const { readSearchableMessages } = await loadSubject();
  const first = await readSearchableMessages(path);
  const cached = await readSearchableMessages(path);
  assert.equal(cached, first);

  await writeFile(path, `${JSON.stringify({ type: "message", id: "u2", parentId: null, message: { role: "user", content: "second longer value" } })}\n`);
  const updated = await readSearchableMessages(path);
  assert.notEqual(updated, first);
  assert.equal(updated[0]?.text, "second longer value");
});
