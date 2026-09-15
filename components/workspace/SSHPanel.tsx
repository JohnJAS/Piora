"use client";

import { useCallback, useEffect, useState } from "react";
import { AliIcon } from "../AliIcon";
import { TerminalSurface } from "./TerminalSurface";
import { SSHConnectionDialog } from "./SSHConnectionDialog";
import styles from "./TerminalPanel.module.css";

import type { SSHAuth } from "@/lib/ssh/types";
interface Snapshot { id: string; host: string; port: number; username: string; cwd: string; connected: boolean; mode: "independent" | "agent-controlled" }
interface Entry { name: string; path: string; type: "file" | "directory" | "other"; size: number }

export function SSHPanel({ agentSessionId }: { agentSessionId?: string | null }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("."); const [entries, setEntries] = useState<Entry[]>([]);
  const loadFiles = useCallback(async (nextPath: string) => { if (!snapshot) return; try { const response = await fetch(`/api/ssh/sessions/${snapshot.id}/files?path=${encodeURIComponent(nextPath)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to read remote directory"); setPath(data.path); setEntries(data.entries); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }, [snapshot]);
  const connect = async (value: { host: string; port: number; username: string; auth: SSHAuth }) => {
    setConnecting(true); setError(null);
    try { const response = await fetch("/api/ssh/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); setSnapshot(data.snapshot); setPath(data.snapshot.cwd || "."); setDialog(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setConnecting(false); }
  };
  useEffect(() => { if (snapshot) void loadFiles(path); }, [loadFiles, path, snapshot]);
  const close = async () => { if (snapshot) await fetch(`/api/ssh/sessions/${snapshot.id}`, { method: "DELETE" }); setSnapshot(null); setEntries([]); };
  const bind = async () => { if (!snapshot || !agentSessionId) return; const response = await fetch(`/api/ssh/sessions/${snapshot.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: snapshot.mode === "agent-controlled" ? "independent" : "agent-controlled", agentSessionId }) }); if (!response.ok) { const data = await response.json(); setError(data.error || "Unable to bind SSH session"); return; } setSnapshot((await response.json()).snapshot); if (snapshot.mode !== "agent-controlled") { await fetch(`/api/agent/${agentSessionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "restart_extensions" }) }); } };
  const upload = async (file: File) => { if (!snapshot) return; const response = await fetch(`/api/ssh/sessions/${snapshot.id}/files/upload?path=${encodeURIComponent(`${path.replace(/\/$/, "")}/${file.name}`)}`, { method: "POST", body: file }); if (!response.ok) { const data = await response.json(); setError(data.error || "Upload failed"); return; } void loadFiles(path); };
  return <section className={styles.root} aria-label="SSH terminal">
    <header className={styles.header}><div className={styles.brand}><AliIcon name="code" size={18} /><strong>SSH</strong></div>{snapshot ? <button title="Disconnect" aria-label="Disconnect" onClick={() => void close()}><AliIcon name="close" size={15} /></button> : null}<button title="New SSH connection" aria-label="New SSH connection" onClick={() => setDialog(true)}><AliIcon name="plus" size={16} /></button></header>
    {error ? <div className={styles.error} role="alert">{error}<button onClick={() => setError(null)}>×</button></div> : null}
    {dialog ? <div style={{ padding: 16 }}><SSHConnectionDialog onConnect={connect} onCancel={() => setDialog(false)} /></div> : null}
    {snapshot ? <><div className={styles.locationBar}><span className={styles.cwd}>{snapshot.username}@{snapshot.host}:{snapshot.port}</span><span className={styles.status} data-ready={snapshot.connected}><i />{snapshot.connected ? "Connected" : "Disconnected"}</span>{agentSessionId ? <button onClick={() => void bind()}>{snapshot.mode === "agent-controlled" ? "Unbind model" : "Use for model"}</button> : null}</div><div className={styles.body}><TerminalSurface key={snapshot.id} terminalId={snapshot.id} transport="ssh" cwd={snapshot.cwd} /><div style={{ borderTop: "1px solid var(--border)", padding: 10, maxHeight: 190, overflow: "auto" }}><div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}><code style={{ flex: 1 }}>{path}</code><button onClick={() => void loadFiles("..")}>Up</button><label><input type="file" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><button type="button" onClick={event => (event.currentTarget.previousElementSibling as HTMLInputElement).click()}>Upload</button></label></div>{entries.map(entry => <div key={entry.path} style={{ display: "flex", gap: 8, padding: "3px 0" }}><button style={{ flex: 1, textAlign: "left" }} onClick={() => entry.type === "directory" ? void loadFiles(entry.path) : undefined}>{entry.type === "directory" ? "📁" : "📄"} {entry.name}</button>{entry.type === "file" ? <a href={`/api/ssh/sessions/${snapshot.id}/files/download?path=${encodeURIComponent(entry.path)}`}>Download</a> : null}</div>)}</div></div></> : !dialog ? <div className={styles.empty}><AliIcon name="code" size={34} /><strong>SSH terminal</strong><p>Connect to a remote host to open an interactive shell.</p><button onClick={() => setDialog(true)} disabled={connecting}>{connecting ? "Connecting…" : "New SSH connection"}</button></div> : null}
  </section>;
}
