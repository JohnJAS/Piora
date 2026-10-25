import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { buildCompactChatHistoryRows: plan, commandPreviewTail } = await createJiti(import.meta.url).import("./compact-chat-history.ts");
const { parseCompactProcessPreference, DEFAULT_COMPACT_PROCESS } = await import("./compact-process-preference.ts");
const text = (text) => ({ type: "text", text });
const assistant = (content, extra = {}) => ({ role: "assistant", content, timestamp: 2000, ...extra });
const call = (id, name = "bash", input = { command: "echo hello" }) => ({ type: "toolCall", toolCallId: id, toolName: name, input });
const result = (id, output, extra = {}) => ({ role: "toolResult", toolCallId: id, content: [text(output)], timestamp: 4000, ...extra });
const user = { role: "user", content: "work", timestamp: 1000 };
const ids = ["u", "step", "result", "answer"];

test("both modes keep completed work open until next input and retain explicit choices", () => {
  const messages = [user, assistant([call("a")]), result("a", "ok"), assistant([text("answer")])];
  const group = (messages, busy, choices, compact) => plan(messages, ids, busy, choices, -1, compact).rows.find(row => row.compactProcess).compactProcess;
  for (const compact of [false, true]) {
    assert.equal(group(messages, true, new Map(), compact).expanded, !compact);
    assert.equal(group(messages, false, new Map(), compact).expanded, true);
    const next = [...messages, { ...user, content: "next" }];
    assert.equal(group(next, true, new Map(), compact).expanded, false);
    assert.equal(group(next, true, new Map([["compact-process:u", true]]), compact).expanded, true);
    assert.equal(group(messages, false, new Map([["compact-process:u", false]]), compact).expanded, false);
    assert.deepEqual(group(messages, false, new Map(), compact).activities, { command: 1 });
  }
});

test("interleaved replies keep chronology, unique rows and original deferred block indices", () => {
  const message = assistant([text("before"), call("a", "read", {path:"a.ts"}), text("between"),
    { type: "thinking", thinking: "", deferred: true }, text("after")]);
  const messages = [user, message, result("a", "data"), { ...user, content: "next" }];
  const folded = plan(messages, ["u", "mixed"], false, new Map());
  assert.deepEqual(folded.rows.filter(row => row.message?.role === "assistant").map(row => row.message.content[0].text), ["before", "between", "after"]);
  assert.equal(folded.entryGroups.get("mixed"), "compact-process:u");
  const opened = plan(messages, ["u", "mixed"], false, new Map([["compact-process:u", true]]));
  assert.deepEqual(opened.rows.filter(row => row.message?.role === "assistant").map(row => row.message.content[0].type), ["text", "toolCall", "text", "thinking", "text"]);
  assert.equal(opened.rows.find(row => row.message?.content?.[0]?.type === "thinking").message.content[0].deferredBlockIndex, 3);
  assert.equal(new Set(opened.rows.map(row => row.key)).size, opened.rows.length);
  assert.equal(message.content[3].deferredBlockIndex, undefined);
});

test("settled failures and missing results remain open after next input and a prior collapse", () => {
  for (const tail of [[], [result("a", "failed", {isError:true})], [assistant([], {stopReason:"aborted"})]]) {
    const rows = plan([user, assistant([call("a")]), ...tail, {...user,content:"next"}], ids, true, new Map([["compact-process:u", false]])).rows;
    assert.equal(rows.find(row => row.compactProcess).compactProcess.expanded, true);
    assert.ok(rows.some(row => row.message?.content?.[0]?.toolCallId === "a"));
  }
});

test("compaction remains in the same turn and does not trigger next-input folding", () => {
  const compaction = {role:"custom",customType:"compaction",content:"summary",display:true};
  const messages = [user, assistant([call("a")]), result("a","ok"), compaction,
    assistant([call("b")]), result("b","ok"), assistant([text("answer")])];
  const rows = plan(messages, [], false, new Map()).rows;
  const groups = rows.filter(row => row.compactProcess);
  assert.equal(groups.length,1);
  assert.equal(groups[0].compactProcess.expanded,true);
  assert.equal(groups[0].compactProcess.activities.command,2);
  assert.equal(rows.filter(row=>row.message===compaction).length,1);
});

test("compact display defaults off and preserves explicit choices", () => {
  assert.equal(DEFAULT_COMPACT_PROCESS, false);
  for (const value of [null, "false", "bad", ""]) assert.equal(parseCompactProcessPreference(value), false);
  assert.equal(parseCompactProcessPreference("true"), true);
});

