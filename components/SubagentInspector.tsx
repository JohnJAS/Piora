"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { fetchSubagent, requestSubagentStop, SubagentRequestError, useSubagentQuery, type SubagentDetailResponse } from "@/hooks/useSubagents";
import { compareSubagentVersions, truncatedSubagentResultPrefix, type SubagentDetail, type SubagentSelection, type SubagentTranscriptEntry, type SubagentTranscriptPage } from "@/lib/subagent-types";
import { AliIcon } from "./AliIcon";
import { LazyMarkdownBody } from "./LazyMarkdownBody";
import styles from "./SubagentTaskCard.module.css";

function detailQuery(agentId: string) {
  return new URLSearchParams({ agentId }).toString();
}

type ActivityItem = SubagentTranscriptEntry | { id: string; role: "tools"; entries: SubagentTranscriptEntry[] };

function groupActivity(entries: SubagentTranscriptEntry[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const entry of entries) {
    if (entry.role !== "toolCall" && entry.role !== "toolResult") {
      items.push(entry);
      continue;
    }
    const previous = items.at(-1);
    if (previous?.role === "tools") previous.entries.push(entry);
    else items.push({ id: "tools:" + entry.id, role: "tools", entries: [entry] });
  }
  return items;
}

function ActivityEntry({ entry, markdown }: { entry: SubagentTranscriptEntry; markdown: boolean }) {
  const { t } = useI18n();
  const title = t("subagent.role." + entry.role) + (entry.toolName ? " · " + entry.toolName : "");
  const toolResult = entry.role === "toolResult";
  return <li className={styles.entry} data-subagent-role={entry.role}>
    {entry.role === "omitted" ? <p>{t("subagent.omitted")}</p> : !entry.text ? <p>{title}</p> :
      <details>
        <summary>
          <span>{title}</span>
          {!toolResult && <span className={styles.preview} aria-hidden="true">{entry.text.trim().slice(0, 160)}</span>}
        </summary>
        {toolResult ? <pre className={styles.toolOutput}>{entry.text}</pre>
          : markdown ? <div className={styles.entryMarkdown}><LazyMarkdownBody className="markdown-assistant-message">{entry.text}</LazyMarkdownBody></div>
          : <p className={styles.entryText}>{entry.text}</p>}
        {entry.truncated && <small className={styles.truncated}>{t("subagent.truncated")}</small>}
      </details>}
  </li>;
}

