"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type { WorkflowMode } from "@/lib/workflow-types";
import { AliIcon } from "../AliIcon";
import styles from "./Workflow.module.css";

export interface WorkflowModePillsProps {
  mode: WorkflowMode;
  goalDrafting: boolean;
  disabled?: boolean;
  onExitPlan: () => void;
  onClearGoalDraft: () => void;
}

/**
 * Codex-aligned removable mode pills in the composer footer.
 * Zero persistent mode chrome in default Agent mode; appears only while Plan
 * mode or Goal drafting mode is active.
 */
export function WorkflowModePills({
  mode,
  goalDrafting,
  disabled,
  onExitPlan,
  onClearGoalDraft,
}: WorkflowModePillsProps) {
  const { t } = useI18n();

  if (mode !== "plan" && !goalDrafting) return null;

  return (
    <>
      {mode === "plan" && (
        <button
          type="button"
          className={styles.modePill}
          data-testid="workflow-plan-pill"
          disabled={disabled}
          onClick={onExitPlan}
          title={t("workflow.pill.exitPlan")}
          aria-label={t("workflow.pill.exitPlan")}
        >
          <span className={styles.modePillIconSwap} aria-hidden="true">
            <span className={styles.modePillIconDefault}>
              <AliIcon name="list-check" size={13} />
            </span>
            <span className={styles.modePillIconClose}>
              <AliIcon name="close" size={12} />
            </span>
          </span>
          <span>{t("workflow.short.plan")}</span>
        </button>
      )}
      {goalDrafting && (
        <button
          type="button"
          className={`${styles.modePill} ${styles.modePillGoal}`}
          data-testid="workflow-goal-pill"
          disabled={disabled}
          onClick={onClearGoalDraft}
          title={t("workflow.pill.clearGoal")}
          aria-label={t("workflow.pill.clearGoal")}
        >
          <AliIcon name="target" size={13} />
          <span>{t("workflow.short.goal")}</span>
          <span className={styles.modePillCloseStatic} aria-hidden="true">
            <AliIcon name="close" size={11} />
          </span>
        </button>
      )}
    </>
  );
}
