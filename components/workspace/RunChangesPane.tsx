"use client";

import { memo, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import styles from "./WorkspacePanel.module.css";
import type { PromptFileChanges } from "@/lib/prompt-file-changes";
import { pollVisibleDocument } from "@/lib/visible-poller";

interface RunChangesPaneProps {
  active: boolean;
  sessionId: string | null;
  sessionRunning?: boolean;
  refreshKey: number;
  fileNavMode: "tree" | "run";
  onFileNavModeChange: (mode: "tree" | "run") => void;
  onOpenReview: () => void;
  onOpenRunFile: (path: string, name: string, options?: { modeHint?: "diff" }) => void;
  children: ReactNode;
}

const MAX_SETTLEMENT_READS = 30;

function formatRunFileDisplay(filePath: string, cwd?: string): { name: string; directory: string | null } {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  const name = segments.pop() ?? filePath;
  const fullDir = segments.join("/");
  if (!cwd) {
    return { name, directory: null };
  }
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const comparablePath = normalizedPath.toLowerCase();
  const comparableCwd = normalizedCwd.toLowerCase();
  if (comparablePath.startsWith(`${comparableCwd}/`)) {
    const relative = normalizedPath.slice(normalizedCwd.length + 1);
    const slash = relative.lastIndexOf("/");
    return { name, directory: slash > 0 ? relative.slice(0, slash) : null };
  }
  return { name, directory: fullDir || null };
}

/** Isolates per-run change polling from FileExplorer and FileViewer renders. */
export const RunChangesPane = memo(function RunChangesPane({
  active,
  sessionId,
  sessionRunning,
  refreshKey,
  fileNavMode,
  onFileNavModeChange,
  onOpenReview,
  onOpenRunFile,
  children,
}: RunChangesPaneProps) {
  const { t } = useI18n();
  const [runChanges, setRunChanges] = useState<PromptFileChanges | null>(null);

  useEffect(() => {
    if (!active || !sessionId) {
      setRunChanges(null);
      return;
    }
    setRunChanges((current) => current?.sessionId === sessionId ? current : null);
    let cancelled = false;
    const load = async (signal: AbortSignal) => {
      try {
        const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/changes`, { cache: "no-store", signal });
        if (!response.ok) return;
        const data = await response.json() as PromptFileChanges | null;
        if (!cancelled && !signal.aborted) setRunChanges(data);
        return data;
      } catch {
        if (!cancelled && !signal.aborted) setRunChanges(null);
      }
    };
    let polling: ReturnType<typeof pollVisibleDocument> | null = null;
    let deferTimer: ReturnType<typeof setTimeout> | undefined;
    let unsettled = false;
    let settlementReads = 0;
    const start = () => {
      if (cancelled) return;
      const pollMs = sessionRunning ? (fileNavMode === "run" ? 2500 : 5000) : 1000;
      polling = pollVisibleDocument(async (signal) => {
        const snapshot = await load(signal);
        if (sessionRunning || signal.aborted) return;
        // The agent can become idle before the workspace snapshot is persisted.
        // Keep reading only when a run actually needs to reach its final state.
        if (snapshot !== undefined) unsettled = snapshot?.status === "running";
        if (!unsettled || ++settlementReads >= MAX_SETTLEMENT_READS) polling?.stop();
      }, pollMs);
    };
    if (fileNavMode === "run") start();
    else deferTimer = setTimeout(start, 200);
    return () => {
      cancelled = true;
      if (deferTimer !== undefined) clearTimeout(deferTimer);
      polling?.stop();
    };
  }, [active, sessionId, sessionRunning, refreshKey, fileNavMode]);

  return <>
    <div className={styles.fileNavigatorTabs} role="tablist" aria-label={t("files.navigator")}>
      <button type="button" role="tab" aria-selected={fileNavMode === "tree"} onClick={() => onFileNavModeChange("tree")}>{t("files.explorer")}</button>
      <button type="button" role="tab" aria-selected={fileNavMode === "run"} onClick={() => onFileNavModeChange("run")}>{t("files.thisRun")}{runChanges?.files.length ? ` ${runChanges.files.length}` : ""}</button>
    </div>
    <div className={styles.fileNavigatorBody} hidden={fileNavMode !== "tree"} style={{ flex: 1, minHeight: 0, overflow: "auto", display: fileNavMode === "tree" ? undefined : "none" }}>{children}</div>
    <div className={styles.fileNavigatorBody} hidden={fileNavMode !== "run"} style={{ flex: 1, minHeight: 0, overflow: "auto", display: fileNavMode === "run" ? undefined : "none" }}>
      <div className={styles.runSummary}>
        <span>{runChanges?.status === "running" ? t("files.runRunning") : runChanges?.status === "aborted" ? t("files.runAborted") : runChanges?.status === "error" ? t("files.runError") : runChanges?.status === "unavailable" ? t("files.runUnavailable") : t("files.thisRun")}</span>
        <button type="button" onClick={onOpenReview}>{t("files.reviewAll")}</button>
      </div>
      {runChanges ? <div className={styles.runScope}>{t("files.runScope")}</div> : null}
      {runChanges?.partial ? <div className={styles.runNotice}>{t("files.runPartial")}</div> : null}
      {runChanges?.files.length ? runChanges.files.map((file) => {
        const { name, directory } = formatRunFileDisplay(file.path, runChanges.cwd);
        return (
          <button key={file.path} className={styles.runFile} type="button" title={file.path} onClick={() => { onOpenRunFile(file.path, name, file.kind === "deleted" ? { modeHint: "diff" } : undefined); }}>
            <AliIcon name="file" size={14} />
            <span className={styles.runFileCopy}>
              <span className={styles.runFileName}>{name}</span>
              {directory ? <span className={styles.runFileDir}>{directory}</span> : null}
            </span>
            <small>{t(`files.run.${file.kind}`)}</small>
          </button>
        );
      }) : <div className={styles.runEmpty}>{!runChanges ? t("files.runNever") : runChanges.status === "running" ? t("files.runPending") : runChanges.status === "unavailable" ? t("files.runUnavailable") : t("files.runEmpty")}</div>}
    </div>
  </>;
});
