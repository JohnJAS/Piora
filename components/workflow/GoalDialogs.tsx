"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { MAX_WORKFLOW_TURN_BUDGET, type WorkflowRun } from "@/lib/workflow-types";
import styles from "./Workflow.module.css";

export function ReplaceGoalDialog({
  open,
  existingObjective,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  existingObjective: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.modalBackdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        data-testid="replace-goal-dialog"
        aria-labelledby="replace-goal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalBody}>
          <h3 id="replace-goal-title">{t("workflow.goal.replaceTitle")}</h3>
          <p>{t("workflow.goal.replaceBody")}</p>
          {existingObjective && (
            <div className={styles.modalPreviewBox}>{existingObjective}</div>
          )}
        </div>
        <footer className={styles.modalFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onCancel} disabled={busy}>
            {t("chat.cancel")}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            data-testid="replace-goal-confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            {t("workflow.goal.replaceConfirm")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function ResumePausedGoalDialog({
  open,
  existingObjective,
  busy,
  onKeepPaused,
  onResumeGoal,
  onCancel,
}: {
  open: boolean;
  existingObjective: string;
  busy?: boolean;
  onKeepPaused: () => void;
  onResumeGoal: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.modalBackdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        data-testid="resume-paused-goal-dialog"
        aria-labelledby="resume-paused-goal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalBody}>
          <h3 id="resume-paused-goal-title">{t("workflow.goal.resumeTitle")}</h3>
          <p>{t("workflow.goal.resumeBody")}</p>
          {existingObjective && (
            <div className={styles.modalPreviewBox}>{existingObjective}</div>
          )}
        </div>
        <footer className={styles.modalFooter}>
          <button
            type="button"
            className={styles.btnSecondary}
            data-testid="resume-goal-keep-paused"
            onClick={onKeepPaused}
            disabled={busy}
          >
            {t("workflow.goal.keepPaused")}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            data-testid="resume-goal-confirm"
            onClick={onResumeGoal}
            disabled={busy}
          >
            {t("workflow.goal.resumeAndSend")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function EditGoalDialog({
  open,
  run,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  run: WorkflowRun | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (update: { objective: string; turnBudget: number }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [objective, setObjective] = useState(run?.objective ?? "");
  const [budget, setBudget] = useState(String(run?.turnBudget ?? 10));

  useEffect(() => {
    if (open && run) {
      setObjective(run.objective);
      setBudget(String(run.turnBudget));
    }
  }, [open, run]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !run || typeof document === "undefined") return null;

  const budgetNumber = Number(budget);
  const validBudget = Number.isSafeInteger(budgetNumber) && budgetNumber >= 1 && budgetNumber <= MAX_WORKFLOW_TURN_BUDGET;
  const canSave = Boolean(objective.trim() && validBudget && !busy);

  return createPortal(
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        data-testid="edit-goal-dialog"
        aria-labelledby="edit-goal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalBody}>
          <h3 id="edit-goal-title">{t("workflow.goal.editGoal")}</h3>
          <textarea
            className={styles.sidePanelTextarea}
            rows={8}
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            aria-label={t("workflow.objective")}
          />
          <label className={styles.guardrailRow}>
            <span className={styles.sidePanelLabel}>{t("workflow.budget")}</span>
            <input
              type="number"
              className={styles.budgetInput}
              min={1}
              max={MAX_WORKFLOW_TURN_BUDGET}
              step={1}
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
        </div>
        <footer className={styles.modalFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={busy}>
            {t("chat.cancel")}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={!canSave}
            onClick={() => void onSave({ objective: objective.trim(), turnBudget: budgetNumber }).then(onClose)}
          >
            {t("workflow.goal.saveGoal")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
