"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SSHConnectionOptions, SSHSessionSnapshot } from "@/lib/ssh/types";
import { sshErrorText, sshRequest } from "@/lib/ssh/client";
import { AliIcon } from "../AliIcon";
import styles from "./SSHPanel.module.css";

export function SSHConnectionDialog({ onConnected }: { onConnected: (snapshot: SSHSessionSnapshot) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [authType, setAuthType] = useState<"password" | "privateKey">("password");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const keyFile = useRef<HTMLInputElement>(null);
  useEffect(() => () => active.current?.abort(), []);

  const submit = async (testOnly: boolean) => {
    if (active.current || !form.current?.reportValidity()) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(testOnly ? "test" : "connect"); setResult(null);
    const value: SSHConnectionOptions = { host: host.trim(), port: Number(port), username: username.trim(), auth: authType === "password" ? { type: "password", password } : { type: "privateKey", privateKey, ...(passphrase ? { passphrase } : {}) } };
    try {
      const data = await sshRequest<{ snapshot: SSHSessionSnapshot }>("/api/ssh/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, testOnly }), signal: controller.signal });
      if (!controller.signal.aborted) {
        if (testOnly) setResult({ ok: true, text: t("ssh.testSuccess") });
        else onConnected(data.snapshot);
      }
    } catch (error) { if (!controller.signal.aborted) setResult({ ok: false, text: sshErrorText(error, t) }); }
    finally { if (active.current === controller) { active.current = null; setBusy(null); } }
  };

  return <div className={styles.connectPage}>
    <form ref={form} className={styles.connectForm} onChange={() => setResult(null)} onSubmit={event => { event.preventDefault(); void submit(false); }}>
      <div className={styles.connectMark}><AliIcon name="code" size={26} /></div>
      <h2>{t("ssh.title")}</h2><p className={styles.subtitle}>{t("ssh.subtitle")}</p>
      <fieldset disabled={busy !== null} className={styles.fields}>
        <div className={styles.hostRow}>
          <label htmlFor={`${id}-host`}>{t("ssh.host")}<input id={`${id}-host`} value={host} onChange={event => setHost(event.target.value)} placeholder="server.example.com" required pattern="[^\s/]+" autoCapitalize="none" spellCheck={false} autoComplete="off" /></label>
          <label htmlFor={`${id}-port`}>{t("ssh.port")}<input id={`${id}-port`} value={port} onChange={event => setPort(event.target.value)} type="number" min={1} max={65535} step={1} required /></label>
        </div>
        <label htmlFor={`${id}-user`}>{t("ssh.username")}<input id={`${id}-user`} value={username} onChange={event => setUsername(event.target.value)} placeholder="deploy" required pattern=".*\S.*" autoCapitalize="none" spellCheck={false} autoComplete="username" /></label>
        <div><span className={styles.fieldLabel} id={`${id}-auth`}>{t("ssh.auth")}</span><div className={styles.segment} role="group" aria-labelledby={`${id}-auth`}>
          <button type="button" aria-pressed={authType === "password"} onClick={() => { setAuthType("password"); setResult(null); }}>{t("ssh.password")}</button>
          <button type="button" aria-pressed={authType === "privateKey"} onClick={() => { setAuthType("privateKey"); setResult(null); }}>{t("ssh.privateKey")}</button>
        </div></div>
        {authType === "password" ? <label htmlFor={`${id}-password`}>{t("ssh.password")}<div className={styles.passwordField}><input id={`${id}-password`} value={password} onChange={event => setPassword(event.target.value)} type={visible ? "text" : "password"} autoComplete="current-password" /><button type="button" onClick={() => setVisible(value => !value)} aria-label={t(visible ? "ssh.hide" : "ssh.show")}>{t(visible ? "ssh.hide" : "ssh.show")}</button></div></label> : <>
          <label htmlFor={`${id}-key`}>{t("ssh.privateKey")}<textarea id={`${id}-key`} value={privateKey} onChange={event => setPrivateKey(event.target.value)} rows={5} required spellCheck={false} placeholder={t("ssh.keyPlaceholder")} /></label>
          <input ref={keyFile} type="file" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void (async () => { try { if (file.size > 1024 * 1024) throw new Error(t("ssh.error.key")); setPrivateKey(await file.text()); setResult(null); } catch (error) { setResult({ ok: false, text: sshErrorText(error, t) }); } })(); }} />
          <button type="button" className={styles.keyPicker} onClick={() => keyFile.current?.click()}><AliIcon name="folder-open" size={16} />{t("ssh.selectKey")}</button>
          <label htmlFor={`${id}-passphrase`}>{t("ssh.passphrase")}<input id={`${id}-passphrase`} value={passphrase} onChange={event => setPassphrase(event.target.value)} type="password" autoComplete="off" /></label>
        </>}
      </fieldset>
      {result ? <div role={result.ok ? "status" : "alert"} className={styles.feedback} data-success={result.ok}><AliIcon name={result.ok ? "check-circle" : "alert"} size={17} /><span>{result.text}</span></div> : null}
      <div className={styles.connectActions}>
        <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void submit(true)}>{busy === "test" ? <span className={styles.spinner} /> : <AliIcon name="link" size={16} />}{t(busy === "test" ? "ssh.testing" : "ssh.test")}</button>
        <button type="submit" className={styles.primary} disabled={busy !== null}>{busy === "connect" ? <span className={styles.spinner} /> : null}{t(busy === "connect" ? "ssh.connecting" : "ssh.connect")}{busy !== "connect" ? <AliIcon name="arrowright" size={16} /> : null}</button>
      </div>
      <p className={styles.formHint}>{t("ssh.testHint")}</p>
    </form>
  </div>;
}
