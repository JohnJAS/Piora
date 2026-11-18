"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { fetchSubagent, requestSubagentStop, SubagentRequestError, useSubagentQuery, type SubagentDetailResponse } from "@/hooks/useSubagents";
import type { SubagentDetail, SubagentSelection, SubagentTranscriptPage } from "@/lib/subagent-types";
import { AliIcon } from "./AliIcon";
import styles from "./SubagentTaskCard.module.css";

function detailQuery(agentId: string) {
  return new URLSearchParams({ agentId }).toString();
}

export function SubagentActivity({ record, toolCallId }: { record?: SubagentDetail; toolCallId?: string }) {
  const { t } = useI18n();
  const query = record ? detailQuery(record.agentId) + "&transcript=true" : undefined;
  const latest = useSubagentQuery<SubagentDetailResponse>(record?.parentSessionId, query);
  const [history, setHistory] = useState<SubagentTranscriptPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
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
  return <div className={styles.transcript} data-subagent-transcript data-subagent-tool-call={toolCallId}>
    <strong>{t("subagent.transcript")}</strong>
    {latest.failed && <button type="button" className={styles.link} onClick={latest.refresh}>{t("subagent.refreshError")}</button>}
    {failed && <p role="alert">{t("subagent.refreshError")}</p>}
    {history && <button type="button" className={styles.link} disabled={loading} onClick={() => setHistory(null)}>{t("subagent.latest")}</button>}
    {cursor && <button type="button" className={styles.link} disabled={loading} onClick={() => void earlier()}>
      {t(loading ? "subagent.loading" : "subagent.earlier")}
    </button>}
    {entries.map(entry => {
      const title = t("subagent.role." + entry.role) + (entry.toolName ? " · " + entry.toolName : "");
      return <div key={entry.id} className={styles.message} data-subagent-role={entry.role}>
        {entry.role === "toolResult" ? <details><summary>{title}</summary><pre>{entry.text}</pre></details> : <>
          <span>{title}</span>
          <pre>{entry.role === "omitted" ? t("subagent.omitted") : entry.text}</pre>
        </>}
        {entry.truncated && <small>{t("subagent.truncated")}</small>}
      </div>;
    })}
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

export function SubagentSummary({ record, showDuration = true }: { record: SubagentDetail; showDuration?: boolean }) {
  const { t } = useI18n();
  return <>
    <p className={styles.usage}>{showDuration ? subagentElapsedSeconds(record) + "s · " : ""}{t("subagent.cumulative")} · {t("subagent.tokens", { tokens: record.totalTokens, tools: record.totalToolUseCount })}{record.model ? " · " + record.model : ""}</p>
    {record.result && <p className={styles.result}>{record.result}</p>}
    {record.error && <p className={styles.result} role="alert">{record.error}</p>}
  </>;
}

export function SubagentInspector({ selection, onClose, modal }: { selection: SubagentSelection; onClose: () => void; modal: boolean }) {
  const { t } = useI18n();
  const { data, failed, refresh } = useSubagentQuery<SubagentDetailResponse>(selection.parentSessionId, detailQuery(selection.agentId));
  const record = data?.records[0];
  const section = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
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
      <strong>{t("subagent.details")}</strong>
      <button type="button" ref={close} className={styles.button} aria-label={t("subagent.closeDetails")} onClick={onClose}><AliIcon name="close" size={14} /></button>
    </header>
    <div className={styles.body}>
      {failed && <button type="button" className={styles.link} onClick={refresh}>{t("subagent.refreshError")}</button>}
      {!record && !failed && <p>{t(data ? "subagent.empty" : "subagent.loadingList")}</p>}
      {record && <>
        <h2>{record.description}</h2>
        <p className={styles.metadata}>{record.agentType} · {t("subagent." + record.status)} · {t(record.background ? "subagent.background" : "subagent.foreground")}</p>
        <SubagentSummary record={record} />
        <SubagentStopButton key={"stop:" + record.agentId + ":" + record.attempt} record={record} stale={failed} inspector />
        <span className={styles.readOnly}>{t("subagent.readOnly")}</span>
        <SubagentActivity key={"activity:" + record.agentId + ":" + record.attempt} record={record} />
      </>}
    </div>
  </section>;
}
