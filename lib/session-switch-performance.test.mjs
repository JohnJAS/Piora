import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const sessionRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const { SessionControlStore } = await jiti.import("./session-control-store.ts");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const prefetchSource = await readFile(new URL("./session-prefetch.ts", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");

test("revalidates unchanged chat resources but serves a new representation after history and receipt appends", async t => {
  const directory = await mkdtemp(join(tmpdir(), "piora-session-revalidate-"));
  const id = "revalidate-fixture";
  const file = join(directory, "session.jsonl");
  const timestamp = "2026-01-01T00:00:00.000Z";
  const header = { type: "session", version: 3, id, cwd: directory, timestamp };
  const message = (entryId, parentId, content) => ({
    type: "message", id: entryId, parentId, timestamp,
    message: { role: "user", content, timestamp: Date.parse(timestamp) },
  });
  const lines = (...entries) => entries.map(entry => JSON.stringify(entry)).join("\n") + "\n";
  const request = (etag, projection = "") => sessionRoute.GET(
    new Request("http://local/api/sessions/" + id + "?deferThinking=1&deferMedia=1" + projection, {
      headers: etag ? { "If-None-Match": etag } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
  const previousRoot = process.env.PIORA_SESSION_CONTROL_ROOT;
  process.env.PIORA_SESSION_CONTROL_ROOT = join(directory, "control");
  t.after(async () => {
    invalidateSessionPathCache(id);
    if (previousRoot === undefined) delete process.env.PIORA_SESSION_CONTROL_ROOT;
    else process.env.PIORA_SESSION_CONTROL_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true });
  });
  const store = new SessionControlStore();
  cacheSessionPath(id, file);
  await writeFile(file, lines(header, message("01010101", null, "first")));
  const initial = await request();
  const etag = initial.headers.get("etag");
  assert.equal(initial.status, 200);
  assert.ok(etag);
  assert.equal(initial.headers.get("cache-control"), "private, no-cache");
  const body = await initial.json();
  assert.deepEqual(body.context.entryIds, ["01010101"]);
  assert.deepEqual(body.tree, []);

  const concurrent = await Promise.all([request(), request()]);
  for (const response of concurrent) {
    assert.equal(response.headers.get("etag"), etag);
    assert.deepEqual(await response.json(), body);
  }
  const unchanged = await request('"other", W/' + etag);
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get("etag"), etag);
  assert.equal(await unchanged.text(), "");

  const withTree = await request(etag, "&includeTree=1");
  assert.equal(withTree.status, 200);
  assert.notEqual(withTree.headers.get("etag"), etag);
  assert.equal((await withTree.json()).tree[0].entry.id, "01010101");

  await appendFile(file, lines(message("02020202", "01010101", "second")));
  const appended = await request(etag);
  const appendedEtag = appended.headers.get("etag");
  assert.equal(appended.status, 200);
  assert.ok(appendedEtag);
  assert.notEqual(appendedEtag, etag);
  assert.deepEqual((await appended.json()).context.entryIds, ["01010101", "02020202"]);

  const commands = store.commandsPath(id);
  await mkdir(dirname(commands), { recursive: true });
  await writeFile(commands, lines({
    kind: "command",
    command: { commandId: "command", targetSessionId: id, idempotencyKey: "client-slash-id", source: "ui",
      status: "completed", delivery: "next_turn", content: "/fixture", acceptedAt: Date.parse(timestamp) },
  }));
  const receipt = await request(appendedEtag);
  assert.equal(receipt.status, 200);
  assert.notEqual(receipt.headers.get("etag"), appendedEtag);
  assert.deepEqual((await receipt.json()).persistedPromptIds, ["client-slash-id"]);
});

test("invalidates client switch snapshots whenever a session becomes active", () => {
  assert.match(hookSource, /invalidatePrefetchedSession\(session\.id\)/);
  assert.match(hookSource, /agentRunning \|\| bashRunning \|\| streamState\.isStreaming/);
  assert.match(hookSource, /invalidatePrefetchedSession\(sid\)/);
});

test("initial chat state consumes the same cached resource used by prefetch", () => {
  assert.match(prefetchSource, /export function peekPrefetchedSession/);
  assert.match(prefetchSource, /entry\.settled/);
  assert.match(hookSource, /peekPrefetchedSession\(session\)/);
  assert.match(hookSource, /useState<SessionData \| null>\(initialSessionData\)/);
  assert.match(hookSource, /useState\(!isNew && initialSessionData === null\)/);
  assert.match(hookSource, /loadSession\(session\.id, initialSessionData === null/);
  assert.match(chatWindowSource, /session-loading-indicator/);
  assert.match(chatWindowSource, /session-loading-composer/);
});

test("does not remount the chat when the selected session is clicked again", () => {
  assert.match(appShellSource, /selectedSessionIdRef\.current === session\.id/);
  assert.match(appShellSource, /setSessionKey\(\(k\) => k \+ 1\)/);
});
