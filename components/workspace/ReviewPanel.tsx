"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { GitFileDiffResponse, GitStatusResponse } from "@/lib/git-types";
import { parseUnifiedDiff, type Hunk } from "@/lib/diff-parse";
import { buildPatchForHunk } from "@/lib/hunk-patch";
import { getReviewNavigationIndex, isCommitKeyboardShortcut } from "@/lib/review-keyboard";
import { DiffView } from "../DiffView";
import { AliIcon } from "../AliIcon";
import { getFileIcon } from "../FileIcons";
import type { ChangeGroup, ChangeListItem } from "./ChangeList";
import styles from "./WorkspacePanel.module.css";

interface Props {
  cwd: string | null;
  refreshKey: number;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
}

type ReviewScope = "all" | ChangeGroup;
type DiffMode = "unified" | "split";

const INITIAL_FILE_LIMIT = 12;
const EMPTY_STATUS: GitStatusResponse = { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 };

function createItems(status: GitStatusResponse): ChangeListItem[] {
  const staged: ChangeListItem[] = [];
  const unstaged: ChangeListItem[] = [];
  const untracked: ChangeListItem[] = [];
  for (const file of status.files) {
    if (file.indexStatus !== " " && file.indexStatus !== "?") staged.push({ key: `staged:${file.filePath}`, group: "staged", file });
    if (file.worktreeStatus === "?") untracked.push({ key: `untracked:${file.filePath}`, group: "untracked", file });
    else if (file.worktreeStatus !== " ") unstaged.push({ key: `unstaged:${file.filePath}`, group: "unstaged", file });
  }
  return [...staged, ...unstaged, ...untracked];
}

