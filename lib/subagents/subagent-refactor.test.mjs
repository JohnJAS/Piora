import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
  alias: { "@": resolve(import.meta.dirname, "../..") },
});

const { summarizeToolActivity, formatLiveToolActivity } = await jiti.import("./activity-format.ts");
const {
  listSubagentProfilesSafe,
  MAX_CUSTOM_PROFILES_PER_SCOPE,
  saveCustomSubagentProfile,
  saveSubagentProfileWithSettings,
  deleteCustomSubagentProfile,
  serializeSubagentProfileMarkdown,
} = await jiti.import("./profile-manager.ts");
const { SUBAGENT_PROFILE_TEMPLATES } = await jiti.import("./profile-templates.ts");
const { POST: saveProfileRoute, DELETE: deleteProfileRoute } = await jiti.import("../../app/api/settings/subagents/profiles/route.ts");
const { GET: getSettingsRoute } = await jiti.import("../../app/api/settings/subagents/route.ts");
const { GET: getSubagentsRoute } = await jiti.import("../../app/api/agent/[id]/subagents/route.ts");
const { DEFAULT_SUBAGENT_SETTINGS, parseSubagentSettings, readSubagentSettings, writeSubagentSettings, subagentSettingsPath } = await jiti.import("../subagent-settings.ts");
const { SubagentRuntime } = await jiti.import("../subagent-runtime.ts");
const { createSubagentDriver } = await jiti.import("../subagent-driver.ts");
const { readSubagentResult, readSubagentTranscript } = await jiti.import("../subagent-transcript.ts");
const { saveSubagent } = await jiti.import("../subagent-store.ts");
const { MAX_SUBAGENT_RESULT_CHARS, SUBAGENT_RESULT_TRUNCATION_SUFFIX, projectSubagentDetail, subagentProfilePreferenceKey } = await jiti.import("../subagent-types.ts");
const { allowFileRoot } = await jiti.import("../file-access.ts");

async function createSandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "piora-subagent-refactor-"));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  allowFileRoot(projectDir);
  t.after(async () => {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true, force: true });
  });
  return { root, agentDir, projectDir };
}

test("summarizeToolActivity extracts concise bounded summaries for common tools", () => {
  assert.equal(summarizeToolActivity("read", { path: "f:\\Piora\\components\\SubagentInspector.tsx" }), "components/SubagentInspector.tsx");
  assert.equal(summarizeToolActivity("grep", { pattern: "SubagentRuntime", path: "lib/subagent-runtime.ts" }), "\"SubagentRuntime\" · lib/subagent-runtime.ts");
  assert.equal(summarizeToolActivity("bash", { command: "npm test\necho second line" }), "npm test");
  assert.equal(formatLiveToolActivity("read", { filePath: "app/globals.css" }), "read · app/globals.css");
  assert.equal(formatLiveToolActivity("ls", {}), "ls");
  const longCmd = "a".repeat(300);
  assert.ok(formatLiveToolActivity("bash", { command: longCmd }).length <= 140);
});

test("listSubagentProfilesSafe isolates malformed files into warnings without breaking settings", async t => {
  const { projectDir } = await createSandbox(t);
  const projectAgents = join(projectDir, ".piora", "agents");
  await mkdir(projectAgents, { recursive: true });
  await writeFile(join(projectAgents, "broken.md"), "---\nname: Explore\n---\nCannot shadow built-in\n");
  await writeFile(join(projectAgents, "valid.md"), "---\nname: reviewer\ndescription: Code review\ntools: read, grep\nmaxTurns: 12\n---\nInspect changes.\n");

  const { profiles, warnings } = listSubagentProfilesSafe(projectDir);
  assert.ok(profiles.some(p => p.name === "general-purpose"));
  assert.ok(profiles.some(p => p.name === "Explore"));
  assert.ok(profiles.some(p => p.name === "reviewer" && p.source === "project"));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].file, "broken.md");
  assert.equal(warnings[0].scope, "project");

  const res = await getSettingsRoute(new Request(`http://localhost/api/settings/subagents?cwd=${encodeURIComponent(projectDir)}`));
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.hasProjectScope, true);
  assert.equal(payload.warnings.length, 1);
  assert.ok(payload.profiles.some(p => p.name === "reviewer"));
});

