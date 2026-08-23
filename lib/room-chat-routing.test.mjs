import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveRoomChatTargets } = await jiti.import("./room-chat-routing.ts");

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
});

test("@all and @所有人 broadcast to the whole room", () => {
  assert.deepEqual(resolveRoomChatTargets(room, "@all report status"), ["coordinator", "worker-a", "worker-b"]);
  assert.deepEqual(resolveRoomChatTargets(room, "@所有人 汇报进度"), ["coordinator", "worker-a", "worker-b"]);
});
