"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { VaultEntry, VaultRequest, VaultSnapshot } from "@/desktop/src/credential-vault-types";
import styles from "./CredentialVaultSettings.module.css";

const empty: Partial<VaultEntry> = { name: "", url: "", username: "", password: "", notes: "", group: "" };
export function CredentialVaultSettings({ rememberedOnly = false }: { rememberedOnly?: boolean } = {}) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const [state, setState] = useState<VaultSnapshot>();
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState(empty);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useCallback(async (input: VaultRequest) => {
    const bridge = window.piDesktop?.vault;
    if (!bridge) return false;
    setBusy(true); setError(false);
    try { setState(await bridge.request(input)); return true; }
    catch { setError(true); return false; }
    finally { setBusy(false); setPassword(""); }
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => { void window.piDesktop?.vault?.request({ action: "status" }).then(value => { if (active) { setState(value); if (!value.unlocked) { setDraft(empty); setPassword(""); } } }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  if (!state) return null;
  const copy = (cn: string, en: string) => zh ? cn : en;
  const field = (key: "name" | "url" | "username" | "password" | "notes" | "group", label: string, type = "text") => <label>{label}<input type={type} value={draft[key] ?? ""} autoComplete="off" onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>;
  return <section className={`${styles.card}${rememberedOnly ? ` ${styles.remembered}` : ""}`} aria-label={rememberedOnly ? copy("网页登录账户", "Website accounts") : copy("本地凭据库", "Local credential vault")}>
    <h3>{copy("网页登录账户", "Website accounts")}</h3>
    <p>{copy("默认在成功登录后加密保存账户，并允许后续自动登录，无需创建或解锁凭据库。验证码仍需你完成。", "Accounts are encrypted and remembered after successful sign-in by default, with automatic sign-in enabled. No vault setup or unlock is needed. Verification codes remain manual.")}</p>
    <fieldset disabled={busy || !state.available}>
      <label className={styles.toggle}><input type="checkbox" checked={state.remembered?.enabled ?? true} onChange={event => { void request({ action: "remember-configure", enabled: event.target.checked }); }} />{copy("自动保存网页登录账户并自动登录", "Remember website accounts and sign in automatically")}</label>
      <ul>{state.remembered?.entries.map(item => <li key={item.id}>
        <span>{item.url}</span>
        <label className={styles.toggle}><input type="checkbox" checked={item.enabled} onChange={event => { void request({ action: "remember-toggle", id: item.id, enabled: event.target.checked }); }} />{copy("允许自动登录", "Allow automatic sign-in")}</label>
        <button type="button" onClick={() => { void request({ action: "remember-remove", id: item.id }); }}>{copy("删除已记住账户", "Delete remembered account")}</button>
      </li>)}</ul>
      {!state.remembered?.entries.length && <p>{copy("还没有记住的网站账户。成功登录支持的网站后会自动保存。", "No website accounts are remembered yet. Supported accounts are saved after successful sign-in.")}</p>}
    </fieldset>
    {rememberedOnly && !state.available && <p role="status">{copy("系统加密不可用，无法保存网页登录账户。", "System encryption is unavailable; website accounts cannot be saved.")}</p>}
    {!rememberedOnly && <>
    <h3>{copy("手动凭据库（可选）", "Manual credential vault (optional)")}</h3>
    <p>{copy("凭据使用系统加密保存。主密码至少 12 位，解锁持续 10 分钟。填写仅支持桌面浏览器的 HTTPS 登录表单，并严格匹配站点与路径。", "Credentials are encrypted by the operating system. Use a master password of at least 12 characters; unlock lasts 10 minutes. Filling supports HTTPS login forms in the desktop browser with exact site and path matching.")}</p>
    <p>{copy("开启账户自动登录后，会等待单点登录，再自动填写和提交匹配的表单。验证码、支付和安全设置仍需你操作；未开启的账户保持手动提交。", "Opted-in accounts wait for SSO before automatically filling and submitting a matching form. Verification codes, payments and security settings remain manual. Other accounts are never submitted automatically.")}</p>
    {!state.available ? <p role="status">{copy("系统加密不可用，凭据库已禁用。", "System encryption is unavailable; the vault is disabled.")}</p> : <fieldset disabled={busy}>
      <label>{copy("主密码（导入时填写备份密码）", "Master password (backup password for import)")}<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label>
      {!state.unlocked ? <button type="button" disabled={password.length < 12} onClick={() => { void request({ action: state.initialized ? "unlock" : "initialize", password }); }}>{state.initialized ? copy("解锁", "Unlock") : copy("创建凭据库", "Create vault")}</button> : <>
        <div className={styles.actions}>
          <button type="button" onClick={() => { setDraft(empty); void request({ action: "lock" }); }}>{copy("锁定", "Lock")}</button>
          <button type="button" disabled={password.length < 12} onClick={() => { void request({ action: "export", password }); }}>{copy("验证并导出加密备份", "Verify and export encrypted backup")}</button>
          <button type="button" disabled={password.length < 12} onClick={() => { void request({ action: "import", password }); }}>{copy("导入加密备份", "Import encrypted backup")}</button>
        </div>
        <label className={styles.toggle}><input type="checkbox" checked={state.autofill} onChange={event => { void request({ action: "configure", enabled: event.target.checked }); }} />{copy("自动填写唯一匹配的登录页（默认关闭）", "Automatically fill a uniquely matched login page (off by default)")}</label>
        <p>{copy("多个匹配账户请通过浏览器登录菜单选择。关闭自动填写后仍可手动填写。备份使用导出时的主密码再次加密，请妥善保管密码。", "Choose between matching accounts in the browser login menu. Manual filling remains available when autofill is off. Backups are separately encrypted with the master password used at export; keep that password safe.")}</p>
        <label>{copy("搜索名称、站点或分组", "Search name, site or group")}<input value={search} onChange={event => setSearch(event.target.value)} /></label>
        <ul>{state.entries.filter(item => `${item.name} ${item.url} ${item.group}`.toLowerCase().includes(search.toLowerCase())).map(item => <li key={item.id}>
          <span><strong>{item.name}</strong> · {item.group}<br />{item.url} · ••••••</span>
          <div className={styles.actions}>
            <button type="button" onClick={() => setDraft({ ...item, password: "" })}>{copy("编辑", "Edit")}</button>
            <button type="button" onClick={() => { void request({ action: "fill", id: item.id }); }}>{copy("填入当前浏览器", "Fill current browser")}</button>
            <button type="button" onClick={() => { if (window.confirm(copy("删除此凭据？", "Delete this credential?"))) void request({ action: "remove", id: item.id }); }}>{copy("删除", "Delete")}</button>
          </div>
        </li>)}</ul>
        <div className={styles.fields}>
          {field("name", copy("名称", "Name"))}{field("group", copy("分组", "Group"))}
          {field("url", copy("完整登录页 URL", "Exact login page URL"), "url")}{field("username", copy("用户名", "Username"), "password")}
          {field("password", draft.id ? copy("密码（留空保留）", "Password (leave empty to keep)") : copy("密码", "Password"), "password")}{field("notes", copy("备注", "Notes"))}
        </div>
        <label className={styles.toggle}><input type="checkbox" checked={draft.autoLogin === true} onChange={event => setDraft(previous => ({ ...previous, autoLogin: event.target.checked }))} />{copy("允许此账户自动登录（锁定和重启后仍可使用，仅匹配此登录页）", "Allow automatic sign-in, including while locked and after restart, only on this login page")}</label>
        <div className={styles.actions}>
          <button type="button" onClick={() => { void request({ action: "save", entry: draft }).then(ok => { if (ok) setDraft(empty); }); }}>{draft.id ? copy("保存修改", "Save changes") : copy("添加凭据", "Add credential")}</button>
          <button type="button" onClick={() => setDraft(empty)}>{copy("清空编辑", "Clear editor")}</button>
        </div>
        <details><summary>{copy("最近填写记录（不含密码）", "Recent fills (no passwords)")}</summary><ul>{state.audit.map((item, index) => <li key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString()} · {item.name} · {item.origin}</li>)}</ul></details>
      </>}
      <button type="button" onClick={() => { void request({ action: "release" }); }}>{copy("关闭当前会话的受保护页面并恢复智能体", "Close this chat's protected pages and resume agent")}</button>
    </fieldset>}
    </>}
    {error && <p role="alert">{rememberedOnly ? copy("账户设置未保存，请重试。", "Account settings could not be saved. Please try again.") : copy("操作未完成。请检查密码、备份及当前登录页；不符合填写规则的页面请手动登录。", "Operation not completed. Check the password, backup and current login page. Sign in manually on unsupported pages.")}</p>}
  </section>;
}
