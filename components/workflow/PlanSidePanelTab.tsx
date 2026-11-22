"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { WorkflowSnapshot } from "@/lib/workflow-types";
import { AliIcon } from "../AliIcon";
import { MarkdownBody } from "../MarkdownBody";
import {
  dispatchWorkflowImplementPlan,
  dispatchWorkflowUpdated,
  WORKFLOW_UPDATED_EVENT,
} from "./workflow-events";
import styles from "./Workflow.module.css";

interface PlanDocumentResponse {
  plan: {
    runId: string;
    version: number;
    title: string;
    objective: string;
    markdown: string;
    filePath: string | null;
    editedByUser: boolean;
    status: string;
    editable: boolean;
    revision: number;
  } | null;
  snapshot: WorkflowSnapshot;
}

export interface PlanSidePanelTabProps {
  sessionId: string | null;
  cwd?: string | null;
  sessionRunning?: boolean;
  refreshKey?: number;
}

/**
 * Right-panel editable PLAN.md viewer & editor aligned with Codex Desktop's
 * Plan Side Panel tab. Supports Preview/Edit mode, Ctrl+S saving, and
 * one-click plan implementation with edited content.
 */
export function PlanSidePanelTab({
  sessionId,
  cwd,
  sessionRunning = false,
  refreshKey = 0,
}: PlanSidePanelTabProps) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<PlanDocumentResponse["plan"]>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("edit");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = Boolean(plan && draft !== plan.markdown);

  const loadPlan = useCallback(async (signal?: AbortSignal) => {
    if (!sessionId) {
      setPlan(null);
      setDraft("");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/workflow/plan`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(t("workflow.loadError"));
      const data = await response.json() as PlanDocumentResponse;
      if (signal?.aborted) return;
      setPlan(data.plan);
      setDraft((previous) => {
        if (!data.plan) return "";
        // Avoid clobbering active unsaved edits to the exact same version.
        if (plan && plan.runId === data.plan.runId && plan.version === data.plan.version && previous !== plan.markdown) {
          return previous;
        }
        return data.plan.markdown;
      });
      if (data.plan && !data.plan.editable) setMode("preview");
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : t("workflow.loadError"));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [sessionId, t, plan]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPlan(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshKey]);

  useEffect(() => {
    if (!sessionId) return;
    const onUpdated = (event: Event) => {
      const snapshot = (event as CustomEvent<WorkflowSnapshot>).detail;
      if (snapshot?.sessionId === sessionId) void loadPlan();
    };
    window.addEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
  }, [sessionId, loadPlan]);

  const savePlan = useCallback(async (): Promise<boolean> => {
    if (!sessionId || !plan || !plan.editable || !draft.trim() || saving) return false;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/workflow/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: plan.runId,
          markdown: draft,
          expectedRevision: plan.revision,
        }),
      });
      const data = await response.json() as PlanDocumentResponse & { error?: string };
      if (!response.ok || !data.plan) {
        throw new Error(data.error ?? t("workflow.actionError"));
      }
      setPlan(data.plan);
      setDraft(data.plan.markdown);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
      if (data.snapshot) dispatchWorkflowUpdated(data.snapshot);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("workflow.actionError"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [sessionId, plan, draft, saving, t]);

  const handleImplement = async () => {
    if (!sessionId || !plan || sessionRunning) return;
    if (dirty) {
      const saved = await savePlan();
      if (!saved) return;
    }
    dispatchWorkflowImplementPlan(sessionId, plan.runId);
  };

  if (!sessionId || (!loading && !plan)) {
    return (
      <div className={styles.emptyState} data-testid="plan-side-panel-empty">
        <AliIcon name="list-check" size={22} />
        <p>{t("workflow.plan.emptyPanel")}</p>
      </div>
    );
  }

  return (
    <div
      className={styles.sidePanel}
      data-testid="plan-side-panel"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void savePlan();
        }
      }}
    >
      <header className={styles.sidePanelHeader}>
        <div className={styles.sidePanelTitleGroup}>
          <AliIcon name="list-check" size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <h3>{plan?.title || t("workflow.plan.panelTitle")}</h3>
          {plan && (
            <span className={styles.sidePanelBadge}>{t("workflow.version", { version: plan.version })}</span>
          )}
          {plan?.editedByUser && (
            <span className={styles.sidePanelBadge}>{t("workflow.plan.editedBadge")}</span>
          )}
          {dirty ? (
            <span className={styles.sidePanelBadge}>{t("workflow.plan.unsaved")}</span>
          ) : savedNotice ? (
            <span className={styles.sidePanelBadge}>{t("workflow.plan.saved")}</span>
          ) : null}
        </div>
        <div className={styles.inlineActions}>
          {plan?.editable && (
            <div className={styles.segmentedTabs} role="tablist">
              <button
                type="button"
                role="tab"
                className={styles.segmentedTab}
                aria-selected={mode === "preview"}
                data-active={mode === "preview" ? "true" : undefined}
                onClick={() => setMode("preview")}
              >
                {t("workflow.plan.previewTab")}
              </button>
              <button
                type="button"
                role="tab"
                className={styles.segmentedTab}
                aria-selected={mode === "edit"}
                data-active={mode === "edit" ? "true" : undefined}
                onClick={() => setMode("edit")}
              >
                {t("workflow.plan.editTab")}
              </button>
            </div>
          )}
          {plan?.editable && (
            <button
              type="button"
              className={styles.btnSecondary}
              data-testid="plan-side-panel-save"
              disabled={!dirty || saving || !draft.trim()}
              onClick={() => void savePlan()}
            >
              <AliIcon name="save" size={13} />
              <span>{t("workflow.plan.savePlan")}</span>
            </button>
          )}
          {plan?.status === "awaiting_approval" && (
            <button
              type="button"
              className={styles.btnPrimary}
              data-testid="plan-side-panel-implement"
              disabled={sessionRunning || saving}
              onClick={() => void handleImplement()}
            >
              {t("workflow.approve")}
            </button>
          )}
        </div>
      </header>

      <div className={styles.sidePanelBody}>
        {error && (
          <div className={styles.goalRailError} role="alert">
            <span>{error}</span>
            <button type="button" className={styles.btnGhost} onClick={() => void loadPlan()}>
              {t("workflow.refresh")}
            </button>
          </div>
        )}

        {plan?.editable && mode === "edit" ? (
          <textarea
            className={`${styles.sidePanelTextarea} ${styles.planEditorTextarea}`}
            data-testid="plan-side-panel-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t("workflow.plan.panelTitle")}
            spellCheck={false}
          />
        ) : (
          <div data-testid="plan-side-panel-preview">
            <MarkdownBody cwd={cwd ?? undefined}>{draft || plan?.markdown || ""}</MarkdownBody>
          </div>
        )}
      </div>
    </div>
  );
}
