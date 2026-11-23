"use client";

import React from "react";
import type { PermissionMode, ToolPermissionState } from "@/lib/tool-permission-policy";
import type { UserInputAnswers } from "@/lib/user-input";
import type { WorkflowSnapshot } from "@/lib/workflow-types";
import { ImplementPlanCard } from "./ImplementPlanCard";
import { InlineUserInputCard, type UserInputRequest } from "./InlineUserInputCard";

export interface ComposerPendingRequestPanelProps {
  sessionId?: string | null;
  userInputRequest?: UserInputRequest | null;
  onRespondUserInput: (request: UserInputRequest, response: { answers: UserInputAnswers } | { cancelled: true }) => void;
  workflowSnapshot: WorkflowSnapshot | null;
  workflowBusy: boolean;
  workflowEnabled: boolean;
  running: boolean;
  toolPermission?: ToolPermissionState | null;
  permissionSaving?: boolean;
  onToolPermissionChange?: (mode: PermissionMode) => void;
  onApprovePlan: () => void;
  planFeedback: string;
  onPlanFeedbackChange: (feedback: string) => void;
  onRevisePlanWithFeedback: (feedback: string) => Promise<boolean>;
  onDismissPlan: () => void;
}

/**
 * Unified inline pending-request router anchored directly above the Composer.
 * Prioritizes active `request_user_input` questions, then Plan implementation
 * confirmation when a Plan is awaiting approval and the session is idle.
 */
export function ComposerPendingRequestPanel({
  sessionId,
  userInputRequest,
  onRespondUserInput,
  workflowSnapshot,
  workflowBusy,
  workflowEnabled,
  running,
  toolPermission,
  permissionSaving,
  onToolPermissionChange,
  onApprovePlan,
  planFeedback,
  onPlanFeedbackChange,
  onRevisePlanWithFeedback,
  onDismissPlan,
}: ComposerPendingRequestPanelProps) {
  if (userInputRequest) {
    return (
      <InlineUserInputCard
        key={userInputRequest.id}
        request={userInputRequest}
        sessionId={sessionId}
        onRespond={onRespondUserInput}
      />
    );
  }

  const run = workflowSnapshot?.current;
  if (run?.kind === "plan" && run.status === "awaiting_approval" && !running) {
    return (
      <ImplementPlanCard
        key={`${run.id}:${run.version}`}
        run={run}
        sessionId={sessionId}
        busy={workflowBusy}
        enabled={workflowEnabled}
        toolPermission={toolPermission}
        permissionSaving={permissionSaving}
        onToolPermissionChange={onToolPermissionChange}
        onApprove={onApprovePlan}
        feedback={planFeedback}
        onFeedbackChange={onPlanFeedbackChange}
        onReviseWithFeedback={onRevisePlanWithFeedback}
        onDismiss={onDismissPlan}
      />
    );
  }

  return null;
}
