"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type HarmonyFrameStatus = "idle" | "loading" | "live" | "error";

export interface HarmonyLiveFrame {
  url: string;
  serial: string;
  generation: number;
  revision: number;
}

interface UseHarmonyLiveFrameOptions {
  active: boolean;
  enabled: boolean;
  serial: string;
  generation?: number;
  fallbackError: string;
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } | string };
  return typeof payload.error === "string" ? payload.error : payload.error?.message || `Request failed (${response.status})`;
}

export function useHarmonyLiveFrame(options: UseHarmonyLiveFrameOptions) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<HarmonyFrameStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<HarmonyLiveFrame | null>(null);
  const frameUrlRef = useRef<string | null>(null);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (!options.active || !options.enabled || !options.serial) {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      frameUrlRef.current = null;
      setFrame(null);
      setStatus("idle");
      setError(null);
      return;
    }
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    const schedule = (delay: number) => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!disposed) timer = window.setTimeout(() => { void loadFrame(); }, delay);
    };
    const loadFrame = async () => {
      if (disposed) return;
      if (document.hidden) {
        schedule(1_500);
        return;
      }
      const requestController = new AbortController();
      controller = requestController;
      // Keep the previous frame visibly "live" while the next screenshot is
      // in flight. Flipping to loading on every poll made a ~1fps HDC capture
      // look much more sluggish than it was.
      if (!frameUrlRef.current) setStatus("loading");
      try {
        const response = await fetch(`/api/harmony/frame?serial=${encodeURIComponent(options.serial)}&v=${Date.now()}`, {
          cache: "no-store",
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(await responseError(response));
        const generation = Number(response.headers.get("X-Harmony-Generation"));
        const revision = Number(response.headers.get("X-Harmony-Revision"));
        if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(revision)) throw new Error("Device frame metadata is invalid");
        const url = URL.createObjectURL(await response.blob());
        if (disposed) {
          URL.revokeObjectURL(url);
          return;
        }
        if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
        frameUrlRef.current = url;
        setFrame({ url, serial: options.serial, generation, revision });
        setStatus("live");
        setError(null);
        failures = 0;
      } catch (frameFailure) {
        if (requestController.signal.aborted || disposed) return;
        failures += 1;
        setStatus("error");
        setError(frameFailure instanceof Error ? frameFailure.message : options.fallbackError);
      } finally {
        if (controller === requestController) controller = undefined;
        schedule(failures === 0
          ? (document.hidden ? 3_000 : 250)
          : Math.min(8_000, 1_000 * (2 ** Math.min(failures, 3))));
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) controller?.abort();
      else schedule(0);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void loadFrame();
    return () => {
      disposed = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [options.active, options.enabled, options.fallbackError, options.generation, options.serial, refreshKey]);

  useEffect(() => () => {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
  }, []);

  return { frame, status, error, refresh };
}
