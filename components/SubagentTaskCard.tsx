"use client";

import { useContext, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { OpenSubagentContext, useSubagentQuery, type SubagentDetailResponse } from "@/hooks/useSubagents";
import { compareSubagentVersions, type SubagentDetail } from "@/lib/subagent-types";
import type { ToolResultMessage } from "@/lib/types";
import { AliIcon } from "./AliIcon";
import { ChatDisclosure } from "./ChatDisclosure";
import { SubagentActivity, SubagentStopButton, SubagentSummary } from "./SubagentInspector";
import {
  describeSubagentToolCall,
  formatSubagentDuration,
  useLiveSubagentElapsed,
} from "./subagents/format";
import css from "./SubagentTaskCard.module.css";

function extractToolResultText(toolResult?: ToolResultMessage): string {
  if (!toolResult) return "";
  const raw: unknown = toolResult.content;
  if (typeof raw === "string") return raw.trim();
  if (!Array.isArray(raw)) return "";
  return raw
    .filter((block): block is { type: "text"; text: string } => Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string"))
    .map(block => block.text.trim())
    .filter(Boolean)
    .join("\n");
}

export function SubagentTaskCard({
  sessionId,
  toolCallId,
  toolName,
  input,
  seed,
  toolResult,
  cwd,
  onOpenFile,
}: {
  sessionId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  seed?: SubagentDetail;
  toolResult?: ToolResultMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const openDetails = useContext(OpenSubagentContext);
  const [expanded, setExpanded] = useState(false);
  const localSeed = seed?.parentSessionId === sessionId ? seed : undefined;
  const foreign = Boolean(seed && !localSeed);
  const agentId = localSeed?.agentId ?? (typeof input?.to === "string" ? input.to : typeof input?.task_id === "string" ? input.task_id : undefined);
  // Pre-launch rejections have a settled toolResult with no subagent record; do not keep polling forever.
  const settledWithoutRecord = Boolean(toolResult && !seed);
  const shouldRead = !foreign && !settledWithoutRecord && Boolean(expanded || !seed || seed.status === "running");
  const query = agentId
    ? new URLSearchParams({ agentId }).toString()
    : toolCallId
      ? new URLSearchParams({ toolCallId }).toString()
      : undefined;
  const remote = useSubagentQuery<SubagentDetailResponse>(shouldRead ? sessionId : undefined, query);
  const observed = remote.data?.records[0];
  const current = observed && (!localSeed || compareSubagentVersions(observed, localSeed) >= 0) ? observed : seed;
  const owner = Boolean(current && current.parentSessionId === sessionId);
  const elapsed = useLiveSubagentElapsed(current);
  const { title, actionLabel } = describeSubagentToolCall(toolName, input, current, t);
  const toolResultText = !current && toolResult ? extractToolResultText(toolResult) : "";
  const preLaunchError = Boolean(!current && toolResult?.isError);
  const preLaunchSettled = Boolean(!current && toolResult && !toolResult.isError);
  const status = current?.status ?? (preLaunchError ? "failed" : preLaunchSettled ? "completed" : "running");

  const descriptionNode = current ? (
    <span className={css.cardDescription}>
      <span className={css.statusLabel} data-status={current.status}>
        <span className={css.statusDot} data-status={current.status} aria-hidden="true" />
        <span>{t(`subagent.${current.status}`)}</span>
      </span>
      <span className={css.chip}>{current.agentType}</span>
      {actionLabel && <span className={css.chip}>{actionLabel}</span>}
      {current.background && <span className={css.chip}>{t("subagent.background")}</span>}
    </span>
  ) : preLaunchError ? (
    <span className={css.cardDescription}>
      <span className={css.statusLabel} data-status="failed">
        <span className={css.statusDot} data-status="failed" aria-hidden="true" />
        <span>{t("subagent.failed")}</span>
      </span>
      {actionLabel && <span className={css.chip}>{actionLabel}</span>}
    </span>
  ) : preLaunchSettled ? (
    <span className={css.cardDescription}>
      <span className={css.statusLabel} data-status="completed">
        <span className={css.statusDot} data-status="completed" aria-hidden="true" />
        <span>{t("subagent.completed")}</span>
      </span>
      {actionLabel && <span className={css.chip}>{actionLabel}</span>}
    </span>
  ) : (
    <span className={css.cardDescription}>
      <span className={css.statusLabel} data-status="running">
        <span className={css.statusDot} data-status="running" aria-hidden="true" />
        <span>{t("subagent.waiting")}</span>
      </span>
      {actionLabel && <span className={css.chip}>{actionLabel}</span>}
    </span>
  );

  const metaNode = current ? (
    <span className={css.cardMeta}>
      {current.totalToolUseCount > 0 && <span>{current.totalToolUseCount}×</span>}
      <span>{formatSubagentDuration(elapsed)}</span>
    </span>
  ) : undefined;

  return (
    <div className={css.card} data-subagent-id={current?.agentId ?? "pending"} data-subagent-status={status}>
      <ChatDisclosure
        expanded={expanded}
        onExpandedChange={setExpanded}
        icon="robot"
        label={title}
        description={descriptionNode}
        metadata={metaNode}
        actions={owner && current ? (
          <span className={css.cardActions}>
            {openDetails && (
              <button
                type="button"
                id={`piora-subagent-card-${toolCallId ?? current.agentId}`}
                className={`${css.btn} ${css.btnGhost}`}
                onClick={event => openDetails({ parentSessionId: current.parentSessionId, agentId: current.agentId }, event.currentTarget.id)}
              >
                <AliIcon name="expand" size={12} />
                <span>{t("subagent.openDetails")}</span>
              </button>
            )}
            {current.status === "running" && (
              <SubagentStopButton
                key={`${current.agentId}:${current.attempt}`}
                record={current}
                stale={remote.failed || !observed}
              />
            )}
          </span>
        ) : undefined}
      >
        {current && <SubagentSummary record={current} showDuration={false} compact cwd={cwd} onOpenFile={onOpenFile} />}
        {!current && preLaunchError && (
          <div className={css.errorBox} role="alert">
            <AliIcon name="error" size={14} className={css.errorIcon} />
            <span className={css.errorText}>{toolResultText || t("subagent.failed")}</span>
          </div>
        )}
        {!current && preLaunchSettled && toolResultText && (
          <div className={css.resultBox}>
            <span className={css.resultBody}>{toolResultText}</span>
          </div>
        )}
        {remote.failed && (
          <button type="button" className={css.linkBtn} onClick={remote.refresh}>
            <AliIcon name="reload" size={12} />
            <span>{t("subagent.refreshError")}</span>
          </button>
        )}
        {expanded && owner && current && (
          <SubagentActivity key={`${current.agentId}:${current.attempt}`} record={current} cwd={cwd} onOpenFile={onOpenFile} />
        )}
      </ChatDisclosure>
      {!expanded && preLaunchError && toolResultText && (
        <div className={css.cardLiveBanner} role="alert">
          <AliIcon name="error" size={12} className={css.errorIcon} />
          <span className={css.cardLiveBannerText} title={toolResultText}>{toolResultText}</span>
        </div>
      )}
      {!expanded && current?.status === "running" && current.currentActivity && (
        <div className={css.cardLiveBanner} role="status">
          <AliIcon name="wrench" size={12} />
          <span className={css.cardLiveBannerText} title={current.currentActivity}>
            {t("subagent.liveActivity", { activity: current.currentActivity })}
          </span>
        </div>
      )}
    </div>
  );
}
