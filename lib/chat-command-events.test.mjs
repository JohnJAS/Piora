import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createChatCommandEventResponse } = await createJiti(import.meta.url).import("./chat-command-events.ts");

test("command SSE subscribes before snapshot and replays buffered events without starting a runtime", async () => {
  const previous = globalThis.__pioraSessionMessageRouter;
  const order = [];
  let listener;
  let unsubscribed = false;
  globalThis.__pioraSessionMessageRouter = {
    subscribeEvents(_sessionId, callback) { order.push("subscribe"); listener = callback; return () => { unsubscribed = true; }; },
    listEvents() { order.push("cursor"); return [{ cursor: 10 }]; },
    async listOperations() {
      order.push("snapshot");
      listener({ cursor: 11, type: "command_progress", source: "ui", revision: 2 });
      await Promise.resolve();
      listener({ cursor: 12, type: "command_progress", source: "ui", revision: 4 });
      return [{ commandId: "command", status: "running", revision: 3, content: "/reload", acceptedAt: 1 }];
    },
  };
  const controller = new AbortController();
  try {
    const response = createChatCommandEventResponse(new Request("http://localhost/events", { signal: controller.signal }), "session");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    for (let index = 0; index < 3; index++) chunks.push(decoder.decode((await reader.read()).value));
    const messages = chunks.map(chunk => JSON.parse(chunk.match(/data: (.+)/)[1]));
    assert.deepEqual(order, ["subscribe", "cursor", "snapshot"]);
    assert.equal(messages[0].type, "command_snapshot");
    assert.equal(messages[0].operations[0].revision, 3);
    assert.deepEqual(messages.slice(1).map(message => message.cursor), [11, 12]);
    controller.abort();
    assert.equal(unsubscribed, true);
    assert.equal((await reader.read()).done, true);
  } finally {
    controller.abort();
    globalThis.__pioraSessionMessageRouter = previous;
  }
});

test("command SSE includes old nonterminal work and cleans up an already-aborted connection", async () => {
  const previous = globalThis.__pioraSessionMessageRouter;
  let unsubscribed = 0;
  globalThis.__pioraSessionMessageRouter = {
    subscribeEvents() { return () => { unsubscribed++; }; },
    listEvents() { return []; },
    async listOperations() { return Array.from({ length: 60 }, (_, index) => ({ commandId: `command-${index}`, status: index === 0 ? "running" : "completed", content: "/reload", acceptedAt: index })); },
  };
  const controller = new AbortController();
  try {
    const response = createChatCommandEventResponse(new Request("http://localhost/events", { signal: controller.signal }), "session");
    const reader = response.body.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    const snapshot = JSON.parse(chunk.match(/data: (.+)/)[1]);
    assert.equal(snapshot.operations.length, 51);
    assert.ok(snapshot.operations.some(operation => operation.commandId === "command-0"));
    assert.equal(snapshot.hasMore, true);
    controller.abort();
    const aborted = createChatCommandEventResponse(new Request("http://localhost/events", { signal: controller.signal }), "session");
    assert.equal((await aborted.body.getReader().read()).done, true);
    assert.equal(unsubscribed, 2);
  } finally {
    controller.abort();
    globalThis.__pioraSessionMessageRouter = previous;
  }
});
