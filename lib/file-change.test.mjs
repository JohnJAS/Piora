import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { countPatchLines, getFileChangeInfo } = await jiti.import("./file-change.ts");
const { default: registerFileChanges } = await jiti.import("../extensions/piora-file-changes.ts");
const { writeRuntimePromptSettings } = await jiti.import("./prompt-runtime/settings.ts");

test("file tool guidance is off by default and omits shell prohibitions when enabled", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "piora-file-change-ext-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  const handlers = new Map();
  registerFileChanges({on:(name,handler)=>handlers.set(name,handler)});
  const before = handlers.get("before_agent_start");
  const makeEvent = (selectedTools, hiddenTools) => ({
    systemPrompt: "original",
    systemPromptOptions: { selectedTools, ...(hiddenTools ? { hiddenTools } : {}), appendSystemPrompt: "" },
  });

  // Default OFF: injects nothing.
  const defaultEvent = makeEvent(["read","ls","find","grep","edit","write","bash"]);
  assert.equal(before(defaultEvent), undefined);
  assert.equal(defaultEvent.systemPromptOptions.appendSystemPrompt, "");

  // Enabled compact mode: merges non-conflicting guidance into <piora_runtime> without forbidding rg/cat.
  writeRuntimePromptSettings({ extensions: { fileTools: true, fileReferences: false }, mergeCompact: true }, dir);
  const compactEvent = makeEvent(["read","ls","find","grep","edit","write","bash"]);
  assert.equal(before(compactEvent), undefined);
  const compactText = compactEvent.systemPromptOptions.appendSystemPrompt;
  assert.match(compactText, /<piora_runtime>/);
  assert.match(compactText, /- file_tools:/);
  assert.doesNotMatch(compactText, /instead of (?:cat|shell grep|rg)/i);

  // Expanded mode respects active/hidden tools and avoids prohibitions.
  writeRuntimePromptSettings({ extensions: { fileTools: true }, mergeCompact: false }, dir);
  const full = makeEvent(["read","ls","find","grep","edit","write","bash"]);
  assert.equal(before(full), undefined);
  const expandedText = full.systemPromptOptions.appendSystemPrompt;
  assert.match(expandedText, /<piora_file_tools>/);
  for (const name of ["read","ls","find","grep","edit","write"]) assert.match(expandedText, new RegExp("`" + name + "`"));
  assert.match(expandedText, /Follow explicit user tool choices/);
  assert.doesNotMatch(expandedText, /instead of (?:cat|shell grep|rg)/i);

  const bashOnly = makeEvent(["bash"]);
  assert.equal(before(bashOnly), undefined);
  assert.equal(bashOnly.systemPromptOptions.appendSystemPrompt, "");

  const hiddenRead = makeEvent(["read"], ["read"]);
  assert.equal(before(hiddenRead), undefined);
  assert.equal(hiddenRead.systemPromptOptions.appendSystemPrompt, "");

  const limited = makeEvent(["grep"]);
  before(limited);
  assert.doesNotMatch(limited.systemPromptOptions.appendSystemPrompt, /`read`|`find`|`ls`/);

  const beforeSecond = full.systemPromptOptions.appendSystemPrompt;
  assert.equal(before(full), undefined);
  assert.equal(full.systemPromptOptions.appendSystemPrompt, beforeSecond, "do not duplicate the guidance");
});

test("recognizes edit results and counts unified patch lines", () => {
  const patch = [
    "--- a/components/Card.tsx",
    "+++ b/components/Card.tsx",
    "@@ -1,2 +1,3 @@",
    "-const oldValue = 1;",
    "+const nextValue = 2;",
    "+const label = 'ready';",
    " export default nextValue;",
  ].join("\n");

  assert.deepEqual(countPatchLines(patch), { added: 2, removed: 1 });
  assert.deepEqual(getFileChangeInfo({
    type: "toolCall",
    toolCallId: "edit-1",
    toolName: "edit",
    input: { path: "components/Card.tsx" },
  }, {
    role: "toolResult",
    toolCallId: "edit-1",
    content: [{ type: "text", text: "ok" }],
    details: { patch },
  }), {
    path: "components/Card.tsx",
    patch,
    added: 2,
    removed: 1,
    kind: "updated",
    status: "completed",
  });
});

test("captures a new write as an immutable per-operation patch", async () => {
  const handlers = new Map();
  registerFileChanges({ on: (name, handler) => handlers.set(name, handler) });
  const fileName = `piora-file-change-${process.pid}-${Date.now()}.txt`;
  const path = join(tmpdir(), fileName);
  const input = { path, content: "first line\nsecond line\n" };

  await handlers.get("tool_call")({
    type: "tool_call",
    toolCallId: "write-1",
    toolName: "write",
    input,
  }, { cwd: tmpdir() });
  const transformed = await handlers.get("tool_result")({
    type: "tool_result",
    toolCallId: "write-1",
    toolName: "write",
    input,
    content: [{ type: "text", text: "ok" }],
    isError: false,
    details: undefined,
  });

  assert.equal(transformed.details.path, path);
  assert.equal(transformed.details.changeKind, "created");
  assert.match(transformed.details.patch, /^--- /m);
  assert.match(transformed.details.patch, /^\+first line$/m);
  assert.match(transformed.details.patch, /^\+second line$/m);
});

test("keeps write calls visible while they are still running", () => {
  const info = getFileChangeInfo({
    type: "toolCall",
    toolCallId: "write-running",
    toolName: "write",
    input: { path: "notes.md", content: "hello" },
  });

  assert.equal(info.status, "running");
  assert.equal(info.path, "notes.md");
  assert.equal(info.patch, null);
});
