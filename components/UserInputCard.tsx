"use client";

import type { UserInputAnswers } from "@/lib/user-input";
import { InlineUserInputCard, type UserInputRequest } from "./workflow/InlineUserInputCard";

export type { UserInputRequest };

/**
 * Renders `request_user_input` inline in the Composer surface (Codex-aligned).
 * Preserves the legacy `UserInputCard` export symbol for existing consumers.
 */
export function UserInputCard({
  request,
  sessionId,
  onRespond,
}: {
  request: UserInputRequest;
  sessionId?: string | null;
  onRespond: (request: UserInputRequest, response: { answers: UserInputAnswers } | { cancelled: true }) => void;
}) {
  return <InlineUserInputCard request={request} sessionId={sessionId} onRespond={onRespond} />;
}
