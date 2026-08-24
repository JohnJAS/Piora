import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("./SystemPromptEditor.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/system-prompt/route.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8");

test("system prompt editor persists a global override and refreshes every normal session", () => {
  assert.match(editor, /fetch\("\/api\/system-prompt"/);
  assert.match(editor, /method: "PUT"/);
  assert.match(editor, /piora:system-prompt-changed/);
  assert.match(route, /reloadAllNormalSessionSystemPrompts/);
  assert.match(manager, /systemPromptOverride: \(base\) => readSystemPromptConfig\(\)\.prompt \?\? base/);
  assert.match(manager, /requestSystemPromptReload/);
});
