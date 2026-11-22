"use client";

import { forwardRef, useState, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { requestGitStatus } from "@/lib/git-status-client";
import {
  encodeFilePathForApi,
  getFileDirectory,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import type { GitFileStatus } from "@/lib/git-types";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import {
  parseWorkspaceContinuity,
  updateWorkspaceContinuity,
  workspaceContinuityStorageKey,
} from "@/lib/workspace-continuity";
import styles from "./FileExplorer.module.css";
import { FileContextMenu } from "./file-explorer/FileContextMenu";
import { ChangeRow, SearchResultRow, UploadFeedbackBanner } from "./file-explorer/SearchAndChanges";
import { TreeNode } from "./file-explorer/TreeNode";
import {
  directoryChangeKind,
  fetchEntries,
  GIT_STATUS_COLORS,
  uploadFiles,
  type DirectoryChangeKind,
  type FileContextMenuState,
  type FileContextTarget,
  type FileExplorerHandle,
  type FileExplorerProps,
  type FileNode,
  type PendingConflict,
  type UploadConflictStrategy,
  type UploadPhase,
  type UploadResponse,
  type UploadSummary,
} from "./file-explorer/shared";

export type { FileExplorerHandle } from "./file-explorer/shared";

const fetchGitStatus = requestGitStatus;

export const FileExplorer = forwardRef<FileExplorerHandle, FileExplorerProps>(function FileExplorer({
  cwd,
  selectedFilePath,
  onOpenFile,
  refreshKey,
  onAtMention,
  onAtMentions,
  onUploadBusyChange,
  changesCollapsed,
  onChangesCountChange,
}, ref) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [gitLineStats, setGitLineStats] = useState({ additions: 0, deletions: 0 });
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileIndexEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [focusedSearchIndex, setFocusedSearchIndex] = useState(0);
  const [focusedTreePath, setFocusedTreePath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const prevCwdRef = useRef<string | null>(null);
  const skipExpandedPersistenceRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const uploadBusy = uploadPhase !== "idle";
  const normalizedSelectedFilePath = selectedFilePath
    ? normalizeFilePathSlashes(selectedFilePath)
    : null;
  const treeFocusablePath = focusedTreePath ?? roots[0]?.fullPath ?? null;

  useEffect(() => {
    setFocusedSearchIndex(0);
  }, [searchQuery, searchResults]);

  const gitStatusByPath = useMemo(() => new Map(
    gitFiles.map((status) => [normalizeFilePathSlashes(status.filePath), status]),
  ), [gitFiles]);

  const directoryChanges = useMemo(() => {
    const directories = new Map<string, Set<DirectoryChangeKind>>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      let directory = getFileDirectory(normalizeFilePathSlashes(status.filePath));
      while (directory === normalizedCwd || directory.startsWith(`${normalizedCwd}/`)) {
        const kinds = directories.get(directory) ?? new Set<DirectoryChangeKind>();
        kinds.add(directoryChangeKind(status.status));
        directories.set(directory, kinds);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [cwd, gitFiles]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const handleOpenContextMenu = useCallback((target: FileContextTarget, x: number, y: number) => {
    setContextMenu({ target, x, y });
  }, []);

  const handleOpenTarget = useCallback((target: FileContextTarget) => {
    if (!target.isDir) {
      onOpenFile(target.fullPath, target.name);
      return;
    }
    const relative = normalizeFilePathSlashes(getRelativeFilePath(target.fullPath, cwd));
    const segments = relative.split("/").filter(Boolean);
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      let current = cwd;
      for (const segment of segments) {
        current = joinFilePath(current, segment);
        next.add(current);
      }
      return next;
    });
    setSearchQuery("");
  }, [cwd, onOpenFile]);

  const applyUploadResult = useCallback((data: UploadResponse) => {
    const uploaded = data.uploaded ?? [];
    const skipped = data.skipped ?? [];
    const errors = data.errors ?? [];
    setUploadSummary({ uploaded, skipped, errors });

    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(uploaded.map((name) => joinFilePath(cwd, name))));
      setTreeRefreshKey((key) => key + 1);
    }
  }, [cwd]);

  const performUpload = useCallback(async (
    files: File[],
    strategy: UploadConflictStrategy,
  ) => {
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const { status, data } = await uploadFiles(cwd, files, strategy, setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }
      if (status < 200 || status >= 300) {
        throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      }
      setUploadProgress(100);
      applyUploadResult(data);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [applyUploadResult, cwd]);

  const prepareUpload = useCallback(async (files: File[]) => {
    if (files.length === 0 || uploadBusy) return;
    setUploadSummary(null);
    setHighlightedPaths(new Set());
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("checking");

    try {
      const res = await fetch(
        `/api/files/${encodeFilePathForApi(cwd)}?type=upload-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileNames: files.map((file) => file.name) }),
        },
      );
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${res.status})`);

      if (data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }

      await performUpload(files, "error");
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [cwd, performUpload, uploadBusy]);

  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void prepareUpload(files);
  }, [prepareUpload]);

  useImperativeHandle(ref, () => ({
    openUploadPicker() {
      if (!uploadBusy) uploadInputRef.current?.click();
    },
    focusSearch() {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
  }), [uploadBusy]);

  useEffect(() => {
    onUploadBusyChange?.(uploadBusy);
  }, [onUploadBusyChange, uploadBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) {
      let restored = parseWorkspaceContinuity(null, cwd);
      try {
        restored = parseWorkspaceContinuity(
          window.localStorage.getItem(workspaceContinuityStorageKey(cwd)),
          cwd,
        );
      } catch {
        // The tree remains usable when browser storage is unavailable.
      }
      skipExpandedPersistenceRef.current = true;
      setExpandedPaths(new Set(restored.expandedPaths));
      setHighlightedPaths(new Set());
      setUploadSummary(null);
      setPendingConflict(null);
      setUploadError(null);
      setSearchQuery("");
      setSearchResults([]);
      setFocusedTreePath(null);
      setContextMenu(null);
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    if (skipExpandedPersistenceRef.current) {
      skipExpandedPersistenceRef.current = false;
      return;
    }
    try {
      const key = workspaceContinuityStorageKey(cwd);
      window.localStorage.setItem(
        key,
        updateWorkspaceContinuity(
          window.localStorage.getItem(key),
          cwd,
          { expandedPaths },
        ),
      );
    } catch {
      // Expansion remains available for the current render when storage fails.
    }
  }, [cwd, expandedPaths]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchLoading(true);
      setSearchError(false);
      fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error(`file search failed: ${response.status}`);
          return response.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setSearchResults(data.matches ?? []))
        .catch((searchFailure) => {
          if ((searchFailure as { name?: string }).name !== "AbortError") setSearchError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cwd, searchQuery]);

  useEffect(() => {
    if (!selectedFilePath) return;
    const relative = normalizeFilePathSlashes(getRelativeFilePath(selectedFilePath, cwd));
    const directorySegments = relative.split("/").filter(Boolean).slice(0, -1);
    if (directorySegments.length === 0) return;
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      let current = cwd;
      for (const segment of directorySegments) {
        current = joinFilePath(current, segment);
        next.add(current);
      }
      return next;
    });
  }, [cwd, selectedFilePath]);

  useEffect(() => {
    let cancelled = false;
    fetchGitStatus(cwd)
      .then((status) => {
        if (!cancelled) {
          setGitFiles(status.isGitRepository ? status.files : []);
          setGitLineStats(status.isGitRepository
            ? { additions: status.additions, deletions: status.deletions }
            : { additions: 0, deletions: 0 });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitFiles([]);
          setGitLineStats({ additions: 0, deletions: 0 });
        }
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    onChangesCountChange?.(gitFiles.length);
  }, [gitFiles, onChangesCountChange]);

  const showUploadFeedback = uploadBusy || pendingConflict !== null || uploadError !== null || uploadSummary !== null;

  const addUploadedFilesToChat = useCallback(() => {
    if (!uploadSummary || uploadSummary.uploaded.length === 0) return;
    onAtMentions?.(
      uploadSummary.uploaded.map((name) => getRelativeFilePath(joinFilePath(cwd, name), cwd)),
    );
  }, [cwd, onAtMentions, uploadSummary]);

  return (
    <div className={styles.explorer} style={{ minHeight: "100%" }}>
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
      <div className={styles.filterBar}>
        <div className={styles.filterShell}>
          <AliIcon name="search" size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            className={styles.filterInput}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery) {
                event.preventDefault();
                setSearchQuery("");
              } else if (event.key === "ArrowDown") {
                const firstResult = document.querySelector<HTMLElement>("[data-file-search-result]");
                if (firstResult) {
                  event.preventDefault();
                  firstResult.focus();
                }
              }
            }}
            placeholder={t("files.searchPlaceholder")}
            aria-label={t("files.searchPlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              title={t("files.clearSearch")}
              aria-label={t("files.clearSearch")}
            >
              <AliIcon name="close" size={12} />
            </button>
          )}
        </div>
      </div>

      {showUploadFeedback && (
        <UploadFeedbackBanner
          uploadBusy={uploadBusy}
          uploadPhase={uploadPhase}
          uploadProgress={uploadProgress}
          pendingConflict={pendingConflict}
          uploadError={uploadError}
          uploadSummary={uploadSummary}
          hasAtMentions={Boolean(onAtMentions)}
          onPerformUpload={(files, strategy) => void performUpload(files, strategy)}
          onCancelConflict={() => setPendingConflict(null)}
          onDismissError={() => setUploadError(null)}
          onAddUploadedFilesToChat={addUploadedFilesToChat}
          onDismissSummary={() => setUploadSummary(null)}
          t={t}
        />
      )}

      {searchQuery.trim() && (
        <div style={{ padding: "1px 0 4px" }} role="listbox" aria-label={t("files.searchResults")}>
          {searchLoading && searchResults.length === 0 ? (
            <div className={styles.searchStatus}>{t("files.searching")}</div>
          ) : searchError ? (
            <div className={styles.searchStatus} style={{ color: "#f87171" }}>{t("files.searchFailed")}</div>
          ) : searchResults.length === 0 ? (
            <div className={styles.searchStatus}>{t("files.noSearchResults")}</div>
          ) : searchResults.map((entry, index) => (
            <SearchResultRow
              key={`${entry.isDir ? "dir" : "file"}:${entry.path}`}
              entry={entry}
              cwd={cwd}
              onOpen={handleOpenTarget}
              onOpenContextMenu={handleOpenContextMenu}
              selected={normalizeFilePathSlashes(joinFilePath(cwd, entry.path)) === normalizedSelectedFilePath}
              active={index === focusedSearchIndex}
              onFocus={() => setFocusedSearchIndex(index)}
            />
          ))}
        </div>
      )}

      {!searchQuery.trim() && !changesCollapsed && gitFiles.length > 0 && (
        <div style={{ padding: "0 4px 2px" }}>
          <div
            aria-label={t("files.changeStats", {
              count: gitFiles.length,
              additions: gitLineStats.additions,
              deletions: gitLineStats.deletions,
            })}
            style={{ display: "flex", alignItems: "center", gap: 6, minHeight: "max(24px, calc(var(--text-sm) + 10px))", padding: "0 10px", fontSize: "var(--text-sm)" }}
          >
            <span style={{ color: "var(--text-dim)" }}>
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span style={{ color: GIT_STATUS_COLORS.added, fontFamily: "var(--font-mono)" }}>+{gitLineStats.additions}</span>
            <span style={{ color: GIT_STATUS_COLORS.deleted, fontFamily: "var(--font-mono)" }}>-{gitLineStats.deletions}</span>
          </div>
          {gitFiles.map((status) => (
            <ChangeRow
              key={status.filePath}
              status={status}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onOpenContextMenu={handleOpenContextMenu}
              selected={normalizeFilePathSlashes(status.filePath) === normalizedSelectedFilePath}
              t={t}
            />
          ))}
        </div>
      )}

      {!searchQuery.trim() && (changesCollapsed || gitFiles.length === 0) && (
        <div style={{ padding: "2px 4px" }} role="tree" aria-label={t("files.explorer")}>
          {loading ? (
            <div style={{ padding: "8px 12px", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>Loading files...</div>
          ) : error ? (
            <div style={{ padding: "8px 12px", fontSize: "var(--text-xs)", color: "#f87171" }}>{error}</div>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={node.fullPath}
                node={node}
                depth={0}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                expandedPaths={expandedPaths}
                onToggleExpanded={handleToggleExpanded}
                refreshToken={refreshToken}
                highlightedPaths={highlightedPaths}
                gitStatusByPath={gitStatusByPath}
                directoryChanges={directoryChanges}
                onOpenContextMenu={handleOpenContextMenu}
                selectedFilePath={normalizedSelectedFilePath}
                focusedPath={treeFocusablePath}
                onFocusedPathChange={setFocusedTreePath}
                t={t}
              />
            ))
          )}
          {!loading && !error && roots.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
              {t("files.noFiles")}
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <FileContextMenu
          menu={contextMenu}
          cwd={cwd}
          onClose={() => setContextMenu(null)}
          onOpenInApp={handleOpenTarget}
          onAtMention={onAtMention}
          t={t}
        />
      )}
    </div>
  );
});
