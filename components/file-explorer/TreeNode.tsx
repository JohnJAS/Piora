"use client";

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFilePathForApi, getRelativeFilePath, normalizeFilePathSlashes } from "@/lib/file-paths";
import { getFileViewerKind, isMarkdownPath } from "@/lib/file-types";
import type { GitFileStatus } from "@/lib/git-types";
import { getNextTreeRenderCount, getTreeRenderWindow, TREE_INITIAL_RENDER_COUNT } from "@/lib/tree-progressive";
import { AliIcon } from "../AliIcon";
import { FolderIcon, getFileIcon } from "../FileIcons";
import styles from "../FileExplorer.module.css";
import {
  AddToChatIcon,
  DIRECTORY_CHANGE_CODE,
  DIRECTORY_CHANGE_ORDER,
  fetchEntries,
  GIT_STATUS_COLORS,
  GIT_STATUS_KEYS,
  GitStatusBadge,
  type DirectoryChangeKind,
  type FileContextTarget,
  type FileNode,
  type OpenFileOptions,
  type Translate,
} from "./shared";

export const TreeNode = memo(function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  gitStatusByPath,
  directoryChanges,
  onOpenContextMenu,
  selectedFilePath,
  focusedPath,
  onFocusedPathChange,
  positionInSet,
  setSize,
  t,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  directoryChanges: Map<string, Set<DirectoryChangeKind>>;
  onOpenContextMenu: (target: FileContextTarget, x: number, y: number) => void;
  selectedFilePath?: string | null;
  focusedPath: string | null;
  onFocusedPathChange: (fullPath: string) => void;
  positionInSet?: number;
  setSize?: number;
  t: Translate;
}) {
  const open = expandedPaths.has(node.fullPath);
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const selected = !node.isDir && normalizedPath === selectedFilePath;
  const folderChanges = node.isDir ? directoryChanges.get(normalizedPath) : undefined;
  const folderChangeKinds = DIRECTORY_CHANGE_ORDER.filter((kind) => folderChanges?.has(kind));
  const folderColor = folderChangeKinds.length === 1
    ? GIT_STATUS_COLORS[folderChangeKinds[0]]
    : folderChangeKinds.length
      ? GIT_STATUS_COLORS.modified
      : undefined;
  const openHint = !node.isDir && getFileViewerKind(node.fullPath) === "text" && !isMarkdownPath(node.fullPath)
    ? t("files.openInEditor")
    : t("files.openPreview");
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visibleChildCount, setVisibleChildCount] = useState(TREE_INITIAL_RENDER_COUNT);
  const progressiveSentinelRef = useRef<HTMLButtonElement>(null);
  const childWindow = useMemo(
    () => getTreeRenderWindow(children.length, visibleChildCount),
    [children.length, visibleChildCount],
  );
  const visibleChildren = useMemo(
    () => children.slice(0, childWindow.endIndex),
    [childWindow.endIndex, children],
  );

  const revealMoreChildren = useCallback(() => {
    startTransition(() => {
      setVisibleChildCount((current) => getNextTreeRenderCount(current, children.length));
    });
  }, [children.length]);

  useEffect(() => {
    const sentinel = progressiveSentinelRef.current;
    if (!open || childWindow.remaining === 0 || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) revealMoreChildren();
    }, { rootMargin: "160px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [childWindow.remaining, open, revealMoreChildren]);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const entries = await fetchEntries(node.fullPath);
      setChildren(entries);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  // Re-fetch children when the tree refreshes and the directory is open.
  useEffect(() => {
    if (open && loaded) {
      loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    if (open && !loaded && !loading) void loadChildren();
  }, [loadChildren, loaded, loading, open]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile, onToggleExpanded]);

  return (
    <div>
      <div
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          handleClick();
        }}
        role="treeitem"
        tabIndex={focusedPath === node.fullPath ? 0 : -1}
        data-file-tree-item
        data-tree-label={node.name}
        aria-selected={selected}
        aria-current={selected ? "page" : undefined}
        aria-expanded={node.isDir ? open : undefined}
        aria-level={depth + 1}
        aria-posinset={positionInSet}
        aria-setsize={setSize}
        className={styles.treeItemRow}
        onFocus={() => onFocusedPathChange(node.fullPath)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
            return;
          }

          const tree = event.currentTarget.closest<HTMLElement>("[role='tree']");
          const items = Array.from(tree?.querySelectorAll<HTMLElement>("[data-file-tree-item]") ?? []);
          const currentIndex = items.indexOf(event.currentTarget);
          const focusAt = (index: number) => {
            const target = items[index];
            if (!target) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          };

          if (event.key === "ArrowDown") focusAt(Math.min(items.length - 1, currentIndex + 1));
          else if (event.key === "ArrowUp") focusAt(Math.max(0, currentIndex - 1));
          else if (event.key === "Home") focusAt(0);
          else if (event.key === "End") focusAt(items.length - 1);
          else if (event.key === "ArrowRight" && node.isDir) {
            event.preventDefault();
            if (!open) {
              onToggleExpanded(node.fullPath, true);
              if (!loaded) void loadChildren();
            } else {
              const child = items[currentIndex + 1];
              if (child?.getAttribute("aria-level") === String(depth + 2)) {
                child.focus({ preventScroll: true });
              }
            }
          } else if (event.key === "ArrowLeft") {
            if (node.isDir && open) {
              event.preventDefault();
              onToggleExpanded(node.fullPath, false);
            } else {
              const parentLevel = String(depth);
              const parent = items.slice(0, currentIndex).reverse()
                .find((item) => item.getAttribute("aria-level") === parentLevel);
              if (parent) {
                event.preventDefault();
                parent.focus({ preventScroll: true });
              }
            }
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const needle = event.key.toLocaleLowerCase();
            const ordered = [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex + 1)];
            const match = ordered.find((item) => item.dataset.treeLabel?.toLocaleLowerCase().startsWith(needle));
            if (match) {
              event.preventDefault();
              match.focus({ preventScroll: true });
            }
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenContextMenu(node, event.clientX, event.clientY);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          minHeight: "max(24px, calc(var(--text-sm) + 10px))",
          cursor: "pointer",
          background: selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
          borderRadius: 4,
          userSelect: "none",
        }}
      >
        {node.isDir && (
          <AliIcon
            name="chevron-right"
            size={14}
            strokeWidth={1.8}
            style={{ color: "var(--text-dim)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
          />
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} name={node.name} /> : getFileIcon(node.name, 14)}
        </span>
        <span
          style={{
            fontSize: "var(--text-sm)",
            color: node.isDir ? folderColor ?? "var(--text)" : gitStatus ? GIT_STATUS_COLORS[gitStatus.status] : "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={node.isDir ? node.fullPath : `${node.fullPath} · ${openHint}`}
        >
          {node.name}
        </span>
        {highlighted && (
          <span
            title={t("files.newlyUploaded")}
            aria-label={t("files.newlyUploaded")}
            style={{ width: 14, height: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6" }} />
          </span>
        )}
        {!hovered && !node.isDir && gitStatus && (
          <GitStatusBadge status={gitStatus} t={t} />
        )}
        {node.isDir && folderChangeKinds.length > 0 && (
          <span className={styles.directoryChanges} title={folderChangeKinds.map((kind) => t(GIT_STATUS_KEYS[kind])).join(" · ")}>
            {folderChangeKinds.map((kind) => (
              <span
                key={kind}
                className={styles.directoryChangeBadge}
                style={{ color: GIT_STATUS_COLORS[kind] }}
                aria-label={t(GIT_STATUS_KEYS[kind])}
              >
                {DIRECTORY_CHANGE_CODE[kind]}
              </span>
            ))}
          </span>
        )}
        {loading && (
          <AliIcon name="reload" size={10} style={{ color: "var(--text-dim)", animation: "spin 0.8s linear infinite" }} />
        )}
        {hovered && (onAtMention || !node.isDir) && (
          <div
            style={{
              position: "absolute",
              right: 3,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 1,
              padding: 1,
              borderRadius: "var(--radius-control)",
              background: "var(--bg-hover)",
              boxShadow: "-8px 0 8px var(--bg-hover)",
            }}
          >
            {onAtMention && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
                }}
                aria-label={t("files.insertPath")}
                title={t("files.insertPath")}
                style={{
                  width: 24,
                  height: 24,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "none",
                  borderRadius: 4,
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <AddToChatIcon />
              </button>
            )}
            {!node.isDir && (
              <a
                href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
                download
                onClick={(e) => e.stopPropagation()}
                aria-label={t("files.download")}
                title={t("files.download")}
                style={{
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 4,
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textDecoration: "none",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <AliIcon name="download" size={13} strokeWidth={1.75} />
              </a>
            )}
          </div>
        )}
      </div>
      {node.isDir && open && (
        <div role="group">
          {visibleChildren.map((child, index) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              highlightedPaths={highlightedPaths}
              gitStatusByPath={gitStatusByPath}
              directoryChanges={directoryChanges}
              onOpenContextMenu={onOpenContextMenu}
              selectedFilePath={selectedFilePath}
              focusedPath={focusedPath}
              onFocusedPathChange={onFocusedPathChange}
              positionInSet={index + 1}
              setSize={children.length}
              t={t}
            />
          ))}
          {children.length === 0 && loaded && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: "var(--text-xs)", color: "var(--text-dim)", minHeight: "max(22px, calc(var(--text-xs) + 10px))", display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
        </div>
      )}
      {node.isDir && open && childWindow.remaining > 0 ? (
        <button
          ref={progressiveSentinelRef}
          type="button"
          className={styles.treeLoadMore}
          style={{ marginLeft: 8 + (depth + 1) * 14 }}
          onClick={revealMoreChildren}
        >
          {t("files.loadMore", { shown: childWindow.endIndex, total: children.length })}
        </button>
      ) : null}
    </div>
  );
});
