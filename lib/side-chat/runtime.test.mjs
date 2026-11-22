import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { SessionCapabilityController } = await jiti.import("../rpc/capability-controller.ts");
const { writeSideChatSettings } = await jiti.import("./settings.ts");
const { getRunningRpcSessionStatuses } = await jiti.import("../rpc-running-status.ts");
const {
  deriveSideChatAutoTitle,
  formatQuotedSideSelection,
  isDefaultSideChatTitle,
  matchesSideSlashQuery,
  parseSideSlashTrigger,
} = await jiti.import("./composer-trigger.ts");

function withTempAgentEnv(run) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "piora-side-chat-runtime-"));
    const prevHome = process.env.PIORA_HOME;
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PIORA_HOME = dir;
    process.env.PI_CODING_AGENT_DIR = join(dir, ".pi", "agent");
    try {
      await run(dir);
    } finally {
      if (prevHome === undefined) delete process.env.PIORA_HOME;
      else process.env.PIORA_HOME = prevHome;
      if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function createController(sideChatMeta) {
  let activeTools = [];
  const allTools = [
    { name: "read", description: "Read", defaultActive: true },
    { name: "bash", description: "Bash", defaultActive: true },
    { name: "piora_automation", description: "Automation", defaultActive: true },
    { name: "agent", description: "Subagent", defaultActive: false },
    { name: "workflow_plan", description: "Workflow plan", defaultActive: false },
    { name: "piora_read_parent_session", description: "Read parent", defaultActive: false },
  ];
  const controller = new SessionCapabilityController({
    runtimeProfile: "normal",
    remotePolicy: "agent",
    getInner: () => ({
      sessionManager: { getEntries: () => [] },
      getAllTools: () => allTools,
      getActiveToolNames: () => activeTools,
      getToolDefinition: (name) => allTools.find((t) => t.name === name),
      setActiveToolsByName: (names) => { activeTools = [...names]; },
    }),
    isAlive: () => true,
    isRunning: () => false,
    assertSessionIdle: () => {},
    getPermissionParent: () => undefined,
    getSideChatMeta: () => sideChatMeta,
    setForceEmptySystemPrompt: () => {},
    applyForcedEmptySystemPrompt: () => {},
    emit: () => {},
  });
  controller.initializeSessionCapabilities();
  return { controller, getActiveTools: () => activeTools };
}

test("SessionCapabilityController gates subagents, workflows, automations, and piora_read_parent_session", withTempAgentEnv(() => {
  writeSideChatSettings({ enabled: true });

  const normalSession = createController(undefined);
  assert.equal(normalSession.controller.isToolAllowedByCapability("piora_read_parent_session"), false);
  assert.equal(normalSession.getActiveTools().includes("piora_read_parent_session"), false);

  const attachedSide = createController({
    version: 1,
    parentSessionId: "parent-1",
    storage: "attached",
    boundaryEntryId: "b-1",
    createdAt: new Date().toISOString(),
  });
  assert.equal(attachedSide.controller.isToolAllowedByCapability("piora_read_parent_session"), true);
  assert.equal(attachedSide.controller.isToolAllowedByCapability("agent"), false);
  assert.equal(attachedSide.controller.isToolAllowedByCapability("workflow_plan"), false);
  assert.equal(attachedSide.getActiveTools().includes("piora_read_parent_session"), true);
  assert.equal(attachedSide.getActiveTools().includes("agent"), false);

  const tempSide = createController({
    version: 1,
    parentSessionId: "parent-1",
    storage: "temporary",
    boundaryEntryId: "b-2",
    createdAt: new Date().toISOString(),
  });
  assert.equal(tempSide.controller.isToolAllowedByCapability("piora_automation"), false);
  assert.equal(tempSide.getActiveTools().includes("piora_automation"), false);

  writeSideChatSettings({ enabled: false });
  assert.equal(attachedSide.controller.isToolAllowedByCapability("piora_read_parent_session"), false);
}));

test("composer triggers, quoted selection, and auto-title helpers match Codex semantics", () => {
  assert.deepEqual(parseSideSlashTrigger("/side"), { matched: true, initialPrompt: "" });
  assert.deepEqual(parseSideSlashTrigger("  /side why did tests fail?"), { matched: true, initialPrompt: "why did tests fail?" });
  assert.deepEqual(parseSideSlashTrigger("/sidecar something"), { matched: false });
  assert.equal(matchesSideSlashQuery(""), true);
  assert.equal(matchesSideSlashQuery("si"), true);
  assert.equal(matchesSideSlashQuery("plan"), false);

  assert.equal(formatQuotedSideSelection("line 1\n\nline 2"), "> line 1\n>\n> line 2\n\n");
  assert.equal(isDefaultSideChatTitle(undefined), true);
  assert.equal(isDefaultSideChatTitle("Side chat 2"), true);
  assert.equal(isDefaultSideChatTitle("侧边对话"), true);
  assert.equal(isDefaultSideChatTitle("Debug auth flow"), false);
  assert.equal(deriveSideChatAutoTitle("   First line\nSecond line"), "First line");
  assert.equal(deriveSideChatAutoTitle("A".repeat(60)).length, 48);
  assert.equal(deriveSideChatAutoTitle("", true), "[Image]");
});

test("getRunningRpcSessionStatuses excludes side chats from top-level and aggregates runningSideChatIds onto parent", () => {
  const prevSessions = globalThis.__piSessions;
  try {
    globalThis.__piSessions = new Map([
      ["side-1", {
        sessionId: "side-1",
        isAlive: () => true,
        isSubagentSession: () => false,
        isSideConversation: () => true,
        getSideChatParentId: () => "parent-idle",
        getTaskRuntimeSnapshot: () => ({ id: "side-1", runtime: "running", pendingApproval: false, lastPromptFailed: false }),
      }],
      ["main-1", {
        sessionId: "main-1",
        isAlive: () => true,
        isSubagentSession: () => false,
        isSideConversation: () => false,
        getSideChatParentId: () => undefined,
        getTaskRuntimeSnapshot: () => ({ id: "main-1", runtime: "running", pendingApproval: false, lastPromptFailed: false }),
      }],
    ]);
    const statuses = getRunningRpcSessionStatuses(false);
    assert.equal(statuses.some((s) => s.id === "side-1"), false);
    const parentSnapshot = statuses.find((s) => s.id === "parent-idle");
    assert.ok(parentSnapshot);
    assert.equal(parentSnapshot.runtime, "idle");
    assert.deepEqual(parentSnapshot.runningSideChatIds, ["side-1"]);
  } finally {
    globalThis.__piSessions = prevSessions;
  }
});
