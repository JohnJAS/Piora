"use client";

import { useEffect, useState } from "react";
import {
  defaultPredictionSettings, normalizePredictionText, readPredictionSettings, subscribePredictionSettings,
  type PredictionSettings,
} from "@/lib/input-prediction";
import type { ReplySource } from "@/lib/reply-suggestions";
import { cacheComposerReply, readComposerRecord, replyCacheKey } from "@/lib/reply-storage";

export function usePredictionSettings(cwd?: string | null) {
  const [scope, setScope] = useState<{ cwd: typeof cwd; settings: PredictionSettings }>();
  useEffect(() => {
    const refresh = () => setScope({ cwd, settings: readPredictionSettings(cwd) });
    refresh();
    return subscribePredictionSettings(refresh);
  }, [cwd]);
  return scope?.cwd === cwd ? scope?.settings ?? defaultPredictionSettings() : defaultPredictionSettings();
}

export function useInputPrediction(source: ReplySource | null, cwd: string | null | undefined, locale: string) {
  const settings = usePredictionSettings(cwd);
  const [result, setResult] = useState<{ key: string; text: string }>();
  const key = source && settings.enabled && settings.model
    ? JSON.stringify([source.sessionId, source.sourceEntryId, source.leafId, settings, locale])
    : "";

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const [sessionId, sourceEntryId, leafId, config, language] = JSON.parse(key) as [
      string, string, string | null, PredictionSettings, string,
    ];
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({ ...config, sourceEntryId, leafId, locale: language });
    const requestPrediction = async () => {
      let cacheKey: string | undefined;
      try {
        cacheKey = `prediction:v2:${await replyCacheKey([sessionId, sourceEntryId, leafId, config.model, language])}`;
        const saved = await readComposerRecord<{ text: string }>("replies", cacheKey);
        if (controller.signal.aborted) return;
        if (saved && typeof saved.text === "string") {
          setResult({ key, text: normalizePredictionText(saved.text) });
          return;
        }
      } catch { /* Prediction can still run when local storage is unavailable. */ }
      if (controller.signal.aborted) return;
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/input-prediction`;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeoutMs + 2_000)]);
      const run = () => fetch(url, { method: "POST", headers, body, signal });
      try {
        let response = await run();
        if (response.status === 409 && !signal.aborted) {
          // The visible reply can arrive just before its session file settles.
          await new Promise<void>(resolve => setTimeout(resolve, 500));
          if (signal.aborted) return;
          response = await run();
        }
        if (!response.ok) return;
        const data = await response.json();
        if (signal.aborted || typeof data?.text !== "string") return;
        const text = normalizePredictionText(data.text);
        setResult({ key, text });
        if (cacheKey) void cacheComposerReply(cacheKey, { text }).catch(() => {});
      } catch { /* Optional predictions never interrupt the composer. */ }
    };
    const timer = setTimeout(() => void requestPrediction(), 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  return key && result?.key === key ? result.text : "";
}
