import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file.ts";
import { DEFAULT_WORKFLOW_TURN_BUDGET, type WorkflowRun, type WorkflowSnapshot } from "./workflow-types.ts";

export interface WorkflowRecord { schemaVersion: 1; epoch: string; snapshot: WorkflowSnapshot; actions: string[] }
const host = globalThis as typeof globalThis & { __pioraWorkflowEpoch?: string };
export const workflowEpoch = host.__pioraWorkflowEpoch ??= randomUUID();

export function settleActiveDuration(run: WorkflowRun, now = Date.now()): void {
  if (typeof run.activeSince === "number" && Number.isFinite(run.activeSince)) {
    run.timeUsedMs = (run.timeUsedMs ?? 0) + Math.max(0, now - run.activeSince);
    run.activeSince = null;
  }
}

export class WorkflowStore {
  readonly plansDirectory: string;

  constructor(
    readonly directory: string = join(getAgentDir(), "piora", "workflows"),
    plansDirectory?: string,
  ) {
    const defaultWorkflowDir = join(getAgentDir(), "piora", "workflows");
    this.plansDirectory = plansDirectory ?? (
      directory === defaultWorkflowDir
        ? join(getAgentDir(), "piora", "plans")
        : join(directory, "plans")
    );
  }

  private path(sessionId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error("Invalid workflow session id");
    return join(this.directory, `${sessionId}.json`);
  }

  read(sessionId: string): WorkflowRecord {
    let record: WorkflowRecord;
    try { record = JSON.parse(readFileSync(this.path(sessionId), "utf8")) as WorkflowRecord; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { schemaVersion: 1, epoch: workflowEpoch, actions: [], snapshot: { sessionId, revision: 0, mode: "agent", turnBudget: DEFAULT_WORKFLOW_TURN_BUDGET, current: null, history: [] } };
    }
    if (record.schemaVersion !== 1 || record.snapshot?.sessionId !== sessionId || !Number.isSafeInteger(record.snapshot.revision)
      || !["agent", "plan", "goal"].includes(record.snapshot.mode) || !Array.isArray(record.snapshot.history) || !Array.isArray(record.actions)) throw new Error("Invalid workflow state; refusing to reset it");
    // Reading history never starts a model or replays an execution from a dead host.
    if (record.epoch !== workflowEpoch) {
      const now = Date.now();
      const run = record.snapshot.current;
      if (run && ["running", "planning"].includes(run.status)) {
        settleActiveDuration(run, now);
        run.status = "paused";
        run.reason = "host_restarted";
        run.updatedAt = now;
      }
      if (record.snapshot.autoContinuing) delete record.snapshot.autoContinuing;
      // Even an unchanged review snapshot needs a fresh user action identity.
      // A click queued by the previous process must not become execution here.
      record.snapshot.revision++;
      record.epoch = workflowEpoch;
      this.write(record);
    }
    return record;
  }

  write(record: WorkflowRecord): void {
    const path = this.path(record.snapshot.sessionId);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writePrivateFileAtomicSync(path, JSON.stringify(record));
  }
}

export function readWorkflowSnapshot(sessionId: string): WorkflowSnapshot { return new WorkflowStore().read(sessionId).snapshot; }