test("custom subagent profiles support visual CRUD, rename migration, and built-in protection", async t => {
  const { projectDir, agentDir } = await createSandbox(t);
  writeSubagentSettings({ ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true });

  // Reject built-in shadowing
  assert.throws(() => saveCustomSubagentProfile({
    scope: "user", name: "Explore", description: "bad", systemPrompt: "bad", maxTurns: 10,
  }), /built-in/i);

  // Create project profile via route
  const createRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectDir,
      scope: "project",
      name: "reviewer",
      description: "Review diffs carefully",
      systemPrompt: "Find bugs and edge cases.",
      tools: ["read", "grep", "find", "ls"],
      model: "openai/gpt-5",
      maxTurns: 15,
      background: true,
    }),
  }));
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(created.profile.name, "reviewer");
  assert.equal(created.profile.source, "project");
  assert.equal(created.profile.background, true);
  assert.equal(created.profile.maxTurns, 15);
  assert.deepEqual(created.profile.tools, ["read", "grep", "find", "ls"]);

  // Verify generated Markdown parses cleanly
  const rawMd = await readFile(join(projectDir, ".piora", "agents", "reviewer.md"), "utf8");
  assert.match(rawMd, /name: "reviewer"/);
  assert.match(rawMd, /background: true/);
  assert.match(rawMd, /pioraLimitsVersion: 1/);

  // Persist a model override & disabled flag on reviewer's unique identity key, then rename to code-reviewer
  const reviewerKey = subagentProfilePreferenceKey(created.profile);
  assert.equal(reviewerKey, `id:${created.profile.id}`);
  writeSubagentSettings({
    ...readSubagentSettings(),
    disabledProfiles: [reviewerKey],
    modelOverrides: { [reviewerKey]: "anthropic/claude-sonnet" },
  });
  const renameRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectDir,
      scope: "project",
      previousName: "reviewer",
      name: "code-reviewer",
      description: "Review diffs carefully v2",
      systemPrompt: "Find critical bugs.",
      tools: ["read", "grep"],
      maxTurns: 18,
      background: false,
    }),
  }));
  assert.equal(renameRes.status, 200);
  const renamed = await renameRes.json();
  assert.equal(renamed.profile.id, created.profile.id);
  assert.ok(renamed.profiles.some(p => p.name === "code-reviewer"));
  assert.ok(!renamed.profiles.some(p => p.name === "reviewer"));
  // Renamed profile retains its id-keyed preferences without mutating sibling name keys.
  assert.ok(renamed.settings.disabledProfiles.includes(reviewerKey));
  assert.equal(renamed.settings.modelOverrides[reviewerKey], "anthropic/claude-sonnet");
  assert.equal(Object.hasOwn(renamed.settings.modelOverrides, "code-reviewer"), false);

  // Keep a legacy sibling name preference intact when deleting this unique profile
  writeSubagentSettings({
    ...renamed.settings,
    modelOverrides: { ...renamed.settings.modelOverrides, reviewer: "legacy/shared" },
  });
  const deleteRes = await deleteProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "DELETE",
    body: JSON.stringify({ cwd: projectDir, scope: "project", name: "code-reviewer" }),
  }));
  assert.equal(deleteRes.status, 200);
  const deleted = await deleteRes.json();
  assert.ok(!deleted.profiles.some(p => p.name === "code-reviewer"));
  assert.equal(Object.hasOwn(deleted.settings.modelOverrides, reviewerKey), false);
  assert.equal(deleted.settings.modelOverrides.reviewer, "legacy/shared");

  // Global user scope create + delete directly
  const userProfile = saveCustomSubagentProfile({
    scope: "user",
    name: "helper",
    description: "Global helper: handles chores",
    systemPrompt: "Be helpful.",
    maxTurns: 20,
  });
  assert.equal(userProfile.source, "user");
  const userRaw = await readFile(join(agentDir, "agents", "helper.md"), "utf8");
  assert.match(userRaw, /Global helper: handles chores/);
  assert.equal(deleteCustomSubagentProfile("helper", "user"), true);
  assert.match(serializeSubagentProfileMarkdown({
    name: "demo",
    description: "with: colon",
    systemPrompt: "body",
    maxTurns: 10,
  }), /description: "with: colon"/);
});