test("completed tools and thinking fold into one row while the formal answer stays visible", () => {
  const messages = [user, assistant([{ type: "thinking", thinking: "reason" }, call("shell")]), result("shell", "hello"), assistant([text("answer")])];
  const { rows, entryRows } = plan(messages, ids, false, new Map([["compact-process:u", false]]));
  assert.equal(rows.length, 3);
  assert.equal(rows[1].compactProcess.count, 2);
  assert.equal(rows[1].compactProcess.active, false);
  assert.equal(rows[2].message.content[0].text, "answer");
  assert.equal(entryRows.get("step"), "compact-process:u");
  const open = plan(messages, ids, false, new Map([["compact-process:u", true]]));
  assert.equal(open.rows.length, 4);
  assert.equal(open.rows[2].secondary, true);
  assert.equal(open.entryRows.get("step"), "message:step:0");
});

test("running snapshots update a bounded three-line preview and preserve explicit expansion on finish", () => {
  const messages = [user, assistant([call("shell")]), result("shell", "one\ntwo\nthree\nfour", { isStreaming: true })];
  const running = plan(messages, ids, true, new Map());
  assert.equal(running.rows[1].compactProcess.preview[0].output, "two\nthree\nfour");
  assert.equal(running.rows[1].compactProcess.preview[0].status, "running");
  messages[2] = result("shell", "one\ntwo\nthree\nfour\nfive", { isStreaming: true });
  assert.equal(plan(messages, ids, true, new Map()).rows[1].compactProcess.preview[0].output, "three\nfour\nfive");
  messages[2] = result("shell", "done"); messages.push(assistant([text("answer")]));
  const finished = plan(messages, ids, false, new Map([["compact-process:u", true]]));
  assert.equal(finished.rows[1].compactProcess.expanded, true);
  assert.equal(finished.rows[1].compactProcess.active, false);
});

test("live thinking and answer are split without changing source content or deferred indices", () => {
  const thinking = { type: "thinking", thinking: "", deferred: true, deferredBlockIndex: 0 };
  const message = assistant([thinking, text("typing answer")]);
  const { rows } = plan([user, message], ["u"], true, new Map([["compact-process:u", true]]), 1);
  assert.equal(rows[1].compactProcess.preview[0].status, "done");
  assert.deepEqual(rows[2].message.content[0], thinking);
  assert.equal(rows[3].message.content[0].text, "typing answer");
  assert.equal(rows[3].isStreaming, true);
  assert.equal(message.content.length, 2);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
});

test("errors, browser handoffs and assistant cancellation notices are never hidden", () => {
  for (const [tool, toolResult] of [
    [call("a"), result("a", "failed", { isError: true })],
    [call("a", "browser", { action: "wait_for_user" }), null],
    [call("a", "browser", { action: "wait_for_user" }), result("a", "unsupported", { details: { status: "unsupported" } })],
  ]) {
    const messages = [user, assistant([tool]), ...(toolResult ? [toolResult] : []), assistant([text("answer")])];
    const { rows } = plan(messages, ids, true, new Map());
    assert.equal(rows[1].compactProcess.attention, true);
    assert.ok(rows.some((row) => row.secondary && row.message.content[0].toolCallId === "a"));
  }
  for (const stopReason of ["aborted", "error"]) {
    const message = assistant([], { stopReason, errorMessage: stopReason === "error" ? "provider failed" : undefined });
    const { rows } = plan([user, assistant([call("a")]), message], ids, false, new Map());
    assert.ok(rows.some((row) => row.message === message));
    assert.equal(rows[1].compactProcess.preview[0].status, "unknown");
  }
});

test("each turn gets its own stable group; custom cards remain visible and old tools do not appear running", () => {
  const custom = { role: "custom", customType: "approval", content: "action needed", display: true };
  const messages = [user, assistant([call("a")]), custom, assistant([text("first answer")]),
    { ...user, content: "next" }, assistant([call("b")])];
  const { rows } = plan(messages, [], true, new Map());
  const groups = rows.filter((row) => row.compactProcess);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].compactProcess.active, false);
  assert.equal(groups[0].compactProcess.preview[0].status, "unknown");
  assert.equal(groups[1].compactProcess.active, true);
  assert.ok(rows.some((row) => row.message === custom));
});

test("large expanded processes stay individually windowable and previews remain bounded", () => {
  const messages = [user, ...Array.from({ length: 6000 }, (_, i) => [assistant([call(String(i), "read", { path: "a" })]), result(String(i), "data")]).flat(), assistant([text("done")]), { ...user, content: "next" }];
  const collapsed = plan(messages, [], false, new Map());
  assert.equal(collapsed.rows.length, 4);
  assert.equal(collapsed.rows[1].compactProcess.preview.length, 3);
  assert.equal(plan(messages, [], false, new Map([["compact-process:0", true]])).rows.length, 6004);
});

test("preview tails remove terminal controls, limit long lines and retain only the latest output", () => {
  assert.equal(commandPreviewTail("old\n\x1b[32mnew\x1b[0m\nlast\nend\n"), "new\nlast\nend");
  assert.equal(commandPreviewTail("step1\rstep2\rstep3\rstep4"), "step2\nstep3\nstep4");
  assert.ok(commandPreviewTail("x".repeat(100000)).length <= 241);
});
