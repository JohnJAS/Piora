"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./useI18n";
import type { WorkflowAction, WorkflowSnapshot } from "@/lib/workflow-types";

/** Session and revision checks fence slow requests after switching chats or acting. */
export function useWorkflow(sessionId: string | null, visible: boolean, running: boolean,
  executeAction: (action: WorkflowAction) => Promise<WorkflowSnapshot>) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ sessionId, executeAction, t });
  latest.current = { sessionId, executeAction, t };
  const generation = useRef(0);
  const actionInFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const accept = useCallback((next: WorkflowSnapshot) => {
    if (next.sessionId !== latest.current.sessionId) return;
    setSnapshot(current => current?.sessionId === next.sessionId && current.revision > next.revision ? current : next);
  }, []);
  const reconcile = useCallback(async () => {
    const sid = latest.current.sessionId;
    if (!sid || request.current) return;
    const epoch = generation.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(sid)}/workflow`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok) throw new Error(latest.current.t("workflow.loadError"));
      const next = await response.json() as WorkflowSnapshot;
      if (epoch !== generation.current || controller.signal.aborted || latest.current.sessionId !== sid) return;
      accept(next);
      setLoadError(null);
    } catch {
      if (epoch === generation.current && !controller.signal.aborted) setLoadError(latest.current.t("workflow.loadError"));
    } finally { if (request.current === controller) request.current = null; }
  }, [accept]);
  const refresh = useCallback(async () => {
    // An explicit retry acknowledges the previous action failure. Background
    // polling only reconciles state and must not erase the failure message.
    setActionError(null);
    await reconcile();
  }, [reconcile]);
  useEffect(() => {
    const epoch = ++generation.current;
    request.current?.abort(); request.current = null;
    actionInFlight.current = false;
    setSnapshot(null); setLoadError(null); setActionError(null); setBusy(false);
    if (sessionId) void reconcile();
    return () => { generation.current = epoch + 1; request.current?.abort(); request.current = null; };
  }, [sessionId, reconcile]);
  useEffect(() => {
    if (!sessionId || !visible) return;
    const refreshVisible = () => { if (document.visibilityState !== "hidden") void reconcile(); };
    refreshVisible();
    const timer = setInterval(refreshVisible, running ? 1_000 : 3_000);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { clearInterval(timer); window.removeEventListener("online", refreshVisible); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [sessionId, visible, running, reconcile]);
  const act = useCallback(async (action: WorkflowAction["action"], turnBudget?: number) => {
    const current = snapshot;
    if (!current?.current || current.sessionId !== latest.current.sessionId || actionInFlight.current) return false;
    const epoch = generation.current;
    actionInFlight.current = true; setBusy(true); setLoadError(null); setActionError(null);
    try {
      const next = await latest.current.executeAction({ action, runId: current.current.id, expectedRevision: current.revision, ...(turnBudget !== undefined ? { turnBudget } : {}) });
      if (epoch !== generation.current) return false;
      accept(next);
      return true;
    } catch (cause) {
      if (epoch === generation.current) {
        setActionError(cause instanceof Error ? cause.message : latest.current.t("workflow.actionError"));
        // A 409 may mean another window acted; reload before offering actions.
        void reconcile();
      }
      return false;
    } finally {
      if (epoch === generation.current) { actionInFlight.current = false; setBusy(false); }
    }
  }, [snapshot, accept, reconcile]);
  return { snapshot: snapshot?.sessionId === sessionId ? snapshot : null, error: actionError ?? loadError, busy, act, refresh };
}
