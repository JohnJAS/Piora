"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_INTERFACE_TRANSPARENCY,
  INTERFACE_TRANSPARENCY_STORAGE_KEY,
  normalizeInterfaceTransparency,
  parseInterfaceTransparency,
  serializeInterfaceTransparency,
} from "@/lib/interface-transparency";

const listeners = new Set<() => void>();
const getServerSnapshot = () => DEFAULT_INTERFACE_TRANSPARENCY;
function getSnapshot(): number {
  const value = document.documentElement.dataset.interfaceTransparency;
  return value === undefined ? DEFAULT_INTERFACE_TRANSPARENCY : normalizeInterfaceTransparency(Number(value));
}

function apply(value: number, persist: boolean): void {
  const transparency = normalizeInterfaceTransparency(value);
  const root = document.documentElement;
  root.dataset.interfaceTransparency = String(transparency);
  root.style.setProperty("--interface-transparency", String(transparency));
  if (persist) {
    try { localStorage.setItem(INTERFACE_TRANSPARENCY_STORAGE_KEY, serializeInterfaceTransparency(transparency)); }
    catch { /* Keep the current renderer usable when storage is unavailable. */ }
  }
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent): void {
  if (event.key === INTERFACE_TRANSPARENCY_STORAGE_KEY || event.key === null) {
    apply(parseInterfaceTransparency(event.newValue), false);
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

const setTransparency = (value: number) => apply(value, true);
const reset = () => setTransparency(DEFAULT_INTERFACE_TRANSPARENCY);

export function useInterfaceTransparency() {
  const transparency = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    try { apply(parseInterfaceTransparency(localStorage.getItem(INTERFACE_TRANSPARENCY_STORAGE_KEY)), false); }
    catch { /* Retain the document preference when storage is unavailable. */ }
  }, []);
  return { transparency, setTransparency, reset };
}
