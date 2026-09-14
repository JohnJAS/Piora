"use client";

import { useState } from "react";

export function SSHConnectionDialog({ onConnect, onCancel }: { onConnect: (value: { host: string; port: number; username: string; auth: { type: "password"; password: string } }) => void; onCancel: () => void }) {
  const [host, setHost] = useState(""); const [port, setPort] = useState("22"); const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  return <form onSubmit={event => { event.preventDefault(); if (host.trim() && username.trim()) onConnect({ host: host.trim(), port: Number(port) || 22, username: username.trim(), auth: { type: "password", password } }); }}>
    <label>Host<input value={host} onChange={event => setHost(event.target.value)} autoFocus /></label>
    <label>Port<input value={port} onChange={event => setPort(event.target.value)} inputMode="numeric" /></label>
    <label>Username<input value={username} onChange={event => setUsername(event.target.value)} /></label>
    <label>Password<input value={password} onChange={event => setPassword(event.target.value)} type="password" /></label>
    <div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={!host.trim() || !username.trim()}>Connect</button></div>
  </form>;
}
