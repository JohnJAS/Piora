import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentSessionServices } from "@earendil-works/pi-coding-agent";
import { invalidateExtensionLoadPlanCache } from "../extension-config";
import type { NativeMcpController } from "../native-mcp";
import type { ToolInfo } from "../pi-types";
import type { ProjectToolSettingsRecord } from "../project-tool-settings";
import { restorePromptMaterialDisplayPreview } from "../prompt-materials";
import { reloadModelRetrySettings } from "../retry-settings";
import { drainSessionFileOperations } from "../session-mutation";
import type { AgentSessionWrapper } from "./session-wrapper";
import type { AgentEvent, UnpersistedSessionInfo } from "./types";

declare global {
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piServicesCache: Map<string, AgentSessionServices> | undefined;
}

// ==========================================================================
// Per-session services cache.
//
// The SDK's ResourceLoader owns an ExtensionRuntime. ExtensionRunner.bindCore
// mutates that runtime's sendMessage/sendUserMessage actions, so sharing a
// services object by cwd cross-wires sessions even though each AgentSession
// has a separate runner. Correctness wins over the old warm-start optimization:
// every live session gets a private ResourceLoader/runtime. The cache remains
// useful for repeated calls that race while the same session is being started;
// start locks prevent duplicate construction.
// ==========================================================================

export function getServicesCache(): Map<string, AgentSessionServices> {
  if (!globalThis.__piServicesCache) globalThis.__piServicesCache = new Map();
  return globalThis.__piServicesCache;
}

/** Drop cached per-cwd services so the next session start reloads them. */
export function invalidateServicesCache(): void {
  getServicesCache().clear();
  invalidateExtensionLoadPlanCache();
}

/** Refresh settings only: running streams keep their captured timeout and tools. */
export async function reloadLiveModelRetrySettings(): Promise<void> {
  const managers = new Set([...getServicesCache().values()].map((services) => services.settingsManager));
  for (const session of getRegistry().values()) {
    if (session.isAlive()) {
      managers.add(session.inner.settingsManager);
      session.inner.agent.maxRetryDelayMs = undefined;
    }
  }
  await reloadModelRetrySettings(managers);
}

export async function reloadLiveCompactionSettings(): Promise<void> {
  const managers = new Set([...getServicesCache().values()].map((services) => services.settingsManager));
  for (const session of getRegistry().values()) {
    if (session.isAlive()) managers.add(session.inner.settingsManager);
  }
  await reloadModelRetrySettings(managers);
}

/** Read-only discovery for project settings. Never start servers from this page. */
export function getLiveProjectNativeMcpCatalog(projectRoot: string) {
  const tools = new Map<string, ToolInfo>();
  const resources = new Map<string, ReturnType<NativeMcpController["resourceCatalog"]>[number]>();
  for (const session of getRegistry().values()) {
    if (!session.isAlive() || session.runtimeProfile !== "normal" || normalizeRpcCwd(session.projectRoot) !== normalizeRpcCwd(projectRoot) || !session.nativeMcp) continue;
    if (session.nativeMcp.snapshot().owner !== "native") continue;
    for (const tool of session.inner.getAllTools()) if (tool.name.startsWith("mcp__") || ["codemode", "tool_search", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(tool.name)) tools.set(tool.name, { ...tool, defaultEnabled: true });
    for (const resource of session.nativeMcp.resourceCatalog()) resources.set(resource.id, resource);
  }
  return { tools: [...tools.values()], resources: [...resources.values()] };
}

export function applyProjectToolSettingsToLiveSessions(
  projectRoot: string,
  record: ProjectToolSettingsRecord,
): { appliedSessions: number; deferredSessions: number; failedSessions: number } {
  const target = normalizeRpcCwd(projectRoot);
  let appliedSessions = 0;
  let deferredSessions = 0;
  let failedSessions = 0;
  for (const session of getRegistry().values()) {
    if (!session.isAlive() || normalizeRpcCwd(session.projectRoot) !== target) continue;
    try {
      const result = session.applyProjectCapabilitySettings(record);
      if (result === "applied") appliedSessions += 1;
      else deferredSessions += 1;
    } catch {
      failedSessions += 1;
    }
  }
  return { appliedSessions, deferredSessions, failedSessions };
}

export async function reloadAllNormalSessionSystemPrompts(): Promise<{
  reloadedSessions: number;
  deferredSessions: number;
}> {
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => session.isAlive() && session.runtimeProfile === "normal",
  );
  const results = await Promise.all(sessions.map((session) => session.requestSystemPromptReload()));
  return {
    reloadedSessions: results.filter((result) => result === "reloaded").length,
    deferredSessions: results.filter((result) => result === "deferred").length,
  };
}

