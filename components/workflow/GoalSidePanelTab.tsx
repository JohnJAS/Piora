"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useLaboratorySettings } from "@/hooks/useLaboratorySettings";
import { formatStatusDuration } from "@/lib/status-duration";
import {
  MAX_WORKFLOW_TURN_BUDGET,
  type WorkflowActionName,
  type WorkflowRun,
  type WorkflowSnapshot,
} from "@/lib/workflow-types";
import { AliIcon } from "../AliIcon";
import { dispatchWorkflowUpdated, WORKFLOW_UPDATED_EVENT } from "./workflow-events";
import styles from "./Workflow.module.css";

const KNOWN_REASONS = new Set([
  "host_restarted",
  "mode_changed",
  "revision_requested",
  "user_exited",
  "user_paused",
  "user_cancelled",
  "goal_replaced",
  "user_stopped",
  "turn_budget_exhausted",
  "no_progress",
  "execution_finished",
  "planning_needs_input",
  "laboratory_disabled",
]);

export interface GoalSidePanelTabProps {
  sessionId: string | null;
  sessionRunning?: boolean;
  refreshKey?: number;
}

/**
 * Right-panel Goal inspector & guardrail editor.
 * Keeps the main composer aligned with Codex's minimal single-line rail while
 * housing Piora's objective editing, turn budget (1–100), consecutive
 * no-progress guard status, acceptance criteria/evidence, and history.
 */
