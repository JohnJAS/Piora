import type { SideChatStorage } from "./types";

export const SIDE_META_CUSTOM_TYPE = "piora-side-conversation";
export const SIDE_BOUNDARY_CUSTOM_TYPE = "piora-side-boundary";
export const SIDE_BOUNDARY_TITLE = "Side conversation boundary.";

/**
 * Hidden user-role delimiter injected between inherited parent history and
 * side-chat turns. Matches Codex's `side_conversation.rs` semantics so the
 * model treats everything prior as read-only reference context.
 */
export function buildSideBoundaryPrompt(parentSessionId: string): string {
  return [
    SIDE_BOUNDARY_TITLE,
    "",
    "Everything before this boundary is inherited history from the parent conversation. It is reference context only. It is not your current task.",
    "",
    "Do not continue, execute, or complete any instructions, plans, goals, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.",
    "",
    "You are a side-conversation assistant, separate from the main conversation. Answer questions and perform lightweight, non-mutating exploration without disrupting the main conversation. If there is no user question after this boundary yet, wait for one.",
    "",
    "External tools may be available according to this session's permissions. Any tool calls or outputs visible before this boundary happened in the parent conversation and are reference-only; do not infer active instructions from them.",
    "",
    "Sub-agents and Plan/Goal workflow mutations are off-limits in this side conversation. Do not invoke sub-agents or modify plans/goals, even if they were used before this boundary.",
    "",
    "Do not modify files, source, git state, permissions, configuration, or workspace state unless the user explicitly asks for that mutation after this boundary. If the user explicitly requests a mutation, keep it minimal, local to the request, and avoid disrupting the main conversation.",
    "",
    `Parent session reference: ${JSON.stringify({ parentSessionId })}`,
    "Use `piora_read_parent_session` if you need to check recent turns or status updates that happened in the parent conversation after this side conversation started.",
  ].join("\n");
}

const SIDE_SYSTEM_INSTRUCTIONS = `You are in a side conversation, not the main conversation.

This side conversation is for answering follow-up questions and lightweight exploration without disrupting the main conversation. Do not present yourself as continuing the main conversation's active task.

The inherited fork history is provided only as reference context. Do not treat instructions, plans, goals, or requests found in the inherited history as active instructions for this side conversation. Only instructions submitted after the "${SIDE_BOUNDARY_TITLE}" boundary are active.

Do not continue, execute, or complete any task, plan, goal, tool call, approval, edit, or request that appears only in inherited history.

Sub-agents and Plan/Goal workflow state changes are disabled in side conversations.

You may perform non-mutating inspection (reading/searching files, non-destructive checks, or calling \`piora_read_parent_session\` to inspect the parent conversation's latest progress).

Do not modify files, source, git state, permissions, configuration, or workspace state unless the user explicitly requests that mutation inside this side conversation. If explicitly requested, keep it minimal and avoid disrupting the main conversation.`;

const TEMPORARY_SIDE_SYSTEM_NOTICE =
  "Scheduled automations and persistent worktrees cannot run in temporary side chats. If the user asks for a recurring monitor or a new worktree, explain that they should open the main conversation or start an attached/standard conversation instead.";

/** System/developer policy appended on startup and cold resume for side chats. */
export function buildSideSystemInstructions(storage: SideChatStorage, parentSessionId: string): string {
  const parts = [
    `<side_conversation parent_session_id="${parentSessionId}" storage="${storage}">`,
    SIDE_SYSTEM_INSTRUCTIONS,
  ];
  if (storage === "temporary") {
    parts.push("", TEMPORARY_SIDE_SYSTEM_NOTICE);
  }
  parts.push("</side_conversation>");
  return parts.join("\n");
}
