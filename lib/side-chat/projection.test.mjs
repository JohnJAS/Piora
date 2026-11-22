import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { readHistory } from "../read-runtime/session-history.mjs";

const jiti = createJiti(import.meta.url);
const { buildSessionContext, invalidateSessionPathCache, cacheSessionPath } = await jiti.import("../session-reader.ts");
const { getParentSideChatsDirectory, invalidateSideChatCache } = await jiti.import("./store.ts");
const { SIDE_BOUNDARY_CUSTOM_TYPE, SIDE_META_CUSTOM_TYPE } = await jiti.import("./policy.ts");
const { readParentSessionSummary } = await jiti.import("./parent-reader.ts");

function withTempAgentEnv(run) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "piora-side-chat-proj-"));
    const cwd = join(dir, "workspace");
    mkdirSync(cwd, { recursive: true });
    const prevHome = process.env.PIORA_HOME;
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PIORA_HOME = dir;
    process.env.PI_CODING_AGENT_DIR = join(dir, ".pi", "agent");
    invalidateSideChatCache();
    invalidateSessionPathCache();
    try {
      await run({ dir, cwd });
    } finally {
      invalidateSideChatCache();
      invalidateSessionPathCache();
      if (prevHome === undefined) delete process.env.PIORA_HOME;
      else process.env.PIORA_HOME = prevHome;
      if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function makeAssistant(text, model = "claude-sonnet") {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model,
    usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

test("both buildSessionContext and worker readHistory crop inherited turns and boundary while retaining post-boundary history", withTempAgentEnv(({ cwd }) => {
  const parentId = "proj-parent-1";
  const sideId = "proj-side-1";
  const sideDir = getParentSideChatsDirectory(parentId);
  mkdirSync(sideDir, { recursive: true });
  const sideFile = join(sideDir, `2026-11-22T00-00-00-000Z_${sideId}.jsonl`);
  writeFileSync(
    sideFile,
    `${JSON.stringify({ type: "session", version: 3, id: sideId, timestamp: "2026-11-22T00:00:00.000Z", cwd })}\n`,
    "utf8",
  );

  const sm = SessionManager.open(sideFile, sideDir);
  sm.appendModelChange("anthropic", "claude-old");
  sm.appendMessage({ role: "user", content: "Inherited parent prompt 1", timestamp: Date.now() });
  sm.appendMessage(makeAssistant("Inherited parent answer 1", "claude-old"));
  sm.appendModelChange("anthropic", "claude-mid");
  const boundaryId = sm.appendCustomMessageEntry(SIDE_BOUNDARY_CUSTOM_TYPE, "Side conversation boundary.", false, { parentSessionId: parentId });
  sm.appendCustomEntry(SIDE_META_CUSTOM_TYPE, {
    version: 1,
    parentSessionId: parentId,
    storage: "attached",
    boundaryEntryId: boundaryId,
    createdAt: "2026-11-22T00:00:00.000Z",
  });
  sm.appendMessage({ role: "user", content: "Post-boundary question 1", timestamp: Date.now() });
  sm.appendMessage(makeAssistant("Post-boundary answer 1", "claude-mid"));
  sm.appendModelChange("anthropic", "claude-new");
  sm.appendMessage({ role: "user", content: "Post-boundary question 2", timestamp: Date.now() });
  sm.appendMessage(makeAssistant("Post-boundary answer 2", "claude-new"));

  const entries = sm.getEntries();
  const context = buildSessionContext(entries);
  assert.deepEqual(
    context.messages.map((m) => (m.role === "user" ? m.content : m.content[0].text)),
    ["Post-boundary question 1", "Post-boundary answer 1", "Post-boundary question 2", "Post-boundary answer 2"],
  );
  assert.equal(context.modelChanges?.length, 1);
  assert.equal(context.modelChanges?.[0]?.to?.modelId, "claude-new");

  const transcript = readHistory("sessionTranscript", { path: sideFile }, () => {});
  assert.equal(transcript.entries.length, 4);
  assert.equal(transcript.entries.some((e) => e.customType === SIDE_BOUNDARY_CUSTOM_TYPE), false);
  assert.equal(transcript.entries.some((e) => e.message?.content === "Inherited parent prompt 1"), false);
  assert.equal(transcript.modelChanges.length, 1);
  assert.equal(transcript.modelChanges[0].to.modelId, "claude-new");

  const page = readHistory("sessionPage", { path: sideFile, turns: 20, bytes: 1024 * 1024 }, () => {});
  assert.equal(page.entries.length, 4);
  assert.equal(page.before, null);
  assert.equal(page.modelChanges.length, 1);

  // Attempting to paginate before the boundary fails with missingAnchor.
  const preBoundaryPage = readHistory("sessionPage", { path: sideFile, before: boundaryId, turns: 10, bytes: 1024 * 1024 }, () => {});
  assert.equal(preBoundaryPage.missingAnchor, true);
}));

test("readParentSessionSummary reads recent persisted parent turns without mutating parent", withTempAgentEnv(async ({ cwd }) => {
  const parentId = "read-parent-1";
  const parentDir = SessionManager.create(cwd).getSessionDir();
  mkdirSync(parentDir, { recursive: true });
  const parentFile = join(parentDir, `2026-11-22T00-00-00-000Z_${parentId}.jsonl`);
  writeFileSync(
    parentFile,
    `${JSON.stringify({ type: "session", version: 3, id: parentId, timestamp: "2026-11-22T00:00:00.000Z", cwd })}\n`,
    "utf8",
  );
  const sm = SessionManager.open(parentFile, parentDir);
  sm.appendMessage({ role: "user", content: "First user turn", timestamp: Date.now() });
  sm.appendMessage(makeAssistant("First assistant reply"));
  sm.appendMessage({ role: "user", content: "Latest user turn", timestamp: Date.now() });
  sm.appendMessage(makeAssistant("Latest assistant reply"));
  cacheSessionPath(parentId, parentFile);

  const summary = await readParentSessionSummary(parentId, { maxTurns: 1 });
  assert.match(summary, /Latest user turn/);
  assert.match(summary, /Latest assistant reply/);
  assert.doesNotMatch(summary, /First user turn/);
}));
