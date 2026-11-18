import type { SessionInfo } from "./types";

export async function fetchSessionMetadata(ids: readonly string[], signal?: AbortSignal): Promise<SessionInfo[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += 128) chunks.push(unique.slice(start, start + 128));
  const pages = await Promise.all(chunks.map(async chunk => {
    const query = new URLSearchParams({ view: "metadata" });
    for (const id of chunk) query.append("sessionId", id);
    const response = await fetch("/api/sessions?" + query, { cache: "no-store", signal });
    const body = await response.json() as { sessions?: SessionInfo[]; error?: string };
    if (!response.ok) throw new Error(body.error || "HTTP " + response.status);
    return body.sessions ?? [];
  }));
  return pages.flat();
}