export function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

export function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

export function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piStartingSessionCwds) globalThis.__piStartingSessionCwds = new Map();
  return globalThis.__piStartingSessionCwds;
}

export function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = normalizeRpcCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export function destroyRpcSessionsForCwd(cwd: string): number {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  for (const session of sessions) session.destroy();
  return sessions.length;
}

/**
 * Session infos for live registry sessions missing from the caller's disk
 * scan. The primary case: pi delays the first file write until an assistant
 * message exists, so a brand-new session is invisible to the session list
 * (and thus the sidebar) until its first turn completes. Entries already
 * covered by the disk scan are excluded via `excludeIds` — not via
 * existsSync — because a freshly flushed file may still be absent from a
 * cached (TTL) scan, and the registry entry must bridge that window too.
 * Field semantics mirror the SDK's buildSessionInfo() so merged entries
 * render identically to disk entries.
 */
export function getUnpersistedSessionInfos(excludeIds?: ReadonlySet<string>): UnpersistedSessionInfo[] {
  const infos: UnpersistedSessionInfo[] = [];
  for (const session of getRegistry().values()) {
    if (!session.isAlive() || session.isSubagentSession?.() || session.isSideConversation?.()) continue;
    if (excludeIds?.has(session.sessionId)) continue;
    const sessionFile = session.sessionFile;
    if (!sessionFile) continue;

    const manager = session.inner.sessionManager;
    const header = manager.getHeader();
    if (!header) continue;

    let messageCount = 0;
    let firstMessage = "";
    let lastActivityMs = Date.parse(header.timestamp);
    for (const entry of manager.getEntries()) {
      if (entry.type !== "message") continue;
      messageCount += 1;
      const message = entry.message;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const timestamp = (message as { timestamp?: unknown }).timestamp;
      const activityMs = typeof timestamp === "number" ? timestamp : Date.parse(entry.timestamp);
      if (!Number.isNaN(activityMs)) lastActivityMs = Math.max(lastActivityMs, activityMs);
      if (!firstMessage && message.role === "user") {
        firstMessage = typeof message.content === "string"
          ? restorePromptMaterialDisplayPreview(message.content)
          : message.content
              .filter((block): block is { type: "text"; text: string } => (block as { type?: unknown }).type === "text")
              .map((block) => restorePromptMaterialDisplayPreview(block.text))
              .join(" ");
      }
    }

    infos.push({
      id: session.sessionId,
      path: sessionFile,
      cwd: header.cwd || session.cwd,
      name: manager.getSessionName(),
      created: header.timestamp,
      modified: new Date(Number.isNaN(lastActivityMs) ? Date.now() : lastActivityMs).toISOString(),
      messageCount,
      firstMessage,
      ...(header.parentSession ? { parentSessionPath: header.parentSession } : {}),
    });
  }
  return infos;
}

export function isImmediateRunningSnapshotEvent(event: AgentEvent): boolean {
  return event.type === "agent_start"
    || event.type === "agent_end"
    || event.type === "compaction_start"
    || event.type === "compaction_end"
    || event.type === "auto_compaction_start"
    || event.type === "auto_compaction_end"
    || event.type === "extension_ui_request";
}

export async function stopRpcSessionsForFileMutation(ids: readonly string[], options: { rejectRunning?: boolean } = {}): Promise<void> {
  const selected = new Set(ids);
  // Starts admitted before the mutation lock may still be constructing a wrapper.
  await Promise.allSettled([...getLocks()].filter(([key]) => ids.some((id) => key.endsWith(`:${id}`))).map(([, promise]) => promise));
  await drainSessionFileOperations(ids);
  if (options.rejectRunning && [...getRegistry()].some(([id, session]) => selected.has(id) && session.isRunning())) {
    throw new Error("任务正在运行，请停止或等待完成后再删除消息。");
  }
  await Promise.all([...getRegistry()].filter(([id]) => selected.has(id)).map(([, session]) => session.shutdownForFileMutation()));
}

export function refreshLiveToolApprovals(): void {
  for (const session of globalThis.__piSessions?.values() ?? []) session.refreshToolApprovals();
}
