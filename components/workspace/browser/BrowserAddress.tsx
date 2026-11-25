"use client";

import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import { AliIcon } from "@/components/AliIcon";
import { createPortal } from "react-dom";
import { getCachedFileIndex, loadFileIndex, type ClientFileIndex } from "@/lib/file-index-client";
import { filterFileEntries } from "@/lib/file-fuzzy";
import { getFileName, joinFilePath } from "@/lib/file-paths";
import type { BrowserToolInvoke, Visit } from "@/desktop/src/browser/contracts";
import styles from "./BrowserTools.module.css";

export interface BrowserAddressWorkspace {
  cwd: string;
  openFile(path: string, name: string): void;
}

function useWorkspaceFiles(cwd: string | undefined, query: string) {
  const [index, setIndex] = useState<ClientFileIndex | null>(null);
  const searching = Boolean(query);
  useEffect(() => {
    if (!cwd || !searching) return;
    let current = true;
    setIndex(getCachedFileIndex(cwd));
    void loadFileIndex(cwd).then((result) => {
      if (current) setIndex(result);
    }).catch(() => { /* Web navigation is still available when indexing fails. */ });
    return () => { current = false; };
  }, [cwd, searching]);
  const files = useMemo(() => index && index.cwd === cwd ? index.entries.filter((entry) => !entry.isDir) : undefined, [cwd, index]);
  return useMemo(() => query && files ? filterFileEntries(files, query, 5) : [], [files, query]);
}

type Suggestion = { kind: "file" | "history"; id: string; title: string; value: string };

export function BrowserAddress({
  value,
  change,
  inputRef,
  placeholder,
  label,
  invoke,
  slot,
  navigate,
  home,
  workspace,
}: {
  value: string;
  change(value: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
  placeholder: string;
  label: string;
  invoke?: BrowserToolInvoke;
  slot: HTMLElement | null;
  navigate(value: string): void;
  home?: { submitLabel: string };
  workspace?: BrowserAddressWorkspace;
}) {
  const listId = useId(),
    [editing, setEditing] = useState(false),
    [focus, setFocus] = useState(false),
    [history, setHistory] = useState<Visit[]>([]),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const query = editing && focus ? value.trim() : "";
  const fileQuery = /^(?:https?:\/\/|about:blank$)/i.test(query) ? "" : query.replaceAll("\\", "/").replace(/^\.\//, "");
  const files = useWorkspaceFiles(workspace?.cwd, fileQuery);
  const rows: Suggestion[] = [
    ...files.map(({ path }): Suggestion => ({ kind: "file", id: `file:${path}`, title: getFileName(path), value: path })),
    ...history.map((visit): Suggestion => ({ kind: "history", id: `history:${visit.id}`, title: visit.title || visit.url, value: visit.url })),
  ];
  useEffect(() => {
    let current = true;
    if (!invoke || !query) {
      setHistory([]);
      return;
    }
    const timer = setTimeout(() => {
      void invoke("history", { text: query, suggestions: true, limit: 6 })
        .then((result) => {
          if (current) setHistory(result);
        })
        .catch(() => {
          if (current) setHistory([]);
        });
    }, 65);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [invoke, query]);
  const finishEditing = () => {
    setEditing(false);
    setHistory([]);
    setSelectedId(null);
    inputRef.current?.blur();
  };
  const submit = (url: string) => {
    if (!url.trim()) return;
    finishEditing();
    change(url);
    navigate(url.trim());
  };
  const choose = (row: Suggestion) => {
    if (row.kind === "file" && workspace) {
      finishEditing();
      change("");
      workspace.openFile(joinFilePath(workspace.cwd, row.value), row.title);
    } else if (row.kind === "history") {
      submit(row.value);
    }
  };
  let domain: string | undefined;
  if (!home && invoke && !focus && /^https?:\/\//i.test(value)) {
    try {
      domain = new URL(value).host;
    } catch {
      /* Keep partially entered URLs visible. */
    }
  }
  const open = Boolean(query && rows.length && (home || slot));
  const selected = open ? rows.findIndex((row) => row.id === selectedId) : -1;
  const selectedOption = selected >= 0 ? `${listId}-${selected}` : undefined;
  useEffect(() => {
    if (selectedOption) document.getElementById(selectedOption)?.scrollIntoView({ block: "nearest" });
  }, [selectedOption]);
  const suggestions = open ? (
    <div id={listId} role="listbox" aria-label={label} className={`${styles.suggestions}${home ? ` ${styles.homeSuggestions}` : ""}`}>
      {rows.map((row, i) => (
        <button
          type="button"
          key={row.id}
          id={`${listId}-${i}`}
          role="option"
          tabIndex={-1}
          aria-selected={selected === i}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(row)}
        >
          <AliIcon name={row.kind === "file" ? "file" : "history"} size={15} />
          <span>
            <strong>{row.title}</strong>
            {row.title !== row.value && <small>{row.value}</small>}
          </span>
        </button>
      ))}
    </div>
  ) : null;
  return (
    <>
      <form
        className={home ? styles.homeAddress : undefined}
        data-domain={domain || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (composing(inputRef.current)) return;
          if (selected >= 0) choose(rows[selected]);
          else submit(value);
        }}
      >
        {home && <AliIcon name="search" size={19} />}
        {domain && (
          <span className={styles.addressHost} aria-hidden="true">
            {domain}
          </span>
        )}
        <input
          ref={inputRef}
          value={value}
          aria-label={label}
          placeholder={placeholder}
          role="combobox"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={selectedOption}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false);
            setEditing(false);
          }}
          onCompositionStart={(event) => {
            event.currentTarget.dataset.composing = "true";
          }}
          onCompositionEnd={(event) => {
            delete event.currentTarget.dataset.composing;
          }}
          onChange={(event) => {
            change(event.target.value);
            if (event.target.value.trim() !== value.trim()) setHistory([]);
            setSelectedId(null);
            setEditing(true);
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              composing(event.currentTarget)
            )
              return;
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setSelectedId(null);
            }
            if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              const index = event.key === "ArrowDown"
                ? (selected + 1) % rows.length
                : (selected <= 0 ? rows.length - 1 : selected - 1);
              setSelectedId(rows[index].id);
            }
          }}
        />
        {home && <button type="submit" aria-label={home.submitLabel} title={home.submitLabel} disabled={!value.trim()}>
          <AliIcon name="arrowright" size={16} />
        </button>}
      </form>
      {home ? suggestions : slot && suggestions && createPortal(suggestions, slot)}
    </>
  );
}
function composing(input: HTMLInputElement | null) {
  return input?.dataset.composing === "true";
}
