import type { SideChatParentStatus } from "@/lib/side-chat/types";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";

export const SIDE_CHAT_TAB_PREFIX = "sidechat:";
export const SIDE_CHAT_LOADING_PREFIX = "sidechat-loading:";
export const SIDE_CHAT_SKIP_TEMP_CLOSE_CONFIRM_KEY = "piora-side-chat-skip-temp-close-confirm";
export const PIORA_SIDE_CHAT_INSERT_MAIN_EVENT = "piora:side-chat-insert-main";
export const PIORA_SIDE_CHAT_FOCUS_COMPOSER_EVENT = "piora:side-chat-focus-composer";

export type SideChatTabId = `${typeof SIDE_CHAT_TAB_PREFIX}${string}` | `${typeof SIDE_CHAT_LOADING_PREFIX}${string}`;

export function isSideChatTab(tab: string): tab is SideChatTabId {
  return tab.startsWith(SIDE_CHAT_TAB_PREFIX) || tab.startsWith(SIDE_CHAT_LOADING_PREFIX);
}

export function parseSideChatTabId(tab: string): { kind: "live" | "loading"; id: string } | null {
  if (tab.startsWith(SIDE_CHAT_TAB_PREFIX)) {
    const id = tab.slice(SIDE_CHAT_TAB_PREFIX.length);
    return id ? { kind: "live", id } : null;
  }
  if (tab.startsWith(SIDE_CHAT_LOADING_PREFIX)) {
    const id = tab.slice(SIDE_CHAT_LOADING_PREFIX.length);
    return id ? { kind: "loading", id } : null;
  }
  return null;
}

export function toSideChatTabId(id: string): `${typeof SIDE_CHAT_TAB_PREFIX}${string}` {
  return `${SIDE_CHAT_TAB_PREFIX}${id}`;
}

export function toSideChatLoadingTabId(clientId: string): `${typeof SIDE_CHAT_LOADING_PREFIX}${string}` {
  return `${SIDE_CHAT_LOADING_PREFIX}${clientId}`;
}

export function dispatchInsertIntoMainComposer(text: string): void {
  if (typeof window === "undefined") return;
  const trimmed = text.trim();
  if (!trimmed) return;
  window.dispatchEvent(new CustomEvent<{ text: string }>(PIORA_SIDE_CHAT_INSERT_MAIN_EVENT, { detail: { text: trimmed } }));
}

export function dispatchFocusSideChatComposer(sideId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ sideId?: string }>(PIORA_SIDE_CHAT_FOCUS_COMPOSER_EVENT, { detail: { sideId } }));
}

export function deriveParentStatus(
  snapshot: TaskRuntimeSnapshot | null | undefined,
  parentRunning = false,
): SideChatParentStatus {
  if (snapshot?.pendingApproval || snapshot?.awaitingPlanApproval || snapshot?.taskRun?.phase === "waiting_approval") {
    return "needs_approval";
  }
  if (snapshot?.lastPromptFailed || snapshot?.taskRun?.phase === "failed") {
    return "failed";
  }
  if (snapshot?.runtime === "compacting") {
    return "compacting";
  }
  if (snapshot?.taskRun?.phase === "waiting_user") {
    return "needs_input";
  }
  if (snapshot?.runtime === "running" || snapshot?.runtime === "stopping" || parentRunning) {
    return "running";
  }
  return "idle";
}
