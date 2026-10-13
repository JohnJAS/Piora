import type { SessionStatsInfo } from "./pi-types";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Same whole-file entry scope as Pi getSessionStats, including non-current branches.
 * Nested usage is already rolled into the parent tool result; never add it again.
 * This helper deliberately needs no AgentSession, model, or connection.
 */
export function summarizeSessionStats(manager: {
  getEntries(): readonly unknown[];
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getSessionName(): string | undefined;
}): SessionStatsInfo {
  const stats: SessionStatsInfo = {
    sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionName: manager.getSessionName(),
    scope: "session", costStatus: "unknown",
    userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
  };
  let known = 0, unknown = 0;
  const addUsage = (value: unknown) => {
    const usage = record(value);
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      const count = usage?.[key];
      if (finite(count)) stats.tokens[key] += count;
    }
    const cost = record(usage?.cost)?.total;
    if (finite(cost)) { stats.cost += cost; known++; } else unknown++;
  };
  for (const raw of manager.getEntries()) {
    const entry = record(raw);
    if (!entry) continue;
    if (entry.type === "usage") addUsage(entry.usage);
    else if (entry.type === "compaction" || entry.type === "branch_summary") addUsage(entry.usage);
    if (entry.type !== "message") continue;
    const message = record(entry.message);
    if (!message) continue;
    stats.totalMessages++;
    if (message.role === "user") stats.userMessages++;
    else if (message.role === "toolResult") {
      stats.toolResults++;
      // Ordinary tools need not have billable model usage.
      if (message.usage !== undefined) addUsage(message.usage);
    } else if (message.role === "assistant") {
      stats.assistantMessages++;
      if (Array.isArray(message.content)) stats.toolCalls += message.content.filter(block => record(block)?.type === "toolCall").length;
      addUsage(message.usage);
    }
  }
  stats.tokens.total = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite;
  stats.costStatus = known ? unknown ? "partial" : "known" : "unknown";
  return stats;
}
