"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseAnsiLine } from "@/lib/ansi";
import { filterCommandHistory } from "@/lib/command-history";
import type { TaskControls } from "../ChatWindow";
import { AliIcon } from "../AliIcon";
import styles from "./WorkspacePanel.module.css";

const HISTORY_KEY = "piora-command-history-v1";
const HISTORY_LIMIT = 100;

interface Props {
  controls: TaskControls | null;
}

export function CommandPanel({ controls }: Props) {
  const { t } = useI18n();
  const [command, setCommand] = useState("");
  const [excludeFromContext, setExcludeFromContext] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) setHistory(stored.filter((item): item is string => typeof item === "string").slice(0, HISTORY_LIMIT));
    } catch { /* Ignore malformed local history. */ }
  }, []);

  const outputLines = useMemo(() => (controls?.latestBash?.output ?? "").split(/\r?\n/), [controls?.latestBash?.output]);
  const suggestions = useMemo(
    () => suggestionsOpen ? filterCommandHistory(history, command) : [],
    [command, history, suggestionsOpen],
  );
  const run = (commandOverride?: string) => {
    const value = (commandOverride ?? command).trim();
    if (!value || !controls || controls.disabled) return;
    const next = [value, ...history.filter((item) => item !== value)].slice(0, HISTORY_LIMIT);
    setHistory(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistoryIndex(-1);
    setSuggestionsOpen(false);
    void controls.runCommand(value, excludeFromContext);
  };

  return <div className={styles.commandRoot}>
    <div className={styles.commandToolbar}>
      <div className={styles.commandInputWrap}>
        <input
          ref={inputRef}
          value={command}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls="command-history-suggestions"
          aria-activedescendant={suggestions[suggestionIndex] ? `command-history-option-${suggestionIndex}` : undefined}
          onFocus={() => setSuggestionsOpen(true)}
          onBlur={() => setSuggestionsOpen(false)}
          onChange={(event) => {
            setCommand(event.target.value);
            setHistoryIndex(-1);
            setSuggestionIndex(0);
            setSuggestionsOpen(true);
          }}
          onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            run(suggestions[suggestionIndex]);
          } else if (event.key === "Tab" && suggestions[suggestionIndex]) {
            event.preventDefault();
            setCommand(suggestions[suggestionIndex]);
            setSuggestionsOpen(false);
          } else if (event.key === "Escape" && suggestions.length) {
            event.preventDefault();
            setSuggestionsOpen(false);
          } else if (event.key === "ArrowDown" && suggestions.length) {
            event.preventDefault();
            setSuggestionIndex((current) => (current + 1) % suggestions.length);
          } else if (event.key === "ArrowUp" && suggestions.length) {
            event.preventDefault();
            setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "ArrowUp" && history.length) {
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
          disabled={!controls || controls.bashRunning}
        />
        {suggestions.length ? (
          <div id="command-history-suggestions" className={styles.commandSuggestions} role="listbox" aria-label={t("commandPanel.historyMatches")}>
            <div className={styles.commandSuggestionsHeader}>
              <span>{t("commandPanel.historyMatches")}</span>
              <span>{t("commandPanel.historyHint")}</span>
            </div>
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                id={`command-history-option-${index}`}
                type="button"
                role="option"
                aria-selected={suggestionIndex === index}
                data-active={suggestionIndex === index || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSuggestionIndex(index)}
                onClick={() => {
                  setCommand(suggestion);
                  setSuggestionsOpen(false);
                  inputRef.current?.focus();
                }}
              >
                <AliIcon name="history" size={12} />
                <code>{suggestion}</code>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {controls?.bashRunning
        ? <button type="button" className={styles.danger} onClick={controls.abort}>{t("commandPanel.stop")}</button>
        : <button className={styles.primaryAction} type="button" onClick={() => run()} disabled={!controls || controls.disabled || !command.trim()}><AliIcon name="play" size={12} /><span>{t("commandPanel.run")}</span></button>}
    </div>
    <label className={styles.commandContextToggle}><input type="checkbox" checked={excludeFromContext} onChange={(event) => setExcludeFromContext(event.target.checked)} />{t("commandPanel.exclude")}</label>
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
