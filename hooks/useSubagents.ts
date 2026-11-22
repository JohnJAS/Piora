"use client";

import { createContext, useCallback, useSyncExternalStore } from "react";
import { compareSubagentVersions, type SubagentDetail, type SubagentSelection, type SubagentTranscriptPage } from "@/lib/subagent-types";
import type { SessionInfo } from "@/lib/types";
import { getSubagentRefreshEpoch, markSubagentChanged, subscribeSubagentChanges } from "./useTaskStatus";

export interface SubagentSidebarState {
  activeCounts: ReadonlyMap<string, number>;
  selected?: SubagentSelection;
  open?: (session: SessionInfo, agentId: string, openerId: string) => void;
}
export const SubagentSidebarContext = createContext<SubagentSidebarState | null>(null);
export const OpenSubagentContext = createContext<((selection: SubagentSelection, openerId: string) => void) | null>(null);
export const ContinueSubagentContext = createContext<((record: SubagentDetail) => void) | null>(null);

interface Snapshot { data?: unknown; failed?: boolean }
const empty: Snapshot = {};
class SubagentQuery {
  private request?: AbortController;
  private disposeTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  private disconnect?: () => void;
  private dirty = false;
  private epoch = getSubagentRefreshEpoch();
  private snapshot: Snapshot = empty;

  constructor(private parent: string, private query: string) {}

  getSnapshot = () => this.epoch === getSubagentRefreshEpoch() ? this.snapshot : empty;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.disconnect) {
      const unsubscribe = subscribeSubagentChanges(this.parent, this.refresh);
      const visibility = () => {
        if (document.visibilityState !== "visible") {
          this.request?.abort();
          this.request = undefined;
        } else this.refresh();
      };
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("online", this.refresh);
      this.disconnect = () => {
        unsubscribe();
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("online", this.refresh);
      };
      this.refresh();
    }
    clearTimeout(this.disposeTimer);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.disconnect?.(); this.disconnect = undefined;
      this.request?.abort(); this.request = undefined;
      this.disposeTimer = setTimeout(() => {
        if (!this.listeners.size && cache.get(this.parent + "?" + this.query) === this) cache.delete(this.parent + "?" + this.query);
      }, 30_000);
    };
  };

  refresh = () => {
    if (!this.listeners.size) return;
    const epoch = getSubagentRefreshEpoch();
    if (this.epoch !== epoch) {
      this.epoch = epoch;
      this.request?.abort();
      this.request = undefined;
      this.snapshot = empty;
      for (const listener of this.listeners) listener();
    }
    if (document.visibilityState !== "visible") return;
    if (this.request) { this.dirty = true; return; }
    this.dirty = false;
    const controller = new AbortController();
    this.request = controller;
    void fetchSubagent(this.parent, this.query, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
      .then((data) => {
        if (controller.signal.aborted) return;
        const oldRecord = (this.snapshot.data as SubagentDetailResponse | undefined)?.records?.[0];
        const newRecord = (data as SubagentDetailResponse | undefined)?.records?.[0];
        if (oldRecord && newRecord?.agentId === oldRecord.agentId && compareSubagentVersions(newRecord, oldRecord) < 0) return;
        this.snapshot = { data };
        for (const listener of this.listeners) listener();
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        this.snapshot = error instanceof SubagentRequestError && error.status === 404 ? { failed: true } : { ...this.snapshot, failed: true };
        for (const listener of this.listeners) listener();
      })
      .finally(() => {
        if (this.request !== controller) return;
        this.request = undefined;
        if (this.dirty) this.refresh();
      });
  };
}
const cache = new Map<string, SubagentQuery>();

export class SubagentRequestError extends Error {
  constructor(readonly status: number) { super("Subagent request failed"); }
}

export async function fetchSubagent<T>(parent: string, query: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/agent/" + encodeURIComponent(parent) + "/subagents?" + query, { cache: "no-store", signal });
  if (!response.ok) throw new SubagentRequestError(response.status);
  return response.json() as Promise<T>;
}

export interface SubagentDetailResponse { records: SubagentDetail[]; transcript?: SubagentTranscriptPage; fullResult?: string | null }

export function useSubagentQuery<T>(parent: string | undefined, query: string | undefined) {
  const key = parent && query ? parent + "?" + query : undefined;
  const subscribe = useCallback((listener: () => void) => {
    if (!key || !parent || !query) return () => {};
    const entry = cache.get(key) ?? new SubagentQuery(parent, query);
    cache.set(key, entry);
    return entry.subscribe(listener);
  }, [key, parent, query]);
  const get = useCallback(() => (key ? cache.get(key)?.getSnapshot() : undefined) ?? empty, [key]);
  const snapshot = useSyncExternalStore(subscribe, get, () => empty);
  return { data: snapshot.data as T | undefined, failed: snapshot.failed ?? false, refresh: () => { if (key) cache.get(key)?.refresh(); } };
}

export async function requestSubagentStop(record: SubagentDetail): Promise<boolean> {
  try {
    const response = await fetch("/api/agent/" + encodeURIComponent(record.parentSessionId) + "/subagents", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ action: "stop", agentId: record.agentId, expectedAttempt: record.attempt ?? 1 }),
    });
    if (!response.ok) throw new SubagentRequestError(response.status);
    return response.status === 202;
  } finally { markSubagentChanged(record.parentSessionId); }
}
