import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { GET } = await jiti.import("../app/api/sessions/[id]/route.ts");
const { POST } = await jiti.import("../app/api/sessions/[id]/receipts/route.ts");
const { GET: readBinding } = await jiti.import("../app/api/sessions/[id]/system-prompt/route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const { HISTORY_PAGE_BYTES, readSessionStatistics } = await jiti.import("./session-read-repository.ts");
const { SessionControlStore } = await jiti.import("./session-control-store.ts");

const timestamp = "2026-01-01T00:00:00.000Z";
const lines = contents => contents.map(record => JSON.stringify(record)).join("\n") + "\n";
const entryId = index => index.toString(16).padStart(8, "0");
const user = (content, clientPromptId) => ({ role: "user", content, ...(clientPromptId && { clientPromptId }) });
const assistant = content => ({
  role: "assistant", content: [{ type: "text", text: content }], stopReason: "stop", provider: "fixture", model: "model",
});
const entry = (index, message, parentId = index > 1 ? entryId(index - 1) : null) => ({
  type: "message", id: entryId(index), parentId, timestamp, message,
});

async function fixture(t, id, records, version = 3) {
  const root = await mkdtemp(join(tmpdir(), "piora-session-page-"));
  assert.equal(dirname(root), resolve(tmpdir()));
  const prior = process.env.PIORA_SESSION_CONTROL_ROOT;
  process.env.PIORA_SESSION_CONTROL_ROOT = join(root, "control");
  const path = join(root, "session.jsonl");
  const header = { type: "session", id, version, cwd: root, timestamp };
  await writeFile(path, lines([header, ...records]));
  cacheSessionPath(id, path);
  t.after(async () => {
    invalidateSessionPathCache(id);
    if (prior === undefined) delete process.env.PIORA_SESSION_CONTROL_ROOT;
    else process.env.PIORA_SESSION_CONTROL_ROOT = prior;
    await rm(root, { recursive: true, force: true });
  });
  const params = { params: Promise.resolve({ id }) };
  const url = "http://local/api/sessions/" + id;
  return { path, store: new SessionControlStore(), header, params,
    request: (options = {}, etag) => GET(new Request(url + "?" + new URLSearchParams({ view: "chat", ...options }), {
      headers: etag ? { "if-none-match": etag } : {},
    }), params),
    receipts: (ids, anchors = [], leafId = null) => POST(new Request(url + "/receipts", {
      method: "POST", body: JSON.stringify({ ids, anchors, leafId }),
    }), params),
  };
}

test("large chat transfers complete recent turns, paginates without gaps and survives an append", async t => {
  const history = Array.from({ length: 1024 }, (_, index) => {
    const content = "abcdefgh".repeat(128) + index;
    return entry(index + 1, index % 2 ? assistant(content) : user(content, index === 0 ? "old-receipt" : undefined));
  });
  const chat = await fixture(t, "large-page", history);
  await readSessionStatistics(chat.path);
  const worker = globalThis.__pioraReadWorker;
  assert.ok(worker);
  let pageReads = 0;
  globalThis.__pioraReadWorker = {
    run: (...args) => {
      if (args[0] === "sessionPage") pageReads++;
      return worker.run(...args);
    },
  };
  t.after(() => { globalThis.__pioraReadWorker = worker; });
  const [initial, simultaneous] = await Promise.all([chat.request(), chat.request()]);
  assert.equal(pageReads, 1, "concurrent reads of the same representation must share one worker job");
  assert.equal(initial.status, 200);
  assert.equal(simultaneous.status, 200);
  const text = await initial.text();
  assert.equal(text, await simultaneous.text());
  assert.ok(Buffer.byteLength(text) < HISTORY_PAGE_BYTES + 8192, "chat resource must not transfer a whole transcript");
  const tail = JSON.parse(text);
  assert.equal(tail.context.messages.length, 80);
  assert.equal(tail.context.messages[0].role, "user");
  assert.equal(tail.context.entryIds.at(-1), entryId(1024));
  assert.equal(tail.persistedPromptIds, undefined);
  const revalidation = await chat.request({}, initial.headers.get("etag"));
  assert.equal(revalidation.status, 304);
  assert.equal(pageReads, 1, "304 must not request a worker projection");
  assert.equal(await revalidation.text(), "");

  await appendFile(chat.path, lines([entry(1025, user("appended"))]));
  const before = await chat.request({ older: tail.historyPage.older });
  assert.equal(before.status, 200);
  const page = await before.json();
  assert.equal(page.historyPage.contextVersion, tail.historyPage.contextVersion);
  assert.equal(page.context.entryIds.at(-1), entryId(944));
  assert.equal(page.context.entryIds[0], entryId(865));
  assert.equal(page.leafId, entryId(1024), "a cursor is pinned to the original branch");
  const updated = await chat.request({}, initial.headers.get("etag"));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).context.entryIds.at(-1), entryId(1025));
  const result = await (await chat.receipts(["old-receipt", "absent"], [entryId(1)], entryId(1024))).json();
  assert.deepEqual(result, { persistedPromptIds: ["old-receipt"], activeAnchorIds: [entryId(1)] });
});

