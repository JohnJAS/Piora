"use client";
import { useEffect, useRef, useState } from "react";
import type { HarmonyScenarioStep } from "@/lib/harmony/types";

interface Template { id: string; title: string; version: number; parameters: Record<string, string | number> }
export function ScenarioWorkbench({ serial, leaseToken, cwd, chinese }: { serial: string; leaseToken?: string; cwd?: string | null; chinese: boolean }) {
  const [templates, setTemplates] = useState<Template[]>([]), [templateId, setTemplateId] = useState("");
  const [parameters, setParameters] = useState("{}"), [steps, setSteps] = useState<HarmonyScenarioStep[]>([]);
  const [hap, setHap] = useState(""), [bundle, setBundle] = useState("");
  const [busy, setBusy] = useState(false), [result, setResult] = useState(""), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const copy = (zh: string, en: string) => chinese ? zh : en;
  useEffect(() => () => controller.current?.abort(), []);
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(path, { signal: controller.current?.signal, cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? data.error ?? `HTTP ${response.status}`); return data;
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return; const current = new AbortController(); controller.current = current; setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(current.signal.aborted ? copy("已请求取消，请查看设备清理状态。", "Cancellation requested; check device cleanup state.") : String(reason)); }
    finally { if (controller.current === current) { controller.current = null; setBusy(false); } }
  };
  const compile = async () => { const data = await request("/api/harmony/templates", { id: templateId, parameters: JSON.parse(parameters) }); setSteps(data.steps); return data.steps; };
  return <section aria-label={copy("场景与工程验证", "Scenario and project validation")}>
    <button disabled={busy} onClick={() => void run(async () => setTemplates((await request("/api/harmony/templates")).templates))}>{copy("读取场景模板", "Load scenario templates")}</button>
    <label>{copy("场景", "Scenario")}<select value={templateId} onChange={event => { const template = templates.find(value => value.id === event.target.value); setTemplateId(event.target.value); setParameters(JSON.stringify(template?.parameters ?? {}, null, 2)); setSteps([]); }}>
      <option value="">{copy("选择模板", "Select template")}</option>{templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}
    </select></label>
    <label style={{ display: "block" }}>{copy("场景参数（按住说话须使用已验证的对应配置）", "Parameters (push-to-talk requires its verified profile)")}<textarea value={parameters} onChange={event => { setParameters(event.target.value); setSteps([]); }} rows={6} style={{ width: "100%" }}/></label>
    <button disabled={busy || !templateId} onClick={() => void run(async () => { await compile(); })}>{copy("检查参数并预览步骤", "Validate and preview steps")}</button>
    {steps.length ? <pre style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{JSON.stringify(steps, null, 2)}</pre> : null}
    <button disabled={busy || !leaseToken || !steps.length} onClick={() => void run(async () => { const data = await request("/api/harmony/scenario", { serial, leaseToken, steps: await compile() }); setResult(JSON.stringify(data.result, null, 2)); })}>{copy("执行已预览场景", "Run previewed scenario")}</button>
    <details><summary>{copy("工程检查 → 安装 → 场景 → 日志", "Project checks → install → scenario → logs")}</summary>
      <p>{copy("当前工程", "Current project")}: {cwd || copy("请先选择工程", "Select a project first")}</p>
      <label>{copy("该工程的 HAP 完整路径", "Full HAP path from this project")}<input value={hap} onChange={event => setHap(event.target.value)} style={{ width: "100%" }}/></label>
      <label>{copy("启动包名", "Bundle to launch")}<input value={bundle} onChange={event => setBundle(event.target.value)} style={{ width: "100%" }}/></label>
      <p>{copy("先运行当前工程 ArkTS 与 lint。安装前须批准所选制品的 SHA-256；拒绝后停止。报告来源为 CLI 与设备日志。", "Runs current-project ArkTS and lint first. Installation requires approval of the selected artifact SHA-256. Report sources are CLI checks and device logs.")}</p>
      <button disabled={busy || !cwd || !leaseToken || !steps.length || !hap || !bundle} onClick={() => void run(async () => { const data = await request("/api/harmony/validate", { projectRoot: cwd, hapPath: hap, bundleName: bundle, serial, leaseToken, steps: await compile() }); setResult(JSON.stringify(data.result, null, 2)); })}>{copy("运行验证链", "Run validation chain")}</button>
      <button disabled={busy || !cwd} onClick={() => void run(async () => { const data = await request(`/api/harmony/validate?projectRoot=${encodeURIComponent(cwd!)}`); setResult(JSON.stringify(data.reports, null, 2)); })}>{copy("读取该工程验证记录", "Load project validation reports")}</button>
    </details>
    {busy ? <button onClick={() => controller.current?.abort()}>{copy("取消本次操作", "Cancel this operation")}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result ? <pre aria-label={copy("验证结果", "Validation result")} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 300, overflow: "auto" }}>{result}</pre> : null}
  </section>;
}
