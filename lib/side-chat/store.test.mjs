import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  TEMPORARY_SIDE_CHAT_TTL_MS,
  collectSideChatFilesForParents,
  deleteSideChatFile,
  getParentSideChatsDirectory,
  getSideChatsRoot,
  invalidateSideChatCache,
  listSideChatsForParent,
  promoteSideChatToStandaloneSession,
  readSideChatMetaFromEntries,
  resolveSideChatPath,
  setSideChatArchived,
} = await jiti.import("./store.ts");
const { SIDE_BOUNDARY_CUSTOM_TYPE, SIDE_META_CUSTOM_TYPE } = await jiti.import("./policy.ts");
const { readSessionAgentRuntimeProfile } = await jiti.import("../agent-profile-store.ts");

function withTempAgentEnv(run) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "piora-side-chat-store-"));
    const cwd = join(dir, "workspace");
    mkdirSync(cwd, { recursive: true });
    const prevHome = process.env.PIORA_HOME;
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PIORA_HOME = dir;
    process.env.PI_CODING_AGENT_DIR = join(dir, ".pi", "agent");
    invalidateSideChatCache();
    try {
      await run({ dir, cwd });
    } finally {
      invalidateSideChatCache();
      if (prevHome === undefined) delete process.env.PIORA_HOME;
      else process.env.PIORA_HOME = prevHome;
      if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function createSyntheticSideChatFile({ parentId, sideId, cwd, storage = "attached", title, question = "Side question" }) {
  const dir = getParentSideChatsDirectory(parentId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `2026-11-22T00-00-00-000Z_${sideId}.jsonl`);
  writeFileSync(
    filePath,
    `${JSON.stringify({ type: "session", version: 3, id: sideId, timestamp: "2026-11-22T00:00:00.000Z", cwd })}\n`,
    "utf8",
  );
  const sm = SessionManager.open(filePath, dir);
  const boundaryId = sm.appendCustomMessageEntry(SIDE_BOUNDARY_CUSTOM_TYPE, "Side conversation boundary.", false, { parentSessionId: parentId });
  sm.appendCustomEntry(SIDE_META_CUSTOM_TYPE, {
    version: 1,
    parentSessionId: parentId,
    storage,
    boundaryEntryId: boundaryId,
    createdAt: "2026-11-22T00:00:00.000Z",
  });
  sm.appendMessage({ role: "user", content: question, timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "Side answer" }], api: "anthropic-messages", provider: "anthropic", model: "claude", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  if (title) sm.appendSessionInfo(title);
  return filePath;
}

test("side chats stay isolated under side-chats dir, support archive/delete/collect, and purge expired temporary chats", withTempAgentEnv(({ cwd }) => {
  const parentId = "parent-session-1";
  const attachedFile = createSyntheticSideChatFile({ parentId, sideId: "side-attached-1", cwd, storage: "attached", title: "Side investigation" });
  const tempFile = createSyntheticSideChatFile({ parentId, sideId: "side-temp-1", cwd, storage: "temporary" });
  const expiredTempFile = createSyntheticSideChatFile({ parentId, sideId: "side-temp-expired", cwd, storage: "temporary" });

  const expiredAt = new Date(Date.now() - TEMPORARY_SIDE_CHAT_TTL_MS - 60_000);
  utimesSync(expiredTempFile, expiredAt, expiredAt);

  invalidateSideChatCache();
  assert.equal(resolveSideChatPath("side-attached-1"), attachedFile);
  assert.ok(attachedFile.startsWith(getSideChatsRoot()));

  const active = listSideChatsForParent(parentId);
  assert.equal(active.length, 2);
  assert.equal(existsSync(expiredTempFile), false, "idle expired temporary side chat should be purged");

  const attached = active.find((item) => item.id === "side-attached-1");
  assert.ok(attached);
  assert.equal(attached.isDefaultTitle, false);
  assert.equal(attached.title, "Side investigation");
  assert.equal(attached.messageCount, 2);
  assert.equal(attached.preview, "Side question");

  const temp = active.find((item) => item.id === "side-temp-1");
  assert.ok(temp);
  assert.equal(temp.isDefaultTitle, true);

  setSideChatArchived("side-attached-1", true);
  assert.equal(listSideChatsForParent(parentId).some((item) => item.id === "side-attached-1"), false);
  assert.equal(listSideChatsForParent(parentId, { includeArchived: true }).find((item) => item.id === "side-attached-1")?.archived, true);

  const collected = collectSideChatFilesForParents([parentId]);
  assert.deepEqual(new Set(collected.ids), new Set(["side-attached-1", "side-temp-1"]));
  assert.equal(collected.files.length, 2);

  assert.equal(deleteSideChatFile("side-temp-1"), true);
  assert.equal(existsSync(tempFile), false);
}));

test("running temporary side chats are NOT expired on list while still running", withTempAgentEnv(({ cwd }) => {
  const parentId = "parent-running-temp";
  const tempFile = createSyntheticSideChatFile({ parentId, sideId: "side-temp-running", cwd, storage: "temporary" });
  const old = new Date(Date.now() - TEMPORARY_SIDE_CHAT_TTL_MS - 120_000);
  utimesSync(tempFile, old, old);

  const items = listSideChatsForParent(parentId, { runningIds: new Set(["side-temp-running"]) });
  assert.equal(items.length, 1);
  assert.equal(items[0].running, true);
  assert.equal(existsSync(tempFile), true);
}));

test("promoteSideChatToStandaloneSession creates a clean standard session without boundary or side meta", withTempAgentEnv(async ({ cwd }) => {
  const parentId = "parent-promote-1";
  const sideFile = createSyntheticSideChatFile({ parentId, sideId: "side-promote-1", cwd, storage: "attached", title: "Promoted work" });
  const promoted = await promoteSideChatToStandaloneSession("side-promote-1");
  assert.notEqual(promoted.sessionId, "side-promote-1");
  assert.equal(existsSync(promoted.filePath), true);
  assert.equal(existsSync(sideFile), true, "promotion must leave source side chat intact");
  assert.equal(readSessionAgentRuntimeProfile(promoted.sessionId), "normal");

  const sm = SessionManager.open(promoted.filePath, dirname(promoted.filePath));
  const entries = sm.getEntries();
  assert.equal(readSideChatMetaFromEntries(entries), undefined);
  assert.equal(entries.some((e) => e.type === "custom_message" && e.customType === SIDE_BOUNDARY_CUSTOM_TYPE), false);
  assert.equal(sm.getSessionName(), "Promoted work");
}));
