"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatStatusDuration } from "@/lib/status-duration";
import type { CompletedGoalBadge } from "@/lib/workflow-types";
import { AliIcon } from "../AliIcon";
import styles from "./Workflow.module.css";

export interface GoalAchievedBadgeProps {
  completedGoal: CompletedGoalBadge;
}

/**
 * Codex-aligned inline completion indicator placed in the final assistant
 * message's action row once a Goal is marked completed:
 *   | [target icon] Goal achieved in {duration}
 */
export function GoalAchievedBadge({ completedGoal }: GoalAchievedBadgeProps) {
  const { t } = useI18n();
  const duration = formatStatusDuration(Math.max(1_000, completedGoal.totalTimeMs || 0));

  return (
    <span
      className={styles.goalAchievedBadge}
      data-testid="goal-achieved-badge"
      title={completedGoal.objective}
    >
      <span className={styles.goalAchievedSep} aria-hidden="true">|</span>
      <AliIcon name="target" size={12} />
      <span>{t("workflow.goal.achievedIn", { duration })}</span>
    </span>
  );
}
