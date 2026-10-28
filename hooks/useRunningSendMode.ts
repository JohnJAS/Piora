"use client";

import { useEffect, useSyncExternalStore } from "react";

export type RunningSendMode = "steer" | "next_turn";
const key = "piora-running-send-mode:v1";
let mode: RunningSendMode = "steer";
const listeners = new Set<() => void>();
function notify() { listeners.forEach(listener => listener()); }
function read() {
  try { mode = localStorage.getItem(key) === "next_turn" ? "next_turn" : "steer"; notify(); } catch { /* Retain the in-memory preference. */ }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) read(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
function setMode(value: RunningSendMode) {
  mode = value;
  try { localStorage.setItem(key, value); } catch { /* Apply in memory when storage is unavailable. */ }
  notify();
}
export function useRunningSendMode() {
  const value = useSyncExternalStore(subscribe, () => mode, (): RunningSendMode => "steer");
  useEffect(read, []);
  return { mode: value, setMode };
}