test("subagent driver emits live currentTool/currentActivity and clears them when finished", async t => {
  const { projectDir } = await createSandbox(t);
  let listener;
  const snapshots = [];
  const child = {
    inner: { sessionFile: join(projectDir, "child.jsonl"), model: { provider: "mock", id: "m1" } },
    persistSessionFile() {},
    onEvent(fn) { listener = fn; return () => { listener = undefined; }; },
    async send() {
      listener({ type: "tool_execution_start", toolName: "grep", args: { pattern: "SubagentInspector", path: "components/SubagentInspector.tsx" } });
      listener({ type: "tool_execution_end", toolName: "grep" });
      listener({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Found it" }], usage: { totalTokens: 88 } } });
      listener({ type: "prompt_done", aborted: false });
    },
    async shutdownForFileMutation() {},
  };
  const parent = {
    sessionId: "parent-live",
    cwd: projectDir,
    inner: { getActiveToolNames: () => ["grep", "read"], model: { provider: "mock", id: "m1" } },
    isToolAllowedByCapability: () => true,
    notifySubagentChanged(rec) { snapshots.push(projectSubagentDetail(rec)); },
  };
  const driver = createSubagentDriver(parent, async () => ({ session: child, realSessionId: "child-live" }));
  const settings = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  const runtime = new SubagentRuntime("parent-live", projectDir, driver, () => settings);
  const done = await runtime.launch({ description: "Search symbol", prompt: "Find SubagentInspector", subagent_type: "Explore" }, "call-1");
  assert.equal(done.status, "completed");
  assert.equal(done.currentTool, undefined);
  assert.equal(done.currentActivity, undefined);
  assert.ok(snapshots.some(s => s.status === "running" && s.currentTool === "grep" && s.currentActivity?.includes("SubagentInspector")));
  const last = snapshots.at(-1);
  assert.equal(last.status, "completed");
  assert.equal(last.currentTool, undefined);
  assert.equal(last.currentActivity, undefined);
});

test("readSubagentTranscript extracts toolSummary, toolCallId, isError and timestamp", async t => {
  const { agentDir } = await createSandbox(t);
  const folder = join(agentDir, "piora", "subagent-sessions", "parent-tx", "agent-tx");
  await mkdir(folder, { recursive: true });
  const filePath = join(folder, "run.jsonl");
  const lines = [
    JSON.stringify({
      type: "message",
      id: "m1",
      message: {
        role: "assistant",
        timestamp: 1700000001000,
        content: [{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "lib/subagent-runtime.ts" } }],
      },
    }),
    JSON.stringify({
      type: "message",
      id: "m2",
      message: {
        role: "toolResult",
        toolCallId: "tc-1",
        toolName: "read",
        isError: true,
        timestamp: 1700000002000,
        content: [{ type: "text", text: "ENOENT" }],
      },
    }),
  ].join("\n") + "\n";
  await writeFile(filePath, lines);

  const page = await readSubagentTranscript({
    version: 1,
    agentId: "agent-tx",
    parentSessionId: "parent-tx",
    parentToolCallId: "call",
    agentType: "Explore",
    description: "Inspect",
    prompt: "p",
    childSessionFile: filePath,
    status: "completed",
    background: false,
    startedAt: 1000,
    result: "",
    totalTokens: 1,
    totalToolUseCount: 1,
  }, null, new AbortController().signal);

  assert.equal(page.entries.length, 2);
  assert.equal(page.entries[0].role, "toolCall");
  assert.equal(page.entries[0].toolName, "read");
  assert.equal(page.entries[0].toolSummary, "lib/subagent-runtime.ts");
  assert.equal(page.entries[0].toolCallId, "tc-1");
  assert.equal(page.entries[0].timestamp, 1700000001000);
  assert.equal(page.entries[1].role, "toolResult");
  assert.equal(page.entries[1].isError, true);
  assert.equal(page.entries[1].toolCallId, "tc-1");
});

test("all built-in profile templates including frontend-ui and harmony-adapter validate and save cleanly", async t => {
  const { projectDir } = await createSandbox(t);
  const ids = SUBAGENT_PROFILE_TEMPLATES.map(item => item.id);
  assert.ok(ids.includes("frontend-ui"));
  assert.ok(ids.includes("harmony-adapter"));
  for (const template of SUBAGENT_PROFILE_TEMPLATES) {
    const saved = saveCustomSubagentProfile({
      scope: "project",
      name: template.name,
      description: template.descriptionZh,
      systemPrompt: template.systemPrompt,
      tools: template.tools,
      maxTurns: template.maxTurns,
      background: template.background,
    }, projectDir);
    assert.equal(saved.name, template.name);
    assert.equal(saved.source, "project");
    assert.equal(saved.maxTurns, template.maxTurns);
  }
  const { profiles, warnings } = listSubagentProfilesSafe(projectDir);
  assert.deepEqual(warnings, []);
  for (const template of SUBAGENT_PROFILE_TEMPLATES) {
    assert.ok(profiles.some(profile => profile.name === template.name && profile.source === "project"));
  }
});

test("R1: beta.26 three-field settings load with 200 while explicit malformed fields still fail", async t => {
  await createSandbox(t);
  await mkdir(dirname(subagentSettingsPath()), { recursive: true });
  await writeFile(subagentSettingsPath(), JSON.stringify({
    enabled: true,
    disabledProfiles: ["Explore"],
    modelOverrides: { "general-purpose": "openai/gpt-5" },
  }));
  const res = await getSettingsRoute(new Request("http://localhost/api/settings/subagents"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.settings.enabled, true);
  assert.deepEqual(data.settings.disabledProfiles, ["Explore"]);
  assert.equal(data.settings.modelOverrides["general-purpose"], "openai/gpt-5");
  assert.equal(data.settings.maxConcurrency, 4);
  assert.equal(data.settings.maxTokens, 0);
  assert.throws(() => parseSubagentSettings({ enabled: true, maxConcurrency: 0, disabledProfiles: [], modelOverrides: {} }));
  assert.throws(() => parseSubagentSettings({ enabled: true, maxTokens: -1, disabledProfiles: [], modelOverrides: {} }));
});

test("R2 & R6: YAML special scalars (@team, 001), disallowedTools and explicit tools:[] round-trip without corrupting disk", async t => {
  const { projectDir } = await createSandbox(t);
  const saved = saveCustomSubagentProfile({
    scope: "project",
    name: "001",
    description: "@team: review safely",
    systemPrompt: "No tools allowed.",
    tools: [],
    disallowedTools: ["bash", "write"],
    maxTurns: 12,
  }, projectDir);
  assert.equal(saved.name, "001");
  assert.equal(saved.description, "@team: review safely");
  assert.deepEqual(saved.tools, []);
  assert.deepEqual(saved.disallowedTools, ["bash", "write"]);

  const { profiles, warnings } = listSubagentProfilesSafe(projectDir);
  assert.deepEqual(warnings, []);
  const reloaded = profiles.find(p => p.name === "001");
  assert.ok(reloaded);
  assert.equal(reloaded.description, "@team: review safely");
  assert.deepEqual(reloaded.tools, []);
  assert.deepEqual(reloaded.disallowedTools, ["bash", "write"]);

  // Failed save (e.g., invalid model) must not overwrite existing file
  const beforeMd = await readFile(join(projectDir, ".piora", "agents", "001.md"), "utf8");
  assert.throws(() => saveCustomSubagentProfile({
    scope: "project",
    previousName: "001",
    name: "001",
    description: "updated",
    systemPrompt: "body",
    model: "invalid-model-without-slash",
    maxTurns: 10,
  }, projectDir));
  const afterMd = await readFile(join(projectDir, ".piora", "agents", "001.md"), "utf8");
  assert.equal(afterMd, beforeMd);
});

test("R3: a malformed custom .md file does not prevent built-in Explore or valid custom profiles from running", async t => {
  const { projectDir } = await createSandbox(t);
  const projectAgents = join(projectDir, ".piora", "agents");
  await mkdir(projectAgents, { recursive: true });
  await writeFile(join(projectAgents, "bad.md"), "---\nname: broken\npioraLimitsVersion: 1\nmaxTurns: 999\n---\nBroken\n");
  let runs = 0;
  const settings = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  const runtime = new SubagentRuntime("parent-r3", projectDir, {
    async run() { runs++; return "EXPLORE_OK"; },
    async notify() {},
  }, () => settings);
  const result = await runtime.launch({ description: "Explore", prompt: "Inspect repo", subagent_type: "Explore" }, "tc-r3");
  assert.equal(result.status, "completed");
  assert.equal(result.result, "EXPLORE_OK");
  assert.equal(runs, 1);
});

test("R4: default settings (maxTokens=0) allow new subagents even after 200k+ historical tokens", async t => {
  const { projectDir } = await createSandbox(t);
  saveSubagent({
    version: 1,
    agentId: "historic_heavy",
    parentSessionId: "parent-r4",
    parentToolCallId: "tc-old",
    agentType: "Explore",
    description: "Old heavy task",
    prompt: "old",
    status: "completed",
    background: false,
    startedAt: 1000,
    endedAt: 2000,
    result: "done",
    totalTokens: 250_000,
    totalToolUseCount: 5,
  });
  const settings = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  const runtime = new SubagentRuntime("parent-r4", projectDir, {
    async run(_rec, _prof, _sig, progress) { progress(120, 1); return "NEW_TASK_OK"; },
    async notify() {},
  }, () => settings);
  const result = await runtime.launch({ description: "Short follow-up", prompt: "Quick check" }, "tc-new");
  assert.equal(result.status, "completed");
  assert.equal(result.result, "NEW_TASK_OK");
});

test("R5: fullResult=true recovers both 12,000-char stored results and suffix-truncated transcript results", async t => {
  const { agentDir, root } = await createSandbox(t);
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { cacheSessionPath } = await jiti.import("../session-reader.ts");
  const { persistLazySessionManager } = await jiti.import("../session-persistence.ts");
  const parentSession = SessionManager.create(root);
  parentSession.appendMessage({ role: "user", content: "hi", timestamp: 1 });
  persistLazySessionManager(parentSession);
  const parentId = parentSession.getSessionId();
  cacheSessionPath(parentId, parentSession.getSessionFile());

  const tailMarker = "END_MARKER_12000";
  const longText = "A".repeat(12_000) + tailMarker;
  // Case 1: 12,000-char result stored verbatim (e.g. maxResultChars=16000)
  saveSubagent({
    version: 1,
    agentId: "agent_long_direct",
    parentSessionId: parentId,
    parentToolCallId: "tc-1",
    agentType: "Explore",
    description: "Long direct result",
    prompt: "p",
    status: "completed",
    background: false,
    startedAt: 1000,
    endedAt: 2000,
    result: longText,
    totalTokens: 100,
    totalToolUseCount: 1,
  });
  const detailProjected = projectSubagentDetail({
    agentId: "agent_long_direct", parentSessionId: parentId, parentToolCallId: "tc-1",
    agentType: "Explore", description: "Long direct result", status: "completed", background: false,
    startedAt: 1000, endedAt: 2000, result: longText, totalTokens: 100, totalToolUseCount: 1,
  });
  assert.equal(detailProjected.result.length, MAX_SUBAGENT_RESULT_CHARS);
  assert.equal(detailProjected.resultTruncated, true);

  const directRes = await getSubagentsRoute(
    new Request(`http://localhost/api/agent/${parentId}/subagents?agentId=agent_long_direct&fullResult=true`),
    { params: Promise.resolve({ id: parentId }) },
  );
  assert.equal(directRes.status, 200);
  const directJson = await directRes.json();
  assert.equal(directJson.fullResult, longText);
  assert.ok(directJson.fullResult.endsWith(tailMarker));

  // Case 2: 8,000-char suffix-truncated record recovering full 12,000-char reply from child transcript
  const childDir = join(agentDir, "piora", "subagent-sessions", parentId, "agent_long_tx");
  await mkdir(childDir, { recursive: true });
  const childFile = join(childDir, "child.jsonl");
  await writeFile(childFile, JSON.stringify({
    type: "message",
    id: "final-1",
    timestamp: new Date(1500).toISOString(),
    message: { role: "assistant", content: [{ type: "text", text: longText }] },
  }) + "\n");
  const truncatedRecord = {
    version: 1,
    agentId: "agent_long_tx",
    parentSessionId: parentId,
    parentToolCallId: "tc-2",
    agentType: "Explore",
    description: "Truncated transcript result",
    prompt: "p",
    childSessionFile: childFile,
    status: "completed",
    background: false,
    startedAt: 1000,
    endedAt: 2000,
    result: longText.slice(0, MAX_SUBAGENT_RESULT_CHARS - SUBAGENT_RESULT_TRUNCATION_SUFFIX.length) + SUBAGENT_RESULT_TRUNCATION_SUFFIX,
    totalTokens: 100,
    totalToolUseCount: 1,
  };
  saveSubagent(truncatedRecord);
  assert.equal(await readSubagentResult(truncatedRecord, new AbortController().signal), longText);
  const txRes = await getSubagentsRoute(
    new Request(`http://localhost/api/agent/${parentId}/subagents?agentId=agent_long_tx&fullResult=true`),
    { params: Promise.resolve({ id: parentId }) },
  );
  assert.equal(txRes.status, 200);
  const txJson = await txRes.json();
  assert.equal(txJson.fullResult, longText);
  assert.equal(txJson.records[0].resultTruncated, true);
});

test("R8: continuing a saved child succeeds after renaming its custom profile and respects disabled policy", async t => {
  const { projectDir } = await createSandbox(t);
  saveCustomSubagentProfile({
    scope: "project",
    name: "reader",
    description: "Read files",
    systemPrompt: "Read carefully.",
    tools: ["read", "grep"],
    maxTurns: 10,
  }, projectDir);
  let calls = 0;
  let lastProfile = null;
  let settings = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  const runtime = new SubagentRuntime("parent-r8", projectDir, {
    async run(record, profile) {
      calls++;
      lastProfile = profile;
      record.childSessionFile ??= "saved.jsonl";
      return `RUN_${calls}:${profile.name}`;
    },
    async notify() {},
  }, () => settings);

  const first = await runtime.launch({ description: "First", prompt: "Inspect", subagent_type: "reader" }, "tc-1");
  assert.equal(first.status, "completed");

  // Rename reader -> reader-v2 with tightened tools
  saveCustomSubagentProfile({
    scope: "project",
    previousName: "reader",
    name: "reader-v2",
    description: "Read files v2",
    systemPrompt: "Read carefully v2.",
    tools: ["read"],
    maxTurns: 15,
  }, projectDir);

  const second = await runtime.continue(first.agentId, "Follow up after rename");
  assert.equal(second.status, "completed");
  assert.equal(second.agentType, "reader-v2");
  assert.equal(calls, 2);
  assert.deepEqual(lastProfile.tools, ["read"]);

  // Disabling the renamed profile must block further continuation
  settings = { ...settings, disabledProfiles: [subagentProfilePreferenceKey(lastProfile)] };
  await assert.rejects(runtime.continue(first.agentId, "Blocked when disabled"), /disabled/i);
});

test("R10: parallel tools keep active activity until all finish, and mixed assistant+multi-toolCall JSONL keeps every call", async t => {
  const { agentDir, projectDir } = await createSandbox(t);
  let listener;
  const activities = [];
  const child = {
    inner: { sessionFile: join(projectDir, "child.jsonl"), model: { provider: "mock", id: "m1" } },
    persistSessionFile() {},
    onEvent(fn) { listener = fn; return () => { listener = undefined; }; },
    async send() {
      listener({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "a.ts" } });
      listener({ type: "tool_execution_start", toolCallId: "c2", toolName: "ls", args: { path: "lib" } });
      listener({ type: "tool_execution_end", toolCallId: "c1", toolName: "read" });
      listener({ type: "tool_execution_end", toolCallId: "c2", toolName: "ls" });
      listener({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], usage: { totalTokens: 20 } } });
      listener({ type: "prompt_done", aborted: false });
    },
    async shutdownForFileMutation() {},
  };
  const parent = {
    sessionId: "parent-r10",
    cwd: projectDir,
    inner: { getActiveToolNames: () => ["read", "ls"], model: { provider: "mock", id: "m1" } },
    isToolAllowedByCapability: () => true,
    notifySubagentChanged(rec) { activities.push({ tool: rec.currentTool, activity: rec.currentActivity, status: rec.status }); },
  };
  const driver = createSubagentDriver(parent, async () => ({ session: child, realSessionId: "child-r10" }));
  const settings = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  const runtime = new SubagentRuntime("parent-r10", projectDir, driver, () => settings);
  await runtime.launch({ description: "Parallel tools", prompt: "Run both", subagent_type: "Explore" }, "tc-r10");

  // After read ends while ls is still active, currentTool must still be "ls" (not undefined!)
  const afterReadEndIdx = activities.findIndex(a => a.activity?.includes("(+1)"));
  assert.ok(afterReadEndIdx >= 0, "should report concurrent tools");
  assert.equal(activities[afterReadEndIdx + 1].tool, "ls", "remaining parallel tool must stay visible after first ends");
  assert.equal(activities[afterReadEndIdx + 2].tool, undefined, "clears only once all parallel tools finish");

  // Mixed assistant text + 2 toolCalls in one JSONL entry
  const folder = join(agentDir, "piora", "subagent-sessions", "parent-r10", "agent-mixed");
  await mkdir(folder, { recursive: true });
  const filePath = join(folder, "mixed.jsonl");
  await writeFile(filePath, JSON.stringify({
    type: "message",
    id: "mixed-1",
    message: {
      role: "assistant",
      timestamp: 1700000003000,
      content: [
        { type: "text", text: "Let me check two files." },
        { type: "toolCall", id: "call-read", name: "read", arguments: { path: "src/a.ts" } },
        { type: "toolCall", id: "call-ls", name: "ls", arguments: { path: "src" } },
      ],
    },
  }) + "\n");
  const page = await readSubagentTranscript({
    version: 1, agentId: "agent-mixed", parentSessionId: "parent-r10", parentToolCallId: "tc",
    agentType: "Explore", description: "Mixed", prompt: "p", childSessionFile: filePath,
    status: "completed", background: false, startedAt: 1000, result: "", totalTokens: 1, totalToolUseCount: 2,
  }, null, new AbortController().signal);
  assert.equal(page.entries.length, 3);
  assert.equal(page.entries[0].role, "assistant");
  assert.equal(page.entries[0].text, "Let me check two files.");
  assert.equal(page.entries[1].role, "toolCall");
  assert.equal(page.entries[1].toolCallId, "call-read");
  assert.equal(page.entries[2].role, "toolCall");
  assert.equal(page.entries[2].toolCallId, "call-ls");
});

