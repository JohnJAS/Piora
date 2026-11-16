"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentRecord } from "@/lib/subagent-types";
import type { AgentMessage } from "@/lib/types";
import { ChatDisclosure } from "./ChatDisclosure";
import { LazyMarkdownBody as MarkdownBody } from "./LazyMarkdownBody";
import css from "./SubagentTaskCard.module.css";

function messageText(message: AgentMessage): string {
  if (!("content" in message)) return "output" in message ? String(message.output) : JSON.stringify(message);
  if (typeof message.content === "string") return message.content;
  return message.content.map(block => {
    if (block.type === "text" || block.type === "thinking") return block.type === "thinking" ? block.thinking : block.text;
    if (block.type === "toolCall") return `${block.toolName}\n${JSON.stringify(block.input, null, 2)}`;
    return "[image]";
  }).join("\n");
}
export function SubagentTaskCard({ sessionId, toolCallId, input, seed }: {
  sessionId?: string; toolCallId?: string; input?: Record<string, unknown>; seed?: SubagentRecord;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false), [record, setRecord] = useState<SubagentRecord | undefined>();
  const [messages, setMessages] = useState<AgentMessage[]>([]), [error, setError] = useState("");
  const [observedAt, setObservedAt] = useState(0);
  const agentId = seed?.agentId ?? (typeof input?.to === "string" ? input.to : typeof input?.task_id === "string" ? input.task_id : undefined);
  const current = record ?? seed;
  useEffect(() => {
    if (!sessionId || !current || current.status !== "running") return;
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      void fetch(`/api/agent/${encodeURIComponent(sessionId)}/subagents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", agentId: current.agentId }) });
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [sessionId, current]);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const query = new URLSearchParams(agentId ? { agentId } : { toolCallId: toolCallId ?? "" });
    if (expanded) query.set("transcript", "true");
    async function read() {
      try {
        const response = await fetch(`/api/agent/${encodeURIComponent(sessionId!)}/subagents?${query}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        const next: SubagentRecord | undefined = data.records[0];
        if (!controller.signal.aborted) { setRecord(next); setMessages(data.messages ?? []); setError(""); setObservedAt(Date.now()); }
        if (!controller.signal.aborted && (!next || next.status === "running")) timer = setTimeout(() => void read(), 1500);
      } catch (error) { if (!controller.signal.aborted) setError(String(error)); }
    }
    void read();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [agentId, expanded, sessionId, toolCallId]);
  const title = current?.description ?? String(input?.description ?? t("subagent.title"));
  const stop = async () => {
    if (!sessionId || !current) return;
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/subagents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", agentId: current.agentId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); setRecord(data.record);
    } catch (error) { setError(String(error)); }
  };
  return <ChatDisclosure className={css.card} data-subagent-id={current?.agentId ?? "pending"} data-subagent-status={current?.status ?? "running"}
    expanded={expanded} onExpandedChange={setExpanded} icon="robot" label={title}
    description={current ? `${current.agentType} · ${t(`subagent.${current.status}`)}` : t("subagent.waiting")}
    metadata={current ? `${Math.max(0, Math.round(((current.endedAt ?? (observedAt || current.startedAt)) - current.startedAt) / 1000))}s` : undefined}
    actions={current?.status === "running" ? <button type="button" onClick={() => void stop()}>{t("subagent.stop")}</button> : undefined}>
    {current && <div className={css.usage}>{t("subagent.tokens", { tokens: current.totalTokens, tools: current.totalToolUseCount })}{current.model ? ` · ${current.model}` : ""}</div>}
    {current?.result && <MarkdownBody>{current.result}</MarkdownBody>}
    {current?.error && <p role="alert">{current.error}</p>}
    {error && <p role="alert">{error}</p>}
    {expanded && <div className={css.transcript} data-subagent-transcript>
      <strong>{t("subagent.transcript")}</strong>
      {messages.map((message, index) => <div key={index} className={css.message} data-subagent-role={message.role}>
        <span>{message.role}{message.role === "toolResult" ? ` · ${message.toolName}` : ""}</span>
        <pre>{messageText(message)}</pre>
      </div>)}
      {!messages.length && !error && <p>{t("subagent.loading")}</p>}
    </div>}
  </ChatDisclosure>;
}
