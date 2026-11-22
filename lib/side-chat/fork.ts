import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { bindSessionAgentRuntimeProfile, readSessionAgentRuntimeProfile } from "../agent-profile-store";
import { readRemoteSessionPolicy } from "../remote-session-policy";
import { listRooms } from "../room-store";
import { getRuntimeAgentDataDirectory } from "../runtime-home";
import { isDeletedUserMessage } from "../session-message-delete";
import { cacheSessionPath, resolveSessionPath } from "../session-reader";
import { readSessionFlags } from "../session-flags";
import { appendSessionCapabilityPolicy, copySessionCapabilityPolicy, readLatestSessionCapabilityPolicy } from "../session-capabilities";
import { appendSessionSystemPromptBinding, copySessionSystemPromptBinding, createSessionSystemPromptBinding, readLatestSessionSystemPromptBinding } from "../session-system-prompt";
import { readDefaultToolPermission, readToolPermission, writeToolPermission } from "../tool-permission-store";
import type { SessionEntry } from "../types";
import { getRpcSession } from "../rpc-manager";
import { buildSideBoundaryPrompt, SIDE_BOUNDARY_CUSTOM_TYPE, SIDE_META_CUSTOM_TYPE } from "./policy";
import { readSideChatSettings } from "./settings";
import {
  assertValidSideChatSessionId,
  cacheSideChatPath,
  getParentSideChatsDirectory,
  readSideChatMetaFromEntries,
  readSideChatSummaryByPath,
  resolveSideChatPath,
} from "./store";
import { SideChatError, type SideChatMetaEntry, type SideChatStorage, type SideChatSummary } from "./types";

function collectActiveBranch(entries: readonly SessionEntry[], leafId?: string | null): SessionEntry[] {
  if (!entries.length) return [];
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  let current = leafId ? byId.get(leafId) : entries.at(-1);
  if (!current && leafId !== null) current = entries.at(-1);
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();
  return path;
}

/** True when the active parent branch has at least one non-deleted user prompt. */
export function hasStartedConversation(entries: readonly SessionEntry[], leafId?: string | null): boolean {
  const branch = collectActiveBranch(entries, leafId);
  return branch.some((entry) =>
    entry.type === "message"
    && (entry.message as { role?: string } | undefined)?.role === "user"
    && !isDeletedUserMessage(entry),
  );
}

/**
 * Find the latest anchor on the parent's active branch that ends with balanced
 * `toolCall` / `toolResult` pairs so forking while the parent is running tools
 * never sends an orphaned `tool_use` block to model providers.
 */
export function resolveSafeSideForkAnchor(entries: readonly SessionEntry[], leafId?: string | null): string | null {
  const branch = collectActiveBranch(entries, leafId);
  if (branch.length === 0) return null;

  const openToolCallIds = new Set<string>();
  let lastSafeAnchorId: string | null = null;

  for (const entry of branch) {
    if (entry.type === "message") {
      const msg = entry.message as {
        role?: string;
        content?: unknown;
        stopReason?: string;
      };
      if (msg.role === "assistant") {
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        const toolCallIds = blocks
          .filter((block): block is { type?: string; id?: string } => Boolean(block && typeof block === "object" && (block as { type?: string }).type === "toolCall" && typeof (block as { id?: unknown }).id === "string"))
          .map((block) => block.id!);
        for (const id of toolCallIds) openToolCallIds.add(id);
        if (openToolCallIds.size === 0 && msg.stopReason !== "aborted") {
          lastSafeAnchorId = entry.id;
        }
        continue;
      }
      if (msg.role === "toolResult") {
        const toolCallId = (entry.message as { toolCallId?: unknown }).toolCallId;
        if (typeof toolCallId === "string") openToolCallIds.delete(toolCallId);
        if (openToolCallIds.size === 0) lastSafeAnchorId = entry.id;
        continue;
      }
    }

    if (openToolCallIds.size === 0) {
      lastSafeAnchorId = entry.id;
    }
  }

  return lastSafeAnchorId;
}

function shouldSkipForkEntry(entry: SessionEntry): boolean {
  if (entry.type === "label" || entry.type === "session_info") return true;
  if (entry.type === "custom") {
    const customType = (entry as { customType?: unknown }).customType;
    if (typeof customType !== "string") return false;
    return (
      customType === "piora-remote-policy"
      || customType.startsWith("piora-workflow")
      || customType.startsWith("piora-plan")
      || customType.startsWith("piora-goal")
    );
  }
  return false;
}

