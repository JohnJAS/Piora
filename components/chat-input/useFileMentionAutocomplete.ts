"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnchoredMenuPosition } from "@/hooks/useAnchoredMenuPosition";
import {
  buildAtInsertText,
  extractAtQuery,
  filterFileEntries,
  type AtQueryMatch,
  type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { getCachedFileIndex, loadFileIndex, type ClientFileIndex } from "@/lib/file-index-client";
import { matchesWorkflowMentionQuery, removeMentionToken } from "@/lib/workflow/composer-triggers";
import { resizeComposerTextarea } from "./shared";

export const WORKFLOW_MENTION_PREFIX = "@workflow:";

export interface UseFileMentionAutocompleteOptions {
  cwd?: string | null;
  value: string;
  setValue: (next: string | ((current: string) => string)) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputAnchorRef: React.RefObject<HTMLDivElement | null>;
  workflowEnabled?: boolean;
  onSelectWorkflowMention?: (kind: "plan" | "goal") => void;
}

export function useFileMentionAutocomplete({
  cwd,
  value,
  setValue,
  textareaRef,
  inputAnchorRef,
  workflowEnabled = false,
  onSelectWorkflowMention,
}: UseFileMentionAutocompleteOptions) {
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<ClientFileIndex | null>(() => (cwd ? getCachedFileIndex(cwd) : null));
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);

  const atMenuRef = useRef<HTMLDivElement>(null);
  const atListRef = useRef<HTMLDivElement>(null);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atListId = React.useId();
  const atMenuPosition = useAnchoredMenuPosition(inputAnchorRef, atMenuOpen && atQuery !== null);

  // Recomputed from the text before the caret on every change/caret move.
  // Enabled whenever cwd is set OR Plan/Goal workflow mentions are available.
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd && !workflowEnabled) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd, workflowEnabled]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => {
          if (!controller.signal.aborted) setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] });
        })
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const workflowAtEntries = useMemo<FileIndexEntry[]>(() => {
    if (!workflowEnabled || atQueryText === null || atQuery?.quoted) return [];
    const items: FileIndexEntry[] = [];
    if (matchesWorkflowMentionQuery(atQueryText, "plan")) {
      items.push({ path: `${WORKFLOW_MENTION_PREFIX}plan`, isDir: false });
    }
    if (matchesWorkflowMentionQuery(atQueryText, "goal")) {
      items.push({ path: `${WORKFLOW_MENTION_PREFIX}goal`, isDir: false });
    }
    return items;
  }, [workflowEnabled, atQueryText, atQuery?.quoted]);
  const fileMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;
  const atMatches: FileIndexEntry[] = useMemo(
    () => workflowAtEntries.length ? [...workflowAtEntries, ...fileMatches] : fileMatches,
    [workflowAtEntries, fileMatches],
  );

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Warm the directory after the composer mounts, before @ is needed. Reuse
  // other sessions' entries immediately and refresh stale data in the background.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    const cached = getCachedFileIndex(cwd);
    setFileIndex(cached);
    setFileIndexLoading(!cached);
    const refresh = () => {
      void loadFileIndex(cwd)
        .then((index) => { if (!cancelled) setFileIndex(index); })
        .catch(() => { /* Keep cached entries; the next open retries. */ })
        .finally(() => { if (!cancelled) setFileIndexLoading(false); });
    };
    const timer = setTimeout(refresh, atTokenActive ? 0 : 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    if (entry.path.startsWith(WORKFLOW_MENTION_PREFIX)) {
      const kind = entry.path.slice(WORKFLOW_MENTION_PREFIX.length) as "plan" | "goal";
      const { nextText, nextCursor } = removeMentionToken(value, atQuery.start, cursor);
      setValue(nextText);
      setAtQuery(null);
      onSelectWorkflowMention?.(kind);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
        resizeComposerTextarea(el);
      });
      return;
    }
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      resizeComposerTextarea(el);
    });
  }, [setValue, atQuery, value, textareaRef, onSelectWorkflowMention]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    const item = atItemRefs.current[atActiveIndex];
    const list = atListRef.current;
    if (!item || !list) return;
    const row = item.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  }, [atActiveIndex, atMenuOpen, atMatches.length, atMenuPosition]);

  return {
    atQuery,
    setAtQuery,
    atMenuOpen,
    setAtMenuOpen,
    atActiveIndex,
    setAtActiveIndex,
    fileIndex,
    fileIndexLoading,
    needsServerSearch,
    serverResultInUse,
    atMatches,
    atMenuRef,
    atListRef,
    atItemRefs,
    atListId,
    atMenuPosition,
    updateAtQuery,
    applyAtCompletion,
  };
}
