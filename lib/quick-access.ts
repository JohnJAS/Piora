import type { QuickAccessEntry } from "@/desktop/src/quick-access-types";

export function quickAccessIsShortcut(item: Pick<QuickAccessEntry, "kind" | "path">): boolean {
  return item.kind === "file" && /\.(lnk|url)$/i.test(item.path);
}

export function quickAccessName(item: Pick<QuickAccessEntry, "name" | "path" | "preset">, t: (key: string) => string): string {
  return item.name || (item.preset ? t(`quickAccess.preset.${item.preset}`) : item.path.split(/[\\/]/).filter(Boolean).pop() || item.path);
}

/** Shared scoring keeps the manager and launcher in the same order. */
export function quickAccessScore(item: QuickAccessEntry, query: string, name: string): number {
  const normalized = query.trim().replace(/\\/g, "/").toLocaleLowerCase();
  const label = name.toLocaleLowerCase();
  const target = item.path.replace(/\\/g, "/").toLocaleLowerCase();
  const haystack = `${label} ${target}`;
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (!terms.every(term => haystack.includes(term))) return -1;
  // Within saved locations, favor pinned entries in the same match tier.
  return (normalized && label === normalized ? 1000 : normalized && label.startsWith(normalized) ? 500 : 0) + Number(item.pinned) * 200;
}

export function quickAccessPathKey(target: string, platform?: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function quickAccessErrorKey(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.match(/quickAccess\.error\.[a-zA-Z]+/)?.[0] || "quickAccess.error.unknown";
}
