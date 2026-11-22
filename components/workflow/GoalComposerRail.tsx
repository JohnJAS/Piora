"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatStatusDuration } from "@/lib/status-duration";
import type { WorkflowActionName, WorkflowRun, WorkflowSnapshot } from "@/lib/workflow-types";
import { AliIcon } from "../AliIcon";
import { dispatchOpenWorkflowPanel } from "./workflow-events";
import styles from "./Workflow.module.css";

export interface GoalComposerRailProps {
  snapshot: WorkflowSnapshot | null;
  sessionId?: string | null;
  busy: boolean;
  running: boolean;
  enabled: boolean;
  settingsReady?: boolean;
  error: string | null;
  isMobile?: boolean;
  onAction: (action: WorkflowActionName) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onOpenEditModal: () => void;
}

function goalStatusLabelKey(status: WorkflowRun["status"]): string {
  switch (status) {
    case "running": return "workflow.goal.active";
    case "paused": return "workflow.goal.pausedLabel";
    case "waiting": return "workflow.goal.waitingLabel";
    case "budget_exhausted": return "workflow.goal.budgetReachedLabel";
    case "failed": return "workflow.goal.failedLabel";
    default: return `workflow.status.${status}`;
  }
}

/**
 * Codex-aligned compact single-line Goal Rail Bar docked directly above the Composer.
 * Shows icon + status + single-line objective + live 1s ticking elapsed duration +
 * Clear / Pause-Resume / Edit icon buttons. Auto-hides once Goal completes or cancels.
 */
export function GoalComposerRail({
  snapshot,
  sessionId,
  busy,
  running,
  enabled,
  settingsReady = true,
  error,
  isMobile = false,
  onAction,
  onRefresh,
  onOpenEditModal,
}: GoalComposerRailProps) {
  const { t } = useI18n();
  const run = snapshot?.current;
  const isActiveGoal = Boolean(
    run?.kind === "goal" && run.status !== "completed" && run.status !== "cancelled",
  );
  const isTicking = Boolean(isActiveGoal && run?.status === "running" && run.activeSince);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isTicking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isTicking]);

  if (!isActiveGoal && !error) return null;

  const elapsedMs = run
    ? (run.timeUsedMs ?? 0) + (run.status === "running" && run.activeSince ? Math.max(0, now - run.activeSince) : 0)
    : 0;
  const canResume = Boolean(
    run
    && enabled
    && !busy
    && !running
    && ["paused", "waiting", "budget_exhausted", "failed"].includes(run.status)
    && run.turnsUsed < run.turnBudget,
  );
  const canPause = Boolean(run && !busy && run.status === "running");

  const openDetails = () => {
    if (!run) return;
    if (isMobile) {
      onOpenEditModal();
    } else {
      dispatchOpenWorkflowPanel({ tab: "goal", sessionId, runId: run.id });
    }
  };

  return (
    <>
      {error && (
        <div className={styles.goalRailError} role="alert" data-testid="workflow-error">
          <span>{error}</span>
          <button type="button" className={styles.btnGhost} onClick={() => void onRefresh()}>
            {t("workflow.refresh")}
          </button>
        </div>
      )}

      {isActiveGoal && run && (
        <section
          className={styles.goalRail}
          data-testid="goal-composer-rail"
          data-run-id={run.id}
          data-status={run.status}
          aria-label={t("workflow.goal")}
        >
          <button
            type="button"
            className={styles.goalRailMain}
            data-testid="goal-rail-open-panel"
            onClick={openDetails}
            title={run.objective}
          >
            <span className={styles.goalRailIcon} data-status={run.status} aria-hidden="true">
              <AliIcon name="target" size={14} />
            </span>
            <span className={styles.goalRailStatus} role="status">
              {snapshot?.autoContinuing ? t("workflow.goal.continuing") : t(goalStatusLabelKey(run.status))}
            </span>
            <span className={styles.goalRailObjective}>{run.objective}</span>
            <span className={styles.goalRailMeta}>
              {elapsedMs >= 1_000 ? <span>{formatStatusDuration(elapsedMs)}</span> : null}
              <span>·</span>
              <span>{run.turnsUsed}/{run.turnBudget}</span>
            </span>
          </button>

          {settingsReady && !enabled && (
            <span
              className={styles.sidePanelBadge}
              data-testid="workflow-laboratory-disabled"
              title={t("workflow.laboratoryDisabled")}
            >
              {t("i18n.disabled")}
            </span>
          )}

          <div className={styles.goalRailActions}>
            <button
              type="button"
              className={styles.goalRailActionBtn}
              data-testid="workflow-goal-cancel"
              disabled={busy}
              title={t("workflow.goal.clearGoal")}
              aria-label={t("workflow.goal.clearGoal")}
              onClick={() => void onAction("cancel")}
            >
              <AliIcon name="clear" size={13} />
            </button>

            {run.status === "running" ? (
              <button
                type="button"
                className={styles.goalRailActionBtn}
                data-testid="workflow-goal-pause"
                disabled={!canPause}
                title={t("workflow.goal.pauseGoal")}
                aria-label={t("workflow.goal.pauseGoal")}
                onClick={() => void onAction("pause")}
              >
                <AliIcon name="pause" size={13} />
              </button>
            ) : (
              <button
                type="button"
                className={styles.goalRailActionBtn}
                data-testid="workflow-goal-resume"
                disabled={!canResume}
                title={t("workflow.goal.resumeGoal")}
                aria-label={t("workflow.goal.resumeGoal")}
                onClick={() => void onAction("resume")}
              >
                <AliIcon name="play" size={13} />
              </button>
            )}

            <button
              type="button"
              className={styles.goalRailActionBtn}
              data-testid="workflow-goal-edit"
              disabled={busy}
              title={t("workflow.goal.editGoal")}
              aria-label={t("workflow.goal.editGoal")}
              onClick={openDetails}
            >
              <AliIcon name="edit" size={13} />
            </button>
          </div>
        </section>
      )}
    </>
  );
}
