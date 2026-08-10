import type { SessionInfo } from "@/lib/types";

export const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
export const COLLAPSED_PROJECTS_STORAGE_KEY = "piora:sidebar-collapsed-projects:v1";
export const EXPANDED_PROJECT_SESSIONS_STORAGE_KEY = "piora:sidebar-expanded-project-sessions:v1";
export const PINNED_PROJECTS_STORAGE_KEY = "piora:sidebar-pinned-projects:v1";
export const PROJECT_ALIASES_STORAGE_KEY = "piora:sidebar-project-aliases:v1";
export const REMEMBERED_PROJECTS_STORAGE_KEY = "piora:sidebar-remembered-projects:v1";
export const HIDDEN_PROJECTS_STORAGE_KEY = "piora:sidebar-hidden-projects:v1";
export const RUNNING_SESSIONS_POLL_MS = 2500;

export function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : new Set();
  } catch { return new Set(); }
}

export function saveUnreadSessionIds(ids: Set<string>): void {
  saveStoredStringSet(UNREAD_SESSIONS_STORAGE_KEY, ids);
}

export function loadStoredStringSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === "string")) : new Set();
  } catch { return new Set(); }
}

export function saveStoredStringSet(key: string, values: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (values.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...values]));
  } catch { /* Sidebar remains usable without persistence. */ }
}

export function loadProjectAliases(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECT_ALIASES_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([root, alias]) => root && typeof alias === "string" && alias.trim())
      .map(([root, alias]) => [root, String(alias).trim().slice(0, 80)]));
  } catch { return {}; }
}

export function saveProjectAliases(aliases: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(aliases).length === 0) window.localStorage.removeItem(PROJECT_ALIASES_STORAGE_KEY);
    else window.localStorage.setItem(PROJECT_ALIASES_STORAGE_KEY, JSON.stringify(aliases));
  } catch { /* Sidebar remains usable without persistence. */ }
}

export function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root) continue;
    const previous = latestByRoot.get(root);
    if (!previous || session.modified > previous) latestByRoot.set(root, session.modified);
  }
  return [...latestByRoot].sort((left, right) => right[1].localeCompare(left[1])).map(([root]) => root);
}

export function displayCwd(cwd: string, homeDir?: string): string {
  return homeDir && cwd.startsWith(homeDir) ? `~${cwd.slice(homeDir.length)}` : cwd;
}
