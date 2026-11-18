export const SUBAGENT_TOOLS = ["Agent", "SendMessage", "TaskOutput", "TaskStop"] as const;
export function isSubagentTool(name: string): boolean { return (SUBAGENT_TOOLS as readonly string[]).includes(name); }
export interface SubagentSettings {
  enabled: boolean;
  maxConcurrency: number;
  timeoutSeconds: number;
  maxTokens: number;
  maxResultChars: number;
  disabledProfiles: string[];
  modelOverrides: Record<string, string>;
}
export interface SubagentProfile {
  name: string; description: string; systemPrompt: string;
  source: "built-in" | "user" | "project";
  tools?: string[]; disallowedTools?: string[]; model?: string; maxTurns: number; background?: boolean;
}
export type SubagentStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface SubagentRecord {
  version: 1; agentId: string; parentSessionId: string; parentToolCallId: string;
  agentType: string; description: string; prompt: string;
  childSessionId?: string; childSessionFile?: string; model?: string;
  status: SubagentStatus; background: boolean; startedAt: number; endedAt?: number;
  attempt?: number; attemptStartedAt?: number; revision?: number;
  result: string; error?: string; totalTokens: number; totalToolUseCount: number;
}
export interface SubagentListItem {
  agentId: string; parentSessionId: string; parentToolCallId: string;
  agentType: string; description: string; status: SubagentStatus; background: boolean;
  startedAt: number; attemptStartedAt: number; endedAt?: number; attempt: number; revision: number;
}
export interface SubagentDetail extends SubagentListItem {
  model?: string; result: string; error?: string;
  totalTokens: number; totalToolUseCount: number;
}
export interface SubagentListPage { records: SubagentListItem[]; total: number; nextOffset: number | null }
export interface SubagentTranscriptEntry {
  id: string;
  role: "user" | "assistant" | "toolResult" | "toolCall" | "omitted";
  text: string;
  toolName?: string;
  truncated?: boolean;
}
export interface SubagentTranscriptPage { entries: SubagentTranscriptEntry[]; before: string | null }
export interface SubagentSelection { parentSessionId: string; agentId: string }

type SubagentProjectionSource = Omit<SubagentRecord, "version" | "prompt" | "childSessionId" | "childSessionFile">;

export function isSubagentId(id: unknown): id is string { return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(id); }

export function hasSubagentProjection(value: unknown): value is SubagentProjectionSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<SubagentRecord>;
  return isSubagentId(record.agentId) && isSubagentId(record.parentSessionId) && typeof record.parentToolCallId === "string"
    && typeof record.description === "string" && typeof record.agentType === "string"
    && ["running", "completed", "failed", "cancelled", "interrupted"].some(status => status === record.status)
    && typeof record.background === "boolean" && typeof record.result === "string"
    && (record.error === undefined || typeof record.error === "string")
    && (record.model === undefined || typeof record.model === "string")
    && (record.revision === undefined || Number.isSafeInteger(record.revision) && record.revision >= 0)
    && (record.attempt === undefined || Number.isSafeInteger(record.attempt) && record.attempt > 0)
    && (record.endedAt === undefined || Number.isFinite(record.endedAt))
    && (record.attemptStartedAt === undefined || Number.isFinite(record.attemptStartedAt))
    && Number.isFinite(record.startedAt) && Number.isFinite(record.totalTokens) && Number.isFinite(record.totalToolUseCount);
}

export function projectSubagent(record: SubagentProjectionSource): SubagentListItem {
  return {
    agentId: record.agentId, parentSessionId: record.parentSessionId, parentToolCallId: record.parentToolCallId,
    agentType: record.agentType.slice(0, 200), description: record.description.slice(0, 500),
    status: record.status, background: record.background, startedAt: record.startedAt, endedAt: record.endedAt,
    attemptStartedAt: record.attemptStartedAt ?? record.startedAt, attempt: record.attempt ?? 1, revision: record.revision ?? 0,
  };
}

export function projectSubagentDetail(record: SubagentProjectionSource): SubagentDetail {
  return {
    ...projectSubagent(record), model: record.model?.slice(0, 256), result: record.result.slice(0, 8_000),
    error: record.error?.slice(0, 2_000), totalTokens: record.totalTokens, totalToolUseCount: record.totalToolUseCount,
  };
}

export function projectSubagentMessageDetails(details: unknown): { subagent: SubagentDetail } | undefined {
  if (!details || typeof details !== "object" || !("subagent" in details)) return undefined;
  return hasSubagentProjection(details.subagent) ? { subagent: projectSubagentDetail(details.subagent) } : undefined;
}

export function compareSubagents(left: SubagentListItem, right: SubagentListItem): number {
  return Number(right.status === "running") - Number(left.status === "running")
    || right.startedAt - left.startedAt || left.agentId.localeCompare(right.agentId);
}

export function compareSubagentVersions(left: SubagentListItem, right: SubagentListItem): number {
  return left.attempt - right.attempt || left.revision - right.revision;
}

export interface SubagentLaunch {
  description: string; prompt: string; subagent_type?: string; run_in_background?: boolean;
}
