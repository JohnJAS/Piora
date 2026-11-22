"use client";

import type { WorkflowSnapshot } from "@/lib/workflow-types";

export type WorkflowSidePanelTab = "plan" | "goal";

export interface OpenWorkflowPanelDetail {
  tab: WorkflowSidePanelTab;
  sessionId?: string | null;
  runId?: string;
}

export const OPEN_WORKFLOW_PANEL_EVENT = "piora:open-workflow-panel";
export const WORKFLOW_UPDATED_EVENT = "piora:workflow-updated";
export const WORKFLOW_IMPLEMENT_PLAN_EVENT = "piora:workflow-implement-plan";

export function dispatchOpenWorkflowPanel(detail: OpenWorkflowPanelDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenWorkflowPanelDetail>(OPEN_WORKFLOW_PANEL_EVENT, { detail }));
}

export function dispatchWorkflowUpdated(snapshot: WorkflowSnapshot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkflowSnapshot>(WORKFLOW_UPDATED_EVENT, { detail: snapshot }));
}

export function dispatchWorkflowImplementPlan(sessionId: string, runId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ sessionId: string; runId?: string }>(WORKFLOW_IMPLEMENT_PLAN_EVENT, {
    detail: { sessionId, runId },
  }));
}
