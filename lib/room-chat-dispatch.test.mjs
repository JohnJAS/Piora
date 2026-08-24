import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "piora-room-chat-dispatch-"));
process.env.PIORA_ROOMS_ROOT = root;
const jiti = createJiti(import.meta.url);
const rooms = await jiti.import("./room-store.ts");
const chat = await jiti.import("./room-chat.ts");

class FakeRouter {
  commands = [];
  listeners = new Map();

  async dispatchSessionMessage(input) {
    const commandId = `command-${this.commands.length + 1}`;
    this.commands.push({ commandId, input });
    return { accepted: true, commandId, sessionId: input.targetSessionId, status: "queued" };
  }

  subscribeEvents(sessionId, listener) {
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => listeners.delete(listener);
  }

  async getCommand(commandId) {
    const command = this.commands.find((candidate) => candidate.commandId === commandId);
    return { commandId, status: "queued", targetSessionId: command?.input.targetSessionId };
  }
}

test.after(() => {
  delete process.env.PIORA_ROOMS_ROOT;
  rmSync(root, { recursive: true, force: true });
});

test("an Agent's shared @mention is delivered to the mentioned Session and preserves the scheduling chain", async () => {
  let room = rooms.createRoom({ name: "Mention routing", creator: { sessionId: "lead-session", name: "Lead", role: "coordinator" } });
  room = rooms.addRoomMember(room.id, { sessionId: "worker-session", name: "Coder", role: "worker" });
  room = rooms.addRoomMember(room.id, { sessionId: "review-session", name: "Reviewer", role: "reviewer" });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "lead-session" });
  const router = new FakeRouter();

  const assignment = rooms.appendRoomMessage(room.id, {
    authorKind: "session",
    authorId: "lead-session",
    authorName: "Lead",
    content: "@Coder 请先完成编码",
    forwardDepth: 1,
    autoRound: 1,
    maxAutoRounds: 6,
  });
  const assigned = await chat.dispatchExplicitRoomMentions(room.id, assignment, router);
  assert.deepEqual(assigned.dispatched.map((item) => item.sessionId), ["worker-session"]);
  assert.equal(router.commands[0].input.targetSessionId, "worker-session");
  assert.match(router.commands[0].input.content, /Shared message from: Lead/);
  assert.match(router.commands[0].input.content, /@Lead/);

  const completion = rooms.appendRoomMessage(room.id, {
    authorKind: "session",
    authorId: "worker-session",
    authorName: "Coder",
    content: "@Lead 编码已完成，可以安排审查",
    replyTo: assignment.id,
    ...chat.deriveRoomReplyRoutingMetadata(room.id, assignment.id),
  });
  const reported = await chat.dispatchExplicitRoomMentions(room.id, completion, router);
  assert.deepEqual(reported.dispatched.map((item) => item.sessionId), ["lead-session"]);
  assert.equal(router.commands[1].input.targetSessionId, "lead-session");
  assert.equal(completion.autoRound, 2);
  assert.equal(completion.forwardDepth, 2);

  const prematureReview = rooms.appendRoomMessage(room.id, {
    authorKind: "session",
    authorId: "worker-session",
    authorName: "Coder",
    content: "@Reviewer 请直接开始审查",
    replyTo: assignment.id,
    ...chat.deriveRoomReplyRoutingMetadata(room.id, assignment.id),
  });
  const rescheduled = await chat.dispatchExplicitRoomMentions(room.id, prematureReview, router);
  assert.deepEqual(rescheduled.dispatched.map((item) => item.sessionId), ["lead-session"]);
  assert.equal(rescheduled.skipped[0].code, "ROOM_COORDINATOR_SCHEDULED");

  const combinedAssignment = rooms.appendRoomMessage(room.id, {
    authorKind: "session",
    authorId: "lead-session",
    authorName: "Lead",
    content: "@Reviewer 等待，@Coder 先编码",
  });
  const serialized = await chat.dispatchExplicitRoomMentions(room.id, combinedAssignment, router);
  assert.deepEqual(serialized.dispatched, []);
  assert.deepEqual(serialized.skipped.map((item) => item.sessionId), ["review-session", "worker-session"]);
  assert.equal(serialized.skipped[0].code, "ROOM_COORDINATOR_ONE_TARGET");

  const noMention = rooms.appendRoomMessage(room.id, {
    authorKind: "session",
    authorId: "lead-session",
    authorName: "Lead",
    content: "收到，暂时不调度其他人",
  });
  assert.deepEqual(await chat.dispatchExplicitRoomMentions(room.id, noMention, router), { dispatched: [], skipped: [] });
  assert.equal(router.commands.length, 3);
});
