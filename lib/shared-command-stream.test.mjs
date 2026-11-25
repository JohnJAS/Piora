import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { createSharedCommandStreamChannel } = await jiti.import("./shared-command-stream.ts");

test("shared command stream buffers snapshot and live updates until subscriber attaches", () => {
  const channel = createSharedCommandStreamChannel();
  const stateUpdates = [];
  const unsubState = channel.subscribeState(() => stateUpdates.push(channel.getActiveSessionId()));
  const token = {};

  channel.activate("s1", token);
  assert.deepEqual(stateUpdates, ["s1"]);

  channel.emit("s1", { type: "command_snapshot", operations: [{ commandId: "old" }] }, token);
  channel.emit("s1", { type: "command_snapshot", operations: [{ commandId: "fresh" }] }, token);
  channel.emit("s1", { type: "command_progress", commandId: "fresh", cursor: 2 }, token);

  const received = [];
  const errors = [];
  const unsub = channel.subscribe(
    "s1",
    (payload) => received.push(payload),
    () => errors.push("err"),
  );

  assert.equal(received.length, 2);
  assert.equal(received[0].operations[0].commandId, "fresh");
  assert.equal(received[1].commandId, "fresh");

  channel.emitError("s1", token);
  assert.deepEqual(errors, ["err"]);

  unsub();
  unsubState();
});

test("shared command stream fences stale closing tokens after reconnect", () => {
  const channel = createSharedCommandStreamChannel();
  const firstToken = {};
  const secondToken = {};
  const received = [];

  channel.activate("s1", firstToken);
  channel.activate("s1", secondToken);
  channel.subscribe(
    "s1",
    (payload) => received.push(payload),
    () => {},
  );

  // Late deactivate or emit from first connection must be ignored.
  channel.deactivate("s1", firstToken);
  assert.equal(channel.getActiveSessionId(), "s1");

  channel.emit("s1", { type: "ignored" }, firstToken);
  channel.emit("s1", { type: "accepted" }, secondToken);
  assert.deepEqual(received, [{ type: "accepted" }]);

  channel.deactivate("s1", secondToken);
  assert.equal(channel.getActiveSessionId(), null);
});
