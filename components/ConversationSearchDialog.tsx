"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import type { ConversationArchiveFilter, ConversationSearchResponse, ConversationSearchResult } from "@/lib/conversation-search";
import { getProjectLabel } from "@/lib/session-project-groups";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "./AliIcon";
import styles from "./ConversationSearchDialog.module.css";

interface Props {
  sessions: SessionInfo[];
  onClose: () => void;
  onSelect: (session: SessionInfo, entryId: string) => void;
}

function HighlightedSnippet({ result }: { result: ConversationSearchResult }) {
  const start = Math.max(0, Math.min(result.snippet.length, result.matchStart));
  const end = Math.max(start, Math.min(result.snippet.length, start + result.matchLength));
  return <>
    {result.snippet.slice(0, start)}
    <mark>{result.snippet.slice(start, end)}</mark>
    {result.snippet.slice(end)}
  </>;
}

export function ConversationSearchDialog({ sessions, onClose, onSelect }: Props) {
  const { locale, t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [archive, setArchive] = useState<ConversationArchiveFilter>("all");
  const [response, setResponse] = useState<ConversationSearchResponse>({ results: [], durationMs: 0, truncated: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusTrap(dialogRef, true, { initialFocus: inputRef, onEscape: onClose });

  const projects = useMemo(() => {
    const entries = new Map<string, string>();
    for (const session of sessions) {
      const key = session.projectless ? "__projectless__" : session.projectRoot ?? session.cwd;
      entries.set(key, session.projectless ? t("conversationSearch.projectless") : getProjectLabel(key));
    }
    return [...entries].sort((left, right) => left[1].localeCompare(right[1], locale));
  }, [locale, sessions, t]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResponse({ results: [], durationMs: 0, truncated: false });
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ q: trimmed, archive, limit: "100" });
      if (project) params.set("project", project);
      try {
        const searchResponse = await fetch(`/api/sessions/search?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await searchResponse.json().catch(() => ({})) as ConversationSearchResponse & { error?: string };
        if (!searchResponse.ok) throw new Error(payload.error || `HTTP ${searchResponse.status}`);
        setResponse(payload);
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setError(searchError instanceof Error ? searchError.message : String(searchError));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [archive, project, query]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const openResult = (result: ConversationSearchResult) => {
    const session = sessions.find((candidate) => candidate.id === result.sessionId);
    if (!session) {
      setError(t("conversationSearch.sessionMissing"));
      return;
    }
    onSelect(session, result.entryId);
    onClose();
  };

  return createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="conversation-search-title">
        <header className={styles.header}>
          <div>
            <h2 id="conversation-search-title">{t("conversationSearch.title")}</h2>
            <p>{t("conversationSearch.description")}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("i18n.close")} title={t("i18n.close")}>
            <AliIcon name="close" size={16} />
          </button>
        </header>

        <div className={styles.controls}>
          <label className={styles.searchBox}>
            <AliIcon name="search" size={16} />
            <input ref={inputRef} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={t("conversationSearch.placeholder")} />
            {loading ? <AliIcon className="animate-spin" name="reload" size={14} /> : null}
          </label>
          <select value={project} onChange={(event) => setProject(event.target.value)} aria-label={t("conversationSearch.projectFilter")}>
            <option value="">{t("conversationSearch.allProjects")}</option>
            {projects.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={archive} onChange={(event) => setArchive(event.target.value as ConversationArchiveFilter)} aria-label={t("conversationSearch.archiveFilter")}>
            <option value="all">{t("conversationSearch.allChats")}</option>
            <option value="active">{t("conversationSearch.activeChats")}</option>
            <option value="archived">{t("conversationSearch.archivedChats")}</option>
          </select>
        </div>

        <div className={styles.summary} role="status" aria-live="polite">
          {error
            ? t("conversationSearch.failed", { error })
            : query.trim()
              ? t("conversationSearch.resultCount", { count: response.results.length, duration: response.durationMs })
              : t("conversationSearch.hint")}
          {response.truncated ? ` · ${t("conversationSearch.truncated")}` : ""}
        </div>

        <div className={styles.results}>
          {response.results.map((result, index) => (
            <button key={`${result.sessionId}:${result.entryId}:${index}`} type="button" className={styles.result} onClick={() => openResult(result)}>
              <span className={styles.resultHeader}>
                <strong>{result.title}</strong>
                <span>{result.projectLabel}</span>
                {result.archived ? <span className={styles.badge}>{t("conversationSearch.archived")}</span> : null}
              </span>
              <span className={styles.snippet}><HighlightedSnippet result={result} /></span>
              <span className={styles.meta}>
                {t(result.role === "user" ? "conversationSearch.user" : "conversationSearch.assistant")}
                <span aria-hidden="true">·</span>
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.timestamp))}
              </span>
            </button>
          ))}
          {!loading && !error && query.trim() && response.results.length === 0 ? (
            <div className={styles.empty}><AliIcon name="search" size={22} /><span>{t("conversationSearch.noResults")}</span></div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
