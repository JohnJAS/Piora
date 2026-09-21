"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import styles from "./HarmonyCheckPanel.module.css";

type Diagnostic = {
  source: "arkts" | "lint";
  file: string;
  relativeFile: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "suggestion" | "info";
  code?: string;
  rule?: string;
  message: string;
};
type Step = { kind: "arkts" | "lint"; status: string; durationMs: number; filesChecked?: number; message?: string };
type Report = {
  id: string;
  status: "passed" | "issues" | "incomplete" | "cancelled";
  completedAt: string;
  durationMs: number;
  stale?: boolean;
  diagnostics: Diagnostic[];
  checks: Step[];
  summary: { errors: number; warnings: number; suggestions: number; info: number; total: number };
};
type Payload = {
  environment?: { ready: boolean; cliVersion: string; studioPath?: string; studioVersion?: string; error?: string };
  config?: { arktsEnabled: boolean; lintEnabled: boolean };
  report?: Report | null;
  error?: string | { message?: string };
};

function requestError(payload: Payload, status: number): string {
  return typeof payload.error === "string" ? payload.error : payload.error?.message || `HTTP ${status}`;
}

export function HarmonyCheckPanel({ active, cwd, onOpenFile, onGuideAgent }: {
  active: boolean;
  cwd?: string | null;
  onOpenFile?: (path: string, line: number) => void;
  onGuideAgent?: (prompt?: string) => void;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const copy = useCallback((cn: string, en: string) => zh ? cn : en, [zh]);
  const [payload, setPayload] = useState<Payload>({});
  const [arkts, setArkts] = useState(true);
  const [lint, setLint] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!cwd) { setPayload({}); return; }
    try {
      const response = await fetch(`/api/harmony/check?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const next = await response.json() as Payload;
      if (!response.ok) throw new Error(requestError(next, response.status));
      setPayload(next);
      setArkts(next.config?.arktsEnabled !== false);
      setLint(next.config?.lintEnabled !== false);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [cwd]);

  useEffect(() => { if (active) void load(); }, [active, load]);
  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    if (!cwd || (!arkts && !lint)) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRunning(true); setError("");
    try {
      const response = await fetch("/api/harmony/check", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: current.signal,
        body: JSON.stringify({ projectRoot: cwd, checks: [...(arkts ? ["arkts"] : []), ...(lint ? ["lint"] : [])] }),
      });
      const next = await response.json() as { report?: Report; error?: Payload["error"] };
      if (!response.ok || !next.report) throw new Error(requestError(next, response.status));
      setPayload((before) => ({ ...before, report: next.report }));
    } catch (reason) {
      if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (controller.current === current) { controller.current = null; setRunning(false); } }
  };

  const report = payload.report;
  const grouped = useMemo(() => {
    const map = new Map<string, Diagnostic[]>();
    for (const item of report?.diagnostics ?? []) map.set(item.relativeFile, [...(map.get(item.relativeFile) ?? []), item]);
    return [...map];
  }, [report]);
  const statusLabel = report?.status === "passed" ? copy("检查通过", "Checks passed")
    : report?.status === "issues" ? copy("发现代码问题", "Code issues found")
      : report?.status === "incomplete" ? copy("检查未完成", "Check incomplete")
        : report?.status === "cancelled" ? copy("已取消", "Cancelled") : copy("尚未检查", "Not checked");

  if (!cwd) return <div className={styles.empty}><AliIcon name="code" size={28} /><strong>{copy("请选择鸿蒙项目", "Select a Harmony project")}</strong><span>{copy("项目需要包含根级 build-profile.json5。", "The project needs a root build-profile.json5.")}</span></div>;

  return <div className={styles.root}>
    <section className={styles.environment} data-ready={payload.environment?.ready ? "true" : "false"}>
      <AliIcon name={payload.environment?.ready ? "check-circle" : "warning"} size={15} />
      <span><strong>{payload.environment?.ready ? copy("DevEco 工具链已就绪", "DevEco toolchain ready") : copy("DevEco 工具链未就绪", "DevEco toolchain unavailable")}</strong>
        <small>{payload.environment?.ready
          ? `CLI ${payload.environment.cliVersion} · DevEco Studio ${payload.environment.studioVersion ?? ""}`
          : payload.environment?.error ?? copy("正在检测环境…", "Detecting environment…")}</small></span>
    </section>
    <div className={styles.toolbar}>
      <label><input type="checkbox" checked={arkts} onChange={(event) => setArkts(event.target.checked)} />ArkTS {copy("语法/语义", "syntax/semantics")}</label>
      <label><input type="checkbox" checked={lint} onChange={(event) => setLint(event.target.checked)} />Code Linter</label>
      <button type="button" disabled={running || !payload.environment?.ready || (!arkts && !lint)} onClick={() => void run()}>
        <AliIcon name={running ? "reload" : "play"} size={13} />{running ? copy("正在检查…", "Checking…") : copy("立即检查", "Run checks")}
      </button>
      {running ? <button type="button" onClick={() => controller.current?.abort()}>{copy("取消", "Cancel")}</button> : null}
    </div>
    <section className={styles.summary} data-status={report?.status ?? "none"}>
      <div><strong>{statusLabel}{report?.stale ? ` · ${copy("结果已过期", "stale")}` : ""}</strong>
        <small>{report ? `${new Date(report.completedAt).toLocaleString()} · ${(report.durationMs / 1000).toFixed(1)}s` : copy("运行检查后，问题会按文件列在这里。", "Run checks to list issues by file.")}</small></div>
      {report ? <div className={styles.counts}><span>{report.summary.errors} {copy("错误", "errors")}</span><span>{report.summary.warnings} {copy("警告", "warnings")}</span><span>{report.summary.suggestions} {copy("建议", "suggestions")}</span></div> : null}
      {report?.status === "issues" && onGuideAgent ? <button type="button" onClick={() => onGuideAgent(copy(
        "请读取鸿蒙代码检查结果，逐项修复 ArkTS 与 Code Linter 问题，然后调用 piora_harmony_check 复查，直到通过；如果工具返回 incomplete，请明确报告环境问题。",
        "Read the Harmony code-check report, fix each ArkTS and Code Linter diagnostic, then call piora_harmony_check until it passes. If the tool returns incomplete, report the environment problem clearly.",
      ))}><AliIcon name="robot" size={13} />{copy("让 Agent 修复", "Ask Agent to fix")}</button> : null}
    </section>
    {report?.checks.some((step) => step.message) ? <div className={styles.stepMessages}>{report.checks.filter((step) => step.message).map((step) => <p key={step.kind}><strong>{step.kind}</strong> · {step.message}</p>)}</div> : null}
    <div className={styles.diagnostics}>
      {grouped.map(([file, items]) => <section key={file}>
        <button type="button" className={styles.file} onClick={() => onOpenFile?.(items[0].file, items[0].line)}>{file}<span>{items.length}</span></button>
        {items.map((item, index) => <button key={`${item.source}:${item.line}:${item.column}:${index}`} type="button" className={styles.issue} data-severity={item.severity} onClick={() => onOpenFile?.(item.file, item.line)}>
          <span className={styles.location}>{item.line}:{item.column}</span><span className={styles.source}>{item.source}{item.rule || item.code ? ` · ${item.rule ?? item.code}` : ""}</span><span>{item.message}</span>
        </button>)}
      </section>)}
      {report && !report.diagnostics.length && report.status === "passed" ? <div className={styles.clean}><AliIcon name="check-circle" size={25} /><span>{copy("没有发现 ArkTS 或代码规范问题。", "No ArkTS or code-style issues were found.")}</span></div> : null}
    </div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
  </div>;
}
