import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const control = readFileSync(new URL("./SessionToolsControl.tsx", import.meta.url), "utf8");
const input = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const rightPanel = readFileSync(new URL("./workspace/RightPanel.tsx", import.meta.url), "utf8");

test("the composer exposes a compact per-session tool control", () => {
  assert.match(input, /<SessionToolsControl/);
  assert.match(control, /aria-haspopup="dialog"/);
  assert.match(control, /role="switch"/);
  assert.match(control, /data-placement=\{placement\.side\}/);
  assert.match(control, /preset: "custom"/);
  assert.match(control, /sessionTools\.defaultOn/);
  assert.match(control, /sessionTools\.enableAll/);
  assert.doesNotMatch(control, /const PRESETS|selectPreset/);
});

test("browser and Harmony panels disclose model access separately from panel access", () => {
  assert.match(rightPanel, /capabilityAccess\("browser"\)/);
  assert.match(rightPanel, /capabilityAccess\("device"\)/);
  assert.match(rightPanel, /sessionTools\.panelAccessOff/);
});
