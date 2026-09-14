"use client";

import { useState } from "react";
import { AliIcon } from "../AliIcon";
import { TerminalSurface } from "./TerminalSurface";
import { SSHConnectionDialog } from "./SSHConnectionDialog";
import styles from "./TerminalPanel.module.css";

interface Snapshot { id: string; host: string; port: number; username: string; cwd: string; connected: boolean }

export function SSHPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = async (value: { host: string; port: number; username: string; auth: { type: "password"; password: string } }) => {
    setConnecting(true); setError(null);
    try { const response = await fetch("/api/ssh/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); setSnapshot(data.snapshot); setDialog(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setConnecting(false); }
  };
  const close = async () => { if (snapshot) await fetch(`/api/ssh/sessions/${snapshot.id}`, { method: "DELETE" }); setSnapshot(null); };
  return <section className={styles.root} aria-label="SSH terminal">
    <header className={styles.header}><div className={styles.brand}><AliIcon name="code" size={18} /><strong>SSH</strong></div>{snapshot ? <button title="Disconnect" aria-label="Disconnect" onClick={() => void close()}><AliIcon name="close" size={15} /></button> : null}<button title="New SSH connection" aria-label="New SSH connection" onClick={() => setDialog(true)}><AliIcon name="plus" size={16} /></button></header>
    {error ? <div className={styles.error} role="alert">{error}<button onClick={() => setError(null)}>×</button></div> : null}
    {dialog ? <div style={{ padding: 16 }}><SSHConnectionDialog onConnect={connect} onCancel={() => setDialog(false)} /></div> : null}
    {snapshot ? <><div className={styles.locationBar}><span className={styles.cwd}>{snapshot.username}@{snapshot.host}:{snapshot.port}</span><span className={styles.status} data-ready={snapshot.connected}><i />{snapshot.connected ? "Connected" : "Disconnected"}</span></div><div className={styles.body}><TerminalSurface key={snapshot.id} terminalId={snapshot.id} transport="ssh" cwd={snapshot.cwd} /></div></> : !dialog ? <div className={styles.empty}><AliIcon name="code" size={34} /><strong>SSH terminal</strong><p>Connect to a remote host to open an interactive shell.</p><button onClick={() => setDialog(true)} disabled={connecting}>{connecting ? "Connecting…" : "New SSH connection"}</button></div> : null}
  </section>;
}
