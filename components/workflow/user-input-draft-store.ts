"use client";

import type { UserInputAnswers } from "@/lib/user-input";

export interface UserInputDraft {
  answers: UserInputAnswers;
  customText: Record<string, string>;
  activeIndex: number;
}

const drafts = new Map<string, UserInputDraft>();
const MAX_DRAFTS = 40;

function draftKey(sessionId: string | undefined, requestId: string): string {
  return `${sessionId ?? "anon"}:${requestId}`;
}

export function getUserInputDraft(sessionId: string | undefined, requestId: string): UserInputDraft | null {
  return drafts.get(draftKey(sessionId, requestId)) ?? null;
}

export function setUserInputDraft(sessionId: string | undefined, requestId: string, draft: UserInputDraft): void {
  const key = draftKey(sessionId, requestId);
  if (drafts.has(key)) drafts.delete(key);
  drafts.set(key, draft);
  while (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
    else break;
  }
}

export function clearUserInputDraft(sessionId: string | undefined, requestId: string): void {
  drafts.delete(draftKey(sessionId, requestId));
}
