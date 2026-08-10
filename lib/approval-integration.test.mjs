import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rpc = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const extension = readFileSync(new URL("../extensions/piora-approval.ts", import.meta.url), "utf8");
const card = readFileSync(new URL("../components/ApprovalCard.tsx", import.meta.url), "utf8");
const presets = readFileSync(new URL("./tool-presets.ts", import.meta.url), "utf8");

test("loads approval as a disk extension without implementing a tool interceptor in rpc-manager", () => {
  assert.match(rpc, /additionalExtensionPaths/);
  assert.match(rpc, /piora-approval\.ts/);
  assert.doesNotMatch(rpc, /function\s+classifyTool|matchDangerousCommand/);
  assert.match(extension, /api\.on\("tool_call"/);
  assert.match(extension, /ctx\.ui\.select/);
});

test("supports allow-once, allow-for-task, reject, and semantic permission tiers", () => {
  assert.match(extension, /APPROVAL_ALLOW_TASK/);
  assert.match(extension, /allowedForTask/);
  assert.match(card, /APPROVAL_ALLOW_ONCE/);
  assert.match(card, /APPROVAL_ALLOW_TASK/);
  assert.match(card, /APPROVAL_REJECT/);
  assert.match(presets, /PRESET_NONE[^=]*= \["read", "grep", "find", "ls"\]/);
});
