import { HarmonyError } from "../errors";
import { requireValidObservation } from "../observation/quality";
import type { HarmonyAutomationBackend, HarmonyLease } from "../types";
import type { HarmonyApprovalStore } from "./approval-store";

/** Task grants are scoped to one lease/epoch and application, never button words. */
export class HarmonyPolicyEngine {
  private readonly grants = new Map<number, Set<string>>();
  constructor(private readonly approvals: HarmonyApprovalStore) {}
  revoke(epoch: number) { this.grants.delete(epoch); }
  async authorize(lease: HarmonyLease, backend: HarmonyAutomationBackend, method: keyof HarmonyAutomationBackend, args: unknown[], signal: AbortSignal) {
    // A manual lease is acquired only by the desktop's explicit take-control UI.
    // High-risk commands are independently approved by the manager for all owners.
    if (lease.owner.kind === "manual") return;
    if (["installPackage", "uninstallPackage", "clearAppData", "startRecording"].includes(method)) return;
    if (method === "pressKey" && ["home", "recents"].includes(String(args[1])) || method === "keyHold") {
      await this.approvals.require(lease, "system_control", { method, input: JSON.stringify(args.slice(1).filter(value => !(value instanceof AbortSignal))) });
      return;
    }
    let app: string;
    if (method === "launchApp" || method === "stopApp") app = String(args[1]);
    else {
      const observation = await backend.snapshot(lease.serial, { includeTree: true, includeScreenshot: false, signal });
      requireValidObservation(observation);
      if (!observation.quality?.appId || !observation.quality.windowId) throw new HarmonyError("OBSERVATION_UNAVAILABLE", "Task control requires an observed foreground application and window", { details: { dispatchState: "not-sent" } });
      app = observation.quality.appId;
    }
    const approved = this.grants.get(lease.leaseEpoch) ?? new Set<string>();
    if (approved.has(app)) return;
    await this.approvals.require(lease, "test_control", { bundleName: app, scope: "ordinary application control for this task and lease; submissions can have external effects" });
    approved.add(app); this.grants.set(lease.leaseEpoch, approved);
  }
}