test("index detects same-file rewrite plus growth, invalidates older cursors and retains the full compatibility response", async t => {
  const records = Array.from({ length: 96 }, (_, index) => entry(index + 1, index % 2 ? assistant("answer") : user("question")));
  const chat = await fixture(t, "rewritten-page", records);
  const original = await (await chat.request()).json();
  const initialContents = await readFile(chat.path, "utf8");
  const changed = initialContents.replaceAll('"question"', '"updated"');
  await writeFile(chat.path, changed + lines([entry(97, user("last"))]));
  assert.equal((await chat.request({ older: original.historyPage.older })).status, 409);
  const focused = await chat.request({ around: entryId(8) });
  assert.equal(focused.status, 200);
  assert.equal((await focused.json()).context.messages[0].content, "updated");
  const compatibility = await chat.request({ view: "full", deferThinking: "1", deferMedia: "1" });
  assert.equal((await compatibility.json()).context.entryIds.length, 97);
  const replacement = chat.path + ".next";
  await writeFile(replacement, lines([chat.header, entry(1, user("replaced", "new-id"))]));
  await rename(replacement, chat.path);
  assert.ok((await stat(chat.path)).size < 1024);
  assert.deepEqual((await (await chat.request()).json()).context.entryIds, [entryId(1)]);
  assert.equal((await chat.request({ older: "not-a-cursor" })).status, 400);
});

test("a large latest turn preserves the compaction boundary, branches and targeted receipts", async t => {
  const summary = { type: "compaction", id: entryId(5), parentId: entryId(4), timestamp, summary: "checkpoint", firstKeptEntryId: entryId(3), tokensBefore: 500 };
  const prompt = "x".repeat(HISTORY_PAGE_BYTES * 4);
  const chat = await fixture(t, "branched-page", [
    entry(1, user("summarized", "summarized-id")), entry(2, assistant("old")),
    entry(3, user("retained")), entry(4, assistant("retained reply")), summary,
    entry(6, user(prompt)), entry(7, assistant("large reply")),
    entry(8, user("alternative", "alternate-id"), entryId(2)), entry(9, assistant("alternative reply")),
  ]);
  const main = await chat.request({ leafId: entryId(7) });
  assert.equal(main.status, 200);
  const page = await main.json();
  assert.deepEqual(page.context.entryIds, [entryId(6), entryId(7)]);
  assert.deepEqual(page.context.messages.map(message => message.content), [prompt, [{ type: "text", text: "large reply" }]]);
  assert.ok(page.historyPage.older);
  const older = await (await chat.request({ older: page.historyPage.older })).json();
  assert.deepEqual(older.context.entryIds, [summary.id, entryId(3), entryId(4)]);
  assert.equal(older.historyPage.older, null);
  const alternate = await (await chat.request({ leafId: entryId(9) })).json();
  assert.deepEqual(alternate.context.entryIds, [entryId(1), entryId(2), entryId(8), entryId(9)]);
  const commandFile = chat.store.commandsPath("branched-page");
  await mkdir(dirname(commandFile), { recursive: true });
  await writeFile(commandFile, lines([{ kind: "command", command: {
    commandId: "command", targetSessionId: "branched-page", source: "ui", idempotencyKey: "slash",
    delivery: "next_turn", status: "completed", content: "/fixture", acceptedAt: 1,
  } }]));
  assert.deepEqual(await (await chat.receipts(["slash", "alternate-id", "summarized-id"], [entryId(1), entryId(3), entryId(8)], entryId(7))).json(), {
    persistedPromptIds: ["alternate-id", "summarized-id", "slash"], activeAnchorIds: [entryId(3)],
  });
});

for (const version of [3, 2]) {
  test(`version ${version} history returns a large turn intact when paging or focusing a reply`, async t => {
    const prompt = "```text\n" + "原始提问".repeat(600) + "\n```";
    const answer = "# 这是助手回答\n\n- 保留格式\n\n" + "后续内容".repeat(HISTORY_PAGE_BYTES / 4) + "\n\n正文末尾";
    const chat = await fixture(t, `large-delivery-${version}`, [
      entry(1, user(prompt)),
      entry(2, assistant(answer)),
      entry(3, user("follow-up")),
      entry(4, assistant("short final")),
    ], version);
    const response = await chat.request();
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(Buffer.byteLength(text) < HISTORY_PAGE_BYTES);
    const body = JSON.parse(text);
    assert.deepEqual(body.context.entryIds, [entryId(3), entryId(4)]);
    assert.ok(body.historyPage.older);

    for (const query of [{ older: body.historyPage.older }, { around: entryId(2) }]) {
      const response = await chat.request(query);
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.deepEqual(page.context.entryIds, [entryId(1), entryId(2)]);
      assert.deepEqual(page.context.messages.map(message => [message.role, message.content]), [
        ["user", prompt], ["assistant", [{ type: "text", text: answer }]],
      ]);
      assert.equal(page.historyPage.older, null);
    }
    const { readSessionHistoryEntry } = await jiti.import("./session-read-repository.ts");
    assert.deepEqual((await readSessionHistoryEntry(chat.path, entryId(2))).message.content, [{ type: "text", text: answer }]);
  });
}

