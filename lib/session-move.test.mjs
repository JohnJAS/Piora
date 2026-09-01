import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moveSource = await readFile(new URL("./session-move.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/sessions/[id]/move/route.ts", import.meta.url), "utf8");

test("moves a complete fork subtree and rewrites its project ownership atomically", () => {
  assert.match(moveSource, /descendants = new Set<string>\(\[sessionId\]\)/);
  assert.match(moveSource, /session\.parentSessionId && descendants\.has\(session\.parentSessionId\)/);
  assert.match(moveSource, /header\.cwd = targetCwd/);
  assert.match(moveSource, /movedPathBySource\.get\(sessionPathKey\(header\.parentSession\)\)/);
  assert.match(moveSource, /rename\(entry\.sourcePath, entry\.backupPath\)/);
  assert.match(moveSource, /rename\(entry\.temporaryPath, entry\.destinationPath\)/);
});

test("refuses to move live sessions and exposes the operation through a POST route", () => {
  assert.match(moveSource, /getRpcSession\(session\.id\)\?\.isRunning\(\)/);
  assert.match(moveSource, /SessionMoveError\("A session in this conversation tree is still running", 409\)/);
  assert.match(routeSource, /export async function POST/);
  assert.match(routeSource, /moveSessionTreeToCwd\(id, cwd\)/);
});
