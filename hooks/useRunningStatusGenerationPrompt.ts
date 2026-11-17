"use client";

import { useEffect, useSyncExternalStore } from "react";
import { RUNNING_STATUS_MAX_PROMPT_LENGTH } from "@/lib/running-status-labels";

const key = "piora-running-status-generation-prompt:v1";
let prompt = "";
const listeners = new Set<() => void>();
function notify() { listeners.forEach(listener => listener()); }
function read() {
  try {
    prompt = (localStorage.getItem(key) ?? "").slice(0, RUNNING_STATUS_MAX_PROMPT_LENGTH);
    notify();
  } catch { /* Retain the in-memory preference when storage is unavailable. */ }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) read(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
function setPrompt(value: string) {
  prompt = value.slice(0, RUNNING_STATUS_MAX_PROMPT_LENGTH);
  try { localStorage.setItem(key, prompt); } catch { /* Apply in memory when storage is unavailable. */ }
  notify();
}
export function useRunningStatusGenerationPrompt() {
  const value = useSyncExternalStore(subscribe, () => prompt, () => "");
  useEffect(read, []);
  return { prompt: value, setPrompt };
}
