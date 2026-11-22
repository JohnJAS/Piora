"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { fetchSubagent, SubagentRequestError, useSubagentQuery, type SubagentDetailResponse } from "@/hooks/useSubagents";
import { copyText } from "@/lib/clipboard";
import type { SubagentDetail, SubagentTranscriptEntry, SubagentTranscriptPage } from "@/lib/subagent-types";
import { AliIcon, type AliIconName } from "../AliIcon";
import { LazyMarkdownBody as MarkdownBody } from "../LazyMarkdownBody";
import styles from "../SubagentTaskCard.module.css";

type TimelineFilter = "all" | "messages" | "tools";

function detailQuery(agentId: string) {
  return new URLSearchParams({ agentId }).toString();
}

function formatEntryTime(timestamp?: number): string | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return undefined;
  }
}

function roleIcon(role: SubagentTranscriptEntry["role"]): AliIconName {
  switch (role) {
    case "user": return "send";
    case "assistant": return "robot";
    case "toolCall": return "wrench";
    case "toolResult": return "terminal";
    default: return "info";
  }
}

function ToolResultRow({
  entry,
  title,
  forceOpen,
}: {
  entry: SubagentTranscriptEntry;
  title: string;
  forceOpen?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen]);

  const handleCopy = () => {
    void copyText(entry.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <details
      className={styles.toolDetails}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.toolSummary}>
        <AliIcon name="chevron-right" size={12} className={styles.toolChevron} />
        <AliIcon name={entry.isError ? "error" : "terminal"} size={12} />
        <span className={styles.toolSummaryLabel}>{title}</span>
        {entry.isError && <span className={styles.toolErrorTag}>{t("subagent.toolFailed")}</span>}
      </summary>
      {open && (
        <div className={styles.toolOutputWrap}>
          {entry.text && (
            <div className={styles.toolOutputActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={handleCopy}>
                <AliIcon name={copied ? "check" : "copy"} size={12} />
                <span>{t(copied ? "subagent.copied" : "subagent.copyOutput")}</span>
              </button>
            </div>
          )}
          <pre className={styles.codePre}>{entry.text || "—"}</pre>
          {entry.truncated && <small className={styles.truncatedBadge}>{t("subagent.truncated")}</small>}
        </div>
      )}
    </details>
  );
}

function UserPromptBody({ text }: { text: string }) {
  const { t } = useI18n();
  const isLong = text.length > 260 || text.split("\n").length > 5;
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <p className={`${styles.promptText}${isLong && !expanded ? ` ${styles.promptClamped}` : ""}`}>{text}</p>
      {isLong && (
        <button type="button" className={styles.linkBtn} onClick={() => setExpanded(value => !value)}>
          {t(expanded ? "subagent.hideFullPrompt" : "subagent.showFullPrompt")}
        </button>
      )}
    </>
  );
}

