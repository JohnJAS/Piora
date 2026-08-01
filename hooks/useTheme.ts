"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { UiThemePackId } from "../lib/ui-theme-packs";

export type Theme =
  | "light"
  | "dark"
  | "starlight"
  | "ivory"
  | "doodle"
  | "fortune"
  | "midnight"
  | "forest"
  | "dream";

export interface ThemePreset {
  id: Theme;
  isDark: boolean;
  packId?: UiThemePackId;
  preview: {
    background: string;
    accent: string;
  };
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "light", isDark: false, preview: { background: "#fffdfc", accent: "#3569d4" } },
  { id: "dark", isDark: true, preview: { background: "#1a1a1a", accent: "#60a5fa" } },
  { id: "starlight", isDark: false, preview: { background: "#f3f2ff", accent: "#7857e8" } },
  { id: "ivory", isDark: false, preview: { background: "#f8f5e9", accent: "#78834f" } },
  { id: "doodle", isDark: false, preview: { background: "#fff9e9", accent: "#0e9f8f" } },
  { id: "fortune", isDark: false, preview: { background: "#fff5dc", accent: "#b92c25" } },
  { id: "midnight", isDark: true, preview: { background: "#0b1020", accent: "#8b9dff" } },
  { id: "forest", isDark: true, preview: { background: "#101914", accent: "#6fcf97" } },
  { id: "dream", isDark: true, packId: "codex-dream-skin", preview: { background: "#111318", accent: "#8da397" } },
] as const;

export const THEME_STORAGE_KEY = "pi-theme:v1";
export const LEGACY_THEME_STORAGE_KEY = "pi-theme";

const THEME_IDS = new Set<Theme>(THEME_PRESETS.map(({ id }) => id));
const DARK_THEME_IDS = new Set<Theme>(
  THEME_PRESETS.filter(({ isDark }) => isDark).map(({ id }) => id),
);
const listeners = new Set<() => void>();
let storageListenerAttached = false;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEME_IDS.has(value as Theme);
}

export function isDarkTheme(theme: Theme): boolean {
  return DARK_THEME_IDS.has(theme);
}

/** Accepts both the versioned payload and the old plain `pi-theme` value. */
export function parseStoredTheme(value: string | null): Theme | null {
  if (!value) return null;
  if (isTheme(value)) return value;

  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "theme" in parsed) {
      const theme = (parsed as { theme?: unknown }).theme;
      return isTheme(theme) ? theme : null;
    }
  } catch {
    // A malformed preference falls back to the legacy key or the light theme.
  }
  return null;
}

export function serializeThemePreference(theme: Theme): string {
  return JSON.stringify({ theme });
}

function subscribe(cb: () => void): () => void {
  if (!storageListenerAttached && typeof window !== "undefined") {
    storageListenerAttached = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = parseStoredTheme(event.newValue);
      if (next && next !== getSnapshot()) applyTheme(next, false);
    });
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  const theme = document.documentElement.dataset.theme;
  if (isTheme(theme)) return theme;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function applyTheme(theme: Theme, persist = true): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", isDarkTheme(theme));
  root.style.colorScheme = isDarkTheme(theme) ? "dark" : "light";

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, serializeThemePreference(theme));
      // Keep older Pi Web versions usable. Custom dark presets degrade to dark.
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, isDarkTheme(theme) ? "dark" : "light");
    } catch {
      // Ignore storage errors (private mode, quota, disabled storage, etc.).
    }
  }

  listeners.forEach((cb) => cb());
}

export type ThemeChangeOrigin = { x: number; y: number };

function transitionToTheme(theme: Theme, origin?: ThemeChangeOrigin, appearanceAction?: () => void): void {
  if (theme === getSnapshot()) {
    appearanceAction?.();
    return;
  }

  const commit = () => {
    appearanceAction?.();
    applyTheme(theme);
  };

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const supportsViewTransition = typeof document.startViewTransition === "function";

  if (!supportsViewTransition || reduceMotion) {
    commit();
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(commit);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 450,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // A cancelled transition has already applied the requested theme.
    });
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme, origin?: ThemeChangeOrigin) => {
    transitionToTheme(next, origin);
  }, []);

  const setThemeWithAction = useCallback((next: Theme, action: () => void, origin?: ThemeChangeOrigin) => {
    transitionToTheme(next, origin, action);
  }, []);

  const toggleTheme = useCallback((origin?: ThemeChangeOrigin) => {
    transitionToTheme(isDarkTheme(getSnapshot()) ? "light" : "dark", origin);
  }, []);

  return {
    theme,
    themes: THEME_PRESETS,
    setTheme,
    setThemeWithAction,
    toggleTheme,
    isDark: isDarkTheme(theme),
  };
}
