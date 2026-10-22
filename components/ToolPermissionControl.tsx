"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { PERMISSION_MODES, type PermissionMode, type ToolPermissionState } from "@/lib/tool-permission-policy";
import styles from "./ToolPermissionControl.module.css";

export function ToolPermissionControl({ state, saving, onChange }: {
  state: ToolPermissionState | null; saving?: boolean; onChange: (mode: PermissionMode) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const disabled = !state || saving;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 16);
      const above = rect.top > window.innerHeight - rect.bottom;
      setPosition({ position: "fixed", width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(above ? { bottom: window.innerHeight - rect.top + 7 } : { top: rect.bottom + 7 }),
        maxHeight: Math.max(80, (above ? rect.top : window.innerHeight - rect.bottom) - 15) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <>
  <button ref={trigger} type="button" data-permission-trigger
    className={`model-settings-trigger ${styles.control}${open ? " is-open" : ""}${state?.mode === "full" && !state.legacy ? ` ${styles.full}` : ""}`}
    aria-label={t("permission.label")} aria-haspopup="menu" aria-expanded={open && !disabled} aria-controls={open ? id : undefined}
    disabled={disabled} title={t(state?.legacy ? "permission.legacyHelp" : `permission.${state?.mode ?? "auto"}Help`)}
    onClick={() => setOpen(!open)}>
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z" /></svg>
    <span className="model-settings-trigger-label">{t(!state ? "permission.loading" : state.legacy ? "permission.legacy" : `permission.${state.mode}`)}</span>
  </button>
  {open && !disabled && createPortal(<div ref={panel} id={id} role="menu" aria-label={t("permission.label")}
    className={`model-settings-popover ${styles.menu}`} style={position}
    onKeyDown={event => {
      if (event.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const options = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>("button"));
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    }}>
    {state?.legacy && <p className={styles.legacy}>{t("permission.legacyHelp")}</p>}
    {PERMISSION_MODES.map(mode => <button key={mode} type="button" role="menuitemradio" data-mode={mode}
      aria-checked={!state?.legacy && state?.mode === mode}
      className={`model-settings-row ${styles.option}${mode === "full" ? ` ${styles.full}` : ""}`}
      onClick={() => { setOpen(false); trigger.current?.focus(); onChange(mode); }}>
      <span className={styles.copy}><span>{t(`permission.${mode}`)}</span><small>{t(`permission.${mode}Help`)}</small></span>
      <span className={styles.check} aria-hidden="true">{!state?.legacy && state?.mode === mode ? "✓" : ""}</span>
    </button>)}
  </div>, document.body)}
  </>;
}

export function DefaultToolPermissionSetting() {
  const { t } = useI18n();
  const [state, setState] = useState<ToolPermissionState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/tool-permissions", { signal: controller.signal }).then(async res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = await res.json();
      setState({ mode: value.mode, revision: 0 });
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, []);
  const save = async (mode: PermissionMode) => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/tool-permissions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = await res.json();
      setState({ mode: value.mode, revision: 0 });
    } catch (error) { setError(String(error)); }
    finally { setSaving(false); }
  };
  return <section className={styles.setting}>
    <strong>{t("permission.default")}</strong>
    <p>{t("permission.defaultHelp")}</p>
    <ToolPermissionControl state={state} saving={saving} onChange={save} />
    {state && <p>{t(`permission.${state.mode}Help`)}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
