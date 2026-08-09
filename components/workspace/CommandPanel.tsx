"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseAnsiLine } from "@/lib/ansi";
import type { TaskControls } from "../ChatWindow";
import { AliIcon } from "../AliIcon";
import styles from "./WorkspacePanel.module.css";

const HISTORY_KEY = "piora-command-history-v1";
const HISTORY_LIMIT = 100;

interface Props {
  trusted: boolean;
  controls: TaskControls | null;
}

export function CommandPanel({ trusted, controls }: Props) {
  const { t } = useI18n();
  const [command, setCommand] = useState("");
  const [excludeFromContext, setExcludeFromContext] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) setHistory(stored.filter((item): item is string => typeof item === "string").slice(0, HISTORY_LIMIT));
    } catch { /* Ignore malformed local history. */ }
  }, []);

  const outputLines = useMemo(() => (controls?.latestBash?.output ?? "").split(/\r?\n/), [controls?.latestBash?.output]);
  const run = () => {
    const value = command.trim();
    if (!value || !trusted || !controls || controls.disabled) return;
    const next = [value, ...history.filter((item) => item !== value)].slice(0, HISTORY_LIMIT);
    setHistory(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistoryIndex(-1);
    void controls.runCommand(value, excludeFromContext);
  };

  return <div className={styles.commandRoot}>
    <div className={styles.commandToolbar}>
      <input
        ref={inputRef}
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); run(); }
          else if (event.key === "ArrowUp" && history.length) {
            event.preventDefault();
            const next = Math.min(history.length - 1, historyIndex + 1);
            setHistoryIndex(next); setCommand(history[next] ?? "");
          } else if (event.key === "ArrowDown" && historyIndex >= 0) {
            event.preventDefault();
            const next = historyIndex - 1;
            setHistoryIndex(next); setCommand(next >= 0 ? history[next] ?? "" : "");
          }
        }}
        placeholder={t("commandPanel.placeholder")}
        aria-label={t("commandPanel.placeholder")}
        disabled={!trusted || !controls || controls.bashRunning}
      />
      {controls?.bashRunning
        ? <button type="button" className={styles.danger} onClick={controls.abort}>{t("commandPanel.stop")}</button>
        : <button className={styles.primaryAction} type="button" onClick={run} disabled={!trusted || !controls || controls.disabled || !command.trim()}><AliIcon name="play" size={12} /><span>{t("commandPanel.run")}</span></button>}
    </div>
    <label className={styles.commandContextToggle}><input type="checkbox" checked={excludeFromContext} onChange={(event) => setExcludeFromContext(event.target.checked)} />{t("commandPanel.exclude")}</label>
    {!trusted ? <div className={styles.error} role="alert">{t("commandPanel.untrusted")}</div> : null}
    <div className={styles.commandLimit}>{t("commandPanel.limit")}</div>
    <div className={styles.commandOutput} aria-live="polite">
      {controls?.bashRunning ? <div className={styles.searchNotice}>{t("commandPanel.running", { command: controls.pendingCommand ?? command })}</div> : null}
      {controls?.latestBash ? <>
        <div className={styles.commandMeta}><code>{controls.latestBash.excludeFromContext ? "!!" : "!"}{controls.latestBash.command}</code><span>{controls.latestBash.cancelled ? t("commandPanel.cancelled") : t("commandPanel.exit", { code: controls.latestBash.exitCode ?? "?" })}</span><button type="button" onClick={() => void navigator.clipboard.writeText(controls.latestBash?.output ?? "")}>{t("commandPanel.copy")}</button><button type="button" onClick={() => { setCommand(controls.latestBash?.command ?? ""); inputRef.current?.focus(); }}>{t("commandPanel.rerun")}</button></div>
        <pre>{outputLines.map((line, index) => <span key={index}>{parseAnsiLine(line).map((segment, segmentIndex) => <span key={segmentIndex} style={segment.style}>{segment.text}</span>)}{"\n"}</span>)}</pre>
      </> : <div className={styles.empty}>{t("commandPanel.empty")}</div>}
    </div>
  </div>;
}