test("N1: saved profileId takes precedence over reused display name and fails cleanly when deleted", async t => {
  const { projectDir } = await createSandbox(t);
  const original = saveCustomSubagentProfile({
    scope: "project",
    name: "reader",
    description: "Original reader",
    systemPrompt: "ROLE_ORIGINAL",
    tools: ["read"],
  }, projectDir);
  const settings = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  let seenProfile;
  const runtime = new SubagentRuntime("parent-n1-unit", projectDir, {
    async run(record, profile) {
      seenProfile = profile;
      record.childSessionFile ??= "child.jsonl";
      return "OK";
    },
    async notify() {},
  }, () => settings);

  const first = await runtime.launch({ description: "Task", prompt: "Inspect", subagent_type: "reader" }, "tc-1");
  assert.equal(first.profileId, original.id);
  assert.equal(seenProfile.systemPrompt, "ROLE_ORIGINAL");

  const renamed = saveCustomSubagentProfile({
    scope: "project",
    previousName: "reader",
    name: "reader-v2",
    description: "Renamed reader",
    systemPrompt: "ROLE_RENAMED",
    tools: ["read", "grep"],
  }, projectDir);
  assert.equal(renamed.id, original.id);

  const recycled = saveCustomSubagentProfile({
    scope: "project",
    name: "reader",
    description: "Recycled reader",
    systemPrompt: "ROLE_RECYCLED",
    tools: ["bash"],
  }, projectDir);
  assert.notEqual(recycled.id, original.id);

  const second = await runtime.continue(first.agentId, "Follow up");
  assert.equal(second.profileId, original.id);
  assert.equal(second.agentType, "reader-v2");
  assert.equal(seenProfile.systemPrompt, "ROLE_RENAMED");

  // Deleting original ID throws a clear unavailable error even though a profile named `reader` exists.
  deleteCustomSubagentProfile("reader-v2", "project", projectDir);
  await assert.rejects(runtime.continue(first.agentId, "Follow up again"), /no longer available/i);
});

