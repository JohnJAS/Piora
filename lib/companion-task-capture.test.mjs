import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const capture = await jiti.import("./companion-task-capture.ts");

test("task capture records only the latest actionable completed turn", () => {
  const record = capture.buildCompanionTaskRecord({
    sessionId: "session-1",
    sessionTitle: "修复登录问题",
    project: "piora",
    messages: [
      { role: "user", content: "解释一下 React hydration" },
      { role: "assistant", content: [{ type: "text", text: "这是服务端和客户端标记不一致。" }] },
      { role: "user", content: "请修复登录页的 hydration 问题，并补上测试。" },
      { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "已修复登录页并新增回归测试，类型检查通过。" }], stopReason: "stop" },
    ],
    entryIds: ["u1", "a1", "u2", "a2"],
    capturedAt: 123,
  });

  assert.ok(record);
  assert.equal(record.sourceEntryId, "a2");
  assert.equal(record.title, "修复登录页的 hydration 问题，并补上测试");
  assert.equal(record.outcome, "已修复登录页并新增回归测试，类型检查通过。");
  assert.equal(record.reviewStatus, "pending");
  assert.equal(record.capturedAt, 123);
  assert.doesNotMatch(record.outcome, /hidden/);
});

test("task capture ignores informational and failed turns", () => {
  assert.equal(capture.buildCompanionTaskRecord({
    sessionId: "session-1",
    messages: [
      { role: "user", content: "React 是什么？" },
      { role: "assistant", content: [{ type: "text", text: "React 是 UI 库。" }], stopReason: "stop" },
    ],
    entryIds: ["u1", "a1"],
  }), null);

  assert.equal(capture.buildCompanionTaskRecord({
    sessionId: "session-1",
    messages: [
      { role: "user", content: "帮我修复问题" },
      { role: "assistant", content: [{ type: "text", text: "失败" }], stopReason: "error" },
    ],
    entryIds: ["u1", "a1"],
  }), null);
});
