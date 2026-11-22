export type SideChatStorage = "attached" | "temporary";

export interface SideChatSettings {
  enabled: boolean;
}

export interface SideChatMetaEntry {
  version: 1;
  parentSessionId: string;
  storage: SideChatStorage;
  boundaryEntryId: string;
  createdAt: string;
  inheritedLeafId?: string | null;
  archived?: boolean;
  archivedAt?: string;
}

export interface SideChatSummary {
  id: string;
  parentSessionId: string;
  cwd: string;
  title: string;
  isDefaultTitle: boolean;
  preview: string;
  storage: SideChatStorage;
  archived: boolean;
  expired: boolean;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  running: boolean;
  lastPromptFailed?: boolean;
}

export type SideChatParentStatus =
  | "idle"
  | "running"
  | "compacting"
  | "needs_input"
  | "needs_approval"
  | "failed";

export const SIDE_CHAT_TOOL_NAMES = ["piora_read_parent_session"] as const;

export function isSideChatTool(name: string): boolean {
  return (SIDE_CHAT_TOOL_NAMES as readonly string[]).includes(name);
}

export class SideChatError extends Error {
  constructor(
    readonly code:
      | "SIDE_CHAT_DISABLED"
      | "PARENT_NOT_FOUND"
      | "PARENT_NOT_STARTED"
      | "PARENT_ARCHIVED"
      | "NESTED_SIDE_CHAT_FORBIDDEN"
      | "SIDE_CHAT_NOT_FOUND"
      | "SIDE_CHAT_FORBIDDEN"
      | "INVALID_REQUEST",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SideChatError";
  }
}
