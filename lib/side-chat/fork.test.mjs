import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { writeSideChatSettings } = await jiti.import("./settings.ts");
const {
  createSideChatFromParent,
  hasStartedConversation,
  resolveSafeSideForkAnchor,
} = await jiti.import("./fork.ts");
const { SIDE_BOUNDARY_CUSTOM_TYPE } = await jiti.import("./policy.ts");
const { invalidateSideChatCache, readSideChatMetaFromEntries, resolveSideChatPath } = await jiti.import("./store.ts");
const { cacheSessionPath, invalidateSessionListCache, invalidateSessionPathCache } = await jiti.import("../session-reader.ts");
const { updateSessionFlag } = await jiti.import("../session-flags.ts");
const { bindSessionAgentRuntimeProfile, readSessionAgentRuntimeProfile } = await jiti.import("../agent-profile-store.ts");
const { writeToolPermission, readToolPermission } = await jiti.import("../tool-permission-store.ts");
const {
  SESSION_CAPABILITY_ENTRY_TYPE,
  appendSessionCapabilityPolicy,
  buildSessionCapabilityCatalog,
  createSessionCapabilityPolicy,
  restoreSessionCapabilityPolicy,
} = await jiti.import("../session-capabilities.ts");

function withTempAgentEnv(run) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "piora-side-chat-fork-"));
    const cwd = join(dir, "workspace");
    mkdirSync(cwd, { recursive: true });
    const prevHome = process.env.PIORA_HOME;
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PIORA_HOME = dir;
    process.env.PI_CODING_AGENT_DIR = join(dir, ".pi", "agent");
    invalidateSideChatCache();
    invalidateSessionPathCache();
    invalidateSessionListCache();
    try {
      await run({ dir, cwd });
    } finally {
      invalidateSideChatCache();
      invalidateSessionPathCache();
      invalidateSessionListCache();
      if (prevHome === undefined) delete process.env.PIORA_HOME;
      else process.env.PIORA_HOME = prevHome;
      if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function createParentFile(_dir, cwd, parentId) {
  const parentDir = SessionManager.create(cwd).getSessionDir();
  mkdirSync(parentDir, { recursive: true });
  const parentFile = join(parentDir, `2026-11-22T00-00-00-000Z_${parentId}.jsonl`);
  writeFileSync(
    parentFile,
    `${JSON.stringify({ type: "session", version: 3, id: parentId, timestamp: "2026-11-22T00:00:00.000Z", cwd })}\n`,
    "utf8",
  );
  cacheSessionPath(parentId, parentFile);
  return { parentDir, parentFile };
}

function assistantToolCall(callId, text = "") {
  return {
    role: "assistant",
    content: [
      ...(text ? [{ type: "text", text }] : []),
      { type: "toolCall", id: callId, name: "read", arguments: { path: "README.md" } },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function toolResult(callId) {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text", text: "ok" }],
    isError: false,
    timestamp: Date.now(),
  };
}

test("resolveSafeSideForkAnchor rewinds unpaired trailing tool calls and aborted replies", () => {
  const entries = [
    { id: "u1", parentId: null, type: "message", timestamp: "2026-11-22T00:00:01Z", message: { role: "user", content: "hi" } },
    { id: "a1", parentId: "u1", type: "message", timestamp: "2026-11-22T00:00:02Z", message: assistantToolCall("call-1") },
    { id: "r1", parentId: "a1", type: "message", timestamp: "2026-11-22T00:00:03Z", message: toolResult("call-1") },
    { id: "u2", parentId: "r1", type: "message", timestamp: "2026-11-22T00:00:04Z", message: { role: "user", content: "next" } },
    { id: "a2", parentId: "u2", type: "message", timestamp: "2026-11-22T00:00:05Z", message: assistantToolCall("call-2") },
  ];
  assert.equal(hasStartedConversation(entries, "a2"), true);
  assert.equal(resolveSafeSideForkAnchor(entries, "a2"), "u2");
  assert.equal(resolveSafeSideForkAnchor(entries, "r1"), "r1");

  const withAborted = [
    ...entries.slice(0, 4),
    { id: "aborted", parentId: "u2", type: "message", timestamp: "2026-11-22T00:00:05Z", message: { role: "assistant", content: [], stopReason: "aborted" } },
  ];
  assert.equal(resolveSafeSideForkAnchor(withAborted, "aborted"), "u2");
});

test("createSideChatFromParent forks safely, preserves parent, strips parent title/workflow entries, and enforces guardrails", withTempAgentEnv(async ({ dir, cwd }) => {
  const parentId = "fork-parent-1";
  const { parentDir, parentFile } = createParentFile(dir, cwd, parentId);
  const parentSm = SessionManager.open(parentFile, parentDir);

  await assert.rejects(
    () => createSideChatFromParent({ parentSessionId: parentId }),
    (err) => err.code === "SIDE_CHAT_DISABLED" && err.status === 403,
  );

  writeSideChatSettings({ enabled: true });

  await assert.rejects(
    () => createSideChatFromParent({ parentSessionId: parentId }),
    (err) => err.code === "PARENT_NOT_STARTED" && err.status === 400,
  );

  const u1 = parentSm.appendMessage({ role: "user", content: "Inspect codebase", timestamp: Date.now() });
  parentSm.appendSessionInfo("Main Session Secret Title");
  parentSm.appendCustomEntry("piora-workflow-state", { mode: "plan" });
  const a1 = parentSm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Looking now" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  parentSm.appendMessage(assistantToolCall("in-flight-1"));
  writeToolPermission(parentId, "ask", join(dir, ".pi", "agent"));
  const parentRawBefore = readFileSync(parentFile, "utf8");

  const created = await createSideChatFromParent({ parentSessionId: parentId, storage: "temporary" });
  assert.equal(created.parentSessionId, parentId);
  assert.equal(created.storage, "temporary");
  assert.equal(created.isDefaultTitle, true);
  assert.equal(readFileSync(parentFile, "utf8"), parentRawBefore, "parent session file must remain untouched");

  const sideFile = resolveSideChatPath(created.id);
  assert.ok(sideFile);
  const sideSm = SessionManager.open(sideFile, dirname(sideFile));
  assert.equal(sideSm.getSessionName(), undefined, "parent session_info title must NOT leak into side chat");
  const sideEntries = sideSm.getEntries();
  assert.equal(sideEntries.some((e) => e.type === "custom" && String(e.customType).startsWith("piora-workflow")), false);
  assert.equal(sideEntries.some((e) => e.type === "custom_message" && e.customType === SIDE_BOUNDARY_CUSTOM_TYPE), true);
  const meta = readSideChatMetaFromEntries(sideEntries);
  assert.ok(meta);
  assert.equal(meta.parentSessionId, parentId);
  assert.equal(meta.inheritedLeafId, a1);
  assert.notEqual(u1, "");
  assert.equal(readSessionAgentRuntimeProfile(created.id), "normal");
  assert.equal(readToolPermission(created.id, join(dir, ".pi", "agent")).mode, "ask");

  // Nested side chat is forbidden
  await assert.rejects(
    () => createSideChatFromParent({ parentSessionId: created.id }),
    (err) => err.code === "NESTED_SIDE_CHAT_FORBIDDEN" && err.status === 400,
  );

  // Archived parent is rejected
  await updateSessionFlag(parentId, { archived: true });
  await assert.rejects(
    () => createSideChatFromParent({ parentSessionId: parentId }),
    (err) => err.code === "PARENT_ARCHIVED" && err.status === 409,
  );

  // Notes-only parent is rejected
  const notesParentId = "notes-parent-1";
  const notes = createParentFile(dir, cwd, notesParentId);
  const notesSm = SessionManager.open(notes.parentFile, notes.parentDir);
  notesSm.appendCustomEntry("piora-remote-policy", { policy: "notes" });
  notesSm.appendMessage({ role: "user", content: "Note", timestamp: Date.now() });
  await assert.rejects(
    () => createSideChatFromParent({ parentSessionId: notesParentId }),
    (err) => err.code === "SIDE_CHAT_FORBIDDEN" && err.status === 403,
  );

  // Non-normal runtime profile parent is rejected
  const deviceParentId = "device-parent-1";
  const dev = createParentFile(dir, cwd, deviceParentId);
  const devSm = SessionManager.open(dev.parentFile, dev.parentDir);
  devSm.appendMessage({ role: "user", content: "Tap", timestamp: Date.now() });
  await bindSessionAgentRuntimeProfile(deviceParentId, "device-control");
  await assert.rejects(
    () => createSideChatFromParent({ parentSessionId: deviceParentId }),
    (err) => err.code === "SIDE_CHAT_FORBIDDEN" && err.status === 403,
  );
}));

test("cold fork omits empty capability policy for legacy parents so default tools restore while copying explicit parent policies", withTempAgentEnv(async ({ dir, cwd }) => {
  writeSideChatSettings({ enabled: true });

  const catalog = buildSessionCapabilityCatalog([
    { name: "read", description: "Read files" },
    { name: "grep", description: "Search files" },
    { name: "ls", description: "List files" },
  ], "normal");

  const legacyParentId = "legacy-cold-parent";
  const legacy = createParentFile(dir, cwd, legacyParentId);
  const legacySm = SessionManager.open(legacy.parentFile, legacy.parentDir);
  legacySm.appendMessage({ role: "user", content: "Legacy cold prompt", timestamp: Date.now() });

  const legacySide = await createSideChatFromParent({ parentSessionId: legacyParentId, storage: "attached" });
  const legacySideFile = resolveSideChatPath(legacySide.id);
  assert.ok(legacySideFile);
  const legacySideEntries = SessionManager.open(legacySideFile, dirname(legacySideFile)).getEntries();
  assert.equal(
    legacySideEntries.some((entry) => entry.type === "custom" && entry.customType === SESSION_CAPABILITY_ENTRY_TYPE),
    false,
    "cold fork of legacy parent must not write a synthetic empty capability policy",
  );
  const restoredForLegacy = restoreSessionCapabilityPolicy(legacySideEntries, catalog, "normal");
  assert.deepEqual([...restoredForLegacy.enabledCapabilityIds].sort(), ["tool:grep", "tool:ls", "tool:read"]);

  const explicitParentId = "explicit-policy-cold-parent";
  const explicit = createParentFile(dir, cwd, explicitParentId);
  const explicitSm = SessionManager.open(explicit.parentFile, explicit.parentDir);
  explicitSm.appendMessage({ role: "user", content: "Restricted cold prompt", timestamp: Date.now() });
  const explicitPolicy = createSessionCapabilityPolicy(
    { preset: "custom", enabledCapabilityIds: [] },
    catalog,
    "normal",
  );
  appendSessionCapabilityPolicy(explicitSm, explicitPolicy);

  const explicitSide = await createSideChatFromParent({ parentSessionId: explicitParentId, storage: "attached" });
  const explicitSideFile = resolveSideChatPath(explicitSide.id);
  assert.ok(explicitSideFile);
  const explicitSideEntries = SessionManager.open(explicitSideFile, dirname(explicitSideFile)).getEntries();
  const restoredForExplicit = restoreSessionCapabilityPolicy(explicitSideEntries, catalog, "normal");
  assert.deepEqual(restoredForExplicit.enabledCapabilityIds, []);
}));
