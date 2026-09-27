import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFileAtomicSync } from "../../atomic-file";
import { HarmonyError } from "../errors";
import { requireValidObservation } from "../observation/quality";
import type { HarmonyScenarioOptions, HarmonyScenarioResult, HarmonyScenarioStepResult, HarmonySnapshot } from "../types";

export interface ScenarioExecution {
  processId: number;
  flowVersion: 1; flowHash: string; deviceFingerprint?: string;
  artifactHashes: Record<string, string>;
  id: string; serial: string; ownerId: string; sessionId?: string; deviceEpoch: number;
  status: "running" | "passed" | "failed" | "interrupted";
  startedAt: string; updatedAt: string;
  steps: HarmonyScenarioStepResult[];
  checkpoint?: { name: string; stepIndex: number; observationHash: string };
  resumedFrom?: string;
}
export function observationFingerprint(snapshot: HarmonySnapshot): string {
  requireValidObservation(snapshot);
  return createHash("sha256").update(JSON.stringify({ quality: snapshot.quality, nodes: snapshot.nodes?.map(({ ref, parentRef, ...node }) => { void ref; void parentRef; return node; }) })).digest("hex");
}
/** Private local execution journal; public records exclude inputs, trees and screenshots. */
export class ScenarioExecutionStore {
  constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  private path(id: string, suffix = "json") {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HarmonyError("INVALID_ARGUMENT", "Invalid scenario execution ID");
    return join(this.directory, `${id}.${suffix}`);
  }
  create(options: HarmonyScenarioOptions, owner: { id: string; sessionId?: string }, deviceEpoch: number, resumedFrom?: string, fingerprint?: string): ScenarioExecution {
    if (this.list().length >= 500) throw new HarmonyError("DEVICE_BUSY", "Scenario journal is full; export and remove older records first");
    const now = new Date().toISOString();
    const artifactHashes: Record<string, string> = {};
    for (const [index, step] of options.steps.entries()) if (step.action === "install_app") {
      if (statSync(step.hapPath).size > 256 * 1024 * 1024) throw new HarmonyError("INVALID_ARGUMENT", "HAP exceeds the journal artifact limit");
      artifactHashes[String(index)] = createHash("sha256").update(readFileSync(step.hapPath)).digest("hex");
    }
    const record: ScenarioExecution = { processId: process.pid, flowVersion: 1, deviceFingerprint: fingerprint,
      flowHash: createHash("sha256").update(JSON.stringify(options.steps)).digest("hex"), artifactHashes, id: randomUUID(), serial: options.serial, ownerId: owner.id, sessionId: owner.sessionId, deviceEpoch,
      status: "running", startedAt: now, updatedAt: now, resumedFrom,
      steps: options.steps.map((step, index) => ({ index, id: step.id, action: step.action, status: "not-run", durationMs: 0 })),
    };
    writePrivateFileAtomicSync(this.path(record.id, "inputs.json"), JSON.stringify({ steps: options.steps, policy: options.policy }));
    this.write(record); return record;
  }
  write(record: ScenarioExecution) { record.updatedAt = new Date().toISOString(); writePrivateFileAtomicSync(this.path(record.id), JSON.stringify(record)); }
  get(id: string): ScenarioExecution {
    const path = this.path(id);
    if (statSync(path).size > 1024 * 1024) throw new HarmonyError("INVALID_RESPONSE", "Scenario record exceeds limit");
    return JSON.parse(readFileSync(path, "utf8")) as ScenarioExecution;
  }
  remove(id: string, serial: string) {
    const record = this.get(id);
    if (record.serial !== serial || record.status === "running") throw new HarmonyError("DEVICE_BUSY", "Only completed records for the selected device can be removed");
    unlinkSync(this.path(id, "inputs.json")); unlinkSync(this.path(id));
  }
  list(serial?: string): ScenarioExecution[] {
    return readdirSync(this.directory).filter(file => /^[a-f0-9-]{36}\.json$/.test(file)).map(file => this.get(file.slice(0, -5)))
      .filter(record => !serial || record.serial === serial).sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  }
  recoverInterrupted() {
    for (const record of this.list()) if (record.status === "running") {
      try { process.kill(record.processId, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        record.status = "interrupted";
        for (const step of record.steps) if (step.status === "running") { step.status = "failed"; step.message = "Process exited during this step; effect unknown; do not replay"; }
        this.write(record);
      } }
    }
  }
  finish(record: ScenarioExecution, result: HarmonyScenarioResult) { record.status = result.status; record.steps = result.steps; this.write(record); }
  resumeInputs(id: string, snapshot: HarmonySnapshot, sessionId?: string, fingerprint?: string): Pick<HarmonyScenarioOptions, "steps" | "policy"> {
    const record = this.get(id);
    if (record.flowVersion !== 1 || record.deviceFingerprint !== fingerprint) throw new HarmonyError("STALE_SNAPSHOT", "Device or workflow version changed; start a fresh scenario");
    if (record.sessionId !== sessionId || record.serial !== snapshot.serial || record.status === "running" || !record.checkpoint) {
      throw new HarmonyError("INVALID_ARGUMENT", "Execution cannot be resumed in this task or device");
    }
    if (record.checkpoint.observationHash !== observationFingerprint(snapshot)) throw new HarmonyError("STALE_SNAPSHOT", "The device no longer matches the saved checkpoint; start a new scenario with fresh preconditions");
    const next = record.checkpoint.stepIndex + 1;
    const unsafe = record.steps.slice(next).some(step => step.status === "passed" || step.status === "running" || (step.status === "failed" && step.receipt?.dispatchState !== "not-sent" && (step.error?.details as Record<string, unknown> | undefined)?.dispatchState !== "not-sent"));
    if (unsafe) throw new HarmonyError("SCENARIO_FAILED", "Actions after the checkpoint may have executed; automatic replay is forbidden", { details: { dispatchState: "unknown" } });
    const inputs = JSON.parse(readFileSync(this.path(id, "inputs.json"), "utf8")) as Pick<HarmonyScenarioOptions, "steps" | "policy">;
    if (createHash("sha256").update(JSON.stringify(inputs.steps)).digest("hex") !== record.flowHash) throw new HarmonyError("STALE_SNAPSHOT", "Saved workflow inputs changed");
    for (const [index, step] of inputs.steps.entries()) if (step.action === "install_app") {
      if (statSync(step.hapPath).size > 256 * 1024 * 1024 || createHash("sha256").update(readFileSync(step.hapPath)).digest("hex") !== record.artifactHashes[String(index)]) throw new HarmonyError("STALE_SNAPSHOT", "The approved workflow artifact changed");
    }
    if (next >= inputs.steps.length) throw new HarmonyError("INVALID_ARGUMENT", "No steps remain after this checkpoint");
    return { steps: inputs.steps.slice(next), policy: inputs.policy };
  }
}