export function ReviewPanel({ cwd, refreshKey, onRefresh, onOpenFile }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusResponse>(EMPTY_STATUS);
  const [diffs, setDiffs] = useState<Record<string, GitFileDiffResponse>>({});
  const [loadingDiffs, setLoadingDiffs] = useState<Set<string>>(() => new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(() => new Set());
  const [reviewedStorageRoot, setReviewedStorageRoot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ReviewScope>("all");
  const [mode, setMode] = useState<DiffMode>("unified");
  const [visibleCount, setVisibleCount] = useState(INITIAL_FILE_LIMIT);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showCommit, setShowCommit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const commitMessageRef = useRef<HTMLTextAreaElement>(null);
  const fileRefs = useRef(new Map<string, HTMLElement>());
  const diffsRef = useRef(diffs);
  const loadingDiffsRef = useRef(loadingDiffs);
  const diffGenerationRef = useRef(0);
  diffsRef.current = diffs;
  loadingDiffsRef.current = loadingDiffs;

  const items = useMemo(() => createItems(status), [status]);
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => (scope === "all" || item.group === scope)
      && (!needle || item.file.filePath.toLocaleLowerCase().includes(needle)));
  }, [items, query, scope]);
  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);
  const stagedItems = useMemo(() => items.filter((item) => item.group === "staged"), [items]);
  const worktreeItems = useMemo(() => items.filter((item) => item.group !== "staged"), [items]);
  const reviewedCount = items.filter((item) => reviewedKeys.has(item.key)).length;

  useEffect(() => {
    const prefill = (event: Event) => {
      const detail = (event as CustomEvent<{ cwd?: string | null; message?: string }>).detail;
      if (detail?.cwd !== cwd || !detail.message?.trim()) return;
      setCommitMessage(detail.message.trim());
      setShowCommit(true);
      requestAnimationFrame(() => commitMessageRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("piora:prefill-commit-message", prefill);
    const focusCommit = () => {
      setShowCommit(true);
      requestAnimationFrame(() => commitMessageRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("piora:focus-review-commit", focusCommit);
    return () => {
      window.removeEventListener("piora:prefill-commit-message", prefill);
      window.removeEventListener("piora:focus-review-commit", focusCommit);
    };
  }, [cwd]);

  useEffect(() => {
    setExpandedKeys(new Set());
  }, [cwd]);

  const loadStatus = useCallback(async () => {
    if (!cwd) { setStatus(EMPTY_STATUS); return; }
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as GitStatusResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      diffGenerationRef.current += 1;
      setStatus(data);
      const availableKeys = new Set(createItems(data).map((item) => item.key));
      setExpandedKeys((current) => new Set([...current].filter((key) => availableKeys.has(key))));
      setDiffs({});
      setLoadingDiffs(new Set());
      setVisibleCount(INITIAL_FILE_LIMIT);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [cwd]);

  useEffect(() => { void loadStatus(); }, [loadStatus, refreshKey]);

  useEffect(() => {
    if (!status.repositoryRoot) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`piora:reviewed:${status.repositoryRoot}`) ?? "[]") as unknown;
      setReviewedKeys(new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []));
    } catch { setReviewedKeys(new Set()); }
    setReviewedStorageRoot(status.repositoryRoot);
  }, [status.repositoryRoot]);

  useEffect(() => {
    if (!status.repositoryRoot || reviewedStorageRoot !== status.repositoryRoot) return;
    localStorage.setItem(`piora:reviewed:${status.repositoryRoot}`, JSON.stringify([...reviewedKeys]));
  }, [reviewedKeys, reviewedStorageRoot, status.repositoryRoot]);

  useEffect(() => {
    if (!cwd) return;
    const missing = visibleItems.filter((item) => expandedKeys.has(item.key)
      && !diffsRef.current[item.key]
      && !loadingDiffsRef.current.has(item.key));
    if (missing.length === 0) return;
    const generation = diffGenerationRef.current;
    setLoadingDiffs((current) => new Set([...current, ...missing.map((item) => item.key)]));
    void Promise.all(missing.map(async (item) => {
      try {
        const response = await fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(item.file.filePath)}&scope=${item.group === "staged" ? "staged" : "worktree"}`, { cache: "no-store" });
        const data = await response.json() as GitFileDiffResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (generation === diffGenerationRef.current) setDiffs((current) => ({ ...current, [item.key]: data }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoadingDiffs((current) => { const next = new Set(current); next.delete(item.key); return next; });
      }
    }));
  }, [cwd, expandedKeys, visibleItems]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const index = Math.max(0, filteredItems.findIndex((item) => item.key === activeKey));
      const nextIndex = getReviewNavigationIndex(index, event.key, filteredItems.length);
      if (nextIndex === null) return;
      event.preventDefault();
      const nextItem = filteredItems[nextIndex];
      if (nextIndex >= visibleCount) setVisibleCount(Math.min(filteredItems.length, nextIndex + INITIAL_FILE_LIMIT));
      setActiveKey(nextItem.key);
      setExpandedKeys((current) => new Set(current).add(nextItem.key));
      requestAnimationFrame(() => fileRefs.current.get(nextItem.key)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [activeKey, filteredItems, visibleCount]);

  useEffect(() => {
    setVisibleCount(INITIAL_FILE_LIMIT);
    setActiveKey(null);
  }, [query, scope]);

  const mutate = useCallback(async (action: "stage" | "unstage" | "revert", targetItems: ChangeListItem[], options?: { hunk?: Hunk }) => {
    if (!cwd || targetItems.length === 0 || busy) return;
    const root = (status.repositoryRoot ?? cwd).replace(/\\/g, "/").replace(/\/$/, "");
    const relativePaths = [...new Set(targetItems.map((item) => {
      const normalized = item.file.filePath.replace(/\\/g, "/");
      return normalized.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`) ? normalized.slice(root.length + 1) : normalized;
    }))];
    const body: Record<string, unknown> = { cwd, paths: relativePaths };
    const itemDiff = targetItems.length === 1 ? diffs[targetItems[0].key] : undefined;
    if (action === "revert") {
      const changedLines = options?.hunk?.lines.filter((line) => line.kind === "added" || line.kind === "removed").length
        ?? (itemDiff?.patch ? parseUnifiedDiff(itemDiff.patch).lineCount : targetItems.reduce((sum, item) => sum + (item.file.additions ?? 0) + (item.file.deletions ?? 0), 0));
      if (!window.confirm(t("review.confirmRevert", { count: changedLines }))) return;
    }
    if (action === "revert" || options?.hunk) {
      const hashResponse = await fetch("/api/git/diff-hash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, paths: relativePaths }) });
      const hashData = await hashResponse.json() as { diffHash?: string; error?: string };
      if (!hashResponse.ok || !hashData.diffHash) { setError(hashData.error || "Unable to verify diff"); return; }
      body.diffHash = hashData.diffHash;
      if (options?.hunk && itemDiff?.patch) body.patch = buildPatchForHunk(itemDiff.patch, options.hunk);
    }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/git/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { error?: string; stale?: boolean };
      if (!response.ok) throw new Error(data.stale ? t("review.stale") : data.error || `HTTP ${response.status}`);
      setToast(t(`review.${action}Done`));
      onRefresh();
      window.dispatchEvent(new CustomEvent("piora:git-status-changed", { detail: { cwd } }));
      await loadStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [busy, cwd, diffs, loadStatus, onRefresh, status.repositoryRoot, t]);

  const commit = useCallback(async () => {
    if (!cwd || !commitMessage.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/git/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, message: commitMessage, amend }) });
      const data = await response.json() as { sha?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setToast(t("review.commitDone", { sha: data.sha?.slice(0, 8) ?? "" }));
      setCommitMessage(""); setShowCommit(false);
      onRefresh(); window.dispatchEvent(new CustomEvent("piora:git-status-changed", { detail: { cwd } })); await loadStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [amend, busy, commitMessage, cwd, loadStatus, onRefresh, t]);

  const toggleReviewed = (key: string) => setReviewedKeys((current) => toggleSet(current, key));
  const scrollToItem = (item: ChangeListItem) => {
    const itemIndex = filteredItems.findIndex((candidate) => candidate.key === item.key);
    if (itemIndex >= visibleCount) setVisibleCount(Math.min(filteredItems.length, itemIndex + INITIAL_FILE_LIMIT));
    setActiveKey(item.key);
    setExpandedKeys((current) => new Set(current).add(item.key));
    requestAnimationFrame(() => fileRefs.current.get(item.key)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  if (!cwd) return <ReviewEmpty message={t("review.selectProject")} />;
  if (loading && status.files.length === 0) return <ReviewEmpty message={t("review.loading")} loading />;
  if (!status.isGitRepository) return <ReviewEmpty message={error || t("review.notGit")} />;
  if (items.length === 0) return <div className={styles.reviewRoot}><ReviewTopBar status={status} mode={mode} setMode={setMode} busy={busy} onRefresh={loadStatus} t={t} /><ReviewEmpty message={t("review.clean")} /></div>;

  const scopeCounts: Record<ReviewScope, number> = {
    all: items.length,
    staged: stagedItems.length,
    unstaged: items.filter((item) => item.group === "unstaged").length,
    untracked: items.filter((item) => item.group === "untracked").length,
  };

  return <div className={styles.reviewRoot} aria-busy={busy}>
    <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
      {activeKey ? t("review.selectedChange", { path: items.find((item) => item.key === activeKey)?.file.filePath ?? "" }) : t("review.noSelectedChange")}
    </div>
    <ReviewTopBar status={status} mode={mode} setMode={setMode} busy={busy} onRefresh={loadStatus} t={t}
      onCollapseAll={() => setExpandedKeys(visibleItems.every((item) => expandedKeys.has(item.key)) ? new Set() : new Set(visibleItems.map((item) => item.key)))} />

    <div className={styles.reviewFilters}>
      <label className={styles.reviewSearch}>
        <AliIcon name="search" size={13} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("review.searchPlaceholder")} aria-label={t("review.searchPlaceholder")} />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label={t("review.clearSearch")}><AliIcon name="close" size={12} /></button> : null}
      </label>
      <div className={styles.scopeTabs} role="group" aria-label={t("review.filterLabel")}>
        {(["all", "unstaged", "staged", "untracked"] as const).map((value) => <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}>{t(`review.filter.${value}`)}<span>{scopeCounts[value]}</span></button>)}
      </div>
    </div>

    <main className={styles.reviewStream} role="region" aria-label={t("review.diffRegion")}>
      <section className={styles.reviewOverview} aria-label={t("review.changesTree")}>
        <div className={styles.reviewProgressRow}>
          <span>{t("review.progress", { reviewed: reviewedCount, total: items.length })}</span>
          <span className={styles.reviewStats}><span className={styles.additions}>+{status.additions}</span><span className={styles.deletions}>-{status.deletions}</span></span>
        </div>
        <div className={styles.reviewProgressTrack} aria-hidden="true"><span style={{ width: `${items.length ? reviewedCount / items.length * 100 : 0}%` }} /></div>
        <div className={styles.reviewFileIndex}>
          {filteredItems.map((item) => <FileIndexRow key={item.key} item={item} reviewed={reviewedKeys.has(item.key)} active={activeKey === item.key} onSelect={() => scrollToItem(item)} onReview={() => toggleReviewed(item.key)} t={t} />)}
          {filteredItems.length === 0 ? <div className={styles.reviewNoResults}>{t("review.noMatches")}</div> : null}
        </div>
      </section>

      <div className={styles.reviewDivider}><span>{t("review.filesChanged", { count: filteredItems.length })}</span></div>

      <div className={styles.reviewFiles}>
        {visibleItems.map((item) => {
          const itemDiff = diffs[item.key];
          const collapsed = !expandedKeys.has(item.key);
          return <section key={item.key} ref={(node) => { if (node) fileRefs.current.set(item.key, node); else fileRefs.current.delete(item.key); }} className={`${styles.reviewFile} ${reviewedKeys.has(item.key) ? styles.reviewedFile : ""}`} data-review-key={item.key}>
            <FileReviewHeader
              item={item}
              collapsed={collapsed}
              reviewed={reviewedKeys.has(item.key)}
              busy={busy}
              onToggle={() => setExpandedKeys((current) => toggleSet(current, item.key))}
              onReview={() => toggleReviewed(item.key)}
              onOpen={() => onOpenFile(item.file.filePath)}
              onStage={() => void mutate(item.group === "staged" ? "unstage" : "stage", [item])}
              onRevert={() => void mutate("revert", [item])}
              t={t}
            />
            {!collapsed ? <div className={styles.reviewFileBody}>
              {itemDiff?.supported && itemDiff.patch ? <DiffView patch={itemDiff.patch} filePath={item.file.filePath} mode={mode} showFileHeader={false} onOpenFile={(path) => onOpenFile(path)} hunkActions={(hunk) => <span className={styles.hunkActions} onClick={(event) => event.stopPropagation()}><button type="button" disabled={busy} onClick={() => void mutate(item.group === "staged" ? "unstage" : "stage", [item], { hunk })}>{item.group === "staged" ? t("review.unstageHunk") : t("review.stageHunk")}</button>{item.group !== "staged" ? <button type="button" className={styles.danger} disabled={busy} onClick={() => void mutate("revert", [item], { hunk })}>{t("review.revertHunk")}</button> : null}</span>} />
                : loadingDiffs.has(item.key) ? <ReviewFileLoading t={t} /> : <ReviewEmpty message={t("review.diffUnavailable")} compact />}
            </div> : null}
          </section>;
        })}
        {visibleCount < filteredItems.length ? <button className={styles.loadMoreFiles} type="button" onClick={() => setVisibleCount((count) => Math.min(filteredItems.length, count + INITIAL_FILE_LIMIT))}>{t("review.loadMoreFiles", { shown: visibleItems.length, total: filteredItems.length })}</button> : null}
      </div>
    </main>

    <footer className={styles.reviewFooter}>
      {showCommit && stagedItems.length > 0 ? <div className={styles.commitPanel}>
        <div className={styles.commitPanelHeader}><span>{t("review.commitPreview", { count: stagedItems.length })}</span><button type="button" onClick={() => setShowCommit(false)} aria-label={t("review.closeCommit")}><AliIcon name="close" size={13} /></button></div>
        <textarea ref={commitMessageRef} value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onKeyDown={(event) => { if (!isCommitKeyboardShortcut(event.nativeEvent)) return; event.preventDefault(); void commit(); }} placeholder={t("review.commitMessage")} aria-label={t("review.commitMessage")} aria-describedby="review-commit-shortcut" rows={3} />
        <span id="review-commit-shortcut" className={styles.srOnly}>{t("review.commitShortcut")}</span>
        <div className={styles.commitFooter}>
          <label className={styles.amendToggle}><input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />{t("review.amend")}</label>
          <button className={styles.primaryAction} type="button" disabled={busy || !commitMessage.trim()} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => void commit()}><AliIcon name="check" size={13} />{t("review.commit")}</button>
        </div>
      </div> : <div className={styles.reviewFooterBar}>
        <span>{stagedItems.length ? t("review.readyToCommit", { count: stagedItems.length }) : t("review.nothingStaged")}</span>
        <div>
          {worktreeItems.length ? <button type="button" disabled={busy} onClick={() => void mutate("stage", worktreeItems)}>{t("review.stageAll")}</button> : null}
          <button className={styles.primaryAction} type="button" disabled={busy || stagedItems.length === 0} onClick={() => { setShowCommit(true); requestAnimationFrame(() => commitMessageRef.current?.focus({ preventScroll: true })); }}><AliIcon name="check" size={13} />{t("review.commitAction", { count: stagedItems.length })}</button>
        </div>
      </div>}
      {error ? <div role="alert" className={styles.error}>{error}</div> : null}
      {toast ? <div role="status" className={styles.toast}>{toast}</div> : null}
    </footer>
  </div>;
}

