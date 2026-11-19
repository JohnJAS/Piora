"use client";

import { useContext, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { OpenSubagentContext, useSubagentQuery, type SubagentDetailResponse } from "@/hooks/useSubagents";
import { compareSubagentVersions, type SubagentDetail } from "@/lib/subagent-types";
import { ChatDisclosure } from "./ChatDisclosure";
import { SubagentActivity, SubagentStopButton, SubagentSummary, subagentElapsedSeconds } from "./SubagentInspector";
import css from "./SubagentTaskCard.module.css";

export function SubagentTaskCard({ sessionId, toolCallId, input, seed }: {
  sessionId?: string; toolCallId?: string; input?: Record<string, unknown>; seed?: SubagentDetail;
}) {
  const { t } = useI18n();
  const openDetails = useContext(OpenSubagentContext);
  const [expanded, setExpanded] = useState(false);
  const localSeed = seed?.parentSessionId === sessionId ? seed : undefined;
  const foreign = Boolean(seed && !localSeed);
  const agentId = localSeed?.agentId ?? (typeof input?.to === "string" ? input.to : typeof input?.task_id === "string" ? input.task_id : undefined);
  const shouldRead = !foreign && Boolean(expanded || !seed || seed.status === "running");
  const query = agentId ? new URLSearchParams({ agentId }).toString()
    : toolCallId ? new URLSearchParams({ toolCallId }).toString() : undefined;
  const remote = useSubagentQuery<SubagentDetailResponse>(shouldRead ? sessionId : undefined, query);
  const observed = remote.data?.records[0];
  const current = observed && (!localSeed || compareSubagentVersions(observed, localSeed) >= 0) ? observed : seed;
  const owner = Boolean(current && current.parentSessionId === sessionId);
  const title = current?.description ?? String(input?.description ?? t("subagent.title"));
  return <ChatDisclosure className={css.card} data-subagent-id={current?.agentId ?? "pending"} data-subagent-status={current?.status ?? "running"}
    expanded={expanded} onExpandedChange={setExpanded} icon="robot" label={title}
    description={current ? current.agentType + " · " + t("subagent." + current.status) : t("subagent.waiting")}
    metadata={current ? subagentElapsedSeconds(current) + "s" : undefined}
    actions={owner && current ? <>
      {openDetails && <button type="button" onClick={() => openDetails({ parentSessionId: current.parentSessionId, agentId: current.agentId })}>{t("subagent.openDetails")}</button>}
      {current.status === "running" && <SubagentStopButton key={current.agentId + ":" + current.attempt} record={current} stale={remote.failed || !observed} />}
    </> : undefined}>
    {current && <SubagentSummary record={current} />}
    {remote.failed && <button type="button" className={css.link} onClick={remote.refresh}>{t("subagent.refreshError")}</button>}
    {expanded && owner && current && <SubagentActivity key={current.agentId + ":" + current.attempt} record={current} />}
  </ChatDisclosure>;
}
