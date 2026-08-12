import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../desktop/src/server-supervisor.ts", import.meta.url), "utf8");

test("uses Next readiness output to avoid a sequential cold health-route wait", () => {
  assert.match(source, /export function isNextServerReadyLine/);
  assert.match(source, /runtimeReady\.then\(\(\) => "next-ready" as const\)/);
  assert.match(source, /readinessSource/);
  assert.match(source, /if \(runtimeReady \|\| !isNextServerReadyLine\(line\)\) return;/);
});
