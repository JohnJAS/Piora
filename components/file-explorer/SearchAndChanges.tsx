"use client";

import { useState } from "react";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { getFileDirectory, getFileName, getRelativeFilePath, joinFilePath } from "@/lib/file-paths";
import type { GitFileStatus } from "@/lib/git-types";
import { AliIcon } from "../AliIcon";
import { FolderIcon, getFileIcon } from "../FileIcons";
import styles from "../FileExplorer.module.css";
import {
  AddToChatIcon,
  DismissButton,
  GIT_STATUS_COLORS,
  GitStatusBadge,
  type FileContextTarget,
  type OpenFileHandler,
  type PendingConflict,
  type Translate,
  type UploadConflictStrategy,
  type UploadPhase,
  type UploadSummary,
} from "./shared";

export function SearchResultRow({
  entry,
  cwd,
  onOpen,
  onOpenContextMenu,
  selected,
  active,
  onFocus,
}: {
  entry: FileIndexEntry;
  cwd: string;
  onOpen: (target: FileContextTarget) => void;
  onOpenContextMenu: (target: FileContextTarget, x: number, y: number) => void;
  selected: boolean;
  active: boolean;
  onFocus: () => void;
}) {
  const fullPath = joinFilePath(cwd, entry.path);
  const name = getFileName(entry.path);
  const parentPath = getFileDirectory(entry.path);
  const target = { name, fullPath, isDir: entry.isDir };
  return (
    <div
      className={styles.searchResult}
      role="option"
      aria-selected={selected}
      data-file-search-result
      data-tree-label={name}
      tabIndex={active ? 0 : -1}
      onFocus={onFocus}
      title={fullPath}
      style={{ background: selected ? "var(--bg-selected)" : undefined }}
      onClick={() => onOpen(target)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(target);
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          const rows = Array.from(
            event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-file-search-result]") ?? [],
          );
          const currentIndex = rows.indexOf(event.currentTarget);
          const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
              ? rows.length - 1
              : event.key === "ArrowDown"
                ? Math.min(rows.length - 1, currentIndex + 1)
                : Math.max(0, currentIndex - 1);
          if (rows[nextIndex]) {
            event.preventDefault();
            rows[nextIndex].focus();
          }
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const rows = Array.from(
            event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-file-search-result]") ?? [],
          );
          const currentIndex = rows.indexOf(event.currentTarget);
          const needle = event.key.toLocaleLowerCase();
          const ordered = [...rows.slice(currentIndex + 1), ...rows.slice(0, currentIndex + 1)];
          const match = ordered.find((row) => row.dataset.treeLabel?.toLocaleLowerCase().startsWith(needle));
          if (match) {
            event.preventDefault();
            match.focus();
          }
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu(target, event.clientX, event.clientY);
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {entry.isDir ? <FolderIcon size={15} name={name} /> : getFileIcon(name, 15)}
      </span>
      <div className={styles.searchResultText}>
        <div className={styles.searchResultName}>{name}</div>
        <div className={styles.searchResultPath}>{parentPath === "." ? "" : parentPath}</div>
      </div>
    </div>
  );
}

