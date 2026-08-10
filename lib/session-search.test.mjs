import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

const { filterSessions, sessionMatchesSearch } = await import("./session-search.ts");

const makeSession = (index) => ({
  id: `session-${index}`,
  path: `/repo/.pi/${index}.jsonl`,
  cwd: index % 2 ? "/repo/frontend" : "/repo/backend",
  name: index === 227 ? "Investigate streaming retry" : `Task ${index}`,
  firstMessage: `Message ${index}`,
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-01T00:00:00.000Z",
  messageCount: 2,
});

test("matches title, cwd, and project name case-insensitively", () => {
  const session = makeSession(227);
  assert.equal(sessionMatchesSearch(session, "Piora", "STREAMING"), true);
  assert.equal(sessionMatchesSearch(session, "Piora", "frontend"), true);
  assert.equal(sessionMatchesSearch(session, "Piora", "piora"), true);
  assert.equal(sessionMatchesSearch(session, "Piora", "missing"), false);
});

test("filters 300 sessions in under 50ms", () => {
  const sessions = Array.from({ length: 300 }, (_, index) => makeSession(index));
  const started = performance.now();
  const matches = filterSessions(sessions, "Piora", "streaming retry");
  const elapsed = performance.now() - started;
  assert.deepEqual(matches.map((session) => session.id), ["session-227"]);
  assert.ok(elapsed < 50, `search took ${elapsed.toFixed(2)}ms`);
});