test("N2: beta.26 settings upgrade keeps unlimited timeout and unlimited turns while explicit limits enforce", async t => {
  const { agentDir, projectDir } = await createSandbox(t);
  await mkdir(dirname(subagentSettingsPath()), { recursive: true });
  await writeFile(subagentSettingsPath(), JSON.stringify({
    enabled: true,
    disabledProfiles: [],
    modelOverrides: {},
  }));
  const settings = readSubagentSettings();
  assert.equal(settings.timeoutSeconds, 0);

  // Use simulated clock past 300,000 ms on background task with default timeoutSeconds=0.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let settleRun;
    const runtime = new SubagentRuntime("parent-n2-clock", projectDir, {
      run() { return new Promise(resolve => { settleRun = resolve; }); },
      async notify() {},
    }, () => settings);

    const running = await runtime.launch({ description: "Long task", prompt: "Work slowly", run_in_background: true }, "tc-n2-bg");
    t.mock.timers.tick(305_000);
    await Promise.resolve();
    assert.equal(runtime.get(running.agentId).status, "running", "beta.26 upgrade must not abort after 300s");
    settleRun("LONG_TASK_COMPLETED");
    const completed = await runtime.output(running.agentId, true);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result, "LONG_TASK_COMPLETED");

    // Explicit positive timeout must abort when reached.
    const timedRuntime = new SubagentRuntime("parent-n2-timed", projectDir, {
      run(_r, _p, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      async notify() {},
    }, () => ({ ...settings, timeoutSeconds: 5 }));
    const timedPromise = timedRuntime.launch({ description: "Timed", prompt: "Wait" }, "tc-n2-timed");
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(5_000);
    const timed = await timedPromise;
    assert.equal(timed.status, "failed");
    assert.match(timed.error, /timed out/i);
  } finally {
    t.mock.timers.reset();
  }

  // Explore past 20 turns & general-purpose past 30 turns complete when unlimited; explicit maxTurns=3 aborts at turn 3.
  const runTurns = async (profile, turnCount) => {
    let listener;
    const child = {
      inner: { sessionFile: join(agentDir, `child-${profile.name}-${turnCount}.jsonl`), model: { provider: "mock", id: "m" } },
      persistSessionFile() {},
      onEvent(fn) { listener = fn; return () => { listener = undefined; }; },
      async send(cmd) {
        if (cmd.type === "abort") return;
        for (let i = 1; i <= turnCount; i++) {
          listener?.({ type: "turn_end", toolResults: [{ toolCallId: `t${i}` }] });
          await Promise.resolve();
        }
        listener?.({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `FINISHED_${turnCount}` }] } });
        listener?.({ type: "prompt_done", aborted: false });
      },
      async shutdownForFileMutation() {},
    };
    const parent = {
      sessionId: "parent-n2-turns",
      cwd: projectDir,
      inner: { getActiveToolNames: () => ["read"], model: { provider: "mock", id: "m" } },
      isToolAllowedByCapability: () => true,
    };
    const driver = createSubagentDriver(parent, async () => ({ session: child, realSessionId: `child-${turnCount}` }));
    return driver.run(
      { version: 1, agentId: `ag-${turnCount}`, parentSessionId: "parent-n2-turns", parentToolCallId: "tc", agentType: profile.name, description: "turns", prompt: "go", status: "running", background: false, startedAt: Date.now(), result: "", totalTokens: 0, totalToolUseCount: 0 },
      profile,
      new AbortController().signal,
      () => {},
    );
  };

  const { profiles } = listSubagentProfilesSafe(projectDir);
  const explore = profiles.find(p => p.name === "Explore");
  const general = profiles.find(p => p.name === "general-purpose");
  assert.equal(explore.maxTurns, undefined);
  assert.equal(general.maxTurns, undefined);
  assert.equal(await runTurns(explore, 20), "FINISHED_20");
  assert.equal(await runTurns(general, 30), "FINISHED_30");
  await assert.rejects(runTurns({ ...general, maxTurns: 3 }, 3), /turn limit/i);
});

