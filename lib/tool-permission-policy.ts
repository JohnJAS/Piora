export const PERMISSION_MODES = ["ask", "auto", "full"] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];
export interface ToolPermissionState { mode: PermissionMode; revision: number; legacy?: boolean }
export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.includes(value as PermissionMode);
}

/** Only known structured operations are exempt. Names/keywords never prove arbitrary code safe. */
export function needsToolApproval(state: ToolPermissionState, name: string, input: unknown): boolean {
  if (state.legacy || state.mode === "full") return false;
  if (["read", "grep", "find", "ls", "piora_request_user_input"].includes(name)) return false;
  const action = input && typeof input === "object" ? (input as { action?: unknown }).action : undefined;
  if (name === "browser" && ["snapshot", "screenshot", "tabs", "scroll", "wait_for_user"].includes(String(action))) return false;
  if (state.mode === "auto") {
    if (["write", "edit"].includes(name)) return false;
    // Opening a page is navigation. Click/type/press can submit, delete, or purchase;
    // without structured effect metadata they require approval in auto mode.
    if (name === "browser" && ["open", "new_tab", "switch_tab", "back", "forward", "reload", "close_tab", "close"].includes(String(action))) return false;
  }
  return true;
}
