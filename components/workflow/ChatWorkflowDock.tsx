"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { PermissionMode, ToolPermissionState } from "@/lib/tool-permission-policy";
import type { UserInputAnswers } from "@/lib/user-input";
import type { WorkflowActionName, WorkflowSnapshot } from "@/lib/workflow-types";
import type { WorkflowActionExtra } from "@/hooks/useWorkflow";
import { ComposerPendingRequestPanel } from "./ComposerPendingRequestPanel";
import { FloatingStepProgressPill } from "./FloatingStepProgressPill";
import { GoalComposerRail } from "./GoalComposerRail";
import { EditGoalDialog, ReplaceGoalDialog, ResumePausedGoalDialog } from "./GoalDialogs";
import type { UserInputRequest } from "./InlineUserInputCard";
import type { PausedGoalPendingSubmission } from "./useComposerWorkflow";
import {
  WORKFLOW_IMPLEMENT_PLAN_EVENT,
  WORKFLOW_UPDATED_EVENT,
} from "./workflow-events";

export interface ChatWorkflowDockProps {
  sessionId?: string | null;
  snapshot: WorkflowSnapshot | null;
  busy: boolean;
  running: boolean;
  enabled: boolean;
  settingsReady: boolean;
  error: string | null;
  isMobile?: boolean;
  userInputRequest?: UserInputRequest | null;
  onRespondUserInput: (request: UserInputRequest, response: { answers: UserInputAnswers } | { cancelled: true }) => void;
  toolPermission?: ToolPermissionState | null;
  permissionSaving?: boolean;
  onToolPermissionChange?: (mode: PermissionMode) => void;
  onAction: (action: WorkflowActionName, extra?: number | WorkflowActionExtra) => Promise<boolean>;
  onAcceptSnapshot: (snapshot: WorkflowSnapshot) => void;
  onRefresh: () => Promise<void>;
  onOpenTaskChanges?: () => void;
  onFocusComposer: () => void;
  onEnterGoalDraft: (inlineObjective?: string) => void;
  replaceGoalRequest: { inlineObjective?: string } | null;
  onClearReplaceGoalRequest: () => void;
  pausedGoalSubmission: PausedGoalPendingSubmission | null;
  onClearPausedGoalSubmission: () => void;
}

/**
 * Cohesive Codex-aligned workflow dock mounted directly above the Composer.
 * Orchestrates floating step progress, inline UserInput / ImplementPlan cards,
 * single-line Goal Rail Bar, and Replace/Resume/Edit dialogs.
 */
