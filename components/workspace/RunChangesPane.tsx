"use client";

import { memo, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import styles from "./WorkspacePanel.module.css";
import type { PromptFileChanges } from "@/lib/prompt-file-changes";

interface RunChangesPaneProps {
  runChanges: PromptFileChanges | null;
  selectedRunFilePath?: string;
  fileNavMode: "tree" | "run";
  onFileNavModeChange: (mode: "tree" | "run") => void;
  onOpenReview: () => void;
  onSelectRunFile: (path: string) => void;
  children: ReactNode;
}

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

export const RunChangesPane = memo(function RunChangesPane({
  runChanges,
  selectedRunFilePath,
  fileNavMode,
  onFileNavModeChange,
  onOpenReview,
  onSelectRunFile,
  children,
}: RunChangesPaneProps) {
  const { t } = useI18n();

  return <>
    <div className={styles.fileNavigatorTabs} role="tablist" aria-label={t("files.navigator")}>
      <button type="button" role="tab" aria-selected={fileNavMode === "tree"} onClick={() => onFileNavModeChange("tree")}>{t("files.explorer")}</button>
      <button type="button" role="tab" aria-selected={fileNavMode === "run"} onClick={() => onFileNavModeChange("run")}>{t("files.thisRun")}{runChanges?.files.length ? ` ${runChanges.files.length}` : ""}</button>
    </div>
    <div className={styles.fileNavigatorBody} hidden={fileNavMode !== "tree"} style={{ flex: 1, minHeight: 0, overflow: "auto", display: fileNavMode === "tree" ? undefined : "none" }}>{children}</div>
    <div className={styles.fileNavigatorBody} hidden={fileNavMode !== "run"} style={{ flex: 1, minHeight: 0, overflow: "auto", display: fileNavMode === "run" ? undefined : "none" }}>
      <div className={styles.runSummary}>
        <span title={runChanges ? t("files.runScope") : undefined}>{runChanges?.status === "running" ? t("files.runRunning") : runChanges?.status === "aborted" ? t("files.runAborted") : runChanges?.status === "error" ? t("files.runError") : runChanges?.status === "unavailable" ? t("files.runUnavailable") : t("files.thisRun")}</span>
        <button type="button" onClick={onOpenReview}>{t("files.reviewAll")}</button>
      </div>
      {runChanges?.partial ? <div className={styles.runNotice}>{t("files.runPartial")}</div> : null}
      {runChanges?.files.length ? runChanges.files.map((file) => {
        const { name, directory } = formatRunFileDisplay(file.path, runChanges.cwd);
        return (
          <button key={file.path} className={styles.runFile} type="button" title={file.path}
            aria-current={selectedRunFilePath === file.path || undefined} onClick={() => onSelectRunFile(file.path)}>
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
