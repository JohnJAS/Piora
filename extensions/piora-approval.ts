import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decideApproval, describeApproval } from "../lib/approval-policy";
import { getPermissionTier } from "../lib/approval-runtime";
import { APPROVAL_ALLOW_ONCE, APPROVAL_ALLOW_TASK, APPROVAL_OPTIONS, encodeApprovalTitle } from "../lib/approval-ui";

export default function pioraApproval(api: ExtensionAPI) {
  const allowedForTask = new Map<string, Set<string>>();
  api.on("tool_call", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const tier = getPermissionTier(sessionId);
    const decision = decideApproval(event.toolName, event.input, tier);
    if (decision === "allow") return;
    if (decision === "deny") return { block: true, reason: "The current read-only permission tier does not allow this operation." };

    const fingerprint = event.toolName === "bash" ? "bash-dangerous" : event.toolName;
    if (allowedForTask.get(sessionId)?.has(fingerprint)) return;
    const detail = describeApproval(event.toolName, event.input);
    const selected = await ctx.ui.select(
      encodeApprovalTitle({ toolName: event.toolName, ...detail }),
      [...APPROVAL_OPTIONS],
    );
    if (selected === APPROVAL_ALLOW_TASK) {
      const allowed = allowedForTask.get(sessionId) ?? new Set<string>();
      allowed.add(fingerprint);
      allowedForTask.set(sessionId, allowed);
      return;
    }
    if (selected === APPROVAL_ALLOW_ONCE) return;
    return { block: true, reason: "The user rejected this operation." };
  });
}
