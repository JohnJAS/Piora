import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { summarizeSessionStats } = await jiti.import("./session-stats.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const statsRoute = await jiti.import("../app/api/sessions/[id]/stats/route.ts");
const detailRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
const usage = (cost) => ({ input: 10, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 19, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });

test("whole-file totals include other branches and auxiliary usage without double-counting nested calls", async t => {
  const root = mkdtempSync(join(tmpdir(), "piora-stats-"));
  const sm = SessionManager.create(root, join(root, "sessions"));
  const id = sm.getSessionId();
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  t.after(() => { globalThis.__piSessions = previous; invalidateSessionPathCache(id); rmSync(root, { recursive: true, force: true }); });
  const first = sm.appendMessage({ role: "user", content: "start", timestamp: 1 });
  sm.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "parent", name: "codemode", arguments: {} }], provider: "fixture", model: "fixture", api: "openai-completions", stopReason: "toolUse", timestamp: 2, usage: usage(1) });
  sm.appendMessage({ role: "toolResult", toolCallId: "parent", toolName: "codemode", content: [], isError: false, timestamp: 3, usage: usage(2), nestedCalls: { complete: true, calls: [{ id: "parent/0", name: "classifier", status: "ok" }] } });
  sm.appendUsage("classifier", "fixture", "fixture", usage(3));
  sm.appendCompaction("summary", first, 20, undefined, false, usage(4));
  sm.branch(first);
  sm.appendMessage({ role: "assistant", content: [], provider: "fixture", model: "fixture", api: "openai-completions", timestamp: 4, stopReason: "stop", usage: usage(5) });
  const stats = summarizeSessionStats(sm);
  assert.equal(stats.cost, 15);
  assert.equal(stats.tokens.total, 95);
  assert.equal(stats.assistantMessages, 2);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.costStatus, "known");
  cacheSessionPath(id, sm.getSessionFile());
  const context = { params: Promise.resolve({ id }) };
  const response = await statsRoute.GET(new Request(`http://local/api/sessions/${id}/stats`), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(stats)));
  const detail = await detailRoute.GET(new Request(`http://local/api/sessions/${id}`), context);
  assert.deepEqual((await detail.json()).stats, JSON.parse(JSON.stringify(stats)));
  assert.equal(globalThis.__piSessions.size, 0, "history statistics must not start a runtime");
});

test("missing prices are unknown or partial, never an assumed zero price", () => {
  const entries = [{ type: "message", message: { role: "assistant", content: [], usage: { input: 4 } } }];
  const sm = { getEntries: () => entries, getSessionId: () => "s", getSessionFile: () => undefined, getSessionName: () => undefined };
  assert.equal(summarizeSessionStats(sm).costStatus, "unknown");
  entries.push({ type: "usage", usage: usage(2) });
  assert.equal(summarizeSessionStats(sm).costStatus, "partial");
  entries.push({ type: "branch_summary", usage: usage(3) });
  assert.equal(summarizeSessionStats(sm).cost, 5);
});
