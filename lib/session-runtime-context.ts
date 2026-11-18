import { estimateContextUsageBreakdown } from "./context-usage";
import type { AgentSessionLike, ContextUsage } from "./pi-types";

export type SessionRuntimeStateView = "progress" | "chat" | "full";

export function parseRuntimeStateView(requested: unknown): SessionRuntimeStateView {
  return requested === "chat" || requested === "progress" ? requested : "full";
}

export function projectRuntimeContext(
  session: Pick<AgentSessionLike, "agent" | "getContextUsage">,
  forceEmptySystemPrompt: boolean,
): { systemPrompt: string; contextUsage: ContextUsage | null } {
  const state = session.agent.state;
  const systemPrompt = forceEmptySystemPrompt ? "" : state?.systemPrompt ?? "";
  const usage = session.getContextUsage();
  if (!usage) return { systemPrompt, contextUsage: null };
  const breakdown = estimateContextUsageBreakdown({
    messages: state?.messages ?? [],
    systemPrompt,
    tools: state?.tools ?? [],
    totalTokens: usage.tokens,
  });
  return { systemPrompt, contextUsage: {
    percent: usage.percent, contextWindow: usage.contextWindow, tokens: usage.tokens,
    ...(breakdown ? { breakdown } : {}),
  } };
}
