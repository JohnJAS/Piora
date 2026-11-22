import { randomUUID } from "node:crypto";
import { readSubagentSettings } from "./subagent-settings.ts";
import { listSubagentProfilesSafe } from "./subagents/profile-manager.ts";
import { listSubagentRecords, saveSubagent } from "./subagent-store.ts";
import {
  isSubagentProfileDisabled,
  resolveSubagentModelOverride,
  SUBAGENT_RESULT_TRUNCATION_SUFFIX,
  type SubagentLaunch,
  type SubagentProfile,
  type SubagentRecord,
  type SubagentSettings,
} from "./subagent-types.ts";

export interface SubagentActivityUpdate {
  currentTool?: string;
  currentActivity?: string;
}
export interface SubagentDriver {
  run(record: SubagentRecord, profile: SubagentProfile, signal: AbortSignal,
    progress: (tokens: number, tools: number, activity?: SubagentActivityUpdate) => void): Promise<string>;
  notify(record: SubagentRecord): Promise<void>;
  changed?(record: SubagentRecord): void;
}
export class SubagentRuntime {
  private records = new Map<string, SubagentRecord>();
  private active = new Map<string, { controller: AbortController; task: Promise<SubagentRecord> }>();
  private disposed = false;
  private notifications = 0;
  constructor(readonly parentSessionId: string, readonly cwd: string, private driver: SubagentDriver,
    private settings: () => SubagentSettings = readSubagentSettings) {
    for (const record of listSubagentRecords(parentSessionId)) {
      if (record.status === "running") { record.status = "interrupted"; record.endedAt = Date.now(); record.error = "Application stopped before this task completed. Check effects before continuing."; record.revision = (record.revision ?? 0) + 1; saveSubagent(record); }
      this.records.set(record.agentId, record);
    }
  }
  list(): SubagentRecord[] { return [...this.records.values()].map(record => ({ ...record })); }
  get running(): boolean { return this.active.size > 0 || this.notifications > 0; }
  get activeCount(): number { return this.active.size; }
  get(id: string): SubagentRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("Subagent does not belong to this conversation");
    return { ...record };
  }
  private persist(record: SubagentRecord) {
    record.revision = (record.revision ?? 0) + 1;
    saveSubagent(record);
    this.records.set(record.agentId, record);
    this.driver.changed?.({ ...record });
  }
  private profile(name: string, profileId?: string): SubagentProfile {
    const settings = this.settings();
    if (!settings.enabled || this.disposed) throw new Error("Subagents are disabled");
    const allProfiles = listSubagentProfilesSafe(this.cwd).profiles;
    if (profileId) {
      const byId = allProfiles.find(profile => profile.id === profileId);
      if (!byId) {
        throw new Error(`Subagent profile '${name}' (${profileId}) is no longer available`);
      }
      if (isSubagentProfileDisabled(settings, byId)) {
        throw new Error(`Subagent profile '${byId.name}' is disabled`);
      }
      const overrideModel = resolveSubagentModelOverride(settings, byId);
      return { ...byId, model: overrideModel || byId.model };
    }
    const available = allProfiles.filter(profile => !isSubagentProfileDisabled(settings, profile));
    const exact = available.find(profile => profile.name === name);
    let matches = exact ? [exact] : available.filter(profile => profile.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 0) {
      matches = available.filter(profile => profile.aliases?.includes(name));
    }
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous subagent type '${name}'. Available: ${available.map(profile => profile.name).join(", ")}`);
    const profile = { ...matches[0] };
    const overrideModel = resolveSubagentModelOverride(settings, profile);
    profile.model = overrideModel || profile.model;
    return profile;
  }
  async launch(input: SubagentLaunch, toolCallId: string, signal?: AbortSignal): Promise<SubagentRecord> {
    const profile = this.profile(input.subagent_type ?? "general-purpose");
    if (!input.description?.trim() || input.description.length > 500 || !input.prompt?.trim() || input.prompt.length > 100_000) throw new TypeError("Provide a description and a bounded task prompt");
    const record: SubagentRecord = {
      version: 1,
      agentId: `agent_${randomUUID()}`,
      parentSessionId: this.parentSessionId,
      parentToolCallId: toolCallId,
      agentType: profile.name,
      ...(profile.id ? { profileId: profile.id } : {}),
      description: input.description,
      prompt: input.prompt,
      status: "running",
      background: (input.run_in_background ?? profile.background) === true,
      startedAt: Date.now(),
      result: "",
      totalTokens: 0,
      totalToolUseCount: 0,
    };
    return this.execute(record, profile, signal);
  }
  async continue(id: string, prompt: string, signal?: AbortSignal): Promise<SubagentRecord> {
    const record = this.get(id), profile = this.profile(record.agentType, record.profileId);
    if (!prompt?.trim() || prompt.length > 100_000) throw new TypeError("Provide a bounded message");
    if (this.active.has(id)) throw new Error("Subagent is running; wait for its result before continuing");
    if (!record.childSessionFile) throw new Error("Subagent has no saved context to continue");
    record.agentType = profile.name;
    if (profile.id) record.profileId = profile.id;
    record.prompt = prompt; record.background = false; record.status = "running";
    record.attempt = (record.attempt ?? 1) + 1; record.attemptStartedAt = Date.now();
    record.result = ""; record.resultTruncated = undefined; record.resultEntryId = undefined; record.resultFullLength = undefined;
    record.error = undefined; record.endedAt = undefined;
    record.currentTool = undefined; record.currentActivity = undefined;
    return this.execute(record, profile, signal);
  }
  private async execute(record: SubagentRecord, profile: SubagentProfile, parentSignal?: AbortSignal): Promise<SubagentRecord> {
    const settings = this.settings();
    if (!settings.enabled || this.disposed) throw new Error("Subagents are disabled");
    parentSignal?.throwIfAborted();
    if (this.active.size >= settings.maxConcurrency) throw new Error(`Subagent concurrency limit (${settings.maxConcurrency}) reached. Wait for an existing task.`);
    if (settings.maxTokens > 0 && this.list().reduce((sum, item) => sum + item.totalTokens, 0) >= settings.maxTokens) {
      throw new Error("Subagent token budget exhausted");
    }
    const controller = new AbortController();
    const cancel = () => controller.abort(parentSignal?.reason ?? new Error("Parent task cancelled"));
    if (!record.background) parentSignal?.addEventListener("abort", cancel, { once: true });
    const baseTokens = record.totalTokens, baseTools = record.totalToolUseCount;
    const timer = settings.timeoutSeconds > 0
      ? setTimeout(() => controller.abort(new Error("Subagent timed out")), settings.timeoutSeconds * 1000)
      : undefined;
    this.persist(record);
    // Register synchronously before invoking the driver, including drivers that settle immediately.
    const task = Promise.resolve().then(async () => {
      let notify = false;
      try {
        controller.signal.throwIfAborted();
        const result = await this.driver.run(record, profile, controller.signal, (tokens, tools, activity) => {
          record.totalTokens = baseTokens + tokens; record.totalToolUseCount = baseTools + tools;
          if (activity !== undefined) {
            record.currentTool = activity.currentTool || undefined;
            record.currentActivity = activity.currentActivity || undefined;
          }
          this.persist(record);
          const current = this.settings();
          if (!current.enabled) controller.abort(new Error("Subagents were disabled"));
          if (current.maxTokens > 0 && this.list().reduce((sum, item) => sum + item.totalTokens, 0) >= current.maxTokens) {
            controller.abort(new Error("Subagent token budget exhausted"));
          }
        });
        controller.signal.throwIfAborted();
        record.resultFullLength = result.length;
        if (result.length > settings.maxResultChars) {
          const suffix = SUBAGENT_RESULT_TRUNCATION_SUFFIX;
          record.result = `${result.slice(0, Math.max(0, settings.maxResultChars - suffix.length))}${suffix}`.slice(0, settings.maxResultChars);
          record.resultTruncated = true;
        } else {
          record.result = result;
          record.resultTruncated = undefined;
        }
        record.status = "completed";
      } catch (error) {
        const reason = controller.signal.aborted ? controller.signal.reason : error;
        record.error = reason instanceof Error ? reason.message : String(reason);
        record.status = controller.signal.aborted && !/timed out|budget|turn limit/i.test(record.error) ? "cancelled" : "failed";
      } finally {
        if (timer) clearTimeout(timer);
        parentSignal?.removeEventListener("abort", cancel);
        notify = record.background && !this.disposed && record.status !== "cancelled" && this.settings().enabled;
        if (notify) this.notifications++;
        record.currentTool = undefined; record.currentActivity = undefined;
        record.endedAt = Date.now(); this.active.delete(record.agentId); this.persist(record);
      }
      if (notify) {
        try { await this.driver.notify({ ...record }); } catch { /* The durable result remains readable via TaskOutput/UI. Never repeat child effects to retry a notification. */ }
        finally { this.notifications--; }
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
  stopAttempt(id: string, expectedAttempt: number): { record: SubagentRecord; accepted: boolean } | null {
    const record = this.records.get(id);
    if (!record || (record.attempt ?? 1) !== expectedAttempt) return null;
    const active = this.active.get(id);
    if (active) active.controller.abort(new Error("Subagent cancelled"));
    return { record: { ...record }, accepted: Boolean(active) };
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
