import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

test("coalesces and reuses unchanged session response projections", () => {
  assert.match(routeSource, /MAX_CACHED_SESSION_RESPONSES = 8/);
  assert.match(routeSource, /signature = `\$\{fileState\.size\}:\$\{fileState\.mtimeMs\}`/);
  assert.match(routeSource, /if \(!deferThinking \|\| !deferToolResultImages\)/);
  assert.match(routeSource, /existing\?\.signature === signature/);
  assert.match(routeSource, /return existing\.promise/);
  assert.match(routeSource, /while \(cache\.size > MAX_CACHED_SESSION_RESPONSES\)/);
});

test("invalidates client switch snapshots whenever a session becomes active", () => {
  assert.match(hookSource, /invalidatePrefetchedSession\(session\.id\)/);
  assert.match(hookSource, /agentRunning \|\| bashRunning \|\| streamState\.isStreaming/);
  assert.match(hookSource, /invalidatePrefetchedSession\(sid\)/);
});