function buildRechainedBranchEntries(branchToAnchor: readonly SessionEntry[]): SessionEntry[] {
  const retained: SessionEntry[] = [];
  const replacementBySkippedId = new Map<string, string>();
  const pendingSkippedIds: string[] = [];
  let pathParentId: string | null = null;

  for (const entry of branchToAnchor) {
    if (shouldSkipForkEntry(entry)) {
      pendingSkippedIds.push(entry.id);
      continue;
    }
    for (const skippedId of pendingSkippedIds) replacementBySkippedId.set(skippedId, entry.id);
    pendingSkippedIds.length = 0;

    if (entry.type === "compaction") {
      const compactionEntry = entry as SessionEntry & { firstKeptEntryId?: string | null };
      const kept = compactionEntry.firstKeptEntryId;
      retained.push({
        ...compactionEntry,
        parentId: pathParentId,
        firstKeptEntryId: kept === entry.id ? entry.id : (kept ? replacementBySkippedId.get(kept) ?? kept : kept),
      } as SessionEntry);
    } else {
      retained.push({ ...entry, parentId: pathParentId } as SessionEntry);
    }
    pathParentId = entry.id;
  }

  return retained;
}

export interface CreateSideChatOptions {
  parentSessionId: string;
  storage?: SideChatStorage;
  title?: string;
}

/**
 * Create a side conversation safely from either a live or persisted parent
 * session without mutating the parent `AgentSession` in memory or on disk.
 */
