import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "piora-team-api-"));
process.env.PIORA_ROOMS_ROOT = root;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const rooms = await jiti.import("./room-store.ts");
const stores = await jiti.import("./team-run-store.ts");
const coordinators = await jiti.import("./team-coordinator-service.ts");
const runRoutes = await jiti.import("../app/api/rooms/[id]/runs/route.ts");
const runRoute = await jiti.import("../app/api/rooms/[id]/runs/[runId]/route.ts");
const eventRoute = await jiti.import("../app/api/rooms/[id]/runs/[runId]/events/route.ts");
const cancelRoute = await jiti.import("../app/api/rooms/[id]/runs/[runId]/cancel/route.ts");

test.after(() => {
  coordinators.resetTeamCoordinatorForTests();
  stores.resetTeamRunStoreForTests();
  delete process.env.PIORA_ROOMS_ROOT;
  rmSync(root, { recursive: true, force: true });
});

function context(id, runId) {
  return { params: Promise.resolve(runId ? { id, runId } : { id }) };
}

test("Team REST routes enforce Room membership and return stable input-limit errors", async () => {
  let room = rooms.createRoom({ name: "API Team", creator: { sessionId: "api-coordinator", role: "coordinator" } });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "api-coordinator" });
  const store = stores.getTeamRunStore();
  const run = await store.createTeamRun({ roomId: room.id, objective: "Contract test", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "api-coordinator" } });

  const denied = await runRoutes.GET(new Request(`http://local/api/rooms/${room.id}/runs?sessionId=outsider`), context(room.id));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "TEAM_INVALID_CONTEXT");

  const listed = await runRoutes.GET(new Request(`http://local/api/rooms/${room.id}/runs?sessionId=api-coordinator`), context(room.id));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).runs.map((item) => item.id), [run.id]);

  const oversized = await runRoutes.POST(new Request(`http://local/api/rooms/${room.id}/runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "api-coordinator", objective: "x".repeat(256 * 1024 + 1) }),
  }), context(room.id));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "TEAM_INPUT_TOO_LARGE");

  const unauthorizedCancel = await cancelRoute.POST(new Request("http://local/cancel", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "outsider", reason: "no" }),
  }), context(room.id, run.id));
  assert.equal(unauthorizedCancel.status, 403);
});

test("Team SSE starts from a snapshot and authorized run reads preserve projection revision", async () => {
  const room = rooms.createRoom({ name: "SSE Team", creator: { sessionId: "sse-coordinator", role: "coordinator" } });
  const store = stores.getTeamRunStore();
  const run = await store.createTeamRun({ roomId: room.id, objective: "Replay state", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "sse-coordinator" } });
  const detail = await runRoute.GET(new Request(`http://local/run?sessionId=sse-coordinator`), context(room.id, run.id));
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).run.revision, 1);

  const abort = new AbortController();
  const response = await eventRoute.GET(new Request(`http://local/events?sessionId=sse-coordinator`, { signal: abort.signal }), context(room.id, run.id));
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: snapshot/);
  assert.match(first, /"revision":1/);
  abort.abort();
  await reader.cancel().catch(() => undefined);

  const member = room.members[0];
  await store.appendTeamRunEvents(room.id, run.id, run.revision, [{ type: "planning.requested", dispatch: {
    dispatchId: "sse-planning-dispatch", purpose: "planning", taskId: "__planning__", memberId: member.memberId,
    sessionId: member.binding.sessionId, attempt: 1, leaseTokenHash: "hash", status: "requested", requestedAt: Date.now(), updatedAt: Date.now(),
  } }]);
  for (let reconnect = 0; reconnect < 10; reconnect += 1) {
    const replay = await eventRoute.GET(new Request(`http://local/events?sessionId=sse-coordinator&after=1`), context(room.id, run.id));
    const replayReader = replay.body.getReader();
    const frame = new TextDecoder().decode((await replayReader.read()).value);
    assert.match(frame, /id: 2/);
    assert.equal((frame.match(/event: team\.event/g) ?? []).length, 1);
    await replayReader.cancel();
  }
});

test("Team objective accepts exactly 262,144 UTF-8 bytes without truncation", async () => {
  let room = rooms.createRoom({ name: "Boundary Team", creator: { sessionId: "boundary-coordinator", role: "coordinator" } });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "boundary-coordinator" });
  const objective = "界".repeat(87_381) + "x";
  assert.equal(Buffer.byteLength(objective), 262_144);
  const response = await runRoutes.POST(new Request(`http://local/api/rooms/${room.id}/runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "boundary-coordinator", objective, idempotencyKey: "boundary-exact" }),
  }), context(room.id));
  assert.equal(response.status, 201);
  const run = (await response.json()).run;
  assert.equal(Buffer.byteLength(run.objective), 262_144);
  const userMessage = rooms.listRoomMessages(room.id).find((message) => message.correlationId === `team:${run.id}:objective`);
  assert.ok(userMessage);
  assert.equal(rooms.readRoomMessageFullContent(room.id, userMessage.id), objective);
});
