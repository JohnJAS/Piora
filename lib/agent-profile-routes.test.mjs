import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listRoute = await readFile(new URL("../app/api/sessions/route.ts", import.meta.url), "utf8");
const duplicateRoute = await readFile(new URL("../app/api/sessions/[id]/duplicate/route.ts", import.meta.url), "utf8");

test("session list filters both persisted and live sessions by the cold-start profile", () => {
  assert.match(listRoute, /const runtimeProfile = getAgentRuntimeProfile\(\)/);
  assert.match(listRoute, /const profileStore = readAgentProfileStore\(\)/);
  assert.match(listRoute, /isSessionVisibleInAgentRuntimeProfile\(session\.id, runtimeProfile, profileStore\)/);
  assert.match(listRoute, /getRunningRpcSessionIds\(\)\.filter\(\(id\) => visibleIds\.has\(id\)\)/);
  assert.match(listRoute, /runningSessionIds, runtimeProfile/);
});

test("duplicate inherits profile before exposure and quarantines an unbound copy on failure", () => {
  const resolveIndex = duplicateRoute.indexOf("resolveSessionAgentRuntimeProfile(id, runtimeProfile)");
  const duplicateIndex = duplicateRoute.indexOf("source.createBranchedSession(leafId)");
  const bindIndex = duplicateRoute.indexOf("bindSessionAgentRuntimeProfile(newSessionId, runtimeProfile)");
  const cacheIndex = duplicateRoute.indexOf("cacheSessionPath(newSessionId, duplicatedPath)");
  const responseIndex = duplicateRoute.indexOf("NextResponse.json({ sessionId: newSessionId, runtimeProfile })");
  assert.ok(resolveIndex >= 0 && resolveIndex < duplicateIndex);
  assert.ok(bindIndex > duplicateIndex && bindIndex < cacheIndex && cacheIndex < responseIndex);
  assert.match(duplicateRoute, /catch \(profileError\) \{\s*quarantineUnboundSessionFile\(duplicatedPath\)/);
});
