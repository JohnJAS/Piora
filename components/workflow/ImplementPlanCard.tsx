"use client";

import React, { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { PermissionMode, ToolPermissionState } from "@/lib/tool-permission-policy";
import type { WorkflowRun } from "@/lib/workflow-types";
import { AliIcon } from "../AliIcon";
import { ToolPermissionControl } from "../ToolPermissionControl";
import { dispatchOpenWorkflowPanel } from "./workflow-events";
import styles from "./Workflow.module.css";

export interface ImplementPlanCardProps {
  run: WorkflowRun;
  sessionId?: string | null;
  busy: boolean;
  enabled: boolean;
  toolPermission?: ToolPermissionState | null;
  permissionSaving?: boolean;
  onToolPermissionChange?: (mode: PermissionMode) => void;
  onApprove: () => void;
  onReviseWithFeedback: (feedback: string) => void;
  onDismiss: () => void;
}

/**
 * Codex-aligned inline "Implement this plan?" confirmation card docked in the
 * Composer slot whenever a Plan is awaiting user approval.
 */
export function ImplementPlanCard({
  run,
  sessionId,
  busy,
  enabled,
  toolPermission,
  permissionSaving,
  onToolPermissionChange,
  onApprove,
  onReviseWithFeedback,
  onDismiss,
}: ImplementPlanCardProps) {
  const { t } = useI18n();
  const [feedback, setFeedback] = useState("");
  const reviseInputRef = useRef<HTMLInputElement>(null);

  const submitRevision = () => {
    if (!enabled || busy) return;
    onReviseWithFeedback(feedback.trim());
    setFeedback("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onDismiss();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (event.key === "1" && enabled && !busy) {
      event.preventDefault();
      onApprove();
    } else if (event.key === "2" && enabled && !busy) {
      event.preventDefault();
      reviseInputRef.current?.focus();
    }
  };

  return (
    <section
      className={styles.inlineCard}
      role="region"
      data-testid="implement-plan-card"
      data-run-id={run.id}
      aria-label={t("workflow.plan.implementPrompt")}
      onKeyDown={handleKeyDown}
    >
      <header className={styles.inlineHeader}>
        <div className={styles.inlineHeaderLeft}>
          <span className={styles.inlineIcon} aria-hidden="true">
            <AliIcon name="list-check" size={15} />
          </span>
          <div className={styles.inlineHeading}>
            <h3>{t("workflow.plan.implementPrompt")}</h3>
            <p>
              {run.title || run.objective}
              {" · "}
              {t("workflow.version", { version: run.version })}
              {run.planEditedByUser ? ` · ${t("workflow.plan.editedBadge")}` : ""}
            </p>
          </div>
        </div>
        <div className={styles.inlineHeaderRight}>
          <button
            type="button"
            className={styles.btnGhost}
            data-testid="workflow-plan-open-editor"
            onClick={() => dispatchOpenWorkflowPanel({ tab: "plan", sessionId, runId: run.id })}
          >
            <AliIcon name="external-link" size={13} />
            <span>{t("workflow.plan.openInEditor")}</span>
          </button>
          <button
            type="button"
            className={styles.inlineClose}
            disabled={busy}
            onClick={onDismiss}
            aria-label={t("workflow.exit")}
            title={t("workflow.exit")}
          >
            <AliIcon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className={styles.inlineBody}>
        <div className={styles.optionList}>
          <button
            type="button"
            className={styles.optionRow}
            data-testid="workflow-plan-approve"
            data-selected="true"
            disabled={!enabled || busy}
            onClick={onApprove}
          >
            <span className={styles.optionIndex} aria-hidden="true">1</span>
            <span className={styles.optionCopy}>
              <strong>
                {t(run.planEditedByUser ? "workflow.plan.implementEditedYes" : "workflow.plan.implementYes")}
              </strong>
            </span>
          </button>

          <div
            className={styles.optionRow}
            data-testid="workflow-plan-revise-row"
            onClick={() => reviseInputRef.current?.focus()}
          >
            <span className={styles.optionIndex} aria-hidden="true">2</span>
            <input
              ref={reviseInputRef}
              type="text"
              className={styles.customField}
              data-testid="workflow-plan-revise-input"
              disabled={!enabled || busy}
              value={feedback}
              placeholder={t("workflow.plan.revisePlaceholder")}
              aria-label={t("workflow.plan.revisePlaceholder")}
              onChange={(event) => setFeedback(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitRevision();
                }
              }}
            />
            <button
              type="button"
              className={styles.btnSecondary}
              data-testid="workflow-plan-revise"
              disabled={!enabled || busy}
              onClick={(event) => {
                event.stopPropagation();
                submitRevision();
              }}
            >
              {feedback.trim() ? t("workflow.plan.reviseSubmit") : t("workflow.revise")}
            </button>
          </div>
        </div>
      </div>

      <footer className={styles.inlineFooter}>
        <div className={styles.inlineFooterMeta}>
          {onToolPermissionChange && (
            <ToolPermissionControl
              state={toolPermission ?? null}
              saving={permissionSaving}
              onChange={onToolPermissionChange}
            />
          )}
        </div>
        <div className={styles.inlineActions}>
          <button
            type="button"
            className={styles.btnGhost}
            data-testid="workflow-plan-exit"
            disabled={busy}
            onClick={onDismiss}
          >
            {t("workflow.plan.dismiss")}
            <span className={styles.shortcutKey}>Esc</span>
          </button>
        </div>
      </footer>
    </section>
  );
}
