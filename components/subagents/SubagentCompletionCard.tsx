"use client";

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ContinueSubagentContext, OpenSubagentContext } from "@/hooks/useSubagents";
import { copyText } from "@/lib/clipboard";
import type { SubagentDetail } from "@/lib/subagent-types";
import { AliIcon } from "../AliIcon";
import { LazyMarkdownBody as MarkdownBody } from "../LazyMarkdownBody";
import {
  formatSubagentDuration,
  formatSubagentTokens,
  parseSubagentCompletionText,
  resolveSubagentCopyText,
  subagentElapsedSeconds,
} from "./format";
import styles from "../SubagentTaskCard.module.css";

export function SubagentCompletionCard({
  record,
  rawText,
  sessionId,
  cwd,
  onOpenFile,
  messageActions,
}: {
  record: SubagentDetail;
  rawText: string;
  sessionId?: string;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  messageActions?: ReactNode;
}) {
  const { t } = useI18n();
  const openDetails = useContext(OpenSubagentContext);
  const continueSubagent = useContext(ContinueSubagentContext);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "copiedSummary">("idle");
  const [copying, setCopying] = useState(false);
  const [cachedFull, setCachedFull] = useState<string | null | undefined>(undefined);
  const versionKey = `${record.agentId}:${record.attempt}:${record.revision}`;
  const cachedVersionRef = useRef(versionKey);
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (cachedVersionRef.current !== versionKey) {
      cachedVersionRef.current = versionKey;
      setCachedFull(undefined);
      setCopyState("idle");
    }
  }, [versionKey]);

  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  const owner = record.parentSessionId === sessionId;
  const duration = formatSubagentDuration(subagentElapsedSeconds(record));
  const bodyText = parseSubagentCompletionText(rawText, record.result || record.error);

  const handleCopy = async () => {
    if (!bodyText || copying) return;
    setCopying(true);
    try {
      const resolved = await resolveSubagentCopyText({
        record,
        fallbackText: bodyText,
        canFetchFull: owner,
        cachedFull: cachedVersionRef.current === versionKey ? cachedFull : undefined,
      });
      if (resolved.recoveredFull !== undefined) {
        setCachedFull(resolved.recoveredFull);
      }
      await copyText(resolved.text);
      setCopyState(resolved.copiedSummaryFallback ? "copiedSummary" : "copied");
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopyState("idle"), resolved.copiedSummaryFallback ? 3000 : 1500);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="message-row">
      <section
        className={styles.completionCard}
        data-subagent-completion={record.agentId}
        data-subagent-status={record.status}
        aria-label={t("subagent.completionTitle")}
      >
        <header className={styles.completionHeader}>
          <div className={styles.completionTitleArea}>
            <span className={styles.statusDot} data-status={record.status} aria-hidden="true" />
            <div className={styles.completionHeading}>
              <div className={styles.completionTitleRow}>
                <span className={styles.completionName}>{record.description}</span>
                <span className={styles.chip}>{record.agentType}</span>
                <span className={styles.statusLabel} data-status={record.status}>
                  {t(`subagent.${record.status}`)}
                </span>
              </div>
              <div className={styles.completionSubrow}>
                <span>{t("subagent.background")}</span>
                <span>· {duration}</span>
                <span title={`${record.totalTokens.toLocaleString()} tokens`}>
                  · {formatSubagentTokens(record.totalTokens)} tokens
                </span>
                <span>· {t("subagent.metricTools")} {record.totalToolUseCount}</span>
              </div>
            </div>
          </div>
          <div className={styles.completionActions}>
            {bodyText && (
              <button
                type="button"
                className={styles.iconBtn}
                disabled={copying}
                data-subagent-copy-result
                onClick={() => void handleCopy()}
                title={t(
                  copyState === "copiedSummary"
                    ? "subagent.copiedSummary"
                    : copyState === "copied"
                      ? "subagent.copied"
                      : "subagent.copyResult",
                )}
                aria-label={t(
                  copyState === "copiedSummary"
                    ? "subagent.copiedSummary"
                    : copyState === "copied"
                      ? "subagent.copied"
                      : "subagent.copyResult",
                )}
              >
                <AliIcon name={copyState === "idle" ? "copy" : "check"} size={14} />
              </button>
            )}
            {owner && continueSubagent && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                title={t("subagent.continueInChatHint")}
                onClick={() => continueSubagent(record)}
              >
                <AliIcon name="send" size={12} />
                <span>{t("subagent.continueInChat")}</span>
              </button>
            )}
            {owner && openDetails && (
              <button
                type="button"
                id={`piora-subagent-completion-${record.agentId}`}
                className={styles.btn}
                onClick={event => openDetails({ parentSessionId: record.parentSessionId, agentId: record.agentId }, event.currentTarget.id)}
              >
                <AliIcon name="expand" size={12} />
                <span>{t("subagent.openDetails")}</span>
              </button>
            )}
            {messageActions ? <span className="message-hover-actions">{messageActions}</span> : null}
          </div>
        </header>
        <div className={styles.completionBody}>
          {record.status === "failed" && record.error ? (
            <div className={styles.errorBox} role="alert">
              <AliIcon name="error" size={14} className={styles.errorIcon} />
              <span className={styles.errorText}>{record.error}</span>
            </div>
          ) : null}
          {bodyText ? (
            <MarkdownBody className={styles.resultBody} cwd={cwd} onOpenFile={onOpenFile}>
              {bodyText}
            </MarkdownBody>
          ) : null}
          {copyState === "copiedSummary" && (
            <p className={styles.truncatedBadge} role="status" data-subagent-copy-status>
              {t("subagent.copiedSummary")}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
