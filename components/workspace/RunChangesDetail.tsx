"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { PromptFileChange, PromptFileChanges } from "@/lib/prompt-file-changes";
import { DiffView } from "../DiffView";
import styles from "./WorkspacePanel.module.css";

export function RunChangesDetail({ snapshot, file, active, onOpenFile }: {
  snapshot: PromptFileChanges | null;
  file: PromptFileChange | undefined;
  active: boolean;
  onOpenFile: (path: string, name: string) => void;
}) {
  const { t } = useI18n();
  const sessionId = snapshot?.sessionId;
  const runId = snapshot?.runId;
  const path = file?.path;
  const revision = file?.patchRevision;
  const key = JSON.stringify([sessionId, runId, path, revision]);
  const [loaded, setLoaded] = useState<{ key: string; patch: string | null; error?: boolean } | null>(null);
  const current = loaded?.key === key ? loaded : null;

  useEffect(() => {
    if (!active || !sessionId || !runId || !path || !revision) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ runId, path });
    void fetch(`/api/agent/${encodeURIComponent(sessionId)}/changes?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { patch } = await response.json() as { patch: string | null };
        if (!controller.signal.aborted) setLoaded({ key, patch });
      })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key, patch: null, error: true }); });
    return () => controller.abort();
  }, [active, key, path, revision, runId, sessionId]);

  if (!file) {
    const label = !snapshot ? "files.runNever" : snapshot.status === "running" ? "files.runPending"
      : snapshot.status === "unavailable" ? "files.runUnavailable" : "files.runEmpty";
    return <div className={styles.empty}>{t(label)}</div>;
  }
  const name = file.path.replace(/\\/g, "/").split("/").pop() ?? file.path;

  return <section className={styles.runDiff} aria-label={t("files.runFileDiff")} data-run-file-diff>
    <header className={styles.runDiffHeader}>
      <span title={file.path}>{name}</span>
      {file.kind !== "deleted" && <button type="button" className="ui-button" onClick={() => onOpenFile(file.path, name)}>{t("files.runOpenFile")}</button>}
    </header>
    <div className={styles.runDiffBody}>
      {revision && !current ? <div className={styles.empty} role="status">{t("files.runDiffLoading")}</div>
        : current?.patch ? <DiffView key={key} patch={current.patch} filePath={file.path} showFileHeader={false} />
        : <div className={styles.empty} role={current?.error ? "alert" : undefined}>
          {t(current?.error ? "files.runDiffFailed" : "files.runDiffUnavailable")}
        </div>}
    </div>
  </section>;
}
