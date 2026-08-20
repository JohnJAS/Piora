import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./remote-control-connector.ts", import.meta.url), "utf8");

test("remote connector is process-scoped and delegates delivery to the router", () => {
  assert.match(source, /globalThis\.__pioraRemoteControlConnector/);
  assert.match(source, /PIORA_REMOTE_CONTROL_WS_URL/);
  assert.match(source, /PIORA_REMOTE_CONTROL_WS_TOKEN/);
  assert.match(source, /dispatchSessionMessage/);
  assert.match(source, /scheduleReconnect/);
  assert.match(source, /lastCursor/);
  assert.doesNotMatch(source, /sendUserMessage/);
});