function ReviewTopBar({ status, mode, setMode, busy, onRefresh, onCollapseAll, t }: {
  status: GitStatusResponse;
  mode: DiffMode;
  setMode: (mode: DiffMode) => void;
  busy: boolean;
  onRefresh: () => void | Promise<void>;
  onCollapseAll?: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return <header className={styles.reviewToolbar}>
    <div className={styles.reviewHeading}>
      <span className={styles.branchBadge}><AliIcon name="branches" size={13} /></span>
      <span><b>{status.branch || t("review.workingTree")}</b><small>{t("review.changes", { count: status.files.length })}</small></span>
    </div>
    <div className={styles.reviewToolbarActions}>
      <button type="button" className={styles.iconAction} aria-pressed={mode === "split"} onClick={() => setMode(mode === "unified" ? "split" : "unified")} title={mode === "unified" ? t("review.splitView") : t("review.unifiedView")} aria-label={mode === "unified" ? t("review.splitView") : t("review.unifiedView")}><AliIcon name="layout" size={14} /></button>
      {onCollapseAll ? <button type="button" className={styles.iconAction} onClick={onCollapseAll} title={t("review.collapseAll")} aria-label={t("review.collapseAll")}><AliIcon name="collapse" size={14} /></button> : null}
      <button type="button" className={styles.iconAction} onClick={() => void onRefresh()} disabled={busy} title={t("review.refresh")} aria-label={t("review.refresh")}><AliIcon name="reload" size={14} /></button>
    </div>
  </header>;
}

function FileIndexRow({ item, reviewed, active, onSelect, onReview, t }: { item: ChangeListItem; reviewed: boolean; active: boolean; onSelect: () => void; onReview: () => void; t: ReturnType<typeof useI18n>["t"] }) {
  const { name, parent } = splitPath(item.file.filePath);
  return <div className={`${styles.fileIndexRow} ${active ? styles.fileIndexActive : ""}`}>
    <button type="button" className={styles.fileIndexMain} onClick={onSelect}>
      <span className={styles.fileIndexIcon} data-status={item.file.status}>{getFileIcon(name, 14)}</span>
      <span className={styles.fileIndexPath} title={item.file.filePath}>{parent ? <small>{parent}/</small> : null}<b>{name}</b></span>
      <span className={styles.lineStats}><span className={styles.additions}>+{item.file.additions ?? 0}</span><span className={styles.deletions}>-{item.file.deletions ?? 0}</span></span>
    </button>
    <button type="button" className={`${styles.reviewCheck} ${reviewed ? styles.reviewCheckDone : ""}`} onClick={onReview} title={reviewed ? t("review.markUnreviewed") : t("review.markReviewed")} aria-label={reviewed ? t("review.markUnreviewed") : t("review.markReviewed")} aria-pressed={reviewed}><AliIcon name="check" size={11} /></button>
  </div>;
}

function FileReviewHeader({ item, collapsed, reviewed, busy, onToggle, onReview, onOpen, onStage, onRevert, t }: { item: ChangeListItem; collapsed: boolean; reviewed: boolean; busy: boolean; onToggle: () => void; onReview: () => void; onOpen: () => void; onStage: () => void; onRevert: () => void; t: ReturnType<typeof useI18n>["t"] }) {
  const { name, parent } = splitPath(item.file.filePath);
  return <header className={styles.reviewFileHeader}>
    <button type="button" className={styles.fileCollapse} onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? t("review.expandFile") : t("review.collapseFile")}><AliIcon name="chevron-right" size={13} /></button>
    <span className={styles.reviewFileIcon}>{getFileIcon(name, 14)}</span>
    <button type="button" className={styles.reviewFilePath} onClick={onToggle} title={item.file.filePath}>{parent ? <small>{parent}/</small> : null}<b>{name}</b></button>
    <span className={styles.fileGroupBadge} data-group={item.group}>{t(`review.group.${item.group}`)}</span>
    <span className={styles.lineStats}><span className={styles.additions}>+{item.file.additions ?? 0}</span><span className={styles.deletions}>-{item.file.deletions ?? 0}</span></span>
    <div className={styles.fileActions}>
      <button type="button" className={`${styles.reviewCheck} ${reviewed ? styles.reviewCheckDone : ""}`} onClick={onReview} title={reviewed ? t("review.markUnreviewed") : t("review.markReviewed")} aria-label={reviewed ? t("review.markUnreviewed") : t("review.markReviewed")} aria-pressed={reviewed}><AliIcon name="check" size={11} /></button>
      <button type="button" disabled={busy} onClick={onStage} title={item.group === "staged" ? t("review.unstage") : t("review.stage")} aria-label={item.group === "staged" ? t("review.unstage") : t("review.stage")}><AliIcon name={item.group === "staged" ? "minus" : "plus"} size={13} /></button>
      {item.group !== "staged" ? <button type="button" className={styles.danger} disabled={busy} onClick={onRevert} title={t("review.revert")} aria-label={t("review.revert")}><AliIcon name="history" size={13} /></button> : null}
      <button type="button" onClick={onOpen} title={t("diff.openFile")} aria-label={t("diff.openFile")}><AliIcon name="file" size={13} /></button>
    </div>
  </header>;
}

function ReviewFileLoading({ t }: { t: ReturnType<typeof useI18n>["t"] }) {
  return <div className={styles.reviewFileLoading}><AliIcon name="reload" size={14} /><span>{t("review.loadingDiff")}</span></div>;
}

function ReviewEmpty({ message, loading = false, compact = false }: { message: string; loading?: boolean; compact?: boolean }) {
  return <div className={`${styles.reviewEmpty} ${compact ? styles.reviewEmptyCompact : ""}`}>
    <span className={`${styles.emptyIcon} ${loading ? styles.emptyIconLoading : ""}`} aria-hidden="true"><AliIcon name={loading ? "reload" : "diff"} size={17} /></span>
    <span>{message}</span>
  </div>;
}

function splitPath(path: string): { name: string; parent: string } {
  const parts = path.replace(/\\/g, "/").split("/");
  const name = parts.pop() ?? path;
  const parentParts = parts.filter(Boolean);
  return { name, parent: parentParts.length > 2 ? `…/${parentParts.slice(-2).join("/")}` : parentParts.join("/") };
}

function toggleSet(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
