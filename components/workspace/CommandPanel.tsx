"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseAnsiLine } from "@/lib/ansi";
import { filterCommandHistory } from "@/lib/command-history";
import type { TaskControls } from "../ChatWindow";
import { AliIcon } from "../AliIcon";
import styles from "./WorkspacePanel.module.css";

const HISTORY_KEY = "piora-command-history-v1";
const HISTORY_LIMIT = 100;
const QUICK_COMMANDS = ["git status --short", "git diff --stat", "npm test", "npm run lint"];

interface Props {
  controls: TaskControls | null;
  cwd?: string | null;
}

export function CommandPanel({ controls, cwd }: Props) {
  const { t } = useI18n();
  const [command, setCommand] = useState("");
  const [excludeFromContext, setExcludeFromContext] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [outputQuery, setOutputQuery] = useState("");
  const [wrapOutput, setWrapOutput] = useState(true);
  const [followOutput, setFollowOutput] = useState(true);
  const [hiddenOutputSignature, setHiddenOutputSignature] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) setHistory(stored.filter((item): item is string => typeof item === "string").slice(0, HISTORY_LIMIT));
    } catch { /* Ignore malformed local history. */ }
  }, []);

  const outputSignature = controls?.latestBash
    ? `${controls.latestBash.command}\u0000${controls.latestBash.output}\u0000${controls.latestBash.exitCode ?? ""}\u0000${controls.latestBash.cancelled ?? ""}`
    : null;
  const latestBash = outputSignature && outputSignature !== hiddenOutputSignature ? controls?.latestBash ?? null : null;
  const outputLines = useMemo(() => (latestBash?.output ?? "").split(/\r?\n/), [latestBash?.output]);
  const commandOptions = useMemo(() => [...history, ...QUICK_COMMANDS.filter((item) => !history.includes(item))], [history]);
  const suggestions = useMemo(
    () => suggestionsOpen ? filterCommandHistory(commandOptions, command) : [],
    [command, commandOptions, suggestionsOpen],
  );
  const outputMatchCount = useMemo(() => {
    const needle = outputQuery.trim().toLocaleLowerCase();
    if (!needle) return 0;
    return outputLines.reduce((count, line) => count + countMatches(line.toLocaleLowerCase(), needle), 0);
  }, [outputLines, outputQuery]);

  useEffect(() => {
    if (!followOutput || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [controls?.bashRunning, controls?.latestBash?.output, followOutput]);

  const run = (commandOverride?: string) => {
    const value = (commandOverride ?? command).trim();
    if (!value || !controls || controls.disabled) return;
    const next = [value, ...history.filter((item) => item !== value)].slice(0, HISTORY_LIMIT);
    setHistory(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistoryIndex(-1);
    setSuggestionsOpen(false);
    setHiddenOutputSignature(null);
    setOutputQuery("");
    setCommand("");
    void controls.runCommand(value, excludeFromContext);
  };

  const chooseSuggestion = (suggestion: string) => {
    setCommand(suggestion);
    setSuggestionsOpen(false);
    inputRef.current?.focus();
  };

  return <div className={styles.commandRoot}>
    <header className={styles.terminalHeader}>
      <div className={styles.terminalIdentity}>
        <span className={styles.terminalStatusDot} data-running={controls?.bashRunning || undefined} />
        <span><b>{t("commandPanel.title")}</b><small>{controls?.bashRunning ? t("commandPanel.statusRunning") : t("commandPanel.statusReady")}</small></span>
      </div>
      <div className={styles.terminalHeaderActions}>
        {cwd ? <span className={styles.terminalCwd} title={cwd}><AliIcon name="folder" size={12} />{compactCwd(cwd)}</span> : null}
        <button type="button" aria-pressed={wrapOutput} onClick={() => setWrapOutput((value) => !value)} title={wrapOutput ? t("commandPanel.unwrap") : t("commandPanel.wrap")} aria-label={wrapOutput ? t("commandPanel.unwrap") : t("commandPanel.wrap")}><AliIcon name="code" size={13} /></button>
        <button type="button" aria-pressed={followOutput} onClick={() => setFollowOutput((value) => !value)} title={followOutput ? t("commandPanel.pauseFollow") : t("commandPanel.follow")} aria-label={followOutput ? t("commandPanel.pauseFollow") : t("commandPanel.follow")}><AliIcon name="arrowdown" size={13} /></button>
        <button type="button" disabled={!latestBash} onClick={() => { if (outputSignature) setHiddenOutputSignature(outputSignature); setOutputQuery(""); }} title={t("commandPanel.clearOutput")} aria-label={t("commandPanel.clearOutput")}><AliIcon name="clear" size={13} /></button>
      </div>
    </header>

    <div ref={outputRef} className={styles.terminalViewport} aria-live="polite">
      {controls?.bashRunning ? <div className={styles.terminalRunningBlock}>
        <span className={styles.terminalSpinner}><AliIcon name="reload" size={13} /></span>
        <code>{controls.pendingCommand ?? command}</code>
        <span>{t("commandPanel.running", { command: controls.pendingCommand ?? command })}</span>
      </div> : null}

      {latestBash ? <article className={styles.terminalBlock} data-status={latestBash.cancelled ? "cancelled" : latestBash.exitCode === 0 ? "success" : "failed"}>
        <div className={styles.terminalBlockHeader}>
          <span className={styles.terminalPrompt}>❯</span>
          <code>{latestBash.command}</code>
          <span className={styles.terminalExit}>{latestBash.cancelled ? t("commandPanel.cancelled") : t("commandPanel.exit", { code: latestBash.exitCode ?? "?" })}</span>
          <button type="button" onClick={() => void navigator.clipboard.writeText(latestBash.command)} title={t("commandPanel.copyCommand")} aria-label={t("commandPanel.copyCommand")}><AliIcon name="copy" size={12} /></button>
          <button type="button" onClick={() => chooseSuggestion(latestBash.command)} title={t("commandPanel.rerun")} aria-label={t("commandPanel.rerun")}><AliIcon name="reload" size={12} /></button>
        </div>
        <div className={styles.terminalFindBar}>
          <AliIcon name="search" size={12} />
          <input value={outputQuery} onChange={(event) => setOutputQuery(event.target.value)} placeholder={t("commandPanel.findOutput")} aria-label={t("commandPanel.findOutput")} />
          {outputQuery ? <><span>{t("commandPanel.findMatches", { count: outputMatchCount })}</span><button type="button" onClick={() => setOutputQuery("")} aria-label={t("review.clearSearch")}><AliIcon name="close" size={11} /></button></> : null}
        </div>
        <pre data-wrap={wrapOutput || undefined}>{outputLines.map((line, lineIndex) => <span className={styles.terminalOutputLine} key={lineIndex}>{parseAnsiLine(line).map((segment, segmentIndex) => <span key={segmentIndex} style={segment.style}>{highlightText(segment.text, outputQuery)}</span>)}{"\n"}</span>)}</pre>
        <footer className={styles.terminalBlockFooter}>
          <span>{latestBash.excludeFromContext ? t("commandPanel.contextExcluded") : t("commandPanel.contextIncluded")}</span>
          <button type="button" onClick={() => void navigator.clipboard.writeText(latestBash.output)}><AliIcon name="copy" size={11} />{t("commandPanel.copy")}</button>
        </footer>
      </article> : !controls?.bashRunning ? <div className={styles.terminalEmpty}>
        <span className={styles.terminalEmptyIcon}><AliIcon name="code" size={18} /></span>
        <b>{t("commandPanel.emptyTitle")}</b>
        <span>{t("commandPanel.empty")}</span>
        <div className={styles.terminalQuickCommands} aria-label={t("commandPanel.quickCommands")}>
          {QUICK_COMMANDS.map((quickCommand) => <button key={quickCommand} type="button" onClick={() => chooseSuggestion(quickCommand)}><code>{quickCommand}</code></button>)}
        </div>
      </div> : null}
    </div>

    <footer className={styles.terminalComposer}>
      <div className={styles.commandInputWrap}>
        <span className={styles.terminalInputPrompt}>❯</span>
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
              chooseSuggestion(suggestions[suggestionIndex]);
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
        {suggestions.length ? <div id="command-history-suggestions" className={styles.commandSuggestions} role="listbox" aria-label={t("commandPanel.historyMatches")}>
          <div className={styles.commandSuggestionsHeader}><span>{t("commandPanel.historyMatches")}</span><span>{t("commandPanel.historyHint")}</span></div>
          {suggestions.map((suggestion, index) => <button key={suggestion} id={`command-history-option-${index}`} type="button" role="option" aria-selected={suggestionIndex === index} data-active={suggestionIndex === index || undefined} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => chooseSuggestion(suggestion)}><AliIcon name="history" size={12} /><code>{suggestion}</code></button>)}
        </div> : null}
      </div>
      {controls?.bashRunning
        ? <button type="button" className={styles.terminalStopButton} onClick={controls.abort}><AliIcon name="stop" size={11} />{t("commandPanel.stop")}</button>
        : <button className={styles.terminalRunButton} type="button" onClick={() => run()} disabled={!controls || controls.disabled || !command.trim()}><AliIcon name="play" size={11} /><span>{t("commandPanel.run")}</span></button>}
      <div className={styles.terminalComposerMeta}>
        <label className={styles.commandContextToggle}><input type="checkbox" checked={excludeFromContext} onChange={(event) => setExcludeFromContext(event.target.checked)} /><span aria-hidden="true" />{t("commandPanel.exclude")}</label>
        <span className={styles.commandLimit}>{t("commandPanel.limit")}</span>
      </div>
    </footer>
  </div>;
}

function compactCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : normalized;
}

function countMatches(value: string, needle: string): number {
  let count = 0;
  let index = value.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = value.indexOf(needle, index + Math.max(1, needle.length));
  }
  return count;
}

function highlightText(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = lowerText.indexOf(lowerNeedle);
  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(<mark key={`${match}:${parts.length}`}>{text.slice(match, match + needle.length)}</mark>);
    cursor = match + needle.length;
    match = lowerText.indexOf(lowerNeedle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
