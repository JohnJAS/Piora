import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./CapabilityBundlesConfig.tsx", import.meta.url), "utf8");

test("capability bundle export is cancelable and aborts when the settings page unmounts", () => {
  assert.match(component, /new AbortController\(\)/);
  assert.match(component, /signal:\s*controller\.signal/);
  assert.match(component, /exportAbortRef\.current\?\.abort\(\)/);
  assert.match(component, /return \(\) => \{[\s\S]*exportAbortRef\.current\?\.abort\(\)/);
  assert.match(component, /busy === "export"[\s\S]*t\("i18n\.cancel"\)/);
});

test("canceling an export is not reported as an export failure", () => {
  assert.match(component, /controller\.signal\.aborted[\s\S]*error\.name === "AbortError"[\s\S]*return/);
  assert.match(component, /finally \{[\s\S]*exportAbortRef\.current === controller[\s\S]*setBusy\(null\)/);
});
