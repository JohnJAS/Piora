import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSubagentRuntime } from "../lib/subagent-runtime.ts";
import { readSubagentSettings } from "../lib/subagent-settings.ts";
import { listSubagentProfilesSafe } from "../lib/subagents/profile-manager.ts";
import { isSubagentProfileDisabled, projectSubagentDetail, type SubagentRecord } from "../lib/subagent-types.ts";
import { applyExtensionPromptGuidance } from "../lib/prompt-runtime/capabilities.ts";

function result(record: SubagentRecord) {
  const text = record.status === "running"
    ? `Async agent launched. agentId: ${record.agentId}. Continue non-overlapping work; a completion notification will arrive. Use SendMessage to continue after completion.`
    : `${record.result || record.error || "(No output)"}\nagentId: ${record.agentId}\nstatus: ${record.status}\n<usage>subagent_tokens: ${record.totalTokens}; tool_uses: ${record.totalToolUseCount}; duration_ms: ${(record.endedAt ?? Date.now()) - record.startedAt}</usage>`;
  return { content: [{ type: "text" as const, text }], details: { subagent: projectSubagentDetail(record) }, isError: ["failed", "cancelled", "interrupted"].includes(record.status) };
}
export default function subagentExtension(api: ExtensionAPI) {
  api.on("before_agent_start", (event, ctx) => {
    const runtimeActive = Boolean(getSubagentRuntime(ctx.sessionManager.getSessionId()));
    const settings = readSubagentSettings();
    const active = runtimeActive && settings.enabled;
    const profiles = active
      ? listSubagentProfilesSafe(ctx.cwd).profiles.filter(profile => !isSubagentProfileDisabled(settings, profile))
      : [];
    const profileSummary = profiles.map(profile => `${profile.name} (${profile.description})`).join("; ");
    const compactText = active
      ? `Use Agent for independent multi-step tasks and SendMessage to continue an owned child agent; completions arrive automatically.${profileSummary ? ` Profiles: ${profileSummary}.` : ""}`
      : undefined;
    const expandedBlock = active
      ? `<available_subagents>\n${profiles.map(profile => `${profile.name}: ${profile.description}`).join("\n")}\nUse Agent for independent multi-step tasks and parallel exploration. Each Agent starts with only the supplied prompt, in a separate context sharing this workspace. Include necessary context and clear file ownership. Do not duplicate delegated work. Relay useful conclusions to the user. SendMessage continues an existing child context. Background completions arrive automatically. Child tools inherit your permissions; nested delegation is disabled.\n</available_subagents>`
      : undefined;
    applyExtensionPromptGuidance(event, {
      key: "subagents",
      toolNames: ["Agent", "SendMessage", "TaskOutput", "TaskStop"],
      active,
      compactText,
      expandedBlock,
      expandedMarker: "<available_subagents>",
    });
  });
  const runtime = (id: string) => { const value = getSubagentRuntime(id); if (!value) throw new Error("Subagents are unavailable in this session"); return value; };
  api.registerTool(defineTool({
    name: "Agent", label: "Subagent", defaultActive: false, executionMode: "parallel",
    description: "Delegate a complete task to an independent subagent. Types: general-purpose, Explore (read-only), or a configured profile. Return its final findings and usage. Use run_in_background for asynchronous execution and automatic completion notification. A new call starts a fresh context; use SendMessage to continue an existing agent.",
    parameters: Type.Object({ description: Type.String({ minLength: 1, maxLength: 500 }), prompt: Type.String({ minLength: 1, maxLength: 100_000 }), subagent_type: Type.Optional(Type.String({ maxLength: 200 })), run_in_background: Type.Optional(Type.Boolean()) }),
    async execute(id, input, signal, _update, ctx) { return result(await runtime(ctx.sessionManager.getSessionId()).launch(input, id, signal)); },
  }));
  api.registerTool(defineTool({
    name: "SendMessage", label: "Continue subagent", defaultActive: false, executionMode: "parallel",
    description: "Continue a completed subagent with its own conversation context intact. Only agents owned by this conversation are addressable. Wait for running agents before continuing them.",
    parameters: Type.Object({ to: Type.String(), message: Type.String({ minLength: 1, maxLength: 100_000 }) }),
    async execute(_id, input, signal, _update, ctx) { return result(await runtime(ctx.sessionManager.getSessionId()).continue(input.to, input.message, signal)); },
  }));
  api.registerTool(defineTool({
    name: "TaskOutput", label: "Subagent result", defaultActive: false, executionMode: "parallel", description: "Read a subagent result or optionally wait for completion. Prefer automatic background completion notifications to polling.",
    parameters: Type.Object({ task_id: Type.String(), block: Type.Optional(Type.Boolean()) }),
    async execute(_id, input, signal, _update, ctx) { return result(await runtime(ctx.sessionManager.getSessionId()).output(input.task_id, input.block, signal)); },
  }));
  api.registerTool(defineTool({
    name: "TaskStop", label: "Stop subagent", defaultActive: false, executionMode: "parallel", description: "Cancel one owned subagent and its tools. Completed effects are not reverted.",
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_id, input, _signal, _update, ctx) { const value = runtime(ctx.sessionManager.getSessionId()); value.stop(input.task_id); return result(await value.output(input.task_id, true)); },
  }));
}