export function ChangeRow({
  status,
  cwd,
  onOpenFile,
  onOpenContextMenu,
  selected,
  t,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  onOpenContextMenu: (target: FileContextTarget, x: number, y: number) => void;
  selected: boolean;
  t: Translate;
}) {
  const [hovered, setHovered] = useState(false);
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  return (
    <div
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu({ name, fullPath: status.filePath, isDir: false }, event.clientX, event.clientY);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={status.filePath}
      aria-current={selected ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10,
        paddingRight: 8,
        minHeight: "max(24px, calc(var(--text-sm) + 10px))",
        cursor: "pointer",
        background: selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: 4,
        userSelect: "none",
      }}
    >
      <GitStatusBadge status={status} t={t} />
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>
        {getFileIcon(name, 13)}
      </span>
      <span
        style={{
          fontSize: "var(--text-sm)",
          color: GIT_STATUS_COLORS[status.status],
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {rel}
      </span>
    </div>
  );
}

export function UploadFeedbackBanner({
  uploadBusy,
  uploadPhase,
  uploadProgress,
  pendingConflict,
  uploadError,
  uploadSummary,
  hasAtMentions,
  onPerformUpload,
  onCancelConflict,
  onDismissError,
  onAddUploadedFilesToChat,
  onDismissSummary,
  t,
}: {
  uploadBusy: boolean;
  uploadPhase: UploadPhase;
  uploadProgress: number;
  pendingConflict: PendingConflict | null;
  uploadError: string | null;
  uploadSummary: UploadSummary | null;
  hasAtMentions: boolean;
  onPerformUpload: (files: File[], strategy: UploadConflictStrategy) => void;
  onCancelConflict: () => void;
  onDismissError: () => void;
  onAddUploadedFilesToChat: () => void;
  onDismissSummary: () => void;
  t: Translate;
}) {
  return (
    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
      {uploadBusy && (
        <div role="status" aria-live="polite" aria-label={uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { progress: uploadProgress })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 14, color: "var(--text-muted)" }}>
            {uploadPhase === "checking" ? (
              <AliIcon name="reload" size={13} style={{ animation: "spin 0.8s linear infinite" }} />
            ) : (
              <AliIcon name="upload" size={13} />
            )}
            {uploadPhase === "uploading" && <span style={{ fontSize: "var(--text-xs)" }}>{uploadProgress}%</span>}
          </div>
          {uploadPhase === "uploading" && (
            <div style={{ height: 3, marginTop: 4, overflow: "hidden", borderRadius: 2, background: "var(--border)" }}>
              <div style={{ width: `${uploadProgress}%`, height: "100%", background: "var(--text-muted)", transition: "width 120ms ease" }} />
            </div>
          )}
        </div>
      )}

      {pendingConflict && (
        <div role="alert" style={{ padding: 7, border: "1px solid color-mix(in srgb, #f59e0b 55%, var(--border))", borderRadius: 4, background: "color-mix(in srgb, #f59e0b 9%, var(--bg-panel))" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {t("files.conflictSummary", {
              count: pendingConflict.conflicts.length,
              countSuffix: pendingConflict.conflicts.length === 1 ? "" : "s",
              files: pendingConflict.conflicts.join(", "),
            })}
          </div>
          {pendingConflict.nonReplaceable.length > 0 && (
            <div style={{ marginTop: 3, fontSize: "var(--text-xs)", color: "#f59e0b", lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {t("files.cannotReplace", { files: pendingConflict.nonReplaceable.join(", ") })}
            </div>
          )}
          <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
            <button type="button" onClick={() => onPerformUpload(pendingConflict.files, "overwrite")} style={{ minHeight: "max(22px, calc(var(--text-xs) + 12px))", padding: "0 7px", border: "1px solid #ef4444", borderRadius: 4, background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: "var(--text-xs)" }}>
              {t("files.replace")}
            </button>
            <button type="button" onClick={() => onPerformUpload(pendingConflict.files, "skip")} style={{ minHeight: "max(22px, calc(var(--text-xs) + 12px))", padding: "0 7px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: "var(--text-xs)" }}>
              {t("files.skipExisting")}
            </button>
            <button type="button" onClick={onCancelConflict} style={{ minHeight: "max(22px, calc(var(--text-xs) + 12px))", padding: "0 7px", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--text-xs)" }}>
              {t("files.cancel")}
            </button>
          </div>
        </div>
      )}

      {uploadError && (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: "var(--text-xs)", lineHeight: 1.35, color: "#f87171" }}>
          <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{uploadError}</span>
          <DismissButton onClick={onDismissError} title={t("files.dismissError")} />
        </div>
      )}

      {uploadSummary && (
        <div aria-live="polite">
          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22, fontSize: "var(--text-xs)" }}>
            <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              {uploadSummary.uploaded.length > 0 && (
                <span title={`${uploadSummary.uploaded.length} uploaded`} aria-label={`${uploadSummary.uploaded.length} uploaded`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#22c55e" }}>
                  <AliIcon name="check" size={13} />
                  <span>{uploadSummary.uploaded.length}</span>
                </span>
              )}
              {uploadSummary.skipped.length > 0 && (
                <span title={`${uploadSummary.skipped.length} skipped`} aria-label={`${uploadSummary.skipped.length} skipped`} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-dim)" }}>
                  <AliIcon name="minus" size={13} />
                  <span>{uploadSummary.skipped.length}</span>
                </span>
              )}
              {uploadSummary.errors.length > 0 && (
                <span title={`${uploadSummary.errors.length} failed`} aria-label={`${uploadSummary.errors.length} failed`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#f87171" }}>
                  <AliIcon name="warning" size={13} />
                  <span>{uploadSummary.errors.length}</span>
                </span>
              )}
            </div>
            {uploadSummary.uploaded.length > 0 && hasAtMentions && (
              <button
                type="button"
                onClick={onAddUploadedFilesToChat}
                title={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                aria-label={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                style={{ width: 26, height: 26, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid transparent", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
              >
                <AddToChatIcon />
              </button>
            )}
            <DismissButton onClick={onDismissSummary} title={t("files.dismissUploadResults")} />
          </div>
          {uploadSummary.errors.map((item) => (
            <div key={item.name} title={item.error} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, minWidth: 0, fontSize: "var(--text-xs)", color: "#f87171" }}>
              <AliIcon name="error" size={11} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