export async function createSideChatFromParent(options: CreateSideChatOptions): Promise<SideChatSummary> {
  if (!readSideChatSettings().enabled) {
    throw new SideChatError("SIDE_CHAT_DISABLED", 403, "Enable Side Chat in Settings → Laboratory first.");
  }

  let parentSessionId: string;
  try {
    parentSessionId = assertValidSideChatSessionId(options.parentSessionId, "parent session id");
  } catch {
    throw new SideChatError("INVALID_REQUEST", 400, "Invalid parent session id.");
  }

  const storage: SideChatStorage = options.storage === "temporary" ? "temporary" : "attached";
  if (resolveSideChatPath(parentSessionId)) {
    throw new SideChatError("NESTED_SIDE_CHAT_FORBIDDEN", 400, "Side chats cannot be opened inside another side chat.");
  }
  if (listRooms(parentSessionId).some((room) => room.members.some((member) => member.binding.sessionId === parentSessionId))) {
    throw new SideChatError("SIDE_CHAT_FORBIDDEN", 403, "Side chats are only available in standard conversations.");
  }

  const flags = readSessionFlags();
  if (flags[parentSessionId]?.archived) {
    throw new SideChatError("PARENT_ARCHIVED", 409, "Archived conversations cannot open a side chat.");
  }

  const liveParent = getRpcSession(parentSessionId);
  let entries: SessionEntry[];
  let leafId: string | null;
  let cwd: string;
  const parentCapabilityPolicy = liveParent?.isAlive() ? liveParent.getSessionCapabilities() : undefined;
  let parentSystemPromptBinding = liveParent?.isAlive() ? liveParent.getSystemPromptBinding() : null;
  const liveModel = liveParent?.isAlive() ? liveParent.inner.model : undefined;
  const liveThinkingLevel = liveParent?.isAlive() ? liveParent.inner.agent.state?.thinkingLevel : undefined;

  if (liveParent?.isAlive()) {
    if (liveParent.isSideConversation?.()) {
      throw new SideChatError("NESTED_SIDE_CHAT_FORBIDDEN", 400, "Side chats cannot be opened inside another side chat.");
    }
    if (liveParent.runtimeProfile !== "normal" || liveParent.remotePolicy === "notes") {
      throw new SideChatError("SIDE_CHAT_FORBIDDEN", 403, "Side chats are only available in standard conversations.");
    }
    const sm = liveParent.inner.sessionManager;
    entries = sm.getEntries() as unknown as SessionEntry[];
    leafId = sm.getLeafId();
    cwd = liveParent.cwd;
  } else {
    const persistedProfile = readSessionAgentRuntimeProfile(parentSessionId);
    if (persistedProfile && persistedProfile !== "normal") {
      throw new SideChatError("SIDE_CHAT_FORBIDDEN", 403, "Side chats are only available in standard conversations.");
    }
    const parentFile = await resolveSessionPath(parentSessionId);
    if (!parentFile) {
      throw new SideChatError("PARENT_NOT_FOUND", 404, "Parent conversation was not found.");
    }
    const sm = SessionManager.open(parentFile);
    entries = sm.getEntries() as unknown as SessionEntry[];
    leafId = sm.getLeafId();
    cwd = sm.getCwd();
    parentSystemPromptBinding = readLatestSessionSystemPromptBinding(entries);
  }

  if (readSideChatMetaFromEntries(entries)) {
    throw new SideChatError("NESTED_SIDE_CHAT_FORBIDDEN", 400, "Side chats cannot be opened inside another side chat.");
  }
  if (readRemoteSessionPolicy(entries) === "notes") {
    throw new SideChatError("SIDE_CHAT_FORBIDDEN", 403, "Side chats are only available in standard conversations.");
  }
  if (!hasStartedConversation(entries, leafId)) {
    throw new SideChatError("PARENT_NOT_STARTED", 400, "Send a message in the main conversation before opening a side chat.");
  }

  const anchorId = resolveSafeSideForkAnchor(entries, leafId);
  const branch = collectActiveBranch(entries, anchorId ?? leafId);
  const anchorIndex = anchorId ? branch.findIndex((entry) => entry.id === anchorId) : -1;
  const branchToAnchor = anchorIndex >= 0 ? branch.slice(0, anchorIndex + 1) : [];
  const retainedEntries = buildRechainedBranchEntries(branchToAnchor);

  const sideSessionId = randomUUID();
  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const sideChatDir = getParentSideChatsDirectory(parentSessionId);
  mkdirSync(sideChatDir, { recursive: true, mode: 0o700 });
  const sideChatFile = join(sideChatDir, `${fileTimestamp}_${sideSessionId}.jsonl`);

  const header = {
    type: "session" as const,
    version: 3,
    id: sideSessionId,
    timestamp,
    cwd,
  };
  const lines = [header, ...retainedEntries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(sideChatFile, lines, { encoding: "utf8", flag: "wx", mode: 0o600 });

  const sideSm = SessionManager.open(sideChatFile, sideChatDir);

  if (liveModel?.provider && liveModel?.id) {
    sideSm.appendModelChange(liveModel.provider, liveModel.id);
  }
  if (typeof liveThinkingLevel === "string" && liveThinkingLevel) {
    sideSm.appendThinkingLevelChange(liveThinkingLevel);
  }

  if (parentCapabilityPolicy) {
    const clonedPolicy = copySessionCapabilityPolicy(parentCapabilityPolicy.policy);
    appendSessionCapabilityPolicy(sideSm, clonedPolicy);
  } else {
    const persistedPolicy = readLatestSessionCapabilityPolicy(entries);
    if (persistedPolicy) {
      appendSessionCapabilityPolicy(sideSm, copySessionCapabilityPolicy(persistedPolicy));
    }
  }

  const promptBinding = parentSystemPromptBinding
    ? copySessionSystemPromptBinding(parentSystemPromptBinding)
    : createSessionSystemPromptBinding({ mode: "default" });
  appendSessionSystemPromptBinding(sideSm, promptBinding);

  const boundaryEntryId = sideSm.appendCustomMessageEntry(
    SIDE_BOUNDARY_CUSTOM_TYPE,
    buildSideBoundaryPrompt(parentSessionId),
    false,
    { parentSessionId, kind: "side-boundary" },
  );
  const meta: SideChatMetaEntry = {
    version: 1,
    parentSessionId,
    storage,
    boundaryEntryId,
    createdAt: timestamp,
    inheritedLeafId: anchorId,
  };
  sideSm.appendCustomEntry(SIDE_META_CUSTOM_TYPE, meta);

  const cleanTitle = options.title?.trim();
  if (cleanTitle) {
    sideSm.appendSessionInfo(cleanTitle);
  }

  const agentDir = getRuntimeAgentDataDirectory();
  const recordedPermission = readToolPermission(parentSessionId, agentDir);
  const inheritedPermission = recordedPermission.legacy ? readDefaultToolPermission(agentDir) : recordedPermission.mode;
  writeToolPermission(sideSessionId, inheritedPermission, agentDir);
  await bindSessionAgentRuntimeProfile(sideSessionId, "normal");

  cacheSideChatPath(sideSessionId, sideChatFile);
  cacheSessionPath(sideSessionId, sideChatFile);

  const summary = readSideChatSummaryByPath(sideChatFile);
  if (!summary) {
    throw new Error("Created side chat summary could not be read back.");
  }
  return summary;
}
