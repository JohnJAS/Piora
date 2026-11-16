import { randomUUID } from "node:crypto";
import { listSubagentProfiles, readSubagentSettings } from "./subagent-settings.ts";
import { listSubagentRecords, saveSubagent } from "./subagent-store.ts";
import type { SubagentLaunch, SubagentProfile, SubagentRecord, SubagentSettings } from "./subagent-types.ts";

export interface SubagentDriver {
  run(record: SubagentRecord, profile: SubagentProfile, signal: AbortSignal,
    progress: (tokens: number, tools: number) => void): Promise<string>;
  notify(record: SubagentRecord): Promise<void>;
  changed?(record: SubagentRecord): void;
}
export class SubagentRuntime {
  private records = new Map<string, SubagentRecord>();
  private active = new Map<string, { controller: AbortController; task: Promise<SubagentRecord> }>();
  private disposed = false;
  constructor(readonly parentSessionId: string, readonly cwd: string, private driver: SubagentDriver,
    private settings: () => SubagentSettings = readSubagentSettings) {
    for (const record of listSubagentRecords(parentSessionId)) {
      if (record.status === "running") { record.status = "interrupted"; record.endedAt = Date.now(); record.error = "Application stopped before this task completed. Check effects before continuing."; saveSubagent(record); }
      this.records.set(record.agentId, record);
    }
  }
  list(): SubagentRecord[] { return [...this.records.values()].map(record => ({ ...record })); }
  get running(): boolean { return this.active.size > 0; }
  get(id: string): SubagentRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("Subagent does not belong to this conversation");
    return { ...record };
  }
  private persist(record: SubagentRecord) { saveSubagent(record); this.records.set(record.agentId, record); this.driver.changed?.({ ...record }); }
  private profile(name: string): SubagentProfile {
    const settings = this.settings();
    if (!settings.enabled || this.disposed) throw new Error("Subagents are disabled");
    const available = listSubagentProfiles(this.cwd).filter(profile => !settings.disabledProfiles.includes(profile.name));
    const exact = available.find(profile => profile.name === name);
    const matches = exact ? [exact] : available.filter(profile => profile.name.toLowerCase() === name.toLowerCase());
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous subagent type '${name}'. Available: ${available.map(profile => profile.name).join(", ")}`);
    const profile = { ...matches[0] };
    profile.model = Object.hasOwn(settings.modelOverrides, profile.name) && settings.modelOverrides[profile.name] || profile.model;
    return profile;
  }
  async launch(input: SubagentLaunch, toolCallId: string, signal?: AbortSignal): Promise<SubagentRecord> {
    const profile = this.profile(input.subagent_type ?? "general-purpose");
    if (!input.description?.trim() || input.description.length > 500 || !input.prompt?.trim() || input.prompt.length > 100_000) throw new TypeError("Provide a description and a bounded task prompt");
    const record: SubagentRecord = { version: 1, agentId: `agent_${randomUUID()}`, parentSessionId: this.parentSessionId, parentToolCallId: toolCallId,
      agentType: profile.name, description: input.description, prompt: input.prompt, status: "running",
      background: (input.run_in_background ?? profile.background) === true, startedAt: Date.now(), result: "", totalTokens: 0, totalToolUseCount: 0 };
    return this.execute(record, profile, signal);
  }
  async continue(id: string, prompt: string, signal?: AbortSignal): Promise<SubagentRecord> {
    const record = this.get(id), profile = this.profile(record.agentType);
    if (!prompt?.trim() || prompt.length > 100_000) throw new TypeError("Provide a bounded message");
    if (this.active.has(id)) throw new Error("Subagent is running; wait for its result before continuing");
    if (!record.childSessionFile) throw new Error("Subagent has no saved context to continue");
    record.prompt = prompt; record.background = false; record.status = "running"; record.error = undefined; record.endedAt = undefined;
    return this.execute(record, profile, signal);
  }
  private async execute(record: SubagentRecord, profile: SubagentProfile, parentSignal?: AbortSignal): Promise<SubagentRecord> {
    const settings = this.settings();
    if (!settings.enabled || this.disposed) throw new Error("Subagents are disabled");
    parentSignal?.throwIfAborted();
    if (this.active.size >= settings.maxConcurrency) throw new Error(`Subagent concurrency limit (${settings.maxConcurrency}) reached. Wait for an existing task.`);
    if (this.list().reduce((sum, item) => sum + item.totalTokens, 0) >= settings.maxTokens) throw new Error("Subagent token budget exhausted");
    const controller = new AbortController();
    const cancel = () => controller.abort(parentSignal?.reason ?? new Error("Parent task cancelled"));
    if (!record.background) parentSignal?.addEventListener("abort", cancel, { once: true });
    const baseTokens = record.totalTokens, baseTools = record.totalToolUseCount;
    const timer = setTimeout(() => controller.abort(new Error("Subagent timed out")), settings.timeoutSeconds * 1000);
    this.persist(record);
    // Register synchronously before invoking the driver, including drivers that settle immediately.
    const task = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const result = await this.driver.run(record, profile, controller.signal, (tokens, tools) => {
          record.totalTokens = baseTokens + tokens; record.totalToolUseCount = baseTools + tools;
          this.persist(record);
          const current = this.settings();
          if (!current.enabled) controller.abort(new Error("Subagents were disabled"));
          if (this.list().reduce((sum, item) => sum + item.totalTokens, 0) >= current.maxTokens) controller.abort(new Error("Subagent token budget exhausted"));
        });
        controller.signal.throwIfAborted();
        const suffix = "\n[Truncated; see child transcript.]";
        record.result = result.length > settings.maxResultChars ? `${result.slice(0, Math.max(0, settings.maxResultChars - suffix.length))}${suffix}`.slice(0, settings.maxResultChars) : result;
        record.status = "completed";
      } catch (error) {
        const reason = controller.signal.aborted ? controller.signal.reason : error;
        record.error = reason instanceof Error ? reason.message : String(reason);
        record.status = controller.signal.aborted && !/timed out|budget|turn limit/i.test(record.error) ? "cancelled" : "failed";
      } finally {
        clearTimeout(timer); parentSignal?.removeEventListener("abort", cancel);
        record.endedAt = Date.now(); this.active.delete(record.agentId); this.persist(record);
      }
      if (record.background && !this.disposed && record.status !== "cancelled" && this.settings().enabled) {
        try { await this.driver.notify({ ...record }); } catch { /* The durable result remains readable via TaskOutput/UI. Never repeat child effects to retry a notification. */ }
      }
      return { ...record };
    });
    this.active.set(record.agentId, { controller, task });
    return record.background ? { ...record } : task;
  }
  async output(id: string, block = false, signal?: AbortSignal): Promise<SubagentRecord> {
    const record = this.get(id), running = this.active.get(id);
    if (!block || !running) return record;
    signal?.throwIfAborted();
    let abort: (() => void) | undefined;
    try { return await Promise.race([running.task, new Promise<never>((_, reject) => {
      abort = () => reject(signal?.reason ?? new Error("Wait cancelled")); signal?.addEventListener("abort", abort, { once: true });
    })]); } finally { if (abort) signal?.removeEventListener("abort", abort); }
  }
  stop(id: string, reason = "Subagent cancelled"): SubagentRecord {
    const record = this.get(id); this.active.get(id)?.controller.abort(new Error(reason)); return record;
  }
  async stopAll(reason = "Parent task cancelled"): Promise<void> {
    const running = [...this.active.values()];
    for (const item of running) item.controller.abort(new Error(reason));
    await Promise.allSettled(running.map(item => item.task));
  }
  async dispose(): Promise<void> { this.disposed = true; await this.stopAll("Parent conversation closed"); }
}
const host = globalThis as typeof globalThis & { __pioraSubagents?: Map<string, SubagentRuntime> };
export function getSubagentRuntime(sessionId: string): SubagentRuntime | undefined { return host.__pioraSubagents?.get(sessionId); }
export function bindSubagentRuntime(runtime: SubagentRuntime): () => void {
  const map = host.__pioraSubagents ??= new Map(); map.set(runtime.parentSessionId, runtime);
  return () => { if (map.get(runtime.parentSessionId) === runtime) map.delete(runtime.parentSessionId); void runtime.dispose(); };
}
export async function stopAllSubagents(): Promise<void> { await Promise.all([...host.__pioraSubagents?.values() ?? []].map(runtime => runtime.stopAll("Subagents were disabled"))); }
