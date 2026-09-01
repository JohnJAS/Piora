import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(".") },
});
const sessionRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
  resolveSessionPath,
} = await jiti.import("./session-reader.ts");

function routeContext(id) {
  return { params: Promise.resolve({ id }) };
}

test("loads a live lazy session before its JSONL file exists", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piora-live-session-detail-"));
  const previousRegistry = globalThis.__piSessions;
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    rmSync(root, { recursive: true, force: true });
  });

  const manager = SessionManager.create(root, join(root, "sessions"));
  const header = manager.getHeader();
  const sessionFile = manager.getSessionFile();
  assert.ok(header?.id);
  assert.ok(sessionFile);
  assert.equal(existsSync(sessionFile), false);

  globalThis.__piSessions = new Map([[header.id, {
    isAlive: () => true,
    sessionFile,
    inner: { sessionManager: manager },
  }]]);
  cacheSessionPath(header.id, sessionFile);

  const response = await sessionRoute.GET(
    new Request(`http://local/api/sessions/${header.id}?deferThinking=1&deferMedia=1`),
    routeContext(header.id),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.sessionId, header.id);
  assert.equal(body.filePath, sessionFile);
  assert.deepEqual(body.context.messages, []);
  assert.equal(existsSync(sessionFile), false, "reading a lazy session must not force it to disk");
  invalidateSessionPathCache(header.id);
});

test("turns an orphaned cached session path into a stable 404", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const sessionId = `orphaned-${Date.now()}`;
  const missingPath = join(tmpdir(), `${sessionId}.jsonl`);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    invalidateSessionPathCache(sessionId);
  });

  globalThis.__piSessions = new Map();
  cacheSessionPath(sessionId, missingPath);
  assert.equal(await resolveSessionPath(sessionId), missingPath);

  const response = await sessionRoute.GET(
    new Request(`http://local/api/sessions/${sessionId}?deferThinking=1&deferMedia=1`),
    routeContext(sessionId),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Session not found" });
});
