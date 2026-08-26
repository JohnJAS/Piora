import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const collection = fs.readFileSync(new URL("../app/api/automations/route.ts", import.meta.url), "utf8");
const item = fs.readFileSync(new URL("../app/api/automations/[id]/route.ts", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("./automation-runtime.ts", import.meta.url), "utf8");
const instrumentation = fs.readFileSync(new URL("../instrumentation-node.ts", import.meta.url), "utf8");

test("automation mutations use bounded JSON and no-store responses", () => {
  assert.match(collection, /parseJsonWithinLimit/);
  assert.match(collection, /Cache-Control.*no-store/);
  assert.match(collection, /await store\.remove\(automation\.id\)/);
  assert.match(collection, /name: automation\.name, rrule: automation\.rrule/);
  assert.match(item, /parseJsonWithinLimit/);
  assert.match(item, /resolveOrStartRpcSession/);
  assert.match(item, /export async function DELETE/);
});

test("the scheduler starts with the Node server and dispatches through the persistent Session router", () => {
  assert.match(instrumentation, /startAutomationRuntime\(\)/);
  assert.match(runtime, /getSessionMessageRouter\(\)\.dispatchSessionMessage/);
  assert.match(runtime, /idempotencyKey: `automation:/);
  assert.match(runtime, /recoverInterrupted/);
});
