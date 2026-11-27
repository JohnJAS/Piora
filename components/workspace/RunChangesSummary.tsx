"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { PromptFileChanges } from "@/lib/prompt-file-changes";
import { AliIcon } from "../AliIcon";
import styles from "./RunChangesSummary.module.css";

export function RunChangesSummary({ snapshot, expanded, onToggle }: {
  snapshot: PromptFileChanges;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const dismissalKey = `piora-run-changes-dismissed:${snapshot.sessionId}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return window.sessionStorage.getItem(dismissalKey) === snapshot.runId; }
    catch { return false; }
  });
  if (dismissed || !snapshot.files.length) return null;
  const totals = snapshot.files.reduce((total, file) => ({
    additions: total.additions + (file.additions ?? 0),
    deletions: total.deletions + (file.deletions ?? 0),
  }), { additions: 0, deletions: 0 });
  const label = t(snapshot.files.length === 1 ? "files.runChangedFile" : "files.runChangedFiles", { count: snapshot.files.length });
  const actionLabel = t(expanded ? "files.closeRunChanges" : "files.openRunChanges");

  return <div className={styles.wrapper} data-run-changes-summary>
    <div className={styles.pill}>
      <button type="button" className={styles.summary} aria-expanded={expanded} title={actionLabel} onClick={onToggle}>
        <AliIcon name="git-commit" size={14} />
        <span>{label}</span>
        {totals.additions > 0 || totals.deletions > 0 ? <span className={styles.stats} title={t("files.runTextStats")}>
          {totals.additions > 0 && <span className={styles.additions}>+{totals.additions}</span>}
          {totals.deletions > 0 && <span className={styles.deletions}>−{totals.deletions}</span>}
        </span> : null}
        <AliIcon name="chevron-right" size={12} className={styles.chevron} />
      </button>
      <button type="button" className={styles.dismiss} title={t("files.dismissRunChanges")} aria-label={t("files.dismissRunChanges")}
        onClick={() => {
          setDismissed(true);
          try { window.sessionStorage.setItem(dismissalKey, snapshot.runId); } catch { /* local session ends on reload */ }
        }}><AliIcon name="close" size={13} /></button>
    </div>
  </div>;
}
