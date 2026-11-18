import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(import.meta.dirname, "..") } });
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const { persistLazySessionManager } = await jiti.import("./session-persistence.ts");
const { DELETE } = await jiti.import("../app/api/sessions/[id]/messages/[entryId]/route.ts");
const { GET } = await jiti.import("../app/api/sessions/[id]/route.ts");
const { GET: contextGET } = await jiti.import("../app/api/sessions/[id]/context/route.ts");
const { prepareChatHistory, projectChatHistoryTail } = await jiti.import("./chat-history-projection.ts");

test("message deletion survives disk reload, updates cached history and rejects active writers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-delete-message-"));
  const manager = SessionManager.create(directory, path.join(directory, "sessions"));
  const id = manager.getSessionId();
  try {
    const userId = manager.appendMessage({ role: "user", content: "erase this secret", clientPromptId: "delete-receipt", timestamp: 1 });
    const laterId = manager.appendMessage({ role: "user", content: "keep this message", timestamp: 2 });
    persistLazySessionManager(manager);
    const file = manager.getSessionFile();
    cacheSessionPath(id, file);
    const get = etag => GET(new Request(`http://localhost/api/sessions/${id}`, { headers: etag ? { "If-None-Match": etag } : {} }), { params: Promise.resolve({ id }) });
    const before = await get();
    assert.equal(before.status, 200);
    const del = () => DELETE(new Request(`http://localhost/api/sessions/${id}/messages/${userId}`, { method: "DELETE" }), { params: Promise.resolve({ id, entryId: userId }) });
    globalThis.__piSessions ??= new Map();
    globalThis.__piSessions.set(id, { isRunning: () => true });
    assert.equal((await del()).status, 409);
    assert.ok((await readFile(file, "utf8")).includes("erase this secret"));
    globalThis.__piSessions.delete(id);
    assert.equal((await del()).status, 200);
    const after = await get(before.headers.get("etag"));
    assert.equal(after.status, 200);
    const body = await after.json();
    assert.deepEqual(body.context.entryIds, [laterId]);
    assert.deepEqual(body.persistedPromptIds, ["delete-receipt"]);
    assert.equal((await readFile(file, "utf8")).includes("erase this secret"), false);
    const branch = await (await contextGET(new Request(`http://localhost/api/sessions/${id}/context?leafId=${laterId}`), { params: Promise.resolve({ id }) })).json();
    assert.deepEqual(branch.context.entryIds, [laterId]);
    assert.deepEqual(branch.persistedPromptIds, ["delete-receipt"]);
    assert.equal((await del()).status, 200, "retrying a completed deletion is harmless");
  } finally {
    globalThis.__piSessions?.delete(id);
    invalidateSessionPathCache(id);
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("piora-delete-message-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting a user message keeps the preceding and following replies in separate visible turns", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-delete-message-"));
  const manager = SessionManager.create(directory, path.join(directory, "sessions"));
  const id = manager.getSessionId();
  const assistant = (text, timestamp) => manager.appendMessage({ role: "assistant", content: [{ type: "text", text }], timestamp });
  try {
    const firstUser = manager.appendMessage({ role: "user", content: "question A", timestamp: 1 });
    const firstReply = assistant("reply A", 2);
    const deletedUser = manager.appendMessage({ role: "user", content: "question B", timestamp: 3 });
    const secondReply = assistant("reply B", 4);
    persistLazySessionManager(manager);
    const file = manager.getSessionFile();
    cacheSessionPath(id, file);
    const url = `http://localhost/api/sessions/${id}`;
    const params = Promise.resolve({ id });
    const deleted = await DELETE(new Request(`${url}/messages/${deletedUser}`, { method: "DELETE" }), { params: Promise.resolve({ id, entryId: deletedUser }) });
    assert.equal(deleted.status, 200);
    assert.deepEqual((await deleted.json()).deletedIds, [deletedUser]);
    for (const response of [await GET(new Request(url), { params }), await contextGET(new Request(`${url}/context?leafId=${secondReply}`), { params })]) {
      assert.equal(response.status, 200);
      const { context } = await response.json();
      assert.deepEqual(context.entryIds, [firstUser, firstReply, secondReply]);
      for (const [compact, direct] of [[true, false], [false, false], [false, true]]) {
        const base = prepareChatHistory(context.messages, context.entryIds, new Map(), compact, direct, [], []);
        assert.deepEqual([...base.metadata.showTimestamps], [1, 2]);
        const { rows } = projectChatHistoryTail(base, null, false);
        assert.deepEqual([...rows].filter(row => row.message?.role === "assistant" && !row.intermediate).map(row => row.message.content[0].text), ["reply A", "reply B"]);
      }
    }
    assert.doesNotMatch(await readFile(file, "utf8"), /question B/);
  } finally {
    invalidateSessionPathCache(id);
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("piora-delete-message-"));
    await rm(directory, { recursive: true, force: true });
  }
});
