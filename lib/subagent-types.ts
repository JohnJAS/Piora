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
  result: string; error?: string; totalTokens: number; totalToolUseCount: number;
}
export interface SubagentLaunch {
  description: string; prompt: string; subagent_type?: string; run_in_background?: boolean;
}
