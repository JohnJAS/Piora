import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveRoomChatTargets } = await jiti.import("./room-chat-routing.ts");

const room = {
  coordination: { coordinatorSessionId: "coordinator" },
  members: [
    { sessionId: "coordinator", name: "架构师" },
    { sessionId: "worker-a", name: "前端" },
    { sessionId: "worker-b", name: "测试" },
  ],
};

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
