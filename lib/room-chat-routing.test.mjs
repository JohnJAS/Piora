import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveExplicitRoomChatTargets, resolveRoomChatTargets } = await jiti.import("./room-chat-routing.ts");

const room = {
  coordination: { coordinatorMemberId: "member-coordinator" },
  members: [
    { memberId: "member-coordinator", profile: { name: "架构师" }, binding: { sessionId: "coordinator" } },
    { memberId: "member-worker-a", profile: { name: "前端" }, binding: { sessionId: "worker-a" } },
    { memberId: "member-worker-b", profile: { name: "测试" }, binding: { sessionId: "worker-b" } },
  ],
};

test("v3 JSON data does not require non-enumerable v2 aliases", () => {
  const serializedRoom = JSON.parse(JSON.stringify(room));
  assert.deepEqual(resolveRoomChatTargets(serializedRoom, "@前端 请处理"), ["worker-a"]);
});

test("plain group messages go to the coordinator", () => {
  assert.deepEqual(resolveRoomChatTargets(room, "请讨论下一步"), ["coordinator"]);
});

test("member mentions target only matching sessions", () => {
  assert.deepEqual(resolveRoomChatTargets(room, "@前端 请调整布局，@测试 跑一下回归"), ["worker-a", "worker-b"]);
  assert.deepEqual(resolveExplicitRoomChatTargets(room, "@测试 先检查，@前端 再修复"), ["worker-b", "worker-a"]);
});

test("team mode sends multi-Agent requests to the coordinator so dependencies are scheduled instead of started in parallel", () => {
  const teamRoom = { ...room, coordination: { ...room.coordination, mode: "team" } };
  assert.deepEqual(resolveRoomChatTargets(teamRoom, "@前端 先编码，@测试 等编码完成后再审查"), ["coordinator"]);
  assert.deepEqual(resolveRoomChatTargets(teamRoom, "@前端 只处理这个独立问题"), ["worker-a"]);
  assert.deepEqual(resolveRoomChatTargets(teamRoom, "@所有人 立即汇报"), ["coordinator", "worker-a", "worker-b"]);
});

test("explicit Agent replies can route mentions without falling back to the coordinator or echoing to the sender", () => {
  assert.deepEqual(resolveExplicitRoomChatTargets(room, "处理完成，没有后续派工", { excludeSessionId: "worker-a" }), []);
  assert.deepEqual(resolveExplicitRoomChatTargets(room, "@架构师 编码已经完成", { excludeSessionId: "worker-a" }), ["coordinator"]);
  assert.deepEqual(resolveExplicitRoomChatTargets(room, "@所有人 汇报", { excludeSessionId: "coordinator" }), ["worker-a", "worker-b"]);
});

test("@all and @所有人 broadcast to the whole room", () => {
  assert.deepEqual(resolveRoomChatTargets(room, "@all report status"), ["coordinator", "worker-a", "worker-b"]);
  assert.deepEqual(resolveRoomChatTargets(room, "@所有人 汇报进度"), ["coordinator", "worker-a", "worker-b"]);
});
