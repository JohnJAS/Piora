import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./workspace/HarmonyPanel.tsx", import.meta.url), "utf8");

test("device actions keep the existing Harmony video connection alive", () => {
  const actionSource = source.slice(
    source.indexOf("  const action ="),
    source.indexOf("  const mediaAction ="),
  );

  assert.match(actionSource, /jsonRequest\("\/api\/harmony\/action"/);
  assert.doesNotMatch(actionSource, /requestFrame/);
  assert.match(source, /onClick=\{requestFrame\}/);
});

test("keeps a read-only observer surface available while an Agent is running", () => {
  assert.match(source, /sessionRunning/);
  assert.match(source, /agentHasControl/);
  assert.match(source, /旁观模式 · Agent 正在操作/);
  assert.match(source, /查看模式 · 截图和录屏可直接使用/);
  assert.match(source, /onGuideAgent/);
  assert.match(source, /frameMode === "frames"/);
});

test("keeps passive media controls independent and gives the screen resizable focus space", () => {
  const mediaSource = source.slice(source.indexOf("  const mediaAction ="), source.indexOf("  const saveSettings ="));
  assert.match(source, /disabled=\{!canScreenshot \|\| busy\}/);
  assert.match(mediaSource, /if \(!selectedSerial\) return/);
  assert.doesNotMatch(mediaSource, /if \(!selectedSerial \|\| !lease\) return/);
  assert.match(source, /piora-harmony-drawer-height-v1/);
  assert.match(source, /role="separator"/);
  assert.match(source, /frameZoom/);
  assert.match(source, /onMaximizedChange\(!maximized\)/);
});
