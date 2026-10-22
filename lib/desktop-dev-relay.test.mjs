import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createDesktopDevRelay } from "../scripts/desktop-dev-relay.mjs";

function shell() {
  const child = new EventEmitter();
  child.connected = true;
  child.sent = [];
  child.send = (message, callback) => { child.sent.push(message); callback(); };
  return child;
}
const request = (id, sessionId) => ({ type: "pi-desktop:browser-agent-request", requestId: id, sessionId, params: { action: "open" } });

test("Next wrapper forwards only desktop messages to its server worker and removes old listeners", () => {
  const parent = shell();
  const children = [];
  const childProcess = { fork: () => { const child = shell(); children.push(child); return child; } };
  const require = (id) => {
    if (id === "node:child_process") return childProcess;
    if (id === "node:module") return { syncBuiltinESMExports() {} };
    assert.equal(id, "next/dist/bin/next");
  };
  require.resolve = () => "/next/start-server.js";
  runInNewContext(readFileSync(new URL("../scripts/desktop-next-dev.cjs", import.meta.url), "utf8"), { require, process: parent });
  const worker = childProcess.fork("/next/start-server.js");
  const other = childProcess.fork("/unrelated.js");
  worker.emit("message", request("one", "a"));
  worker.emit("message", { nextServerReady: true });
  assert.equal(parent.sent.length, 1);
  parent.emit("message", { type: "pi-desktop:browser-agent-response", requestId: "one" });
  assert.equal(worker.sent.length, 1);
  assert.equal(other.sent.length, 0);
  worker.emit("exit");
  assert.equal(parent.listenerCount("message"), 0);
  const replacement = childProcess.fork("/next/start-server.js");
  parent.emit("message", { type: "pi-desktop:browser-agent-response", requestId: "two" });
  assert.equal(replacement.sent.length, 1);
  assert.equal(worker.sent.length, 1);
});

test("relay preserves chat ownership, responses, and cancellation", () => {
  const responses = [];
  const relay = createDesktopDevRelay(message => responses.push(message));
  const child = shell();
  relay.attach(child);
  relay.receive(request("one", "chat-a"));
  relay.receive(request("two", "chat-b"));
  assert.deepEqual(child.sent, [request("one", "chat-a"), request("two", "chat-b")]);
  relay.receive({ type: "pi-desktop:browser-agent-cancel", requestId: "one" });
  child.emit("message", { type: "pi-desktop:browser-agent-response", requestId: "one", ok: true });
  child.emit("message", { type: "pi-desktop:browser-agent-response", requestId: "two", ok: true });
  assert.equal(responses.length, 1);
  assert.equal(responses[0].requestId, "two");
  assert.equal(child.sent[2].type, "pi-desktop:browser-agent-cancel");
});

test("disconnect fails pending requests once, rejects gap requests and recovers without replay", () => {
  const responses = [];
  const relay = createDesktopDevRelay(message => responses.push(message));
  const old = shell();
  relay.attach(old);
  relay.receive(request("one", "a"));
  old.emit("disconnect");
  old.emit("exit");
  relay.receive(request("two", "b"));
  assert.equal(responses.length, 2);
  assert.ok(responses.every(response => response.ok === false));
  const replacement = shell();
  relay.attach(replacement);
  assert.equal(replacement.sent.length, 0);
  relay.receive(request("three", "a"));
  old.emit("message", { requestId: "three", ok: true });
  assert.equal(responses.length, 2);
  replacement.emit("message", { type: "pi-desktop:browser-agent-response", requestId: "three", ok: true });
  assert.equal(responses.at(-1).ok, true);
});
