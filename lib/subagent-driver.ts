import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentSessionWrapper, startRpcSession } from "./rpc-manager";
import type { SubagentDriver } from "./subagent-runtime";
import { isSubagentTool, projectSubagentDetail } from "./subagent-types";
import { saveSubagent } from "./subagent-store";
import { isWorkflowTool } from "./workflow-tools";

const forbidden = new Set(["piora_room", "piora_automation"]);
export function childToolNames(parentTools: string[], profile: { tools?: string[]; disallowedTools?: string[] }): string[] {
  const allowed = profile.tools ? new Set(profile.tools) : undefined, denied = new Set(profile.disallowedTools);
  return parentTools.filter(name => !isSubagentTool(name) && !isWorkflowTool(name) && !forbidden.has(name)
    && !denied.has(name) && (!allowed || allowed.has(name)));
}
export function createSubagentDriver(parent: AgentSessionWrapper, start: typeof startRpcSession): SubagentDriver {
  return {
    changed(record) { parent.notifySubagentChanged(record); },
    async run(record, profile, signal, progress) {
      signal.throwIfAborted();
      const tools = childToolNames(parent.inner.getActiveToolNames().filter(name => parent.isToolAllowedByCapability(name)), profile);
      const model = profile.model ?? (parent.inner.model ? `${parent.inner.model.provider}/${parent.inner.model.id}` : undefined);
      const separator = model?.indexOf("/") ?? -1;
      const { session: child, realSessionId } = await start(record.childSessionId ?? record.agentId, record.childSessionFile ?? "", parent.cwd, {
        subagentParent: parent, subagentSystemPrompt: profile.systemPrompt,
        subagentDirectory: join(getAgentDir(), "piora", "subagent-sessions", parent.sessionId, record.agentId),
        toolNames: tools, allowModelFallback: false,
        ...(model && separator > 0 ? { initialModel: { provider: model.slice(0, separator), modelId: model.slice(separator + 1) } } : {}),
      });
      let detach: (() => void) | undefined;
      let cancel: (() => void) | undefined;
      try {
        signal.throwIfAborted();
        child.persistSessionFile();
        record.childSessionId = realSessionId; record.childSessionFile = child.inner.sessionFile;
        record.model = child.inner.model ? `${child.inner.model.provider}/${child.inner.model.id}` : model;
        saveSubagent(record);
        let tokens = 0, toolCount = 0, turns = 0, output = "";
        const completion = new Promise<string>((resolve, reject) => {
          cancel = () => { void child.send({ type: "abort" }).catch(() => undefined); reject(signal.reason ?? new Error("Subagent cancelled")); };
          signal.addEventListener("abort", cancel, { once: true });
          detach = child.onEvent(event => {
            if (event.type === "tool_execution_start") { toolCount++; progress(tokens, toolCount); }
            if (event.type === "message_end") {
              const message = event.message as { role?: string; content?: { type?: string; text?: string }[]; usage?: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number }; stopReason?: string; errorMessage?: string } | undefined;
              if (message?.role === "assistant") {
                const usage = message.usage;
                tokens += usage?.totalTokens ?? ((usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0));
                output = message.content?.filter(block => block.type === "text").map(block => block.text ?? "").join("\n") ?? "";
                progress(tokens, toolCount);
                if (message.stopReason === "error" || message.stopReason === "aborted") reject(new Error(message.errorMessage || "Subagent model did not complete"));
              }
            }
            if (event.type === "turn_end" && ++turns >= profile.maxTurns) {
              const results = event.toolResults as unknown[] | undefined;
              if (results?.length) { void child.send({ type: "abort" }).catch(() => undefined); reject(new Error("Subagent turn limit reached")); }
            }
            if (event.type === "prompt_error") reject(new Error(String(event.errorMessage ?? "Subagent failed")));
            if (event.type === "prompt_done") {
              if (event.aborted) reject(new Error("Subagent cancelled"));
              else resolve(output || "(Subagent completed without a text response.)");
            }
          });
        });
        // Attach a rejection handler before admission, which can itself fail.
        completion.catch(() => undefined);
        await child.send({ type: "prompt", message: record.prompt, source: "subagent" });
        return await completion;
      } finally {
        if (cancel) signal.removeEventListener("abort", cancel);
        detach?.();
        await child.shutdownForFileMutation();
      }
    },
    async notify(record) {
      if (!parent.isAlive()) return;
      await parent.inner.sendCustomMessage({ customType: "piora-subagent-completion", display: true,
        content: `<subagent-notification>\n${record.description}: ${record.status}\nagentId: ${record.agentId}\n${record.result || record.error}\n</subagent-notification>`,
        details: { subagent: projectSubagentDetail(record) },
      }, { deliverAs: "followUp", triggerTurn: true });
    },
  };
}
