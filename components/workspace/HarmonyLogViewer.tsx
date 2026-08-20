"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AliIcon } from "../AliIcon";
import styles from "./HarmonyPanel.module.css";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "unknown";
type DeviceProcess = { pid: number; name: string };
type LogEntry = { timestamp?: string; level: LogLevel; pid?: number; tid?: number; domain?: string; tag?: string; message: string; raw: string };

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } | string };
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(error || `Request failed (${response.status})`);
  }
  return payload;
}

export function HarmonyLogViewer({ active, serial, online, copy }: {
  active: boolean;
  serial: string;
  online: boolean;
  copy: (zh: string, en: string) => string;
}) {
  const [processes, setProcesses] = useState<DeviceProcess[]>([]);
  const [pid, setPid] = useState("");
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPid("");
    setEntries([]);
    if (!active || !online || !serial) {
      setProcesses([]);
      return;
    }
    const controller = new AbortController();
    void requestJson<{ processes: DeviceProcess[] }>(`/api/harmony/logs?action=processes&serial=${encodeURIComponent(serial)}`, controller.signal)
      .then((payload) => setProcesses(payload.processes))
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => controller.abort();
  }, [active, online, serial]);

  const loadLogs = useCallback(async (signal?: AbortSignal) => {
    if (!serial || !online) return;
    const params = new URLSearchParams({ action: "logs", serial, limit: "600" });
    if (pid) params.set("pid", pid);
    if (level) params.set("level", level);
    if (deferredQuery.trim()) params.set("query", deferredQuery.trim());
    setLoading(true);
    try {
      const payload = await requestJson<{ entries: LogEntry[] }>(`/api/harmony/logs?${params}`, signal);
      setEntries(payload.entries);
      setError(null);
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [deferredQuery, level, online, pid, serial]);

  useEffect(() => {
    if (!active || !online || !serial || paused) return;
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      await loadLogs(controller.signal);
      controller = undefined;
      if (!disposed) timer = window.setTimeout(() => { void poll(); }, document.hidden ? 4_000 : 1_000);
    };
    void poll();
    return () => {
      disposed = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, loadLogs, online, paused, refreshKey, serial]);

  useEffect(() => {
    const output = outputRef.current;
    if (output && !paused) output.scrollTop = output.scrollHeight;
  }, [entries, paused]);

  const selectedProcess = useMemo(() => processes.find((process) => String(process.pid) === pid), [pid, processes]);

  return <section className={styles.logViewer} aria-label={copy("设备日志", "Device logs")}>
    <div className={styles.logToolbar}>
      <select value={pid} onChange={(event) => setPid(event.target.value)} aria-label={copy("选择进程", "Select process")}>
        <option value="">{copy("所有进程", "All processes")}</option>
        {processes.map((process) => <option key={process.pid} value={process.pid}>{process.name} ({process.pid})</option>)}
      </select>
      <select value={level} onChange={(event) => setLevel(event.target.value)} aria-label={copy("日志级别", "Log level")}>
        <option value="">{copy("所有级别", "All levels")}</option>
        <option value="debug">Debug</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option><option value="fatal">Fatal</option>
      </select>
      <label className={styles.logSearch}>
        <AliIcon name="search" size={13} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy("筛选日志", "Filter logs")} aria-label={copy("筛选日志", "Filter logs")} />
      </label>
      <button className={styles.iconButton} type="button" onClick={() => setPaused((value) => !value)} aria-pressed={paused} title={paused ? copy("继续", "Resume") : copy("暂停", "Pause")}>
        <AliIcon name={paused ? "play" : "pause"} size={13} />
      </button>
      <button className={styles.iconButton} type="button" onClick={() => setRefreshKey((key) => key + 1)} title={copy("刷新日志", "Refresh logs")} aria-label={copy("刷新日志", "Refresh logs")}>
        <AliIcon name="reload" size={13} />
      </button>
    </div>
    <div className={styles.logMeta}>
      <span>{selectedProcess ? `${selectedProcess.name} · PID ${selectedProcess.pid}` : copy("所有进程", "All processes")}</span>
      <span>{entries.length} {copy("行", "lines")}{loading ? ` · ${copy("更新中", "updating")}` : ""}{paused ? ` · ${copy("已暂停", "paused")}` : ""}</span>
    </div>
    <div ref={outputRef} className={styles.logOutput} role="log" aria-live="off">
      {entries.length ? entries.map((entry, index) => <div className={styles.logLine} data-level={entry.level} key={`${entry.timestamp ?? ""}-${entry.pid ?? ""}-${index}`}>
        <span className={styles.logTime}>{entry.timestamp ?? ""}</span>
        <span className={styles.logLevel}>{entry.level === "unknown" ? "·" : entry.level.slice(0, 1).toUpperCase()}</span>
        <span className={styles.logPid}>{entry.pid ?? ""}</span>
        <span className={styles.logTag}>{entry.tag ?? entry.domain ?? ""}</span>
        <span className={styles.logMessage}>{entry.message}</span>
      </div>) : <div className={styles.logEmpty}>{online ? copy("没有匹配的日志", "No matching logs") : copy("请先连接设备", "Connect a device first")}</div>}
    </div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
  </section>;
}
