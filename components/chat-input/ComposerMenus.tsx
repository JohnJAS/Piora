"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import {
  getSlashCommandDescription,
  type SlashCommandPaletteItem,
  type SlashCommandSource,
} from "@/lib/commands";
import type { AtQueryMatch, FileIndexEntry } from "@/lib/file-fuzzy";
import type { ClientFileIndex } from "@/lib/file-index-client";
import { AliIcon } from "../AliIcon";
import { FolderIcon, getFileIcon } from "../FileIcons";
import { SLASH_SOURCE_GROUP_LABEL_KEYS } from "./shared";

export interface InputHistoryMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  inputHistory: string[];
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (text: string) => void;
}

export function InputHistoryMenu({
  menuRef,
  itemRefs,
  inputHistory,
  activeIndex,
  onHoverIndex,
  onSelect,
}: InputHistoryMenuProps) {
  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
        boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        overflow: "hidden",
        maxHeight: "min(44vh, 360px)",
      }}
    >
      <div
        title="Input history"
        style={{
          height: 30,
          padding: "0 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          color: "var(--text-dim)",
        }}
      >
        <AliIcon name="history" size={14} />
      </div>
      <div style={{ maxHeight: "calc(min(44vh, 360px) - 31px)", overflowY: "auto", padding: 4 }}>
        {inputHistory.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`${index}:${item}`}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              onMouseEnter={() => onHoverIndex(index)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "7px 8px",
                border: "none",
                borderRadius: "var(--radius-control)",
                background: active ? "var(--bg-selected)" : "none",
                color: "var(--text)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "var(--text-sm)",
                lineHeight: 1.45,
              }}
            >
              <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-dim)", paddingTop: 1 }}>
                {index + 1}
              </span>
              <span style={{ minWidth: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
                {item}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface SlashCommandMenuProps {
  listId: string;
  countLabel: string;
  loading?: boolean;
  error?: string | null;
  onRetryLoad?: () => void;
  isStreaming: boolean;
  filteredCount: number;
  groups: { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }[];
  activeIndex: number;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  onHoverIndex: (index: number) => void;
  onSelect: (command: SlashCommandPaletteItem) => void;
}

export function SlashCommandMenu({
  listId,
  countLabel,
  loading,
  error,
  onRetryLoad,
  isStreaming,
  filteredCount,
  groups,
  activeIndex,
  itemRefs,
  onHoverIndex,
  onSelect,
}: SlashCommandMenuProps) {
  const { t } = useI18n();
  return (
    <div id={listId} className="slash-command-menu" role="listbox" aria-label={t("chat.slashCommands", { label: countLabel })}>
      <div className="slash-command-menu-header">
        <span>{loading ? t("chat.loadingCommands") : t("chat.slashCommands", { label: countLabel })}</span>
        <span className="slash-command-menu-hints" aria-hidden="true">
          <kbd>↑</kbd><kbd>↓</kbd> {t("chat.commandSwitch")} · <kbd>Tab</kbd> {t("chatCommands.selectHint")} · <kbd>esc</kbd> {t("chat.commandClose")}
        </span>
      </div>
      <div className="slash-command-menu-list">
        {error && (
          <div className="slash-command-menu-empty" role="alert">
            {t("chatCommands.catalogFailed")} · {error}{" "}
            <button type="button" onClick={onRetryLoad}>{t("chatCommands.retry")}</button>
          </div>
        )}
        {!loading && filteredCount === 0 ? (
          <div className="slash-command-menu-empty">{t("chat.noCommands")}</div>
        ) : (
          groups.map((group) => (
            <section key={group.source} className="slash-command-group">
              <div className="slash-command-group-header">
                <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                <span>{group.items.length}</span>
              </div>
              {group.items.map(({ command, index }) => {
                const active = index === activeIndex;
                return (
                  <button
                    key={`${command.source}:${command.name}`}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    id={`${listId}-${index}`}
                    aria-selected={active}
                    aria-disabled={command.supported === false}
                    className="slash-command-item"
                    data-active={active ? "true" : "false"}
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={() => onSelect(command)}
                    onMouseEnter={() => onHoverIndex(index)}
                  >
                    <span className="slash-command-item-name">
                      /{command.name}
                      {command.argumentHint && <span className="slash-command-item-argument"> {command.argumentHint}</span>}
                    </span>
                    <span className="slash-command-item-desc">
                      {command.supported === false
                        ? t("chatCommands.unsupported")
                        : isStreaming && command.source === "builtin"
                          ? t("chat.commandWaitUntilIdle")
                          : getSlashCommandDescription(command, t)}
                    </span>
                    <span className="slash-command-item-source">{t(SLASH_SOURCE_GROUP_LABEL_KEYS[command.source])}</span>
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export interface FileMentionMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  listId: string;
  position: React.CSSProperties;
  cwd?: string | null;
  atQuery: AtQueryMatch;
  fileIndex: ClientFileIndex | null;
  fileIndexLoading: boolean;
  needsServerSearch: boolean;
  serverResultInUse: boolean;
  matches: FileIndexEntry[];
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (entry: FileIndexEntry) => void;
}

export function FileMentionMenu({
  menuRef,
  listRef,
  itemRefs,
  listId,
  position,
  cwd,
  atQuery,
  fileIndex,
  fileIndexLoading,
  needsServerSearch,
  serverResultInUse,
  matches,
  activeIndex,
  onHoverIndex,
  onSelect,
}: FileMentionMenuProps) {
  const { t } = useI18n();
  const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
  const matchCountLabel = matches.length === 1 ? t("chat.match") : t("chat.matches", { count: matches.length });
  // With a truncated index, local results are provisional — the
  // debounced server search over the full listing replaces them.
  const truncatedHint = fileIndex?.truncated && !serverResultInUse
    ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
    : "";

  return createPortal(
    <div
      ref={menuRef}
      className="file-mention-menu"
      data-testid="file-mention-menu"
      style={position}
    >
      <div className="file-mention-header">
        <span>
          {indexLoading
            ? t("chat.loadingFiles")
            : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
        </span>
        <span className="file-mention-hints">{t("chat.tabEnter")}</span>
      </div>
      <div
        ref={listRef}
        id={listId}
        className="file-mention-list"
        role="listbox"
        aria-label={t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
      >
        {!indexLoading && matches.length === 0 ? (
          <div className="file-mention-empty">
            {needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
          </div>
        ) : (
          matches.map((entry, index) => {
            const active = index === activeIndex;
            if (entry.path === "@workflow:plan" || entry.path === "@workflow:goal") {
              const kind = entry.path === "@workflow:plan" ? "plan" : "goal";
              return (
                <button
                  key={entry.path}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={active}
                  aria-label={`@${kind}`}
                  data-testid={`mention-workflow-${kind}`}
                  className="file-mention-item"
                  data-active={active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(entry)}
                  onMouseEnter={() => onHoverIndex(index)}
                >
                  <span className="file-mention-icon">
                    <AliIcon name={kind === "plan" ? "list-check" : "target"} size={14} style={{ color: "var(--accent)" }} />
                  </span>
                  <span className="file-mention-copy">
                    <span className="file-mention-name">@{kind}</span>
                    <span className="file-mention-directory">
                      {t(kind === "plan" ? "workflow.slash.planDescription" : "workflow.slash.goalDescription")}
                    </span>
                  </span>
                </button>
              );
            }
            const name = entry.path.split("/").pop() ?? entry.path;
            const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
            return (
              <button
                key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={active}
                aria-label={entry.path}
                title={entry.path}
                className="file-mention-item"
                data-active={active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(entry)}
                onMouseEnter={() => onHoverIndex(index)}
              >
                <span className="file-mention-icon">
                  {entry.isDir ? <FolderIcon size={14} name={name} /> : getFileIcon(name, 14)}
                </span>
                <span className="file-mention-copy">
                  <span className="file-mention-name">{name}{entry.isDir ? "/" : ""}</span>
                  {dirPrefix && <span className="file-mention-directory">{dirPrefix}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
