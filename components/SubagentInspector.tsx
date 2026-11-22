"use client";

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  ContinueSubagentContext,
  fetchSubagent,
  requestSubagentStop,
  useSubagentQuery,
  type SubagentDetailResponse,
} from "@/hooks/useSubagents";
import { copyText } from "@/lib/clipboard";
import {
  type SubagentDetail,
  type SubagentListItem,
  type SubagentListPage,
  type SubagentSelection,
} from "@/lib/subagent-types";
import { AliIcon } from "./AliIcon";
import { LazyMarkdownBody as MarkdownBody } from "./LazyMarkdownBody";
import {
  isSubagentResultTruncated,
  formatSubagentDuration,
  formatSubagentModelName,
  formatSubagentTokens,
  resolveSubagentCopyText,
  subagentElapsedSeconds,
  useLiveSubagentElapsed,
} from "./subagents/format";
import { SubagentTimeline } from "./subagents/SubagentTimeline";
import styles from "./SubagentTaskCard.module.css";

export { subagentElapsedSeconds };

function detailQuery(agentId: string) {
  return new URLSearchParams({ agentId }).toString();
}

export function SubagentActivity({
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
  return <SubagentTimeline record={record} toolCallId={toolCallId} cwd={cwd} onOpenFile={onOpenFile} />;
}

export function SubagentStopButton({
  record,
  stale = false,
  inspector = false,
}: {
  record: SubagentDetail;
  stale?: boolean;
  inspector?: boolean;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);
  if (record.status !== "running") return null;
  const stop = async () => {
    if (pending || stale) return;
    setPending(true);
    setFailed(false);
    try {
      const accepted = await requestSubagentStop(record);
      if (!active.current) return;
      if (!accepted) { setPending(false); return; }
      timer.current = setTimeout(() => {
        setPending(false);
        setFailed(true);
      }, 10_000);
    } catch {
      if (!active.current) return;
      setPending(false);
      setFailed(true);
    }
  };
  return (
    <span className={styles.stopArea}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnDanger}`}
        data-subagent-stop={record.agentId}
        disabled={pending || stale}
        onClick={() => void stop()}
      >
        <AliIcon name="stop" size={12} />
        <span>{t(pending ? "subagent.stopping" : inspector ? "subagent.stopOne" : "subagent.stop")}</span>
      </button>
      {failed && <span className={styles.stopError} role="alert">{t("subagent.stopFailed")}</span>}
    </span>
  );
}

function SubagentResultSection({
  record,
  cwd,
  onOpenFile,
}: {
  record: SubagentDetail;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const [expandedFull, setExpandedFull] = useState(false);
  const [cachedFull, setCachedFull] = useState<string | null | undefined>(undefined);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "copiedSummary">("idle");
  const [copying, setCopying] = useState(false);

  const isTruncated = isSubagentResultTruncated(record);
  const shouldFetchFull = isTruncated && expandedFull;
  const fullQuery = useSubagentQuery<SubagentDetailResponse>(
    shouldFetchFull ? record.parentSessionId : undefined,
    shouldFetchFull ? `${detailQuery(record.agentId)}&fullResult=true` : undefined,
  );
  const matchedFull = fullQuery.data?.records[0]?.attempt === record.attempt ? fullQuery.data.fullResult : undefined;
  const recovered = matchedFull !== undefined ? matchedFull : cachedFull;
  const loadingFull = shouldFetchFull && recovered === undefined && !fullQuery.failed;
  const visibleText = expandedFull && typeof recovered === "string" ? recovered : record.result;

  const handleCopyResult = async () => {
    if (!record.result || copying) return;
    setCopying(true);
    try {
      const resolved = await resolveSubagentCopyText({
        record,
        fallbackText: record.result,
        canFetchFull: true,
        cachedFull: recovered,
      });
      if (resolved.recoveredFull !== undefined) {
        setCachedFull(resolved.recoveredFull);
      }
      await copyText(resolved.text);
      setCopyState(resolved.copiedSummaryFallback ? "copiedSummary" : "copied");
      window.setTimeout(() => setCopyState("idle"), resolved.copiedSummaryFallback ? 3000 : 1500);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className={styles.resultBox} data-subagent-result>
      <div className={styles.resultHeader}>
        <span className={styles.resultTitle}>
          <AliIcon name="check-circle" size={12} />
          <span>{t("subagent.resultHeading")}</span>
        </span>
        <span className={styles.cardActions}>
          {isTruncated && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              aria-expanded={expandedFull}
              data-subagent-expand-result
              onClick={() => setExpandedFull(value => !value)}
            >
              <span>{t(expandedFull ? "subagent.collapseResult" : "subagent.expandResult")}</span>
            </button>
          )}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={copying}
            data-subagent-copy-result
            onClick={() => void handleCopyResult()}
          >
            <AliIcon name={copyState === "idle" ? "copy" : "check"} size={12} />
            <span>
              {t(
                copyState === "copiedSummary"
                  ? "subagent.copiedSummary"
                  : copyState === "copied"
                    ? "subagent.copied"
                    : "subagent.copyResult",
              )}
            </span>
          </button>
        </span>
      </div>
      <MarkdownBody className={styles.resultBody} cwd={cwd} onOpenFile={onOpenFile}>
        {visibleText}
      </MarkdownBody>
      {copyState === "copiedSummary" && (
        <p className={styles.truncatedBadge} role="status" data-subagent-copy-status>{t("subagent.copiedSummary")}</p>
      )}
      {loadingFull && <p className={styles.truncatedBadge} role="status">{t("subagent.loadingResult")}</p>}
      {shouldFetchFull && recovered === null && (
        <p className={styles.truncatedBadge}>{t("subagent.fullResultUnavailable")}</p>
      )}
      {shouldFetchFull && fullQuery.failed && recovered === undefined && (
        <button type="button" className={styles.linkBtn} onClick={fullQuery.refresh}>
          <AliIcon name="reload" size={12} />
          <span>{t("subagent.retryResult")}</span>
        </button>
      )}
      {!expandedFull && isTruncated && (
        <p className={styles.truncatedBadge}>{t("subagent.resultTruncatedHint")}</p>
      )}
    </div>
  );
}

export function SubagentSummary({
  record,
  showDuration = true,
  compact = false,
  cwd,
  onOpenFile,
}: {
  record: SubagentDetail;
  showDuration?: boolean;
  compact?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const elapsed = useLiveSubagentElapsed(record);
  const errorText = record.error === "Subagent token budget exhausted"
    ? t("subagent.legacyBudgetError")
    : record.error;

  return (
    <>
      {compact ? (
        <div className={styles.metricsRow}>
          {showDuration && (
            <span className={styles.metricInline}>
              <AliIcon name="time" size={12} />
              <span>{formatSubagentDuration(elapsed)}</span>
            </span>
          )}
          <span className={styles.metricInline} title={`${record.totalTokens.toLocaleString()} tokens`}>
            <span>{t("subagent.cumulative")} · {t("subagent.tokens", { tokens: formatSubagentTokens(record.totalTokens), tools: record.totalToolUseCount })}</span>
          </span>
          {record.model && (
            <span className={`${styles.chip} ${styles.chipMono}`} title={record.model}>
              {formatSubagentModelName(record.model)}
            </span>
          )}
        </div>
      ) : (
        <div className={styles.kpiGrid}>
          {showDuration && (
            <div className={styles.kpiCell}>
              <span className={styles.kpiLabel}>{t("subagent.metricDuration")}</span>
              <span className={styles.kpiValue}>{formatSubagentDuration(elapsed)}</span>
            </div>
          )}
          <div className={styles.kpiCell} title={`${record.totalTokens.toLocaleString()} tokens`}>
            <span className={styles.kpiLabel}>{t("subagent.metricTokens")}</span>
            <span className={styles.kpiValue}>{formatSubagentTokens(record.totalTokens)}</span>
          </div>
          <div className={styles.kpiCell}>
            <span className={styles.kpiLabel}>{t("subagent.metricTools")}</span>
            <span className={styles.kpiValue}>{record.totalToolUseCount}</span>
          </div>
          {record.attempt > 1 && (
            <div className={styles.kpiCell}>
              <span className={styles.kpiLabel}>{t("subagent.metricAttempt")}</span>
              <span className={styles.kpiValue}>{t("subagent.attemptValue", { count: record.attempt })}</span>
            </div>
          )}
        </div>
      )}

      {record.status === "running" && (
        <div className={styles.liveStrip} role="status">
          <span className={styles.statusDot} data-status="running" aria-hidden="true" />
          <span className={styles.liveStripText} title={record.currentActivity}>
            {record.currentActivity
              ? t("subagent.liveActivity", { activity: record.currentActivity })
              : t("subagent.thinkingActivity")}
          </span>
        </div>
      )}

      {record.result && (
        <SubagentResultSection
          key={`${record.agentId}:${record.attempt}:${record.revision}`}
          record={record}
          cwd={cwd}
          onOpenFile={onOpenFile}
        />
      )}

      {errorText && (
        <div className={styles.errorBox} role="alert">
          <AliIcon name="error" size={14} className={styles.errorIcon} />
          <span className={styles.errorText}>{errorText}</span>
        </div>
      )}
    </>
  );
}

export function SubagentInspector({
  selection,
  onClose,
  modal,
  onSelect,
  expandedWidth = false,
  onToggleWidth,
  cwd,
  onOpenFile,
  resizeHandle,
}: {
  selection: SubagentSelection;
  onClose: () => void;
  modal: boolean;
  onSelect?: (selection: SubagentSelection) => void;
  expandedWidth?: boolean;
  onToggleWidth?: () => void;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  resizeHandle?: ReactNode;
}) {
  const { t } = useI18n();
  const continueSubagent = useContext(ContinueSubagentContext);
  const { data, failed, refresh } = useSubagentQuery<SubagentDetailResponse>(
    selection.parentSessionId,
    detailQuery(selection.agentId),
  );
  const siblingList = useSubagentQuery<SubagentListPage>(
    onSelect ? selection.parentSessionId : undefined,
    onSelect ? "view=list&offset=0" : undefined,
  );
  const [extraSiblings, setExtraSiblings] = useState<SubagentListItem[]>([]);
  const [extraNextOffset, setExtraNextOffset] = useState<number | null | undefined>(undefined);
  const [loadingMoreSiblings, setLoadingMoreSiblings] = useState(false);
  const moreSiblingsAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    moreSiblingsAbort.current?.abort();
    moreSiblingsAbort.current = null;
    setExtraSiblings([]);
    setExtraNextOffset(undefined);
    setLoadingMoreSiblings(false);
  }, [selection.parentSessionId]);

  useEffect(() => () => { moreSiblingsAbort.current?.abort(); }, []);

  const record = data?.records[0];
  const nextSiblingOffset = extraNextOffset !== undefined ? extraNextOffset : (siblingList.data?.nextOffset ?? null);

  const switcherOptions = useMemo(() => {
    const map = new Map<string, SubagentListItem>();
    for (const item of siblingList.data?.records ?? []) map.set(item.agentId, item);
    for (const item of extraSiblings) map.set(item.agentId, item);
    if (record && !map.has(record.agentId)) {
      map.set(record.agentId, record);
    }
    return [...map.values()];
  }, [siblingList.data?.records, extraSiblings, record]);

  const loadMoreSiblings = async () => {
    if (nextSiblingOffset === null || loadingMoreSiblings) return;
    moreSiblingsAbort.current?.abort();
    const controller = new AbortController();
    moreSiblingsAbort.current = controller;
    setLoadingMoreSiblings(true);
    try {
      const page = await fetchSubagent<SubagentListPage>(
        selection.parentSessionId,
        `view=list&offset=${nextSiblingOffset}`,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      );
      if (controller.signal.aborted) return;
      setExtraSiblings(prev => {
        const merged = new Map(prev.map(item => [item.agentId, item]));
        for (const item of page.records) merged.set(item.agentId, item);
        return [...merged.values()];
      });
      setExtraNextOffset(page.nextOffset);
    } catch {
      // Keep already-loaded options available.
    } finally {
      if (!controller.signal.aborted) setLoadingMoreSiblings(false);
      if (moreSiblingsAbort.current === controller) moreSiblingsAbort.current = null;
    }
  };

  const section = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  useFocusTrap(section, modal, { initialFocus: close, onEscape: onClose });
  useEffect(() => {
    if (!modal) close.current?.focus({ preventScroll: true });
  }, [modal, selection.agentId]);

  const canContinue = Boolean(record && record.status !== "running" && continueSubagent);
  const showSwitcher = Boolean(onSelect && ((siblingList.data?.total ?? 0) > 1 || switcherOptions.length > 1));

  return (
    <section
      className={styles.inspector}
      aria-label={t("subagent.details")}
      ref={section}
      role={modal ? "dialog" : "region"}
      aria-modal={modal || undefined}
      data-subagent-inspector={selection.agentId}
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {resizeHandle}
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <AliIcon name="robot" size={14} />
          <strong className={styles.headerTitle}>{t("subagent.details")}</strong>
          <span className={styles.readOnly}>{t("subagent.readOnly")}</span>
        </div>
        <div className={styles.headerActions}>
          {!modal && onToggleWidth && (
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={t(expandedWidth ? "subagent.collapsePanel" : "subagent.expandPanel")}
              title={t(expandedWidth ? "subagent.collapsePanel" : "subagent.expandPanel")}
              onClick={onToggleWidth}
            >
              <AliIcon name={expandedWidth ? "collapse" : "expand"} size={14} />
            </button>
          )}
          {!modal && (
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={t("subagent.refresh")}
              title={t("subagent.refresh")}
              onClick={refresh}
            >
              <AliIcon name="reload" size={14} />
            </button>
          )}
          <button
            type="button"
            ref={close}
            className={styles.iconBtn}
            aria-label={t("subagent.closeDetails")}
            title={t("subagent.closeDetails")}
            onClick={onClose}
          >
            <AliIcon name="close" size={14} />
          </button>
        </div>
      </header>

      {showSwitcher && onSelect && (
        <div className={styles.switcherBar}>
          <select
            className={styles.switcherSelect}
            aria-label={t("subagent.switcherLabel")}
            value={switcherOptions.some(item => item.agentId === selection.agentId) ? selection.agentId : ""}
            onChange={event => {
              if (event.target.value) {
                onSelect({ parentSessionId: selection.parentSessionId, agentId: event.target.value });
              }
            }}
          >
            {!switcherOptions.some(item => item.agentId === selection.agentId) && (
              <option value="" disabled>{t("subagent.loadingList")}</option>
            )}
            {switcherOptions.map(item => (
              <option key={item.agentId} value={item.agentId}>
                [{t(`subagent.${item.status}`)}] {item.description}
              </option>
            ))}
          </select>
          {nextSiblingOffset !== null && (
            <button
              type="button"
              className={styles.btn}
              disabled={loadingMoreSiblings}
              data-subagent-switcher-more
              onClick={() => void loadMoreSiblings()}
            >
              <span>{t(loadingMoreSiblings ? "subagent.loadingList" : "subagent.loadMoreSiblings")}</span>
            </button>
          )}
        </div>
      )}

      <div id="subagent-inspector-body" className={styles.body}>
        {failed && (
          <button type="button" className={styles.linkBtn} onClick={refresh}>
            <AliIcon name="reload" size={12} />
            <span>{t("subagent.refreshError")}</span>
          </button>
        )}
        {!record && !failed && (
          <p className={styles.emptyState}>{t(data ? "subagent.empty" : "subagent.loadingList")}</p>
        )}
        {record && (
          <>
            <div className={styles.hero}>
              <h2 className={styles.heroTitle}>{record.description}</h2>
              <div className={styles.heroMeta}>
                <span className={styles.statusLabel} data-status={record.status}>
                  <span className={styles.statusDot} data-status={record.status} aria-hidden="true" />
                  <span>{t(`subagent.${record.status}`)}</span>
                </span>
                <span className={styles.chip}>{record.agentType}</span>
                <span className={styles.chip}>{t(record.background ? "subagent.background" : "subagent.foreground")}</span>
                {record.model && (
                  <span className={`${styles.chip} ${styles.chipMono}`} title={record.model}>
                    {formatSubagentModelName(record.model)}
                  </span>
                )}
              </div>
              {(record.status === "running" || canContinue) && (
                <div className={styles.heroActions}>
                  <SubagentStopButton key={`stop:${record.agentId}:${record.attempt}`} record={record} stale={failed} inspector />
                  {canContinue && (
                    <button
                      type="button"
                      className={styles.btn}
                      title={t("subagent.continueInChatHint")}
                      onClick={() => continueSubagent?.(record)}
                    >
                      <AliIcon name="send" size={12} />
                      <span>{t("subagent.continueInChat")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <SubagentSummary record={record} cwd={cwd} onOpenFile={onOpenFile} />
            <SubagentActivity
              key={`activity:${record.agentId}:${record.attempt}`}
              record={record}
              cwd={cwd}
              onOpenFile={onOpenFile}
            />
          </>
        )}
      </div>
    </section>
  );
}