export function GoalSidePanelTab({
  sessionId,
  sessionRunning = false,
  refreshKey = 0,
}: GoalSidePanelTabProps) {
  const { t } = useI18n();
  const laboratory = useLaboratorySettings();
  const enabled = laboratory.planGoalEnabled;
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [objectiveDraft, setObjectiveDraft] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadSnapshot = useCallback(async (signal?: AbortSignal) => {
    if (!sessionId) {
      setSnapshot(null);
      return;
    }
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/workflow`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(t("workflow.loadError"));
      const next = await response.json() as WorkflowSnapshot;
      if (!signal?.aborted) {
        setSnapshot(next);
        setError(null);
      }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t("workflow.loadError"));
    }
  }, [sessionId, t]);

  useEffect(() => {
    const controller = new AbortController();
    setObjectiveDraft(null);
    setBudgetDraft(null);
    void loadSnapshot(controller.signal);
    return () => controller.abort();
  }, [sessionId, refreshKey, loadSnapshot]);

  useEffect(() => {
    if (!sessionId) return;
    const onUpdated = (event: Event) => {
      const next = (event as CustomEvent<WorkflowSnapshot>).detail;
      if (next?.sessionId === sessionId) setSnapshot(next);
    };
    window.addEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
  }, [sessionId]);

  const run = snapshot?.current?.kind === "goal" ? snapshot.current : null;
  const isTicking = Boolean(run && run.status === "running" && run.activeSince);
  useEffect(() => {
    if (!isTicking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isTicking]);

  const sendAction = async (
    action: WorkflowActionName,
    extra?: { turnBudget?: number; objective?: string },
  ) => {
    if (!sessionId || !snapshot || !run || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          runId: run.id,
          expectedRevision: snapshot.revision,
          ...extra,
        }),
      });
      const result = await response.json() as { snapshot?: WorkflowSnapshot; error?: string };
      if (!response.ok || !result.snapshot) {
        throw new Error(result.error ?? t("workflow.actionError"));
      }
      setSnapshot(result.snapshot);
      dispatchWorkflowUpdated(result.snapshot);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("workflow.actionError"));
      void loadSnapshot();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!sessionId || (!run && !snapshot?.history.length)) {
    return (
      <div className={styles.emptyState} data-testid="goal-side-panel-empty">
        <AliIcon name="target" size={22} />
        <p>{t("workflow.goal.emptyPanel")}</p>
      </div>
    );
  }

  const effectiveObjective = objectiveDraft ?? run?.objective ?? "";
  const effectiveBudget = budgetDraft ?? String(run?.turnBudget ?? 10);
  const budgetNumber = Number(effectiveBudget);
  const validBudget = Number.isSafeInteger(budgetNumber) && budgetNumber >= 1 && budgetNumber <= MAX_WORKFLOW_TURN_BUDGET;
  const terminal = !run || run.status === "completed" || run.status === "cancelled";
  const elapsedMs = run
    ? (run.timeUsedMs ?? 0) + (run.status === "running" && run.activeSince ? Math.max(0, now - run.activeSince) : 0)
    : 0;
  const canResume = Boolean(
    run
    && enabled
    && !busy
    && !sessionRunning
    && ["paused", "waiting", "budget_exhausted", "failed"].includes(run.status)
    && run.turnsUsed < run.turnBudget,
  );

  return (
    <div className={styles.sidePanel} data-testid="goal-side-panel">
      <header className={styles.sidePanelHeader}>
        <div className={styles.sidePanelTitleGroup}>
          <AliIcon name="target" size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <h3>{t("workflow.goal.panelTitle")}</h3>
          {run && (
            <span className={styles.sidePanelBadge} role="status" data-status={run.status}>
              {t(`workflow.status.${run.status}`)}
            </span>
          )}
        </div>
        {run && !terminal && (
          <div className={styles.inlineActions}>
            {run.status === "running" ? (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={busy}
                onClick={() => void sendAction("pause")}
              >
                <AliIcon name="pause" size={12} />
                <span>{t("workflow.pause")}</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={!canResume}
                onClick={() => void sendAction("resume")}
              >
                <AliIcon name="play" size={12} />
                <span>{t("workflow.resume")}</span>
              </button>
            )}
            <button
              type="button"
              className={styles.btnGhost}
              disabled={busy}
              onClick={() => void sendAction("cancel")}
            >
              {t("workflow.goal.clearGoal")}
            </button>
          </div>
        )}
      </header>

      <div className={styles.sidePanelBody}>
        {error && (
          <div className={styles.goalRailError} role="alert">
            <span>{error}</span>
            <button type="button" className={styles.btnGhost} onClick={() => void loadSnapshot()}>
              {t("workflow.refresh")}
            </button>
          </div>
        )}

        {run && (
          <>
            <section className={styles.sidePanelSection}>
              <label className={styles.sidePanelLabel} htmlFor="goal-objective-editor">
                {t("workflow.objective")}
              </label>
              <textarea
                id="goal-objective-editor"
                className={styles.sidePanelTextarea}
                data-testid="goal-panel-objective-input"
                rows={5}
                disabled={!enabled || terminal || busy}
                value={effectiveObjective}
                onChange={(event) => setObjectiveDraft(event.target.value)}
              />
              {!terminal && (
                <div className={styles.guardrailRow}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    data-testid="goal-panel-save-objective"
                    disabled={!enabled || busy || !effectiveObjective.trim() || effectiveObjective.trim() === run.objective}
                    onClick={() => {
                      void sendAction("edit_goal", { objective: effectiveObjective.trim() }).then((ok) => {
                        if (ok) setObjectiveDraft(null);
                      });
                    }}
                  >
                    {t("workflow.goal.saveGoal")}
                  </button>
                </div>
              )}
            </section>

            <section className={styles.sidePanelSection}>
              <span className={styles.sidePanelLabel}>{t("workflow.budget")}</span>
              <div className={styles.guardrailRow}>
                <span className={styles.sidePanelBadge}>
                  {t("workflow.turns", { used: run.turnsUsed, budget: run.turnBudget })}
                </span>
                <span className={styles.sidePanelBadge}>
                  {t("workflow.goal.elapsed")}: {formatStatusDuration(elapsedMs)}
                </span>
                <span className={styles.sidePanelBadge}>
                  {t("workflow.goal.noProgressGuard", { count: run.noProgressTurns })}
                </span>
              </div>
              {!terminal && (
                <>
                  <div className={styles.guardrailRow}>
                    <input
                      type="number"
                      className={styles.budgetInput}
                      data-testid="workflow-run-budget-input"
                      aria-label={t("workflow.budget")}
                      min={1}
                      max={MAX_WORKFLOW_TURN_BUDGET}
                      step={1}
                      disabled={!enabled || busy}
                      value={effectiveBudget}
                      onChange={(event) => setBudgetDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      data-testid="workflow-goal-set-budget"
                      disabled={!enabled || busy || !validBudget || budgetNumber === run.turnBudget}
                      onClick={() => {
                        void sendAction("set_budget", { turnBudget: budgetNumber }).then((ok) => {
                          if (ok) setBudgetDraft(null);
                        });
                      }}
                    >
                      {t("workflow.saveBudget")}
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                    {t("workflow.budgetHelp")}
                  </p>
                </>
              )}
            </section>

            {run.reason && (
              <div className={styles.modalPreviewBox}>
                {KNOWN_REASONS.has(run.reason) ? t(`workflow.reason.${run.reason}`) : run.reason}
              </div>
            )}

            {run.progress && (
              <section className={styles.sidePanelSection}>
                <span className={styles.sidePanelLabel}>{t("workflow.progress")}</span>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {run.progress}
                </p>
              </section>
            )}

            <section className={styles.sidePanelSection}>
              <span className={styles.sidePanelLabel}>{t("workflow.criteria")}</span>
              <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                {t("workflow.evidenceHelp")}
              </p>
              {run.criteria.length > 0 ? (
                <ol className={styles.criteriaList}>
                  {run.criteria.map((criterion) => (
                    <li key={criterion.id} className={styles.criterionItem}>
                      <div className={styles.criterionHead}>
                        <span>{criterion.text}</span>
                        <span className={styles.sidePanelBadge}>
                          {t(criterion.status === "verified" ? "workflow.verified" : "workflow.pending")}
                        </span>
                      </div>
                      <div className={styles.criterionEvidence}>
                        {criterion.evidence || t("workflow.noEvidence")}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                  {t("workflow.noEvidence")}
                </p>
              )}
            </section>
          </>
        )}

        {Boolean(snapshot?.history.length) && (
          <details data-testid="workflow-history">
            <summary className={styles.sidePanelLabel} style={{ cursor: "pointer" }}>
              {t("workflow.history", { count: snapshot!.history.length })}
            </summary>
            <ol className={styles.criteriaList} style={{ marginTop: 8 }}>
              {[...snapshot!.history].reverse().map((entry: WorkflowRun, index: number) => (
                <li
                  key={`${entry.id}:${entry.version}:${index}`}
                  className={styles.criterionItem}
                  data-testid="workflow-history-entry"
                  data-run-id={entry.id}
                  data-status={entry.status}
                >
                  <div className={styles.criterionHead}>
                    <span>
                      {t(`workflow.${entry.kind}`)}
                      {entry.title ? ` · ${entry.title}` : ""}
                    </span>
                    <span className={styles.sidePanelBadge}>{t(`workflow.status.${entry.status}`)}</span>
                  </div>
                  <div className={styles.criterionEvidence}>
                    {entry.objective || entry.markdown.slice(0, 160)}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
