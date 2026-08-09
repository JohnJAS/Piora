export const APPROVAL_TITLE_PREFIX = "__PIORA_APPROVAL__";
export const APPROVAL_ALLOW_ONCE = "allow-once";
export const APPROVAL_ALLOW_TASK = "allow-task";
export const APPROVAL_REJECT = "reject";
export const APPROVAL_OPTIONS = [APPROVAL_ALLOW_ONCE, APPROVAL_ALLOW_TASK, APPROVAL_REJECT] as const;

export interface ApprovalPrompt {
  toolName: string;
  summary: string;
  reason: string;
}

export function encodeApprovalTitle(prompt: ApprovalPrompt): string {
  return `${APPROVAL_TITLE_PREFIX}${JSON.stringify(prompt)}`;
}

export function decodeApprovalTitle(title: string): ApprovalPrompt | null {
  if (!title.startsWith(APPROVAL_TITLE_PREFIX)) return null;
  try {
    const value = JSON.parse(title.slice(APPROVAL_TITLE_PREFIX.length)) as Partial<ApprovalPrompt>;
    if (typeof value.toolName !== "string" || typeof value.summary !== "string" || typeof value.reason !== "string") return null;
    return value as ApprovalPrompt;
  } catch {
    return null;
  }
}
