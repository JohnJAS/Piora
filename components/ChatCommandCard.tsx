"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ChatCommandView } from "@/lib/chat-command-types";
import { AliIcon } from "./AliIcon";
import styles from "./ChatCommandCard.module.css";

export interface ChatCommandCardActions {
  retry(record: ChatCommandView): Promise<void>;
  restore(record: ChatCommandView, queryOnly?: boolean): Promise<void>;
  cancel(record: ChatCommandView): Promise<void>;
  copy(record: ChatCommandView): Promise<void>;
  openStats?(): void;
}

export function ChatCommandCard({ record, actions }: { record: ChatCommandView; actions: ChatCommandCardActions }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const operation = record.operation;
  if (!operation) return record.local || ["failed", "cancelled", "expired", "interrupted"].includes(record.status) ? <section className={styles.card}>
    <header className={styles.header}><span>{t(`chatCommands.${record.local && record.status === "accepted" ? "preparing" : record.status}`)}</span></header>
    <div className={styles.body}><pre>{record.preview}</pre>{record.errorMessage && <p role="alert">{record.errorMessage}</p>}</div>
    <footer className={styles.footer}><button type="button" disabled={pending} onClick={() => {
      setPending(true);
      void actions.restore(record).catch(error => setActionError(error instanceof Error ? error.message : String(error))).finally(() => setPending(false));
    }}>{t("chatCommands.restore")}</button></footer>
    {actionError && <div className={styles.actionError} role="alert">{actionError}</div>}
  </section> : null;
  const step = operation.steps[0];
  const queryStep = operation.steps[1];
  const finished = ["completed", "failed", "cancelled", "expired", "interrupted"].includes(record.status);
  const stepComplete = step.status === "completed";
  const status = stepComplete ? "completed" : finished ? record.status : operation.phase;
  const result = operation.result;
  const duration = (step.completedAt ?? operation.completedAt) && (step.startedAt ?? operation.startedAt)
    ? `${(((step.completedAt ?? operation.completedAt)! - (step.startedAt ?? operation.startedAt)!) / 1000).toFixed(1)}s` : null;
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setActionError(null);
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  const cancellable = !record.local && (!finished && (record.status === "queued" || record.status === "accepted" || operation.phase === "waiting_client" || operation.steps.some(item => item.status === "running" && item.runId)));
  const failed = ["failed", "interrupted", "expired"].includes(status);
  return <section className={styles.card} aria-label={`/${operation.command.name} ${t(`chatCommands.${status}`)}`} data-command-id={record.commandId}>
    <header className={styles.header}>
      <AliIcon name={operation.command.source === "extension" ? "api" : "code"} size={15} />
      <code>/{operation.command.name}</code>
      <span className={styles.source}>{t(operation.command.source === "builtin" ? "chat.builtIn" : operation.command.source === "extension" ? "chat.extensions" : operation.command.source === "prompt" ? "chat.prompts" : "chat.skills")}</span>
      <span className={`${styles.status} ${stepComplete ? styles.success : failed ? styles.failure : ""}`} role="status">
        <AliIcon name={stepComplete ? "check" : failed ? "warning" : "timer"} size={13} />{t(`chatCommands.${status}`)}
      </span>
    </header>
    <div className={styles.body}>
      {result ? <><strong>{t(result.title)}</strong>{result.message && <p>{t(result.message)}</p>}</> : <p>{record.errorMessage ?? t(`chatCommands.${status}`)}</p>}
      {result?.resources && <div className={styles.resources}>
        <span>{t("chatCommands.extensions", { count: result.resources.extensions })}</span><span>{t("chatCommands.skills", { count: result.resources.skills })}</span><span>{t("chatCommands.prompts", { count: result.resources.prompts })}</span>
      </div>}
      {result?.rename && <p>{result.rename.before ? `${result.rename.before} → ` : ""}{result.rename.after}</p>}
      {result?.compact?.tokensBefore !== undefined && <p className={styles.numbers}>{result.compact.tokensBefore.toLocaleString()} → {result.compact.tokensAfter?.toLocaleString() ?? "—"} tokens</p>}
      {result?.stats && <p>{result.stats.totalMessages.toLocaleString(locale)} {t("chat.messages")} · {result.stats.tokens.total.toLocaleString(locale)} tokens</p>}
      {result?.clientAction && !finished && <button type="button" disabled={pending} onClick={() => void run(() => actions.copy(record))} className={styles.primary}><AliIcon name="copy" size={13} />{t("chatCommands.copy")} · {t("chatCommands.copyCharacters", { count: result.clientAction.characters })}</button>}
      {result?.warnings?.map((warning, index) => <p key={index} className={styles.warning}>{warning}</p>)}
      {record.errorMessage && result && <p className={styles.failure}>{record.errorMessage}</p>}
      {expanded && <div className={styles.details}>
        <pre>{operation.rawText}</pre><time dateTime={new Date(record.acceptedAt).toISOString()}>{new Date(record.acceptedAt).toLocaleString(locale)}</time>
        {operation.command.sourceInfo && <p>{operation.command.sourceInfo.source} · {operation.command.sourceInfo.path}</p>}
        {result?.details?.map((detail, index) => <p key={index}>{detail}</p>)}{result?.compact?.summary && <p>{result.compact.summary}</p>}
      </div>}
      {queryStep && <div className={styles.query}>
        <span>{t("chatCommands.query")} · {t(`chatCommands.${queryStep.status === "pending" ? "queryWaiting" : queryStep.status === "running" ? "model" : queryStep.status === "blocked" ? "failed" : queryStep.status}`)}</span><p>{operation.afterPrompt}</p>
        {queryStep.status === "blocked" && <p>{t("chatCommands.blockedQuery")}</p>}
        {finished && queryStep.status !== "completed" && <button type="button" disabled={pending} onClick={() => void run(() => actions.restore(record, true))}>{t("chatCommands.editQuery")}</button>}
      </div>}
    </div>
    <footer className={styles.footer}>
      <span className={styles.meta}>{record.local ? t("chatCommands.preparing") : t("chatCommands.saved")}{duration && ` · ${duration}`}</span>
      <div className={styles.actions}>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? "chatCommands.collapse" : "chatCommands.details")}</button>
        {result?.stats && actions.openStats && <button type="button" onClick={actions.openStats}>{t("chatCommands.stats")}</button>}
        {finished && (!queryStep || !stepComplete) && <button type="button" disabled={pending} onClick={() => void run(() => actions.retry(record))}>{t(record.status === "completed" ? "chatCommands.rerun" : "chatCommands.retry")}</button>}
        {finished && record.status !== "completed" && <button type="button" disabled={pending} onClick={() => void run(() => actions.restore(record))}>{t("chatCommands.restore")}</button>}
        {cancellable && <button type="button" disabled={pending} onClick={() => void run(() => actions.cancel(record))}>{t("chatCommands.cancel")}</button>}
      </div>
    </footer>
    {actionError && <div className={styles.actionError} role="alert">{actionError}</div>}
  </section>;
}

export function ChatCommandQueue({ records, onCancel }: { records: ChatCommandView[]; onCancel: (record: ChatCommandView) => Promise<void> }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const waiting = records.filter(record => !record.local && (record.status === "queued" || record.status === "accepted"));
  if (!waiting.length) return null;
  return <section className={styles.queue} aria-label={t("chatCommands.next")}>
    <div className={styles.queueTitle}><AliIcon name="menu" size={13} />{t("chatCommands.next")} · {waiting.length}</div>
    {waiting.map(record => <div className={styles.queueRow} key={record.commandId}>
      <span>{record.operation ? record.operation.steps[0].status === "completed" ? record.operation.afterPrompt : `/${record.operation.command.name}` : record.preview}</span>
      <span className={styles.meta}>{t("chatCommands.afterTask")}</span>
      <button type="button" onClick={() => { setError(null); void onCancel(record).catch(reason => setError(String(reason))); }}>{t("chatCommands.cancel")}</button>
    </div>)}
    {error && <p role="alert" className={styles.failure}>{error}</p>}
  </section>;
}
