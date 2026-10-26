"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHarmonyWindow } from "@/hooks/useHarmonyWindow";
import { useHarmonyLiveFrame } from "@/hooks/useHarmonyLiveFrame";
import { useHarmonyMedia, harmonyJson } from "@/hooks/useHarmonyMedia";
import { useApplicationShortcuts } from "@/hooks/useApplicationShortcuts";
import { isMacPlatform, shortcutMatchesEvent, shouldPreserveApplicationShortcut } from "@/lib/keyboard-shortcuts";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { showPioraMessage } from "@/components/PioraMessage";
import { AliIcon } from "@/components/AliIcon";
import type { MirrorScale } from "@/desktop/src/harmony-window-types";
import styles from "./MirrorWindow.module.css";

type Device = { serial: string; name?: string; model?: string; state: string; generation: number; capabilities: Record<string, boolean> };
export function MirrorWindow() {
  useTheme();
  useFontPreferences();
  const { locale } = useI18n(); const chinese = locale === "zh-CN";
  const copy = useCallback((zh: string, en: string) => chinese ? zh : en, [chinese]);
  const state = useHarmonyWindow(); const serial = state?.serial ?? "";
  const [device, setDevice] = useState<Device | null>(null);
  const [deviceError, setDeviceError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { bindings } = useApplicationShortcuts();
  useEffect(() => {
    setDevice(null); if (!serial) return;
    const controller = new AbortController(); let pending = false;
    const load = async () => {
      if (pending) return; pending = true;
      try { const data = await harmonyJson<{ devices: Device[] }>("/api/harmony/devices", undefined, controller.signal);
        if (!controller.signal.aborted) { setDevice(data.devices.find(item => item.serial === serial) ?? null); setDeviceError(""); }
      } catch (error) { if (!controller.signal.aborted) setDeviceError(error instanceof Error ? error.message : String(error)); }
      finally { pending = false; }
    };
    void load(); const timer = setInterval(() => { void load(); }, 2500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [serial]);
  const live = useHarmonyLiveFrame({ active: Boolean(state?.open && !state.minimized), enabled: device?.state === "online", serial,
    generation: device?.generation, canvasRef, chinese, fallbackError: copy("画面连接失败", "Could not connect to the device") });
  const media = useHarmonyMedia(serial, state?.ownerId ?? "", Boolean(serial), chinese);
  const canScreenshot = device?.state === "online" && device.capabilities?.screenshot;
  const width = live.frame?.width, height = live.frame?.height;
  useEffect(() => {
    if (width && height) void window.piDesktop?.harmonyMirror?.reportFrame({ serial, width, height });
  }, [serial, width, height]);
  const record = useCallback(() => {
    if (media.recording && !media.ownsRecording) return;
    void media.action(media.recording?.systemRecorderStateUnknown ? "retrieve_recording" : media.recording ? "stop_recording" : "start_recording");
  }, [media]);
  const details = useCallback(() => { void showPioraMessage({ title: copy("连接详情", "Connection details"), tone: "info",
    message: `${device?.name ?? device?.model ?? serial}\n${live.mode === "video" ? copy("原生视频流", "Native video") : copy("截图兼容模式", "Screenshot fallback")}\n${live.frame ? `${live.frame.width} × ${live.frame.height}` : copy("尚无画面", "No frame")}\n${live.metrics ? `${live.metrics.fps} FPS · ${copy("主机绘制", "Host draw")} ${live.metrics.drawMs} ms\n${copy("绘制耗时不代表端到端延迟。", "Draw time is not end-to-end latency.")}` : ""}\n${live.fallbackReason ?? live.error ?? ""}`,
    actions: [{ id: "done", label: copy("确定", "OK"), primary: true }] }); }, [copy, device, serial, live]);
  useEffect(() => window.piDesktop?.harmonyMirror?.onCommand(command => {
    if (command === "screenshot" && canScreenshot) void media.action("capture_screenshot");
    if (command === "record") record();
    if (command === "reconnect") live.refresh();
    if (command === "details") details();
  }), [media, record, live, details, canScreenshot]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const binding = bindings["harmony.screenshot"];
      if (!binding || !canScreenshot || event.repeat || event.isComposing || shouldPreserveApplicationShortcut(event.target)) return;
      if (shortcutMatchesEvent(event, binding, isMacPlatform(window.piDesktop?.platform))) { event.preventDefault(); void media.action("capture_screenshot"); }
    };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [bindings, canScreenshot, media]);
  const clock = `${String(Math.floor(media.elapsed / 60)).padStart(2, "0")}:${String(media.elapsed % 60).padStart(2, "0")}`;
  return <div className={styles.root}>
    <header className={styles.titlebar}>
      <span className={styles.device} title={serial}>{device?.name ?? device?.model ?? copy("鸿蒙投屏", "Harmony mirror")}</span>
      {media.recording ? <span className={styles.recording} title={copy(`录屏 ${clock} · 最长30分钟`, `Recording ${clock} · 30 minute limit`)}>●<span className={styles.clock}>{clock}</span></span> : null}
      <select className={styles.scale} aria-label={copy("画面缩放", "Screen zoom")} value={state?.scale ?? 75} onChange={event => { void window.piDesktop?.harmonyMirror?.setScale(Number(event.target.value) as MirrorScale); }}>{[25, 50, 75, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select>
      <button className={styles.capture} disabled={!canScreenshot || Boolean(media.busy)} title={copy("截图", "Screenshot")} aria-label={copy("截图", "Screenshot")} onClick={() => { void media.action("capture_screenshot"); }}><AliIcon name="save" size={15} /></button>
      <button className={styles.record} disabled={media.transitioning || device?.state !== "online" || Boolean(media.recording && !media.ownsRecording)} title={media.recording ? copy("停止并保存", "Stop and save") : copy("录屏 · 最长30分钟", "Record · 30 minute limit")} aria-label={media.recording ? copy("停止录屏", "Stop recording") : copy("开始录屏", "Start recording")} onClick={record}><AliIcon name={media.recording ? "stop" : "play"} size={15} /></button>
      <button aria-label={copy("投屏菜单", "Mirror menu")} onClick={() => { void window.piDesktop?.harmonyMirror?.showMenu(); }}>⋯</button>
      <button aria-label={copy("关闭投屏", "Close mirror")} onClick={() => { void window.piDesktop?.harmonyMirror?.close(); }}><AliIcon name="close" size={14} /></button>
    </header>
    <main className={styles.screen}><canvas ref={canvasRef} role="img" aria-label={copy("手机画面", "Device screen")} />
      {device?.state !== "online" || live.status !== "live" ? <div className={styles.placeholder} role="status">{deviceError || (device?.state !== "online" ? copy("等待设备连接", "Waiting for device") : live.status === "error" ? copy("正在重新连接…", "Reconnecting…") : copy("正在连接画面…", "Connecting…"))}</div> : null}
    </main>
  </div>;
}