export function SubagentTimeline({
  record,
  toolCallId,
  cwd,
  onOpenFile,
}: {
  record?: SubagentDetail;
  toolCallId?: string;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const query = record ? `${detailQuery(record.agentId)}&transcript=true` : undefined;
  const latest = useSubagentQuery<SubagentDetailResponse>(record?.parentSessionId, query);
  const [history, setHistory] = useState<SubagentTranscriptPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [toolsExpanded, setToolsExpanded] = useState<boolean | undefined>(undefined);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const base = latest.data?.records[0]?.attempt === record?.attempt ? latest.data?.transcript : undefined;
  const cursor = history ? history.before : base?.before;

  const earlier = async () => {
    if (!record || !query || !cursor || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetchSubagent<SubagentDetailResponse>(
        record.parentSessionId,
        `${query}&before=${encodeURIComponent(cursor)}`,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      );
      if (!controller.signal.aborted && response.transcript && response.records[0]?.attempt === record.attempt) {
        const page = response.transcript;
        const visible = history?.entries ?? base?.entries ?? [];
        const entries = [...new Map([...page.entries, ...visible].map(entry => [entry.id, entry])).values()];
        setHistory({ entries: entries.slice(0, 250), before: page.before });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SubagentRequestError && error.status === 409) {
        setHistory(null);
        latest.refresh();
      } else {
        setFailed(true);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const entries = useMemo(() => history?.entries ?? base?.entries ?? [], [history?.entries, base?.entries]);
  const counts = useMemo(() => {
    let messages = 0;
    let tools = 0;
    for (const entry of entries) {
      if (entry.role === "toolCall" || entry.role === "toolResult") tools++;
      else messages++;
    }
    return { all: entries.length, messages, tools };
  }, [entries]);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "tools") return entries.filter(entry => entry.role === "toolCall" || entry.role === "toolResult");
    return entries.filter(entry => entry.role !== "toolCall" && entry.role !== "toolResult");
  }, [entries, filter]);

  const hasToolResults = useMemo(() => filtered.some(entry => entry.role === "toolResult"), [filtered]);

  return (
    <div className={styles.transcript} data-subagent-transcript data-subagent-tool-call={toolCallId}>
      <div className={styles.transcriptHeader}>
        <span className={styles.transcriptHeading}>
          <AliIcon name="activity" size={14} />
          <span>{t("subagent.transcript")}</span>
          {entries.length > 0 && <span className={styles.chip}>{entries.length}</span>}
        </span>
        {entries.length > 0 && (
          <div className={styles.transcriptControls}>
            <div className={styles.filterGroup} role="group" aria-label={t("subagent.transcript")}>
              {(["all", "messages", "tools"] as const).map(kind => (
                <button
                  key={kind}
                  type="button"
                  className={styles.filterTab}
                  aria-pressed={filter === kind}
                  onClick={() => setFilter(kind)}
                >
                  {t(`subagent.filter.${kind}`)} {counts[kind] > 0 ? `· ${counts[kind]}` : ""}
                </button>
              ))}
            </div>
            {hasToolResults && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => setToolsExpanded(value => !value)}
              >
                {t(toolsExpanded ? "subagent.collapseAllTools" : "subagent.expandAllTools")}
              </button>
            )}
          </div>
        )}
      </div>

      {latest.failed && (
        <button type="button" className={styles.linkBtn} onClick={latest.refresh}>
          <AliIcon name="reload" size={12} />
          <span>{t("subagent.refreshError")}</span>
        </button>
      )}
      {failed && <p className={styles.inlineAlert} role="alert">{t("subagent.refreshError")}</p>}

      {(history || cursor) && (
        <div className={styles.pagerBar}>
          {cursor && (
            <button type="button" className={styles.linkBtn} disabled={loading} onClick={() => void earlier()}>
              <AliIcon name="history" size={12} />
              <span>{t(loading ? "subagent.loading" : "subagent.earlier")}</span>
            </button>
          )}
          {history && (
            <button type="button" className={styles.linkBtn} disabled={loading} onClick={() => setHistory(null)}>
              <AliIcon name="arrowdown" size={12} />
              <span>{t("subagent.latest")}</span>
            </button>
          )}
        </div>
      )}

      {filtered.length > 0 ? (
        <div className={styles.timelineList}>
          {filtered.map(entry => {
            const title = t(`subagent.role.${entry.role}`) + (entry.toolName ? ` · ${entry.toolName}` : "");
            const timeLabel = formatEntryTime(entry.timestamp);
            return (
              <div
                key={entry.id}
                className={styles.timelineItem}
                data-subagent-role={entry.role}
                data-tool-error={entry.isError ? "true" : undefined}
              >
                <span className={styles.timelineNode} aria-hidden="true" />
                {entry.role === "toolResult" ? (
                  <ToolResultRow entry={entry} title={title} forceOpen={toolsExpanded} />
                ) : (
                  <div className={styles.entryCard} data-role={entry.role}>
                    <div className={styles.entryMeta}>
                      <span className={styles.entryRole}>
                        <AliIcon name={roleIcon(entry.role)} size={12} />
                        <span>{title}</span>
                      </span>
                      {timeLabel && <span className={styles.entryTime}>{timeLabel}</span>}
                    </div>
                    {entry.toolSummary && (
                      <div className={styles.toolCallSummary}>
                        <span className={styles.toolArgPill} title={entry.toolSummary}>{entry.toolSummary}</span>
                      </div>
                    )}
                    {entry.role === "omitted" ? (
                      <span className={styles.omittedNotice}>{t("subagent.omitted")}</span>
                    ) : entry.role === "user" ? (
                      <UserPromptBody text={entry.text} />
                    ) : entry.text ? (
                      <MarkdownBody className={styles.entryMarkdown} cwd={cwd} onOpenFile={onOpenFile}>
                        {entry.text}
                      </MarkdownBody>
                    ) : null}
                    {entry.truncated && <small className={styles.truncatedBadge}>{t("subagent.truncated")}</small>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !latest.failed && <p className={styles.emptyState}>{t(base ? "subagent.noTranscript" : "subagent.loading")}</p>
      )}
    </div>
  );
}