test("N3: project profile rename, delete, or recreate never alters sibling project or user model overrides", async t => {
  const { root, agentDir } = await createSandbox(t);
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  await mkdir(join(projectA, ".piora", "agents"), { recursive: true });
  await mkdir(join(projectB, ".piora", "agents"), { recursive: true });
  allowFileRoot(projectA);
  allowFileRoot(projectB);
  writeSubagentSettings({ ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true });

  const alphaRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectA,
      scope: "project",
      name: "audit-alpha",
      description: "Project A alpha",
      systemPrompt: "Audit A",
      model: "fixture/a",
    }),
  }));
  assert.equal(alphaRes.status, 200);
  const alphaProfile = (await alphaRes.json()).profile;

  const betaBRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectB,
      scope: "project",
      name: "inspector-beta",
      description: "Project B beta",
      systemPrompt: "Inspect B",
      model: "fixture/b",
    }),
  }));
  assert.equal(betaBRes.status, 200);

  // User scope profile with the same name
  saveCustomSubagentProfile({
    scope: "user",
    name: "inspector-beta",
    description: "User beta",
    systemPrompt: "Inspect user",
    model: "fixture/user",
  });

  // Set model override + disable strictly on Project A's profile ID
  const keyA = subagentProfilePreferenceKey(alphaProfile);
  writeSubagentSettings({
    ...readSubagentSettings(),
    disabledProfiles: [keyA],
    modelOverrides: { [keyA]: "fixture/override-a" },
  });

  // Rename Project A's `audit-alpha` -> `inspector-beta` (collides in name with Project B and User)
  const renamedRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectA,
      scope: "project",
      previousName: "audit-alpha",
      name: "inspector-beta",
      description: "Project A renamed beta",
      systemPrompt: "Audit A v2",
      model: "fixture/a",
    }),
  }));
  assert.equal(renamedRes.status, 200);

  // Project B launches its `inspector-beta` and must still use `fixture/b` and remain enabled.
  let seenB;
  const runtimeB = new SubagentRuntime("parent-b", projectB, {
    async run(_r, prof) { seenB = prof; return "B_OK"; },
    async notify() {},
  });
  await runtimeB.launch({ description: "Check B", prompt: "Inspect B", subagent_type: "inspector-beta" }, "tc-b1");
  assert.equal(seenB.model, "fixture/b");

  // Delete & recreate in Project A still preserves B's model and enabled state.
  await deleteProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "DELETE",
    body: JSON.stringify({ cwd: projectA, scope: "project", name: "inspector-beta" }),
  }));
  await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectA,
      scope: "project",
      name: "inspector-beta",
      description: "Recreated A",
      systemPrompt: "Recreated A",
      model: "fixture/a-new",
    }),
  }));
  await runtimeB.launch({ description: "Check B after delete", prompt: "Inspect B2", subagent_type: "inspector-beta" }, "tc-b2");
  assert.equal(seenB.model, "fixture/b");

  const { profiles: userOnlyProfiles } = listSubagentProfilesSafe();
  assert.equal(userOnlyProfiles.find(p => p.name === "inspector-beta")?.model, "fixture/user");
  assert.ok(agentDir);
});

