import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel = fs.readFileSync(new URL("./AutomationPanel.tsx", import.meta.url), "utf8");
const messageView = fs.readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8");
const rightPanel = fs.readFileSync(new URL("./workspace/RightPanel.tsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("./SettingsDialog.tsx", import.meta.url), "utf8");

test("scheduled tasks expose creation, editing, run history, and destructive confirmation", () => {
  assert.match(panel, /\/api\/automations/);
  assert.match(panel, /notificationPolicy/);
  assert.match(panel, /runNow/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /detail\.runs/);
  assert.match(panel, /role="menu"/);
  assert.match(panel, /toggleStatus/);
  assert.match(panel, /fallbackName/);
  assert.match(panel, /automations\.deleted/);
});

test("automation cards open the dedicated right panel and settings category", () => {
  assert.match(messageView, /piora-automation/);
  assert.match(messageView, /AutomationCard/);
  assert.match(rightPanel, /AutomationPanel/);
  assert.match(rightPanel, /workspace-automation/);
  assert.match(settings, /key: "automations"/);
});
