import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { readBoundedRegularFile, enforceArtifactQuota } from "../runtime/bounded-file";
import { HarmonyError } from "../errors";
import type { HarmonyLease } from "../types";

export type ProtectedAction = "install_app" | "uninstall_app" | "clear_app_data" | "initialize_mirror" | "start_recording" | "calibrate_input" | "calibrate_audio" | "test_control" | "system_control";
export interface ActionApproval {
  id: string;
  serial: string;
  ownerId: string;
  sessionId?: string;
  deviceEpoch: number;
  leaseEpoch: number;
  action: ProtectedAction;
  parameters: Record<string, string | boolean>;
  actionHash: string;
  artifactHash?: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  createdAt: string;
  expiresAt: string;
}

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** No reusable bearer is returned to the model. Approvals die with the runtime/lease. */
export class HarmonyApprovalStore {
  private readonly records = new Map<string, ActionApproval>();
  constructor(private readonly artifactDirectory: string, private readonly now: () => number = Date.now) {}

  private sweep() {
    for (const [id, record] of this.records) {
      if (Date.parse(record.expiresAt) <= this.now()) record.status = "expired";
      if (Date.parse(record.expiresAt) + 60_000 <= this.now()) this.records.delete(id);
    }
  }

  list(): ActionApproval[] { this.sweep(); return structuredClone([...this.records.values()]); }

  resolve(id: string, approved: boolean): ActionApproval {
    this.sweep();
    const record = this.records.get(id);
    if (!record || record.status !== "pending") throw new HarmonyError("INVALID_ARGUMENT", "Approval is missing or no longer pending");
    record.status = approved ? "approved" : "denied";
    return structuredClone(record);
  }

  revoke(leaseEpoch: number): void {
    for (const record of this.records.values()) {
      if (record.leaseEpoch === leaseEpoch && ["pending", "approved"].includes(record.status)) record.status = "expired";
    }
  }

  async require(lease: HarmonyLease, action: ProtectedAction, parameters: Record<string, string | boolean>): Promise<{ artifactPath?: string }> {
    this.sweep();
    let data: Buffer | undefined;
    let artifactHash: string | undefined;
    if (action === "install_app" || action === "initialize_mirror") {
      const path = parameters.hapPath;
      if (typeof path !== "string" || !isAbsolute(path) || extname(path).toLowerCase() !== ".hap") {
        throw new HarmonyError("INVALID_ARGUMENT", "An absolute HAP artifact path is required");
      }
      const info = await lstat(path).catch(() => undefined);
      if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 256 * 1024 * 1024) {
        throw new HarmonyError("INVALID_ARGUMENT", "HAP must be a regular file between 1 byte and 256 MiB");
      }
      data = await readBoundedRegularFile(path, 256 * 1024 * 1024);
      if (data.length !== info.size) throw new HarmonyError("INVALID_ARGUMENT", "HAP changed while being imported; retry with a stable artifact");
      artifactHash = hash(data);
      parameters = { ...parameters, hapPath: resolve(path) };
    }
    const sorted = Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)));
    const actionHash = hash(JSON.stringify([lease.serial, lease.owner.id, lease.owner.sessionId, lease.deviceEpoch, lease.leaseEpoch, action, sorted, artifactHash]));
    let record = [...this.records.values()].find(item => item.actionHash === actionHash && ["approved", "pending", "denied"].includes(item.status));
    if (!record) {
      if (this.records.size >= 128) throw new HarmonyError("DEVICE_BUSY", "Too many recent device approval requests");
      record = { id: randomUUID(), serial: lease.serial, ownerId: lease.owner.id, sessionId: lease.owner.sessionId,
        deviceEpoch: lease.deviceEpoch, leaseEpoch: lease.leaseEpoch, action, parameters: sorted, actionHash, artifactHash,
        status: "pending", createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(Math.min(Date.parse(lease.expiresAt), this.now() + 120_000)).toISOString() };
      this.records.set(record.id, record);
    }
    if (record.status !== "approved") {
      throw new HarmonyError("APPROVAL_REQUIRED", "Approve this exact device action in the Harmony workbench, then retry it once", {
        details: { approvalId: record.id, action, status: record.status, dispatchState: "not-sent" },
      });
    }
    // Consume before asynchronous IO; concurrent attempts cannot share one approval.
    record.status = "consumed";
    if (!data || !artifactHash) return {};
    await mkdir(this.artifactDirectory, { recursive: true, mode: 0o700 });
    await enforceArtifactQuota(this.artifactDirectory, "hap", data.length);
    const artifactPath = join(this.artifactDirectory, `${artifactHash}.hap`);
    try { await writeFile(artifactPath, data, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stored = await lstat(artifactPath);
    if (!stored.isFile() || stored.isSymbolicLink() || hash(await readBoundedRegularFile(artifactPath, 256 * 1024 * 1024)) !== artifactHash) {
      throw new HarmonyError("INVALID_ARGUMENT", "The imported HAP artifact failed integrity verification");
    }
    return { artifactPath };
  }
}
