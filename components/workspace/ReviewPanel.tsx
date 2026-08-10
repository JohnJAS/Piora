"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { GitFileDiffResponse, GitStatusResponse } from "@/lib/git-types";
import { parseUnifiedDiff, type Hunk } from "@/lib/diff-parse";
import { buildPatchForHunk } from "@/lib/hunk-patch";
import { isCommitKeyboardShortcut } from "@/lib/review-keyboard";
import { DiffView } from "../DiffView";
import { AliIcon } from "../AliIcon";
import { ChangeList, type ChangeListItem } from "./ChangeList";
import styles from "./WorkspacePanel.module.css";

interface Props {
  cwd: string | null;
  refreshKey: number;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
}

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(() => new Set());
  const [diff, setDiff] = useState<GitFileDiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const commitMessageRef = useRef<HTMLTextAreaElement>(null);
  const items = useMemo(() => createItems(status), [status]);
  const selectedItem = items.find((item) => item.key === selectedKey) ?? null;

  useEffect(() => {
    const prefill = (event: Event) => {
      const detail = (event as CustomEvent<{ cwd?: string | null; message?: string }>).detail;
      if (detail?.cwd !== cwd || !detail.message?.trim()) return;
      setCommitMessage(detail.message.trim());
      requestAnimationFrame(() => commitMessageRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("piora:prefill-commit-message", prefill);
    const focusCommit = () => requestAnimationFrame(() => commitMessageRef.current?.focus({ preventScroll: true }));
    window.addEventListener("piora:focus-review-commit", focusCommit);
    return () => {
      window.removeEventListener("piora:prefill-commit-message", prefill);
      window.removeEventListener("piora:focus-review-commit", focusCommit);
    };
  }, [cwd]);

  const loadStatus = useCallback(async () => {
    if (!cwd) { setStatus(EMPTY_STATUS); return; }
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as GitStatusResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setStatus(data);
      const nextItems = createItems(data);
      setSelectedKey((current) => nextItems.some((item) => item.key === current) ? current : null);
      setCheckedPaths((current) => new Set([...current].filter((path) => data.files.some((file) => file.filePath === path))));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [cwd]);

  useEffect(() => { void loadStatus(); }, [loadStatus, refreshKey]);

  useEffect(() => {
    if (!cwd || !selectedItem) { setDiff(null); return; }
    const controller = new AbortController();
    fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(selectedItem.file.filePath)}&scope=${selectedItem.group === "staged" ? "staged" : "worktree"}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as GitFileDiffResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        setDiff(data);
      })
      .catch((cause) => { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [cwd, selectedItem]);

  const mutate = useCallback(async (action: "stage" | "unstage" | "revert", paths: string[], options?: { hunk?: Hunk }) => {
    if (!cwd || paths.length === 0 || busy) return;
    const root = (status.repositoryRoot ?? cwd).replace(/\\/g, "/").replace(/\/$/, "");
    const relativePaths = paths.map((filePath) => {
      const normalized = filePath.replace(/\\/g, "/");
      return normalized.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`) ? normalized.slice(root.length + 1) : normalized;
    });
    const body: Record<string, unknown> = { cwd, paths: relativePaths };
    if (action === "revert") {
      const patch = diff?.patch ?? "";
      const changedLines = options?.hunk?.lines.filter((line) => line.kind === "added" || line.kind === "removed").length
        ?? parseUnifiedDiff(patch).lineCount;
      if (!window.confirm(t("review.confirmRevert", { count: changedLines }))) return;
    }
    if (action === "revert" || options?.hunk) {
      const hashResponse = await fetch("/api/git/diff-hash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, paths: relativePaths }) });
      const hashData = await hashResponse.json() as { diffHash?: string; error?: string };
      if (!hashResponse.ok || !hashData.diffHash) { setError(hashData.error || "Unable to verify diff"); return; }
      body.diffHash = hashData.diffHash;
      if (options?.hunk && diff?.patch) body.patch = buildPatchForHunk(diff.patch, options.hunk);
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
  }, [busy, cwd, diff?.patch, loadStatus, onRefresh, status.repositoryRoot, t]);

  const commit = useCallback(async () => {
    if (!cwd || !commitMessage.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/git/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, message: commitMessage, amend }) });
      const data = await response.json() as { sha?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setToast(t("review.commitDone", { sha: data.sha?.slice(0, 8) ?? "" })); setCommitMessage("");
      onRefresh(); window.dispatchEvent(new CustomEvent("piora:git-status-changed", { detail: { cwd } })); await loadStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [amend, busy, commitMessage, cwd, loadStatus, onRefresh, t]);

  if (!cwd) return <ReviewEmpty message={t("review.selectProject")} />;
  if (loading && status.files.length === 0) return <ReviewEmpty message={t("review.loading")} loading />;
  if (!status.isGitRepository) return <ReviewEmpty message={error || t("review.notGit")} />;

  const checked = [...checkedPaths];
  const selectedPaths = checked.length ? checked : selectedItem ? [selectedItem.file.filePath] : [];
  const stagedCount = status.files.filter((file) => file.indexStatus !== " " && file.indexStatus !== "?").length;
  return <div className={`${styles.reviewRoot} ${selectedItem ? styles.reviewRootWithDiff : ""}`} aria-busy={busy}>
    <aside className={styles.reviewSidebar} aria-label={t("review.controls")}>
      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {selectedItem ? t("review.selectedChange", { path: selectedItem.file.filePath }) : t("review.noSelectedChange")}
      </div>
      <div className={styles.reviewToolbar}>
        <div className={styles.reviewHeading}>
          <b>{t("review.changes", { count: status.files.length })}</b>
          <span className={styles.reviewStats} aria-label={`+${status.additions} −${status.deletions}`}>
            <span className={styles.additions}>+{status.additions}</span>
            <span className={styles.deletions}>−{status.deletions}</span>
          </span>
        </div>
        <div className={styles.reviewToolbarActions}>
          <button className={styles.iconAction} type="button" disabled={busy || selectedPaths.length === 0} onClick={() => void mutate(selectedItem?.group === "staged" ? "unstage" : "stage", selectedPaths)} title={selectedItem?.group === "staged" ? t("review.unstage") : t("review.stage")} aria-label={selectedItem?.group === "staged" ? t("review.unstage") : t("review.stage")}><AliIcon name={selectedItem?.group === "staged" ? "minus" : "check"} size={13} /></button>
          <button className={`${styles.iconAction} ${styles.danger}`} type="button" disabled={busy || selectedPaths.length === 0 || selectedItem?.group === "staged"} onClick={() => void mutate("revert", selectedPaths)} title={t("review.revert")} aria-label={t("review.revert")}><AliIcon name="history" size={13} /></button>
          <button className={styles.iconAction} type="button" onClick={() => void loadStatus()} disabled={busy} title={t("review.refresh")} aria-label={t("review.refresh")}><AliIcon name="reload" size={13} /></button>
        </div>
      </div>
      {items.length ? <ChangeList items={items} selectedKey={selectedKey} checkedPaths={checkedPaths} onSelect={(item) => setSelectedKey(item.key)} onToggle={(path) => setCheckedPaths((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; })} /> : <ReviewEmpty message={t("review.clean")} compact />}
      {stagedCount > 0 ? <div className={styles.commitPanel}>
        <textarea
          ref={commitMessageRef}
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            if (!isCommitKeyboardShortcut(event.nativeEvent)) return;
            event.preventDefault();
            void commit();
          }}
          placeholder={t("review.commitMessage")}
          aria-label={t("review.commitMessage")}
          aria-describedby="review-commit-shortcut"
          rows={3}
        />
        <span id="review-commit-shortcut" className={styles.srOnly}>{t("review.commitShortcut")}</span>
        <div className={styles.commitFooter}>
          <label className={styles.amendToggle}><input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />{t("review.amend")}</label>
          <button className={styles.primaryAction} type="button" disabled={busy || !commitMessage.trim()} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => void commit()}><AliIcon name="check" size={13} />{t("review.commit")}</button>
        </div>
      </div> : null}
      {error ? <div role="alert" className={styles.error}>{error}</div> : null}
      {toast ? <div role="status" className={styles.toast}>{toast}</div> : null}
    </aside>
    {selectedItem ? <section className={styles.diffPane} role="region" aria-label={t("review.diffRegion")}>
      {diff?.supported && diff.patch ? <DiffView patch={diff.patch} filePath={selectedItem.file.filePath} onOpenFile={(path) => onOpenFile(path)} hunkActions={(hunk) => <span className={styles.hunkActions} onClick={(event) => event.stopPropagation()}><button type="button" disabled={busy} onClick={() => void mutate(selectedItem.group === "staged" ? "unstage" : "stage", [selectedItem.file.filePath], { hunk })}>{selectedItem.group === "staged" ? t("review.unstageHunk") : t("review.stageHunk")}</button>{selectedItem.group !== "staged" ? <button type="button" className={styles.danger} disabled={busy} onClick={() => void mutate("revert", [selectedItem.file.filePath], { hunk })}>{t("review.revertHunk")}</button> : null}</span>} /> : <ReviewEmpty message={t("review.diffUnavailable")} />}
    </section> : null}
  </div>;
}

function ReviewEmpty({ message, loading = false, compact = false }: { message: string; loading?: boolean; compact?: boolean }) {
  return <div className={`${styles.reviewEmpty} ${compact ? styles.reviewEmptyCompact : ""}`}>
    <span className={`${styles.emptyIcon} ${loading ? styles.emptyIconLoading : ""}`} aria-hidden="true"><AliIcon name={loading ? "reload" : "diff"} size={17} /></span>
    <span>{message}</span>
  </div>;
}
