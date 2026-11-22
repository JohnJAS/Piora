export const SUBAGENT_TOOLS = ["Agent", "SendMessage", "TaskOutput", "TaskStop"] as const;
export const MAX_SUBAGENT_RESULT_CHARS = 8_000;
export const SUBAGENT_RESULT_TRUNCATION_SUFFIX = "\n[Truncated; see child transcript.]";

export function truncatedSubagentResultPrefix(result: string): string | undefined {
  if (result.length === MAX_SUBAGENT_RESULT_CHARS && result.endsWith(SUBAGENT_RESULT_TRUNCATION_SUFFIX)) {
    return result.slice(0, -SUBAGENT_RESULT_TRUNCATION_SUFFIX.length);
  }
  return undefined;
}

export function subagentProfilePreferenceKey(profile: Pick<SubagentProfile, "id" | "name">): string {
  return profile.id ? `id:${profile.id}` : profile.name;
}

export function isSubagentProfileDisabled(
  settings: Pick<SubagentSettings, "disabledProfiles">,
  profile: Pick<SubagentProfile, "id" | "name">,
): boolean {
  return settings.disabledProfiles.includes(subagentProfilePreferenceKey(profile));
}

export function resolveSubagentModelOverride(
  settings: Pick<SubagentSettings, "modelOverrides">,
  profile: Pick<SubagentProfile, "id" | "name">,
): string {
  const key = subagentProfilePreferenceKey(profile);
  return Object.hasOwn(settings.modelOverrides, key) ? settings.modelOverrides[key] : "";
}

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
  id?: string;
  aliases?: string[];
  name: string; description: string; systemPrompt: string;
  source: "built-in" | "user" | "project";
  fileName?: string;
  tools?: string[]; disallowedTools?: string[]; model?: string; maxTurns?: number; background?: boolean;
}
export interface SubagentProfileWarning {
  file: string;
  scope: "user" | "project";
  message: string;
}
export type SubagentStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface SubagentRecord {
  version: 1; agentId: string; parentSessionId: string; parentToolCallId: string;
  agentType: string; profileId?: string; description: string; prompt: string;
  childSessionId?: string; childSessionFile?: string; model?: string;
  status: SubagentStatus; background: boolean; startedAt: number; endedAt?: number;
  attempt?: number; attemptStartedAt?: number; revision?: number;
  result: string; resultTruncated?: boolean; resultEntryId?: string; resultFullLength?: number;
  error?: string; totalTokens: number; totalToolUseCount: number;
  currentTool?: string; currentActivity?: string;
}
export interface SubagentListItem {
  agentId: string; parentSessionId: string; parentToolCallId: string;
  agentType: string; description: string; status: SubagentStatus; background: boolean;
  startedAt: number; attemptStartedAt: number; endedAt?: number; attempt: number; revision: number;
  currentTool?: string; currentActivity?: string;
}
export interface SubagentDetail extends SubagentListItem {
  model?: string; result: string; resultTruncated?: boolean; error?: string;
  totalTokens: number; totalToolUseCount: number;
}
export interface SubagentListPage { records: SubagentListItem[]; total: number; nextOffset: number | null }
export interface SubagentTranscriptEntry {
  id: string;
  role: "user" | "assistant" | "toolResult" | "toolCall" | "omitted";
  text: string;
  toolName?: string;
  toolSummary?: string;
  toolCallId?: string;
  isError?: boolean;
  timestamp?: number;
  truncated?: boolean;
}
export interface SubagentTranscriptPage { entries: SubagentTranscriptEntry[]; before: string | null }
export interface SubagentSelection { parentSessionId: string; agentId: string }

type SubagentProjectionSource = Omit<
  SubagentRecord,
  "version" | "prompt" | "childSessionId" | "childSessionFile" | "profileId" | "resultEntryId" | "resultFullLength"
>;

export function isSubagentId(id: unknown): id is string { return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(id); }

export function hasSubagentProjection(value: unknown): value is SubagentProjectionSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<SubagentRecord>;
  return isSubagentId(record.agentId) && isSubagentId(record.parentSessionId) && typeof record.parentToolCallId === "string"
    && typeof record.description === "string" && typeof record.agentType === "string"
    && ["running", "completed", "failed", "cancelled", "interrupted"].some(status => status === record.status)
    && typeof record.background === "boolean" && typeof record.result === "string"
    && (record.resultTruncated === undefined || typeof record.resultTruncated === "boolean")
    && (record.error === undefined || typeof record.error === "string")
    && (record.model === undefined || typeof record.model === "string")
    && (record.currentTool === undefined || typeof record.currentTool === "string")
    && (record.currentActivity === undefined || typeof record.currentActivity === "string")
    && (record.revision === undefined || Number.isSafeInteger(record.revision) && record.revision >= 0)
    && (record.attempt === undefined || Number.isSafeInteger(record.attempt) && record.attempt > 0)
    && (record.endedAt === undefined || Number.isFinite(record.endedAt))
    && (record.attemptStartedAt === undefined || Number.isFinite(record.attemptStartedAt))
    && Number.isFinite(record.startedAt) && Number.isFinite(record.totalTokens) && Number.isFinite(record.totalToolUseCount);
}

export function projectSubagent(record: SubagentProjectionSource): SubagentListItem {
  const activeTool = record.status === "running" && record.currentTool ? record.currentTool.slice(0, 80) : undefined;
  const activeSummary = record.status === "running" && record.currentActivity ? record.currentActivity.slice(0, 160) : undefined;
  return {
    agentId: record.agentId, parentSessionId: record.parentSessionId, parentToolCallId: record.parentToolCallId,
    agentType: record.agentType.slice(0, 200), description: record.description.slice(0, 500),
    status: record.status, background: record.background, startedAt: record.startedAt, endedAt: record.endedAt,
    attemptStartedAt: record.attemptStartedAt ?? record.startedAt, attempt: record.attempt ?? 1, revision: record.revision ?? 0,
    ...(activeTool ? { currentTool: activeTool } : {}),
    ...(activeSummary ? { currentActivity: activeSummary } : {}),
  };
}

export function projectSubagentDetail(record: SubagentProjectionSource): SubagentDetail {
  const truncated = record.result.length > MAX_SUBAGENT_RESULT_CHARS
    || truncatedSubagentResultPrefix(record.result) !== undefined
    || (record as Partial<SubagentDetail>).resultTruncated === true;
  return {
    ...projectSubagent(record),
    model: record.model?.slice(0, 256),
    result: record.result.slice(0, MAX_SUBAGENT_RESULT_CHARS),
    ...(truncated ? { resultTruncated: true } : {}),
    error: record.error?.slice(0, 2_000),
    totalTokens: record.totalTokens,
    totalToolUseCount: record.totalToolUseCount,
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