export function SubagentActivity({ record, showHeading = true, markdown = false }: {
  record: SubagentDetail; showHeading?: boolean; markdown?: boolean;
}) {
  const { t } = useI18n();
  const query = detailQuery(record.agentId) + "&transcript=true";
  const latest = useSubagentQuery<SubagentDetailResponse>(record.parentSessionId, query);
  const [history, setHistory] = useState<SubagentTranscriptPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const base = latest.data?.records[0]?.attempt === record.attempt ? latest.data?.transcript : undefined;
  const cursor = history ? history.before : base?.before;
  const earlier = async () => {
    if (!cursor || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetchSubagent<SubagentDetailResponse>(record.parentSessionId, query + "&before=" + encodeURIComponent(cursor),
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
      if (!controller.signal.aborted && response.transcript && response.records[0]?.attempt === record.attempt) {
        const page = response.transcript;
        const visible = history?.entries ?? base?.entries ?? [];
        const entries = [...new Map([...page.entries, ...visible].map(entry => [entry.id, entry])).values()];
        // Keep the user's older view anchored even when the live page advances.
        setHistory({ entries: entries.slice(0, 250), before: page.before });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SubagentRequestError && error.status === 409) {
        setHistory(null);
        latest.refresh();
      } else setFailed(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };
  const entries = history?.entries ?? base?.entries ?? [];
  return <div className={styles.transcript} data-subagent-transcript>
    {showHeading && <strong>{t("subagent.transcript")}</strong>}
    {(latest.failed || failed || history || cursor) && <div className={styles.historyActions}>
      {latest.failed && <button type="button" className={styles.link} onClick={latest.refresh}>{t("subagent.refreshError")}</button>}
      {failed && <p role="alert">{t("subagent.refreshError")}</p>}
      {history && <button type="button" className={styles.link} disabled={loading} onClick={() => setHistory(null)}>{t("subagent.latest")}</button>}
      {cursor && <button type="button" className={styles.link} disabled={loading} onClick={() => void earlier()}>
        {t(loading ? "subagent.loading" : "subagent.earlier")}
      </button>}
    </div>}
    {entries.length > 0 && <ol className={styles.entries}>
      {groupActivity(entries).map(item => item.role === "tools" ?
        <li key={item.id} className={styles.entry}>
          <details data-subagent-tools>
            <summary>{t("subagent.toolActivity", { count: item.entries.length })}</summary>
            <ol className={styles.tools}>{item.entries.map(entry => <ActivityEntry key={entry.id} entry={entry} markdown={markdown} />)}</ol>
          </details>
        </li> : <ActivityEntry key={item.id} entry={item} markdown={markdown} />)}
    </ol>}
    {!entries.length && !latest.failed && <p>{t(base ? "subagent.noTranscript" : "subagent.loading")}</p>}
  </div>;
}

export function SubagentStopButton({ record, stale = false, inspector = false }: {
  record: SubagentDetail; stale?: boolean; inspector?: boolean;
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
  return <span className={styles.stopArea}>
    <button type="button" className={styles.button} data-subagent-stop={record.agentId} disabled={pending || stale} onClick={() => void stop()}>
      {t(pending ? "subagent.stopping" : inspector ? "subagent.stopOne" : "subagent.stop")}
    </button>
    {failed && <span role="alert">{t("subagent.stopFailed")}</span>}
  </span>;
}

export function subagentElapsedSeconds(record: SubagentDetail): number {
  return Math.max(0, Math.round(((record.endedAt ?? Date.now()) - (record.attemptStartedAt ?? record.startedAt)) / 1_000));
}

export function SubagentSummary({ record }: { record: SubagentDetail }) {
  const { t } = useI18n();
  return <>
    <p className={styles.usage}>{t("subagent.cumulative")} · {t("subagent.tokens", { tokens: record.totalTokens, tools: record.totalToolUseCount })}{record.model ? " · " + record.model : ""}</p>
    {record.result && <p className={styles.result}>{record.result}</p>}
    {record.error && <p className={styles.result} role="alert">{record.error}</p>}
  </>;
}

function SubagentResult({ record }: { record: SubagentDetail }) {
  const { t } = useI18n();
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const prefix = truncatedSubagentResultPrefix(record.result);
  const saved = (prefix ?? record.result).replace(/\r\n?/g, "\n").trimEnd();
  const preview = Array.from(saved.split("\n", 10).join("\n")).slice(0, 520).join("").trimEnd();
  const canExpand = prefix !== undefined || preview !== saved;
  const loadFull = expanded && prefix !== undefined;
  const full = useSubagentQuery<SubagentDetailResponse>(record.parentSessionId, loadFull ? detailQuery(record.agentId) + "&fullResult=true" : undefined);
  const returned = full.data?.records[0];
  const recovered = returned && compareSubagentVersions(returned, record) === 0 ? full.data?.fullResult : undefined;
  const loading = loadFull && recovered === undefined && !full.failed;
  const visible = !canExpand || expanded && !loading ? recovered ?? saved : preview;

  return <section className={styles.outcome} data-subagent-result>
    <div className={styles.resultHeading}>
      <h3>{t("subagent.outcome")}</h3>
      {canExpand && <button type="button" className={styles.link} aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}>
        {t(expanded ? "subagent.collapseResult" : "subagent.expandResult")}
      </button>}
    </div>
    <div id={contentId} aria-busy={loading || undefined}>
      <LazyMarkdownBody className="markdown-assistant-message">{visible}</LazyMarkdownBody>
    </div>
    {loading && <p className={styles.resultNotice} role="status">{t("subagent.loadingResult")}</p>}
    {loadFull && recovered === null && <p className={styles.resultNotice}>{t("subagent.fullResultUnavailable")}</p>}
    {loadFull && full.failed && recovered === undefined && <button type="button" className={`${styles.link} ${styles.resultNotice}`} onClick={full.refresh}>
      {t("subagent.retryResult")}
    </button>}
  </section>;
}

export function SubagentInspector({ selection, onClose, modal, resizeHandle }: {
  selection: SubagentSelection; onClose: () => void; modal: boolean; resizeHandle?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const { data, failed, refresh } = useSubagentQuery<SubagentDetailResponse>(selection.parentSessionId, detailQuery(selection.agentId));
  const record = data?.records[0];
  const section = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  useFocusTrap(section, modal, { initialFocus: close, onEscape: onClose });
  useEffect(() => {
    if (!modal) close.current?.focus({ preventScroll: true });
  }, [modal, selection.agentId]);
  return <section className={styles.inspector} aria-label={t("subagent.details")}
    ref={section} role={modal ? "dialog" : "region"} aria-modal={modal || undefined} data-subagent-inspector={selection.agentId} onKeyDown={event => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2>{record?.description ?? t("subagent.details")}</h2>
        {record && <p className={styles.metadata}>
          <span className={styles.status} data-status={record.status}>{t("subagent." + record.status)}</span>
          <span>{record.agentType}</span>
          <span>{subagentElapsedSeconds(record)}s</span>
        </p>}
      </div>
      <button type="button" ref={close} className={`${styles.button} ${styles.close}`} aria-label={t("subagent.closeDetails")} onClick={onClose}><AliIcon name="close" size={14} /></button>
    </header>
    {resizeHandle}
    <div className={styles.body} id="subagent-inspector-body">
      {failed && <button type="button" className={styles.link} onClick={refresh}>{t("subagent.refreshError")}</button>}
      {!record && !failed && <p>{t(data ? "subagent.empty" : "subagent.loadingList")}</p>}
      {record && <>
        {record.result && <SubagentResult key={record.agentId + ":" + record.attempt} record={record} />}
        {record.error && <section className={`${styles.outcome} ${styles.failure}`} role="alert">
          <h3>{t(record.status === "failed" ? "subagent.errorReason" : "subagent.endReason")}</h3>
          <p className={styles.result}>{record.error === "Subagent token budget exhausted" ? t("subagent.legacyBudgetError") : record.error}</p>
        </section>}
        <SubagentStopButton key={"stop:" + record.agentId + ":" + record.attempt} record={record} stale={failed} inspector />
        <details className={styles.disclosure} data-subagent-activity onToggle={event => setActivityOpen(event.currentTarget.open)}>
          <summary>
            <AliIcon name="history" size={15} />
            <span>{t("subagent.transcript")}</span>
            <AliIcon name="chevron-right" size={12} className={styles.chevron} />
          </summary>
          {activityOpen && <SubagentActivity key={record.agentId + ":" + record.attempt} record={record} showHeading={false} markdown />}
        </details>
        <details className={styles.disclosure} data-subagent-run-info>
          <summary>
            <AliIcon name="info" size={15} />
            <span>{t("subagent.runInfo")}</span>
            <AliIcon name="chevron-right" size={12} className={styles.chevron} />
          </summary>
          <dl className={styles.runInfo}>
            {record.model && <div><dt>{t("subagent.profileModel")}</dt><dd>{record.model}</dd></div>}
            <div><dt>{t("subagent.runMode")}</dt><dd>{t(record.background ? "subagent.background" : "subagent.foreground")}</dd></div>
            <div><dt>{t("subagent.cumulative")}</dt><dd>{t("subagent.tokens", {
              tokens: record.totalTokens.toLocaleString(locale), tools: record.totalToolUseCount,
            })}</dd></div>
          </dl>
        </details>
      </>}
    </div>
  </section>;
}
