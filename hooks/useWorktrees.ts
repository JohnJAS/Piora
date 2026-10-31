"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface WorktreeEntry { path: string; branch: string | null; isMain: boolean }
export interface WorktreeState {
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

const metadata = new Map<string, WorktreeState>();
function pathKey(path: string) {
  const value = path.replace(/\\/g, "/").replace(/\/$/, "");
  return /^[a-z]:|^\/\//i.test(value) ? value.toLowerCase() : value;
}

/** Prime project identity before navigation, including checkouts without sessions. */
export function rememberWorktreeMetadata(state: WorktreeState) {
  for (const [key, value] of metadata) {
    if (pathKey(value.projectRoot) === pathKey(state.projectRoot)) metadata.delete(key);
  }
  for (const tree of state.worktrees) metadata.set(pathKey(tree.path), state);
  metadata.set(pathKey(state.forCwd), state);
}

/** Metadata is also used to keep empty worktrees grouped with their project. */
export function useWorktrees(cwd: string | null, enabled = true, refreshKey = 0) {
  const [state, setState] = useState<WorktreeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ cwd: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!cwd || !enabled) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || data.error || !data.projectRoot) throw new Error(data.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) {
          const next = { ...data, forCwd: cwd };
          rememberWorktreeMetadata(next);
          setState(next);
        }
      }).catch(cause => { if (!controller.signal.aborted) setError({ cwd, message: String(cause instanceof Error ? cause.message : cause) }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cwd, enabled, refreshKey, revision]);
  const current = state?.forCwd === cwd ? state : cwd ? metadata.get(pathKey(cwd)) : null;
  const scopedState = useMemo(() => current && cwd ? { ...current, forCwd: cwd } : null, [current, cwd]);
  return { state: scopedState, loading, error: error?.cwd === cwd ? error.message : null, refresh };
}
