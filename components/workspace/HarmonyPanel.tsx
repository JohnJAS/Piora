"use client";

/* Device frames are live, no-store screenshots; Next Image caching is intentionally not applicable. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useHarmonyLiveFrame } from "@/hooks/useHarmonyLiveFrame";
import { AliIcon } from "../AliIcon";
import styles from "./HarmonyPanel.module.css";

type RuntimeProfile = "normal" | "device-control";
type HarmonyDevice = {
  serial: string;
  state: "online" | "unauthorized" | "offline" | "unknown";
  name?: string;
  model?: string;
  osVersion?: string;
  generation: number;
  capabilities: Record<string, boolean>;
};
type PublicLease = { serial: string; owner: { kind: "agent" | "manual"; id: string; sessionId?: string }; expiresAt: string };
type HarmonyState = {
  runtime: { status: string; hdcPath?: string; error?: { code?: string; message?: string } };
  devices: HarmonyDevice[];
  leases: PublicLease[];
  snapshots: Array<{ serial: string; generation: number; revision: number; capturedAt: string; hasTree: boolean; hasScreenshot: boolean }>;
};
type ManualLease = { token: string; serial: string; expiresAt: string };
type RuntimeCandidate = { hdcPath: string; sdkPath: string; source: "selection" | "environment" | "config" | "deveco" | "path" };
type VisionModel = { provider: string; modelId: string; name: string };
type HarmonyConfig = {
  hdcPath?: string;
  vision?: { enabled: boolean; provider: string; modelId: string; shareScreenshotWithActionModel?: boolean };
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } | string } & T;
  if (!response.ok) {
    const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return payload;
}

export function HarmonyPanel({ active }: { active: boolean }) {
  const { locale } = useI18n();
  const chinese = locale === "zh-CN";
  const copy = useCallback((zh: string, en: string) => chinese ? zh : en, [chinese]);
  const [profile, setProfile] = useState<RuntimeProfile | "web">("web");
  const [devices, setDevices] = useState<HarmonyDevice[]>([]);
  const [managerState, setManagerState] = useState<HarmonyState | null>(null);
  const [selectedSerial, setSelectedSerial] = useState("");
  const [lease, setLease] = useState<ManualLease | null>(null);
  const [sdkPath, setSdkPath] = useState("");
  const [runtimeCandidates, setRuntimeCandidates] = useState<RuntimeCandidate[]>([]);
  const [visionModels, setVisionModels] = useState<VisionModel[]>([]);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visionModelKey, setVisionModelKey] = useState("");
  const [shareScreenshot, setShareScreenshot] = useState(false);
  const [diagnostics, setDiagnostics] = useState<unknown>(null);
  const [tree, setTree] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [bundleName, setBundleName] = useState("");
  const [abilityName, setAbilityName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameInteractionError, setFrameInteractionError] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const ownerIdRef = useRef("");
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLImageElement>(null);
  const leaseRef = useRef<ManualLease | null>(null);

  useEffect(() => {
    const ownerKey = "piora-harmony-manual-owner-v1";
    let existingOwner: string | null = null;
    try { existingOwner = window.sessionStorage.getItem(ownerKey); } catch { /* Storage may be unavailable in hardened webviews. */ }
    ownerIdRef.current = existingOwner && /^manual:[A-Za-z0-9-]{1,80}$/.test(existingOwner)
      ? existingOwner
      : `manual:${crypto.randomUUID()}`;
    try { window.sessionStorage.setItem(ownerKey, ownerIdRef.current); } catch { /* The in-memory identity still works. */ }
    void jsonRequest<{ profile: RuntimeProfile }>("/api/harmony/profile")
      .then((result) => setProfile(result.profile))
      .catch(() => setProfile(window.piDesktop ? "normal" : "web"));
  }, []);

  const selected = useMemo(
    () => devices.find((device) => device.serial === selectedSerial) ?? null,
    [devices, selectedSerial],
  );
  const selectedOnline = selected?.state === "online";
  const selectedGeneration = selected?.generation;
  const canScreenshot = Boolean(selectedOnline && selected?.capabilities.screenshot);
  const {
    frame: liveFrame,
    status: frameStatus,
    error: frameLoadError,
    refresh: requestFrame,
  } = useHarmonyLiveFrame({
    active: active && profile === "device-control",
    enabled: canScreenshot,
    serial: selectedSerial,
    generation: selectedGeneration,
    fallbackError: copy("投屏暂不可用，请检查设备授权与 HDC。", "Live view unavailable. Check device authorization and HDC."),
  });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (profile !== "device-control") return;
    try {
      const devicePayload = await jsonRequest<{ devices: HarmonyDevice[]; state: HarmonyState }>("/api/harmony/devices", { signal });
      setDevices(devicePayload.devices);
      setManagerState(devicePayload.state);
      setSelectedSerial((current) => current && devicePayload.devices.some((device) => device.serial === current)
        ? current
        : devicePayload.devices.find((device) => device.state === "online")?.serial ?? devicePayload.devices[0]?.serial ?? "");
      setError(null);
    } catch (refreshError) {
      if (signal?.aborted) return;
      setError(messageOf(refreshError, copy("无法读取设备状态", "Unable to read device state")));
    }
  }, [copy, profile]);

  const loadConfig = useCallback(async () => {
    if (profile !== "device-control") return;
    try {
      const [payload, modelPayload] = await Promise.all([
        jsonRequest<{ config: HarmonyConfig; diagnostics: HarmonyState & { runtime?: { hdcPath?: string } }; candidates: RuntimeCandidate[] }>("/api/harmony/config"),
        jsonRequest<{ models: VisionModel[]; error?: string }>("/api/harmony/vision-models"),
      ]);
      const candidates = payload.candidates ?? [];
      setRuntimeCandidates(candidates);
      setSdkPath(payload.config.hdcPath ?? payload.diagnostics?.runtime?.hdcPath ?? candidates[0]?.hdcPath ?? "");
      setVisionModels(modelPayload.models ?? []);
      const vision = payload.config.vision;
      setVisionEnabled(Boolean(vision?.enabled));
      setVisionModelKey(vision ? `${vision.provider}\u0000${vision.modelId}` : "");
      setShareScreenshot(Boolean(vision?.shareScreenshotWithActionModel));
      setDiagnostics(payload.diagnostics);
    } catch (configError) {
      setError(messageOf(configError, copy("无法读取 SDK 配置", "Unable to read SDK configuration")));
    }
  }, [copy, profile]);

  useEffect(() => {
    if (!active || profile !== "device-control") return;
    void loadConfig();
    let pollTimer: number | undefined;
    let pollController: AbortController | undefined;
    let disposed = false;
    const poll = async () => {
      pollController = new AbortController();
      await refresh(pollController.signal).catch(() => undefined);
      pollController = undefined;
      if (!disposed) pollTimer = window.setTimeout(() => { void poll(); }, 5_000);
    };
    void poll();
    const source = new EventSource("/api/harmony/events");
    source.onmessage = (event) => {
      try {
        const metadata = JSON.parse(event.data) as {
          type?: string;
          serial?: string;
          devices?: HarmonyDevice[];
          state?: HarmonyState;
        };
        if (metadata.type === "devices" && Array.isArray(metadata.devices)) {
          setDevices(metadata.devices);
          setSelectedSerial((current) => current && metadata.devices?.some((device) => device.serial === current)
            ? current
            : metadata.devices?.find((device) => device.state === "online")?.serial ?? metadata.devices?.[0]?.serial ?? "");
        } else if (metadata.type === "state" && metadata.state) {
          setManagerState(metadata.state);
        } else if (metadata.type !== "connected" && metadata.type !== "heartbeat" && metadata.type !== "snapshot") {
          void jsonRequest<{ state: HarmonyState }>(`/api/harmony/state${selectedSerial ? `?serial=${encodeURIComponent(selectedSerial)}` : ""}`)
            .then((payload) => setManagerState(payload.state))
            .catch(() => undefined);
        }
      } catch {
        // A malformed metadata event cannot affect the device command path.
      }
    };
    source.onerror = () => { /* Polling below remains the recovery path. */ };
    return () => {
      disposed = true;
      source.close();
      pollController?.abort();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [active, loadConfig, profile, refresh, selectedSerial]);

  useEffect(() => {
    if (!lease) return;
    const timer = window.setInterval(() => {
      void jsonRequest<{ lease: ManualLease }>("/api/harmony/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "renew", leaseToken: lease.token }),
      }).then((payload) => setLease(payload.lease)).catch(() => setLease(null));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [lease]);

  useEffect(() => {
    leaseRef.current = lease;
  }, [lease]);

  useEffect(() => {
    const releaseCurrentLease = () => {
      const current = leaseRef.current;
      if (!current) return;
      leaseRef.current = null;
      void fetch("/api/harmony/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", leaseToken: current.token }),
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", releaseCurrentLease);
    return () => {
      window.removeEventListener("pagehide", releaseCurrentLease);
      releaseCurrentLease();
    };
  }, []);

  useEffect(() => {
    if (active || !lease) return;
    const token = lease.token;
    setLease(null);
    void jsonRequest("/api/harmony/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", leaseToken: token }),
      keepalive: true,
    }).catch(() => undefined);
  }, [active, lease]);

  const run = useCallback(async <T,>(operation: () => Promise<T>, after?: (value: T) => void) => {
    setBusy(true);
    try {
      const value = await operation();
      after?.(value);
      setError(null);
      return value;
    } catch (operationError) {
      setError(messageOf(operationError, copy("设备操作失败", "Device operation failed")));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [copy]);

  const chooseRuntimePath = useCallback(async (kind: "sdk" | "hdc") => {
    const selectedPath = await window.piDesktop?.selectHarmonyRuntimePath?.(kind);
    if (!selectedPath) return;
    await run(async () => {
      const payload = await jsonRequest<{ candidates: RuntimeCandidate[] }>("/api/harmony/runtime-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectionPath: selectedPath }),
      });
      const selected = payload.candidates.find((candidate) => candidate.source === "selection");
      if (!selected) throw new Error(copy("所选位置中没有找到 hdc", "No hdc executable was found in the selected location"));
      setRuntimeCandidates(payload.candidates);
      setSdkPath(selected.hdcPath);
    });
  }, [copy, run]);

  const acquire = () => selectedSerial && void run(
    () => jsonRequest<{ lease: ManualLease }>("/api/harmony/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acquire", serial: selectedSerial, ownerId: ownerIdRef.current }),
    }),
    (payload) => setLease(payload.lease),
  );

  const release = () => lease && void run(
    () => jsonRequest("/api/harmony/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", leaseToken: lease.token }),
    }),
    () => setLease(null),
  );

  const action = (input: Record<string, unknown>) => {
    if (!selectedSerial || !lease) return Promise.resolve(undefined);
    return run(() => jsonRequest("/api/harmony/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial: selectedSerial, leaseToken: lease.token, ...input }),
    }), () => {
      requestFrame();
      void refresh();
    });
  };

  const imagePoint = (event: React.PointerEvent<HTMLImageElement>) => {
    const image = frameRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return null;
    const bounds = image.getBoundingClientRect();
    const x = Math.round(((event.clientX - bounds.left) / bounds.width) * image.naturalWidth);
    const y = Math.round(((event.clientY - bounds.top) / bounds.height) * image.naturalHeight);
    if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return null;
    return { x, y };
  };

  const switchProfile = (target: RuntimeProfile) => void run(async () => {
    const result = await window.piDesktop?.requestRuntimeProfileSwitch?.(target);
    if (!result) throw new Error(copy("请使用 Piora 桌面版", "Use the Piora desktop app"));
    if (!result.accepted) {
      if (result.error) throw new Error(result.error);
      return result;
    }
    setProfile(result.profile);
    return result;
  });

  if (profile !== "device-control") {
    return <div className={styles.gate}>
      <AliIcon name="mobile" size={34} />
      <h2>{copy("鸿蒙设备控制", "Harmony device control")}</h2>
      <p>{profile === "web"
        ? copy("该能力仅在 Piora 桌面应用中提供。", "This capability is available only in the Piora desktop app.")
        : copy("为隔离普通编码会话，设备自动化需要切换到专用模式。切换会停止当前 AI 任务并重启本地服务。", "Device automation uses an isolated runtime profile. Switching stops current AI tasks and restarts the local service.")}</p>
      {profile === "normal" ? <button type="button" className={styles.primary} disabled={busy} onClick={() => switchProfile("device-control")}>
        {copy("切换到设备控制模式", "Switch to device-control mode")}
      </button> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </div>;
  }

  const snapshot = managerState?.snapshots.find((item) => item.serial === selectedSerial);
  const holder = managerState?.leases.find((item) => item.serial === selectedSerial);
  const frameMatchesDevice = Boolean(liveFrame && selected && liveFrame.serial === selected.serial && liveFrame.generation === selected.generation);
  const frameUrl = active && canScreenshot && frameMatchesDevice ? liveFrame?.url ?? "" : "";
  const frameError = frameInteractionError ?? frameLoadError;
  const ownsRecoverableLease = Boolean(holder?.owner.kind === "manual" && holder.owner.id === ownerIdRef.current);
  const canPointControl = Boolean(lease?.serial === selectedSerial && frameStatus === "live" && frameMatchesDevice && selected?.capabilities.tap);

  return <div className={styles.root}>
    <header className={styles.header}>
      <div><strong>{copy("鸿蒙设备", "Harmony device")}</strong><span>{managerState?.runtime.status ?? "…"}</span></div>
      <div className={styles.headerActions}>
        <button type="button" onClick={() => { requestFrame(); void refresh(); }} disabled={busy} title={copy("刷新", "Refresh")}><AliIcon name="reload" size={14} /></button>
        <button type="button" onClick={() => switchProfile("normal")}>{copy("退出控制模式", "Leave control mode")}</button>
      </div>
    </header>

    <section className={styles.settingsStack}>
      <div className={styles.settings}>
        <label><span>{copy("已选择的 HDC", "Selected HDC")}</span><input value={sdkPath} placeholder="C:\\...\\hdc.exe" onChange={(event) => setSdkPath(event.target.value)} /></label>
        <div className={styles.settingActions}>
          <button type="button" disabled={busy} onClick={() => void chooseRuntimePath("sdk")}>{copy("选择 SDK 文件夹", "Choose SDK folder")}</button>
          <button type="button" disabled={busy} onClick={() => void chooseRuntimePath("hdc")}>{copy("选择 hdc.exe", "Choose hdc.exe")}</button>
          <button type="button" disabled={busy} onClick={() => void run(
            () => jsonRequest<{ config: HarmonyConfig; diagnostics: unknown; candidates: RuntimeCandidate[] }>("/api/harmony/config", {
              method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hdcPath: sdkPath.trim() || null }),
            }),
            (payload) => { setSdkPath(payload.config.hdcPath ?? payload.candidates[0]?.hdcPath ?? ""); setRuntimeCandidates(payload.candidates); setDiagnostics(payload.diagnostics); void refresh(); },
          )}>{copy("保存并重新检测", "Save and rediscover")}</button>
        </div>
      </div>
      {runtimeCandidates.length ? <div className={styles.candidates}>
        <span>{copy("自动检测结果", "Detected installations")}</span>
        {runtimeCandidates.map((candidate) => <button type="button" key={candidate.hdcPath} data-selected={candidate.hdcPath === sdkPath} onClick={() => setSdkPath(candidate.hdcPath)}>
          <strong>{candidate.source}</strong><span>{candidate.hdcPath}</span><small>SDK: {candidate.sdkPath}</small>
        </button>)}
      </div> : <div className={styles.hint}>{copy("未自动找到 HDC，请选择 DevEco SDK 文件夹或 hdc.exe。", "HDC was not found automatically. Choose a DevEco SDK folder or hdc executable.")}</div>}
      <div className={styles.visionSettings}>
        <label className={styles.check}><input type="checkbox" checked={visionEnabled} onChange={(event) => setVisionEnabled(event.target.checked)} />{copy("启用独立视觉模型读取手机截图", "Use a separate vision model for phone screenshots")}</label>
        <select value={visionModelKey} onChange={(event) => setVisionModelKey(event.target.value)} disabled={!visionEnabled}>
          <option value="">{copy("选择视觉模型", "Select vision model")}</option>
          {visionModelKey && !visionModels.some((model) => `${model.provider}\u0000${model.modelId}` === visionModelKey)
            ? <option value={visionModelKey}>{copy("已配置但当前不可用", "Configured but currently unavailable")} · {visionModelKey.replace("\u0000", "/")}</option>
            : null}
          {visionModels.map((model) => <option key={`${model.provider}\u0000${model.modelId}`} value={`${model.provider}\u0000${model.modelId}`}>{model.name} · {model.provider}/{model.modelId}</option>)}
        </select>
        <label className={styles.check}><input type="checkbox" checked={shareScreenshot} disabled={!visionEnabled} onChange={(event) => setShareScreenshot(event.target.checked)} />{copy("同时把原始截图发送给操作模型（默认关闭）", "Also send the raw screenshot to the action model (off by default)")}</label>
        <button type="button" disabled={busy || (visionEnabled && !visionModelKey)} onClick={() => void run(async () => {
          const [provider, modelId] = visionModelKey.split("\u0000");
          const payload = await jsonRequest<{ config: HarmonyConfig; diagnostics: unknown; candidates: RuntimeCandidate[] }>("/api/harmony/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vision: visionEnabled ? { enabled: true, provider, modelId, shareScreenshotWithActionModel: shareScreenshot } : null }),
          });
          setDiagnostics(payload.diagnostics);
          return payload;
        })}>{copy("保存视觉分工", "Save model routing")}</button>
        <p>{copy("截图只发送给所选视觉模型；操作模型默认只收到 UI 树和视觉观察文本。右侧投屏始终在本机获取。", "Screenshots go only to the selected vision model; the action model receives the UI tree and observation text by default. The right-side live view remains local.")}</p>
      </div>
    </section>

    <div className={styles.deviceBar}>
      <select aria-label={copy("选择设备", "Select device")} value={selectedSerial} onChange={(event) => {
        const nextSerial = event.target.value;
        if (lease) {
          const token = lease.token;
          setLease(null);
          void jsonRequest("/api/harmony/manual", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", leaseToken: token }),
          }).catch(() => undefined);
        }
        setSelectedSerial(nextSerial);
        setTree(null);
        setFrameSize(null);
      }}>
        {!devices.length ? <option value="">{copy("未检测到设备", "No device detected")}</option> : null}
        {devices.map((device) => <option key={device.serial} value={device.serial}>{device.name || device.model || device.serial} · {device.state}</option>)}
      </select>
      {lease?.serial === selectedSerial
        ? <button type="button" onClick={release}>{copy("释放手动控制", "Release manual control")}</button>
        : <button type="button" disabled={!selected || selected.state !== "online" || (Boolean(holder) && !ownsRecoverableLease)} onClick={acquire}>
          {ownsRecoverableLease ? copy("恢复手动控制", "Resume manual control") : copy("取得手动控制", "Acquire manual control")}
        </button>}
      <button className={styles.stop} type="button" onClick={() => void run(
        () => jsonRequest("/api/harmony/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "emergency_stop", reason: "desktop-panel" }) }),
        () => { setLease(null); void refresh(); },
      )}>{copy("急停", "STOP")}</button>
    </div>
    {holder ? <div className={styles.lease}>{copy("当前控制者", "Current holder")}: {holder.owner.kind === "agent" ? "AI" : copy("手动面板", "manual panel")} · {new Date(holder.expiresAt).toLocaleTimeString()}</div> : null}

    <div className={styles.deviceArea}>
      <div className={styles.frame} data-enabled={canPointControl ? "true" : "false"}>
        {canScreenshot ? <div className={styles.frameStatus} data-status={frameStatus} aria-live="polite">
          <span />{frameStatus === "error" ? copy("投屏重连中", "Reconnecting") : frameStatus === "loading" ? copy("投屏更新中", "Updating") : copy("实时投屏", "Live view")}
          {frameSize ? ` · ${frameSize.width}×${frameSize.height}` : ""}
        </div> : null}
        {frameUrl ? <img
          ref={frameRef}
          src={frameUrl}
          alt={copy("手机实时截图", "Live device screenshot")}
          draggable={false}
          onLoad={() => {
            const image = frameRef.current;
            setFrameSize(image ? { width: image.naturalWidth, height: image.naturalHeight } : null);
            setFrameInteractionError(null);
          }}
          onError={() => {
            setFrameInteractionError(copy("投屏图片无法解码，正在重试。", "The live-view image could not be decoded; retrying."));
          }}
          onPointerDown={(event) => {
            if (!canPointControl) return;
            pointerStartRef.current = imagePoint(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const from = pointerStartRef.current;
            const to = imagePoint(event);
            pointerStartRef.current = null;
            if (!from || !to || !lease || !liveFrame || !frameMatchesDevice) return;
            const distance = Math.hypot(to.x - from.x, to.y - from.y);
            if (distance > 12 && !selected?.capabilities.swipe) {
              setFrameInteractionError(copy("当前设备不支持滑动注入。", "This device does not support swipe injection."));
              return;
            }
            void action(distance > 12
              ? { action: "swipe", fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, durationMs: 300, generation: liveFrame.generation }
              : { action: "tap", x: to.x, y: to.y, generation: liveFrame.generation });
          }}
        /> : <div>{selectedOnline && !selected?.capabilities.screenshot
          ? copy("当前 UiTest 版本不支持截图投屏", "This UiTest version does not support screen capture")
          : copy("连接设备后显示截图", "Connect a device to view its screen")}</div>}
      </div>
      <aside className={styles.controls}>
        <div className={styles.keyRow}>
          {(["back", "home", "recents"] as const).map((key) => <button key={key} type="button" disabled={!lease || busy || !selected?.capabilities.keys} onClick={() => void action({ action: "press_key", key })}>{key}</button>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (text) void action({ action: "input_text", text }).then((result) => { if (result !== undefined) setText(""); }); }}>
          <label>{copy("文本输入（内容不会写入日志）", "Text input (never logged)")}<textarea value={text} onChange={(event) => setText(event.target.value)} /></label>
          <button type="submit" disabled={!lease || !text || busy || !selected?.capabilities.inputText}>{copy("输入到手机", "Type on device")}</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); if (bundleName) void action({ action: "launch_app", bundleName, abilityName: abilityName || undefined }); }}>
          <label>Bundle<input value={bundleName} onChange={(event) => setBundleName(event.target.value)} placeholder="com.example.app" /></label>
          <label>Ability<input value={abilityName} onChange={(event) => setAbilityName(event.target.value)} /></label>
          <button type="submit" disabled={!lease || !bundleName || busy || !selected?.capabilities.launchApp}>{copy("启动应用", "Launch app")}</button>
        </form>
        <div className={styles.inspectRow}>
          <button type="button" disabled={!canScreenshot || busy} onClick={requestFrame}>{copy("刷新投屏", "Refresh live view")}</button>
          <button type="button" disabled={!selectedOnline || busy || !selected?.capabilities.uiTree} onClick={() => void run(
            () => jsonRequest<{ snapshot: unknown }>(`/api/harmony/tree?serial=${encodeURIComponent(selectedSerial)}`),
            (payload) => setTree(payload.snapshot),
          )}>{copy("读取 UI 树", "Read UI tree")}</button>
        </div>
      </aside>
    </div>

    {frameError ? <div className={styles.frameError} role="status">{frameError}</div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    <details className={styles.diagnostics}>
      <summary>{copy("诊断信息", "Diagnostics")}</summary>
      <pre>{JSON.stringify({ selected, holder, snapshot, diagnostics, tree }, null, 2)}</pre>
    </details>
    <footer>{copy("AI 每次取得控制权都会显示 Piora 确认；同一设备同时只允许一个控制者。", "Each AI control request requires a Piora confirmation; one device has only one controller at a time.")}</footer>
  </div>;
}
