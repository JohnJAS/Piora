import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { listAllSessions } from "@/lib/session-reader";
import { readUsageStatistics, type UsageStatistics } from "@/lib/usage-statistics";
import { createAsyncSnapshotCache } from "@/lib/async-snapshot-cache";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 16;

declare global {
  var __pioraUsageSnapshots: ReturnType<typeof createAsyncSnapshotCache<UsageStatistics>> | undefined;
}

function cache() {
  return globalThis.__pioraUsageSnapshots ??= createAsyncSnapshotCache<UsageStatistics>(CACHE_TTL_MS, MAX_CACHE_ENTRIES);
}

function numericQuery(url: URL, key: string, fallback: number, min: number, max: number): number {
  const value = url.searchParams.get(key);
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    const url = new URL(request.url);
    const timezoneOffsetMinutes = numericQuery(url, "timezoneOffset", 0, -840, 840);
    const activityDays = numericQuery(url, "days", 365, 7, 730);
    const force = url.searchParams.get("refresh") === "1";
    const key = `periods-v1:${timezoneOffsetMinutes}:${activityDays}`;
    const value = await cache().get(key, async () => {
      const sessions = await listAllSessions();
      return readUsageStatistics(sessions.map(session => session.path), { timezoneOffsetMinutes, activityDays });
    }, force);
    return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