test("N4: rename validates settings limits before disk mutation and rolls back on settings write failure", async t => {
  const { projectDir } = await createSandbox(t);
  const agentsDir = join(projectDir, ".piora", "agents");
  await mkdir(agentsDir, { recursive: true });

  // Hand-written legacy profile (no id) with a name-keyed override that would need migration onto `id:<uuid>`
  const legacyPath = join(agentsDir, "legacy-one.md");
  await writeFile(legacyPath, "---\nname: legacy-one\ndescription: Legacy\n---\nLegacy body\n");
  const legacy2Path = join(agentsDir, "legacy-two.md");
  await writeFile(legacy2Path, "---\nname: legacy-two\ndescription: Legacy 2\n---\nLegacy body 2\n");

  const makeOverrides = count => Object.fromEntries(
    Array.from({ length: count }, (_, idx) => [
      idx === 0 ? "legacy-one" : idx === 1 ? "legacy-two" : `item-${idx}`,
      "fixture/m1",
    ]),
  );

  // 199 entries -> migrating legacy-one succeeds cleanly (reaches 200 entries)
  writeSubagentSettings({ ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true, modelOverrides: makeOverrides(199) });
  const okRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectDir,
      scope: "project",
      previousName: "legacy-one",
      name: "legacy-one-v2",
      description: "Legacy v2",
      systemPrompt: "Legacy body",
    }),
  }));
  assert.equal(okRes.status, 200);
  assert.equal(Object.keys((await okRes.json()).settings.modelOverrides).length, 200);

  // Now at 200 entries: renaming legacy-two would add entry #201 -> must fail 400 with ZERO disk changes
  const legacy2Before = await readFile(legacy2Path, "utf8");
  const settingsBefore = readSubagentSettings();
  const payload = {
    cwd: projectDir,
    scope: "project",
    previousName: "legacy-two",
    name: "legacy-two-v2",
    description: "Legacy 2 v2",
    systemPrompt: "Legacy body 2",
  };
  const failRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  }));
  assert.equal(failRes.status, 400);
  assert.equal(await readFile(legacy2Path, "utf8"), legacy2Before, "old file must remain untouched after 400");
  assert.equal(await readFile(join(agentsDir, "legacy-two-v2.md"), "utf8").catch(() => null), null, "new file must not exist after 400");
  assert.deepEqual(readSubagentSettings(), settingsBefore);

  // Exact same retry sees the exact same consistent error (never 'no longer exists')
  const retryRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  }));
  assert.equal(retryRes.status, 400);
  assert.match((await retryRes.json()).error, /200|provider/i);

  // Simulate settings write failure on 199-entry store: new file must roll back & old file must remain intact
  writeSubagentSettings({ ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true, modelOverrides: makeOverrides(199).item ? {} : { "legacy-two": "fixture/m1" } });
  assert.throws(() => saveSubagentProfileWithSettings(payload, projectDir, {
    readSettings: readSubagentSettings,
    writeSettings() { throw new Error("Simulated EACCES writing settings"); },
  }), /Simulated EACCES/);
  assert.equal(await readFile(legacy2Path, "utf8"), legacy2Before);
  assert.equal(await readFile(join(agentsDir, "legacy-two-v2.md"), "utf8").catch(() => null), null);
});

