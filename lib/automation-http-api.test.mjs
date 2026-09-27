import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const collection = fs.readFileSync(new URL("../app/api/automations/route.ts", import.meta.url), "utf8");
const item = fs.readFileSync(new URL("../app/api/automations/[id]/route.ts", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("./automation-runtime.ts", import.meta.url), "utf8");
const instrumentation = fs.readFileSync(new URL("../instrumentation-node.ts", import.meta.url), "utf8");

test("reading automation details does not load or start the session runtime", async () => {
  const automation = { id: "fixture", name: "Fixture" };
  const runs = [{ id: "run-1", automationId: "fixture", status: "succeeded" }];
  const store = { get: id => id === automation.id ? automation : undefined, listRuns: () => runs };
  const exports = {};
  const code = ts.transpileModule(item, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (id === "next/server") return { NextResponse: Response };
    if (id === "@/lib/automation-store") return { getAutomationStore: () => store };
    if (id === "@/lib/bounded-json") return {};
    throw new Error(`Read-only details must not load ${id}`);
  } });
  const response = await exports.GET(null, { params: Promise.resolve({ id: automation.id }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { automation, runs });
  const missing = await exports.GET(null, { params: Promise.resolve({ id: "missing" }) });
  assert.equal(missing.status, 404);
});

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
