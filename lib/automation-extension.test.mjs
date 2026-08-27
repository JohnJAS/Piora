import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const extension = readFileSync(new URL("../extensions/piora-automations.ts", import.meta.url), "utf8");

test("scheduled tasks are advertised as Piora's native scheduler", () => {
  assert.match(extension, /piora_runtime_capability name="scheduled_tasks" availability="active"/);
  assert.match(extension, /selectedTools\?\.includes\("piora_automation"\)/);
  assert.match(extension, /systemPrompt: `\$\{event\.systemPrompt\}/);
  assert.match(extension, /Windows Task Scheduler/);
  assert.match(extension, /schtasks/);
  assert.match(extension, /targetScope=chat/);
  assert.match(extension, /first choice for work that belongs in Piora/);
  assert.match(extension, /remain valid when the user explicitly asks for system-level scheduling/);
});
