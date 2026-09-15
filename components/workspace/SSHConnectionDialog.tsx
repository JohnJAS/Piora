"use client";

import { useState } from "react";

export function SSHConnectionDialog({ onConnect, onCancel }: { onConnect: (value: { host: string; port: number; username: string; auth: { type: "password"; password: string } | { type: "privateKey"; privateKey: string; passphrase?: string } }) => void; onCancel: () => void }) {
  const [host, setHost] = useState(""); const [port, setPort] = useState("22"); const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [privateKey, setPrivateKey] = useState(""); const [authType, setAuthType] = useState<"password" | "privateKey">("password");
  return <form onSubmit={event => { event.preventDefault(); if (host.trim() && username.trim()) onConnect({ host: host.trim(), port: Number(port) || 22, username: username.trim(), auth: authType === "password" ? { type: "password", password } : { type: "privateKey", privateKey } }); }}>
    <label>Host<input value={host} onChange={event => setHost(event.target.value)} autoFocus /></label>
    <label>Port<input value={port} onChange={event => setPort(event.target.value)} inputMode="numeric" /></label>
    <label>Username<input value={username} onChange={event => setUsername(event.target.value)} /></label>
    <label>Authentication<select value={authType} onChange={event => setAuthType(event.target.value as "password" | "privateKey")}><option value="password">Password</option><option value="privateKey">Private key</option></select></label>
    {authType === "password" ? <label>Password<input value={password} onChange={event => setPassword(event.target.value)} type="password" /></label> : <label>Private key<textarea value={privateKey} onChange={event => setPrivateKey(event.target.value)} rows={5} placeholder="Paste your private key" /></label>}
    <div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={!host.trim() || !username.trim()}>Connect</button></div>
  </form>;
}