export function ChatWorkflowDock({
  sessionId,
  snapshot,
  busy,
  running,
  enabled,
  settingsReady,
  error,
  isMobile = false,
  userInputRequest,
  onRespondUserInput,
  toolPermission,
  permissionSaving,
  onToolPermissionChange,
  onAction,
  onAcceptSnapshot,
  onRefresh,
  onOpenTaskChanges,
  onFocusComposer,
  onEnterGoalDraft,
  replaceGoalRequest,
  onClearReplaceGoalRequest,
  pausedGoalSubmission,
  onClearPausedGoalSubmission,
}: ChatWorkflowDockProps) {
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Sync edits made in Right Panel PlanSidePanelTab / GoalSidePanelTab immediately.
  useEffect(() => {
    if (!sessionId) return;
    const onUpdated = (event: Event) => {
      const next = (event as CustomEvent<WorkflowSnapshot>).detail;
      if (next?.sessionId === sessionId) onAcceptSnapshot(next);
    };
    const onImplement = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; runId?: string }>).detail;
      if (detail?.sessionId === sessionId && !running && !busy) {
        void onAction("approve");
      }
    };
    window.addEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
    window.addEventListener(WORKFLOW_IMPLEMENT_PLAN_EVENT, onImplement);
    return () => {
      window.removeEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
      window.removeEventListener(WORKFLOW_IMPLEMENT_PLAN_EVENT, onImplement);
    };
  }, [sessionId, onAcceptSnapshot, onAction, running, busy]);

  const feedbackKey = `${sessionId ?? ""}:${snapshot?.current?.id ?? ""}:${snapshot?.current?.version ?? ""}`;
  const [planFeedback, setPlanFeedback] = useState<Record<string, string>>({});
  const handleRevisePlanWithFeedback = useCallback(async (feedback: string) => {
    const value = feedback.trim();
    const ok = await onAction("revise", value ? { feedback: value } : undefined);
    if (ok) {
      setPlanFeedback(current => {
        if (!(feedbackKey in current)) return current;
        const next = { ...current }; delete next[feedbackKey]; return next;
      });
      if (!value) onFocusComposer();
    }
    return ok;
  }, [feedbackKey, onAction, onFocusComposer]);

  const handleConfirmReplaceGoal = useCallback(() => {
    const queuedObjective = replaceGoalRequest?.inlineObjective;
    void onAction("replace_goal").then((ok) => {
      onClearReplaceGoalRequest();
      if (ok) onEnterGoalDraft(queuedObjective);
    });
  }, [replaceGoalRequest, onAction, onClearReplaceGoalRequest, onEnterGoalDraft]);

  const currentRun = snapshot?.current ?? null;
  const isTerminalRun = currentRun?.status === "completed" || currentRun?.status === "cancelled";
  const todoSteps = isTerminalRun && !running
    ? []
    : snapshot?.todoSteps?.length
      ? snapshot.todoSteps
      : !isTerminalRun
        ? currentRun?.steps ?? []
        : [];

  return (
    <>
      <FloatingStepProgressPill
        steps={todoSteps}
        sessionId={sessionId}
        running={running}
        onOpenChanges={onOpenTaskChanges}
      />

      <ComposerPendingRequestPanel
        sessionId={sessionId}
        userInputRequest={userInputRequest}
        onRespondUserInput={onRespondUserInput}
        workflowSnapshot={snapshot}
        workflowBusy={busy}
        workflowEnabled={enabled}
        running={running}
        toolPermission={toolPermission}
        permissionSaving={permissionSaving}
        onToolPermissionChange={onToolPermissionChange}
        onApprovePlan={() => void onAction("approve")}
        planFeedback={planFeedback[feedbackKey] ?? ""}
        onPlanFeedbackChange={(value) => setPlanFeedback(current => ({ ...current, [feedbackKey]: value }))}
        onRevisePlanWithFeedback={handleRevisePlanWithFeedback}
        onDismissPlan={() => void onAction("exit")}
      />

      <GoalComposerRail
        snapshot={snapshot}
        sessionId={sessionId}
        busy={busy}
        running={running}
        enabled={enabled}
        settingsReady={settingsReady}
        error={error}
        isMobile={isMobile}
        onAction={onAction}
        onRefresh={onRefresh}
        onOpenEditModal={() => setEditModalOpen(true)}
      />

      <ReplaceGoalDialog
        open={Boolean(replaceGoalRequest)}
        existingObjective={currentRun?.kind === "goal" ? currentRun.objective : ""}
        busy={busy}
        onCancel={onClearReplaceGoalRequest}
        onConfirm={handleConfirmReplaceGoal}
      />

      <ResumePausedGoalDialog
        open={Boolean(pausedGoalSubmission)}
        existingObjective={currentRun?.kind === "goal" ? currentRun.objective : ""}
        busy={busy}
        onCancel={onClearPausedGoalSubmission}
        onKeepPaused={() => {
          const pending = pausedGoalSubmission;
          onClearPausedGoalSubmission();
          void pending?.submitKeepPaused();
        }}
        onResumeGoal={() => {
          const pending = pausedGoalSubmission;
          onClearPausedGoalSubmission();
          void pending?.submitResumeGoal();
        }}
      />

      <EditGoalDialog
        open={editModalOpen}
        run={currentRun?.kind === "goal" ? currentRun : null}
        busy={busy}
        onClose={() => setEditModalOpen(false)}
        onSave={async ({ objective, turnBudget }) => {
          await onAction("edit_goal", { objective, turnBudget });
        }}
      />
    </>
  );
}
