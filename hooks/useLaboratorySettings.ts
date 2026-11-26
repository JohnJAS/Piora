"use client";

import { useSyncExternalStore } from "react";

interface LaboratoryState {
  planGoalEnabled: boolean;
  loading: boolean;
  ready: boolean;
  saving: boolean;
  error: string | null;
}
const PASSIVE_FRESHNESS_MS = 15_000;
const BACKGROUND_FRESHNESS_MS = 60_000;
const BACKGROUND_POLL_MS = 5_000;
const initial: LaboratoryState = { planGoalEnabled: false, loading: true, ready: false, saving: false, error: null };
let state = initial;
let revision = 0;
let lastFetchedAt = 0;
let request: AbortController | null = null;
let cleanup: (() => void) | undefined;
const listeners = new Set<() => void>();
const changeKey = "piora-laboratory-settings-changed";
function publish(next: LaboratoryState) { state = next; listeners.forEach(listener => listener()); }

async function refresh(force = true, freshnessMs = PASSIVE_FRESHNESS_MS) {
  if (state.saving || request) return;
  if (!force && state.ready && !state.error && Date.now() - lastFetchedAt < freshnessMs) return;
  const controller = new AbortController();
  request = controller;
  const version = revision;
  try {
    const response = await fetch("/api/settings/laboratory", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
    const data = await response.json() as { planGoalEnabled?: boolean; error?: string };
    if (!response.ok || typeof data.planGoalEnabled !== "boolean") throw new Error(data.error ?? `HTTP ${response.status}`);
    if (version === revision && !controller.signal.aborted) {
      lastFetchedAt = Date.now();
      publish({ ...state, planGoalEnabled: data.planGoalEnabled, loading: false, ready: true, error: null });
    }
  } catch (error) {
    if (version === revision && !controller.signal.aborted) publish({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) });
  } finally { if (request === controller) request = null; }
}

const refreshIfStale = (freshnessMs = PASSIVE_FRESHNESS_MS) => refresh(false, freshnessMs);
const forceRefresh = () => refresh(true);

async function setPlanGoalEnabled(planGoalEnabled: boolean): Promise<boolean> {
  if (state.saving) return false;
  revision++;
  request?.abort(); request = null;
  publish({ ...state, saving: true, error: null });
  try {
    const response = await fetch("/api/settings/laboratory", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planGoalEnabled }), signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json() as { planGoalEnabled?: boolean; error?: string };
    if (!response.ok || typeof data.planGoalEnabled !== "boolean") throw new Error(data.error ?? `HTTP ${response.status}`);
    lastFetchedAt = Date.now();
    publish({ planGoalEnabled: data.planGoalEnabled, loading: false, ready: true, saving: false, error: null });
    // This is only an invalidation signal. Every window reads the server value.
    try { localStorage.setItem(changeKey, `${Date.now()}:${Math.random()}`); } catch { /* Polling still synchronizes windows. */ }
    return true;
  } catch (error) {
    publish({ ...state, saving: false, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const reconcile = () => { if (document.visibilityState !== "hidden") void refreshIfStale(PASSIVE_FRESHNESS_MS); };
    const reconcileBackground = () => { if (document.visibilityState !== "hidden") void refreshIfStale(BACKGROUND_FRESHNESS_MS); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== changeKey && event.key !== null) return;
      lastFetchedAt = 0;
      revision++; request?.abort(); request = null;
      if (document.visibilityState !== "hidden") void refresh(true);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", reconcile);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    const timer = window.setInterval(reconcileBackground, BACKGROUND_POLL_MS);
    if (document.visibilityState !== "hidden") void refreshIfStale(PASSIVE_FRESHNESS_MS);
    cleanup = () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", reconcile);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      request?.abort(); request = null;
    };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { cleanup?.(); cleanup = undefined; } };
}

export function useLaboratorySettings() {
  const current = useSyncExternalStore(subscribe, () => state, () => initial);
  return { ...current, refresh: forceRefresh, setPlanGoalEnabled };
}