test("N5 & N7: small maxResultChars and incomplete attempt-2 tail never leak attempt-1 text", async t => {
  const { agentDir, root } = await createSandbox(t);
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { cacheSessionPath } = await jiti.import("../session-reader.ts");
  const { persistLazySessionManager } = await jiti.import("../session-persistence.ts");
  const parentSession = SessionManager.create(root);
  parentSession.appendMessage({ role: "user", content: "hi", timestamp: 1 });
  persistLazySessionManager(parentSession);
  const parentId = parentSession.getSessionId();
  cacheSessionPath(parentId, parentSession.getSessionFile());

  // N5: Two attempts share identical 8,500-char prefix; attempt 2 trailing line is partial/incomplete.
  const sharedPrefix = "SHARED_HEAD_".repeat(750); // 9,000 chars (> 8,000)
  const attempt1Full = `${sharedPrefix}FROM_ATTEMPT_1`;
  const attempt2Full = `${sharedPrefix}FROM_ATTEMPT_2`;
  const childDir = join(agentDir, "piora", "subagent-sessions", parentId, "agent_n5");
  await mkdir(childDir, { recursive: true });
  const childFile = join(childDir, "child.jsonl");
  const attempt1Jsonl = [
    JSON.stringify({ type: "message", id: "u1", timestamp: new Date(1000).toISOString(), message: { role: "user", content: [{ type: "text", text: "turn 1" }] } }),
    JSON.stringify({ type: "message", id: "a1", timestamp: new Date(1500).toISOString(), message: { role: "assistant", content: [{ type: "text", text: attempt1Full }] } }),
    JSON.stringify({ type: "message", id: "u2", timestamp: new Date(2000).toISOString(), message: { role: "user", content: [{ type: "text", text: "turn 2" }] } }),
  ].join("\n") + "\n";
  const incompleteAttempt2Line = JSON.stringify({
    type: "message",
    id: "a2",
    timestamp: new Date(2500).toISOString(),
    message: { role: "assistant", content: [{ type: "text", text: attempt2Full }] },
  }); // missing trailing newline (incomplete flush)

  await writeFile(childFile, attempt1Jsonl + incompleteAttempt2Line);
  const recN5 = {
    version: 1,
    agentId: "agent_n5",
    parentSessionId: parentId,
    parentToolCallId: "tc-n5",
    agentType: "Explore",
    description: "Two attempts",
    prompt: "turn 2",
    childSessionFile: childFile,
    status: "completed",
    background: false,
    startedAt: 1000,
    attemptStartedAt: 2000,
    endedAt: 3000,
    attempt: 2,
    result: attempt2Full.slice(0, MAX_SUBAGENT_RESULT_CHARS - SUBAGENT_RESULT_TRUNCATION_SUFFIX.length) + SUBAGENT_RESULT_TRUNCATION_SUFFIX,
    resultTruncated: true,
    resultFullLength: attempt2Full.length,
    totalTokens: 200,
    totalToolUseCount: 1,
  };
  saveSubagent(recN5);

  const partialRes = await getSubagentsRoute(
    new Request(`http://localhost/api/agent/${parentId}/subagents?agentId=agent_n5&fullResult=true`),
    { params: Promise.resolve({ id: parentId }) },
  );
  assert.equal(partialRes.status, 200);
  const partialJson = await partialRes.json();
  assert.equal(partialJson.fullResult, null, "incomplete attempt 2 line must return null, never FROM_ATTEMPT_1");

  // Finish writing the complete attempt-2 line and re-query
  await writeFile(childFile, attempt1Jsonl + incompleteAttempt2Line + "\n");
  const completeRes = await getSubagentsRoute(
    new Request(`http://localhost/api/agent/${parentId}/subagents?agentId=agent_n5&fullResult=true`),
    { params: Promise.resolve({ id: parentId }) },
  );
  assert.equal(completeRes.status, 200);
  const completeJson = await completeRes.json();
  assert.equal(completeJson.fullResult, attempt2Full);

  // N7: Legal tiny maxResultChars (1, 16, suffixLen, suffixLen+1, 8000) still set resultTruncated: true and recover tail via route
  const tailMarker = "N7_TRUE_TAIL_END";
  const full12k = "B".repeat(12_000) + tailMarker;
  const n7Entry = JSON.stringify({
    type: "message",
    id: "n7-a1",
    timestamp: new Date(5000).toISOString(),
    message: { role: "assistant", content: [{ type: "text", text: full12k }] },
  }) + "\n";

  for (const limit of [1, 16, SUBAGENT_RESULT_TRUNCATION_SUFFIX.length, SUBAGENT_RESULT_TRUNCATION_SUFFIX.length + 1, 8_000]) {
    const rt = new SubagentRuntime(parentId, root, {
      async run(rec) {
        const childDir = join(agentDir, "piora", "subagent-sessions", parentId, rec.agentId);
        await mkdir(childDir, { recursive: true });
        rec.childSessionFile = join(childDir, "runs.jsonl");
        await writeFile(rec.childSessionFile, n7Entry);
        rec.resultEntryId = "n7-a1";
        return full12k;
      },
      async notify() {},
    }, () => ({ ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true, maxResultChars: limit }));
    const runRec = await rt.launch({ description: `Limit ${limit}`, prompt: "go" }, `tc-n7-${limit}`);
    assert.equal(runRec.resultTruncated, true, `limit ${limit} must flag resultTruncated`);
    assert.equal(runRec.result.length, limit);
    const detail = projectSubagentDetail(runRec);
    assert.equal(detail.resultTruncated, true);

    // Clear live runtime so GET hits saved disk record just like post-restart
    const res = await getSubagentsRoute(
      new Request(`http://localhost/api/agent/${parentId}/subagents?agentId=${runRec.agentId}&fullResult=true`),
      { params: Promise.resolve({ id: parentId }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.records[0].resultTruncated, true);
    assert.equal(body.fullResult, full12k, `limit ${limit} must recover full tail via fullResult=true`);
  }
});

test("N8: transcript pagination enforces 50-entry & 96 KiB budgets inside huge multi-tool lines and advances cursor cleanly", async t => {
  const { agentDir } = await createSandbox(t);
  const folder = join(agentDir, "piora", "subagent-sessions", "parent-n8", "agent-n8");
  await mkdir(folder, { recursive: true });
  const filePath = join(folder, "multi.jsonl");

  const makeMultiToolLine = (id, count, argPad = "a.ts") => JSON.stringify({
    type: "message",
    id,
    message: {
      role: "assistant",
      content: Array.from({ length: count }, (_, idx) => ({
        type: "toolCall",
        id: `${id}-tc-${idx}`,
        name: "read",
        arguments: { path: `${idx}-${argPad}` },
      })),
    },
  }) + "\n";

  // Case A: Single message with 51 tool calls must return 50 on page 1 and 1 on page 2.
  const earlierLine = JSON.stringify({
    type: "message",
    id: "earlier-msg",
    message: { role: "user", content: [{ type: "text", text: "Earlier task" }] },
  }) + "\n";
  await writeFile(filePath, earlierLine + makeMultiToolLine("m51", 51));
  const rec = {
    version: 1,
    agentId: "agent-n8",
    parentSessionId: "parent-n8",
    parentToolCallId: "tc",
    agentType: "Explore",
    description: "N8",
    prompt: "p",
    childSessionFile: filePath,
    status: "completed",
    background: false,
    startedAt: 1000,
    result: "",
    totalTokens: 1,
    totalToolUseCount: 51,
  };
  const page1 = await readSubagentTranscript(rec, null, new AbortController().signal);
  assert.equal(page1.entries.length, 50, "first page must never exceed 50 entries");
  assert.ok(page1.before);
  const page2 = await readSubagentTranscript(rec, page1.before, new AbortController().signal);
  assert.equal(page2.entries.length, 2, "remaining 1 tool call + earlier-msg");
  assert.equal(page2.entries[0].id, "earlier-msg");
  assert.equal(page2.before, null);

  // Case B: 800 short tool calls (< 128 KiB raw line, > 96 KiB projected) must paginate smoothly without empty pages or stalled cursors.
  const bigLine = makeMultiToolLine("m800", 800, "x".repeat(40));
  assert.ok(Buffer.byteLength(bigLine, "utf8") < 128 * 1024);
  await writeFile(filePath, earlierLine + bigLine);

  const collected = [];
  const seenCursors = new Set();
  let before = null;
  for (let iter = 0; iter < 50; iter++) {
    const page = await readSubagentTranscript(rec, before, new AbortController().signal);
    assert.ok(page.entries.length > 0 && page.entries.length <= 50, `page ${iter} length ${page.entries.length} out of bounds`);
    assert.ok(Buffer.byteLength(JSON.stringify(page.entries), "utf8") <= 96 * 1024, "page byte size must stay within 96 KiB");
    collected.unshift(...page.entries);
    if (!page.before) {
      before = null;
      break;
    }
    assert.equal(seenCursors.has(page.before), false, "cursor must advance strictly on every page");
    seenCursors.add(page.before);
    before = page.before;
  }
  assert.equal(before, null);
  assert.equal(collected[0].id, "earlier-msg", "pagination must reach the earlier normal message");
  assert.equal(collected.length, 801);
});

test("N9: creating a 101st custom profile in a scope fails with 400 and does not write an invisible file", async t => {
  const { projectDir } = await createSandbox(t);
  const agentsDir = join(projectDir, ".piora", "agents");
  await mkdir(agentsDir, { recursive: true });
  for (let i = 0; i < MAX_CUSTOM_PROFILES_PER_SCOPE; i++) {
    const id = `agent-${String(i).padStart(3, "0")}`;
    await writeFile(join(agentsDir, `${id}.md`), `---\nname: ${id}\ndescription: Profile ${i}\n---\nPrompt ${i}\n`);
  }

  const extraRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectDir,
      scope: "project",
      name: "zzz-extra",
      description: "Overflow 101st",
      systemPrompt: "Should fail",
    }),
  }));
  assert.equal(extraRes.status, 400);
  const extraBody = await extraRes.json();
  assert.match(extraBody.error, /100|limit/i);
  assert.equal(await readFile(join(agentsDir, "zzz-extra.md"), "utf8").catch(() => null), null, "101st file must not be created");

  // Updating an existing profile inside the 100-file directory still succeeds.
  const editRes = await saveProfileRoute(new Request("http://localhost/api/settings/subagents/profiles", {
    method: "POST",
    body: JSON.stringify({
      cwd: projectDir,
      scope: "project",
      previousName: "agent-000",
      name: "agent-000",
      description: "Updated 000",
      systemPrompt: "Updated prompt 000",
    }),
  }));
  assert.equal(editRes.status, 200);
});
