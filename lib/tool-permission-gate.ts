import { needsToolApproval, type ToolPermissionState } from "./tool-permission-policy.ts";

export async function authorizeTool(input: {
  name: string; args: unknown;
  read(): ToolPermissionState;
  active(): boolean;
  ask(): Promise<"once" | "full" | "deny">;
  grantFull(): void;
}): Promise<boolean> {
  while (input.active()) {
    const before = input.read();
    if (!needsToolApproval(before, input.name, input.args)) return true;
    const decision = await input.ask();
    if (!input.active() || decision === "deny") return false;
    // A response to an older policy cannot undo a subsequent restriction.
    const current = input.read();
    if (before.revision !== current.revision || before.mode !== current.mode) continue;
    if (decision === "full") input.grantFull();
    return input.active();
  }
  return false;
}
