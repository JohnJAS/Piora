"use client";

import { useEffect, useRef, useState } from "react";
import type { ShellSession } from "@/lib/shell/types";
import { useI18n } from "@/hooks/useI18n";
import { useSmartShell } from "@/hooks/useSmartShell";
import { useNativeShellConfig } from "@/hooks/useNativeShellConfig";
import { AliIcon } from "../AliIcon";
import { TerminalSurface, type TerminalSurfaceHandle } from "./TerminalSurface";
import styles from "./SmartShell.module.css";

function TerminalTab({ session, index, active, onSelect, onClose, onRename }: {
  session: ShellSession; index: number; active: boolean;
  onSelect: () => void; onClose: () => void; onRename: (title: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const tab = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const label = session.title || session.profile.label;
  const begin = () => { if (!pending.current) { setTitle(label); setEditing(true); } };
  const cancel = (restoreFocus = true) => { setEditing(false); if (restoreFocus) requestAnimationFrame(() => tab.current?.focus()); };
  const save = async () => {
    const name = title.trim();
    if (pending.current || !name || name.length > 100) return;
    if (name === session.title) { cancel(); return; }
    pending.current = true; setSaving(true);
    try { if (await onRename(name)) cancel(document.activeElement === document.body || Boolean(form.current?.contains(document.activeElement))); }
    finally { pending.current = false; setSaving(false); }
  };
  return <div className={styles.terminalTab} data-active={active}>
    {editing ? <form ref={form} className={styles.tabRename} onSubmit={event => { event.preventDefault(); void save(); }}>
      <input autoFocus aria-label={t("shell.tabName")} maxLength={100} value={title} disabled={saving}
        onFocus={event => event.currentTarget.select()} onChange={event => setTitle(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (event.key === "Enter") event.preventDefault(); return; }
          if (event.key === "Escape" && !pending.current) { event.preventDefault(); cancel(); }
        }} />
      <button type="submit" title={t("shell.saveName")} aria-label={t("shell.saveName")} disabled={saving || !title.trim()}><AliIcon name="check" size={13} /></button>
      <button type="button" title={t("shell.cancelRename")} aria-label={t("shell.cancelRename")} disabled={saving} onClick={() => cancel()}><AliIcon name="close" size={13} /></button>
    </form> : <>
      <button ref={tab} role="tab" aria-selected={active} title={`${label} · ${session.profile.label}\n${session.initialCwd}`} onClick={onSelect} onDoubleClick={begin}
        onKeyDown={event => { if (event.key === "F2") { event.preventDefault(); begin(); } }}>{label} · {index + 1}</button>
      <button className={styles.tabRenameButton} title={t("shell.rename")} aria-label={`${t("shell.rename")} ${index + 1}`} onClick={begin}><AliIcon name="edit" size={12} /></button>
    </>}
    <button title={t("shell.close")} aria-label={t("shell.close") + " " + (index + 1)} onClick={onClose}>×</button>
  </div>;
}

export interface SmartShellPanelProps {
  cwd: string;
  sessionId?: string | null;
  onClose?: () => void;
  onToChat?: (text: string) => void;
  onOpenFile?: (file: string) => void;
  onOpenUrl?: (url: string) => void;
  onSettings?: () => void;
  searchTarget?: { sessionId: string; query: string; revision: number };
}

export function SmartShellPanel({ cwd, onClose, onSettings, searchTarget }: SmartShellPanelProps) {
  const { t } = useI18n();
  const shell = useSmartShell(cwd, true);
  const { config, error: profileError } = useNativeShellConfig();
  const terminal = useRef<TerminalSurfaceHandle>(null);
  const state = shell.snapshot?.session;
  const { sessions, activeId, select } = shell;
  useEffect(() => {
    if (searchTarget && sessions.some(session => session.id === searchTarget.sessionId) && activeId !== searchTarget.sessionId) select(searchTarget.sessionId);
  }, [searchTarget, sessions, activeId, select]);
  const act = (action: string) => { void shell.action({ action }).then(() => terminal.current?.focus()).catch(() => {}); };

  return <section className={styles.root} aria-label={t("shell.title")}>
    <header className={styles.header}>
      <div className={styles.brand}><AliIcon name="code" size={18} /><strong>{state?.profile.label || t("shell.title")}</strong></div>
      {onSettings ? <button title={t("shell.settings")} aria-label={t("shell.settings")} onClick={onSettings}><AliIcon name="setting" size={15} /></button> : null}
      <button title={t("shell.new")} aria-label={t("shell.new")} onClick={() => void shell.create()}><AliIcon name="plus" size={16} /></button>
      <select className={styles.shellPicker} aria-label={t("shell.chooseShell")} title={t("shell.chooseShell")} value="" disabled={!config}
        onChange={event => { if (event.target.value) void shell.create(event.target.value); }}>
        <option value="" disabled>{t("shell.chooseShell")}</option>
        {config?.profiles.map(profile => <option key={profile.executable} value={profile.executable}>{profile.label}{profile.bundled ? ` (${t("shell.bundled")})` : ""}</option>)}
      </select>
      <button title={t("shell.clear")} aria-label={t("shell.clear")} disabled={!state?.connected} onClick={() => { void shell.action({ action: "input", data: "\f", generation: state?.generation }).then(() => terminal.current?.focus()).catch(() => {}); }}><AliIcon name="clear" size={15} /></button>
      <button title={t("shell.restart")} aria-label={t("shell.restart")} disabled={!state} onClick={() => act("restart")}><AliIcon name="reload" size={15} /></button>
      {onClose ? <button title={t("workspace.closeTool")} aria-label={t("workspace.closeTool")} onClick={onClose}><AliIcon name="close" size={15} /></button> : null}
    </header>
    <div className={styles.tabs} role="tablist" aria-label={t("shell.title")}>{shell.sessions.map((session, index) =>
      <TerminalTab key={`${cwd}:${session.id}`} session={session} index={index} active={session.id === shell.activeId}
        onSelect={() => shell.select(session.id)} onClose={() => void shell.close(session.id)} onRename={title => shell.rename(session.id, title)} />
    )}</div>
    {shell.error ? <div className={styles.error} role="alert">{shell.error}<button aria-label={t("workspace.closeTool")} onClick={() => shell.setError("")}>×</button></div> : null}
    {profileError ? <div className={styles.error} role="alert">{profileError}</div> : null}
    {shell.connectionError ? <div className={styles.error} role="alert">{shell.connectionError}<button onClick={shell.reconnect}>{t("shell.retry")}</button></div> : null}
    <div className={styles.body}>
      {state ? <div className={styles.native}>
        <TerminalSurface key={state.id} ref={terminal} cwd={state.initialCwd} terminalId={state.id} subscribeToShell={shell.subscribe} onError={shell.setError} autoFocus
          searchRequest={searchTarget?.sessionId === state.id ? searchTarget : undefined} />
      </div> : <div className={styles.empty}><button onClick={() => void shell.create()}>{t("shell.new")}</button></div>}
    </div>
    <footer className={styles.controlBar}>
      <span className={styles.status} data-ready={state?.connected && shell.connected}><i />{t(state?.connected && shell.connected ? "shell.ready" : "shell.offline")}</span>
      <span className={styles.terminalHint}>{t(state?.profile.kind === "powershell" ? "shell.nativeHint" : "shell.nativeHintOther")}</span>
    </footer>
  </section>;
}