test("one turn can span more entries than a normal history page", async t => {
  const turn = [entry(3, user("one turn")),
    ...Array.from({ length: 180 }, (_, index) => entry(index + 4, assistant("step " + index))),
    entry(184, assistant("final")),
  ];
  assert.ok(Buffer.byteLength(lines(turn)) < HISTORY_PAGE_BYTES);
  const chat = await fixture(t, "many-entry-turn", [entry(1, user("previous")), entry(2, assistant("reply")), ...turn]);
  const response = await chat.request();
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.deepEqual(page.context.entryIds, turn.map(record => record.id));
  assert.deepEqual(page.context.messages.map(message => message.content), turn.map(record => record.message.content));
  assert.ok(page.historyPage.older);
  const older = await (await chat.request({ older: page.historyPage.older })).json();
  assert.deepEqual(older.context.entryIds, [entryId(1), entryId(2)]);
});

test("the oldest retained user turn and the checkpoint each appear once across page boundaries", async t => {
  const records = Array.from({ length: 80 }, (_, index) => entry(index + 1, index % 2 ? assistant("answer") : user("question")));
  const summary = { type: "compaction", id: entryId(81), parentId: entryId(80), timestamp, summary: "checkpoint", firstKeptEntryId: entryId(1), tokensBefore: 500 };
  const chat = await fixture(t, "retained-from-root", [...records, summary]);
  const initial = await (await chat.request()).json();
  assert.deepEqual(initial.context.entryIds, records.map(record => record.id));
  assert.ok(initial.historyPage.older);
  const older = await (await chat.request({ older: initial.historyPage.older })).json();
  assert.deepEqual(older.context.entryIds, [summary.id]);
  assert.equal(older.historyPage.older, null);
});

test("large system prompt snapshots are loaded on demand with their original text", async t => {
  const binding = { version: 1, revision: 1, source: "template", templateId: "removed-template", templateName: "Removed",
    prompt: "原样读取。".repeat(20_000), appliedAt: timestamp };
  const chat = await fixture(t, "long-binding", [entry(1, user("question")), {
    type: "custom", customType: "piora-system-prompt-binding", id: entryId(2), parentId: entryId(1), timestamp, data: binding,
  }]);
  const page = await chat.request();
  const text = await page.text();
  assert.equal(page.status, 200);
  assert.ok(Buffer.byteLength(text) < 8192);
  assert.deepEqual(JSON.parse(text).systemPromptBinding, { ...binding, prompt: null, promptDeferred: true });
  const detail = await readBinding(new Request("http://local/api/sessions/long-binding/system-prompt"), chat.params);
  assert.equal(detail.status, 200);
  assert.deepEqual((await detail.json()).binding, binding);
});

test("model changes after a compaction are placed after the retained reply", async t => {
  const chat = await fixture(t, "model-switch-with-compaction", [
    entry(1, user("first")), entry(2, assistant("older reply")),
    entry(3, user("retained")), entry(4, assistant("retained reply")),
    { type: "compaction", id: entryId(5), parentId: entryId(4), timestamp, summary: "checkpoint", firstKeptEntryId: entryId(3), tokensBefore: 17 },
    { type: "model_change", id: entryId(6), parentId: entryId(5), timestamp, provider: "fixture", modelId: "next" },
    entry(7, user("after")),
  ]);
  const page = (await (await chat.request()).json()).context;
  const full = (await (await chat.request({ view: "full" })).json()).context;
  assert.equal(page.modelChanges[0].afterEntryId, entryId(4));
  assert.deepEqual(page.modelChanges, full.modelChanges);
});

test("paged and full reads agree on deleted prompt boundaries and durable receipts", async t => {
  const chat = await fixture(t, "deleted-page-boundary", [
    entry(1, user("first")), entry(2, assistant("first reply")),
    { type: "custom", id: entryId(3), parentId: entryId(2), timestamp,
      customType: "piora-deleted-message", data: { deletedUser: true, clientPromptId: "deleted-prompt" } },
    entry(4, assistant("kept reply")),
  ]);
  const page = (await (await chat.request()).json()).context;
  const full = (await (await chat.request({ view: "full" })).json()).context;
  assert.deepEqual(page.entryIds, [entryId(1), entryId(2), entryId(4)]);
  assert.deepEqual(page.messages, full.messages);
  assert.equal(page.messages.at(-1).followsDeletedPrompt, true);
  assert.deepEqual((await (await chat.receipts(["deleted-prompt"])).json()).persistedPromptIds, ["deleted-prompt"]);
});
