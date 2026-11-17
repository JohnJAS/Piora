"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { VaultEntry, VaultRequest, VaultSnapshot } from "@/desktop/src/credential-vault-types";
import type { SsoRule } from "@/desktop/src/credential-sso";
import styles from "./CredentialVaultSettings.module.css";

const empty: Partial<VaultEntry> = { name: "", url: "", username: "", password: "", notes: "", group: "" };
const emptyRule: Partial<SsoRule> = { authOrigin: "", returnUrl: "", evidence: "dom", cookieName: "" };

export function CredentialVaultSettings() {
  const { locale } = useI18n();
  const copy = (cn: string, en: string) => locale === "zh-CN" ? cn : en;
  const [state, setState] = useState<VaultSnapshot>();
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState(empty);
  const [rule, setRule] = useState(emptyRule);
  const [httpOrigin, setHttpOrigin] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const revision = useRef(0);
  const pendingRequest = useRef(false);
  const applyState = useCallback((value: VaultSnapshot) => {
    setState(value);
    if (!value.unlocked) { setDraft(empty); setPassword(""); }
  }, []);
  const request = useCallback(async (input: VaultRequest) => {
    const bridge = window.piDesktop?.vault;
    if (!bridge) return false;
    const current = ++revision.current;
    pendingRequest.current = true;
    setBusy(true); setError(false);
    try { const next = await bridge.request(input); if (revision.current === current) applyState(next); return true; }
    catch { if (revision.current === current) setError(true); return false; }
    finally { if (revision.current === current) { pendingRequest.current = false; setBusy(false); setPassword(""); } }
  }, [applyState]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (pendingRequest.current) return;
      const current = revision.current;
      void window.piDesktop?.vault?.request({ action: "status" }).then(value => {
        if (active && revision.current === current) applyState(value);
      }).catch(() => {});
    };
    refresh(); const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [applyState]);
  if (!state) return null;
  const field = (key: "name" | "url" | "username" | "password" | "notes" | "group", label: string, type = "text") => <label>{label}<input type={type} value={draft[key] ?? ""} autoComplete="off" onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>;
  const rows = [
    ...(state.unlocked ? state.entries : []).map(item => ({ ...item, source: "manual" as const, enabled: item.autoLogin === true })),
    ...(state.remembered?.entries ?? []).map(item => ({ ...item, source: "remembered" as const })),
  ].filter(item => `${state.unlocked ? `${item.name ?? ""} ${item.group ?? ""}` : ""} ${item.url}`.toLowerCase().includes(search.toLowerCase()));
  return <section className={`${styles.card} ${styles.remembered}`} aria-label={copy("网页登录账户", "Website accounts")}>
    <h3>{copy("网页登录账户", "Website accounts")}</h3>
    <p>{copy("成功登录后默认加密记住账户并自动登录，无需解锁。解锁凭据库后可管理详情、手动添加账户并备份。验证码仍需你完成。", "Successful sign-ins are remembered with encryption and used automatically without unlocking. Unlock the vault to manage details, add accounts and create backups. Verification codes remain manual.")}</p>
    {!state.available && <p role="status">{copy("系统加密不可用，无法保存网页登录账户。", "System encryption is unavailable; website accounts cannot be saved.")}</p>}
    <fieldset disabled={busy || !state.available}>
      <label className={styles.toggle}><input type="checkbox" checked={state.remembered?.enabled ?? true} onChange={event => { void request({ action: "remember-configure", enabled: event.target.checked }); }} />{copy("自动保存网页登录账户并自动登录", "Remember website accounts and sign in automatically")}</label>
      <label>{copy("搜索名称、站点或分组", "Search name, site or group")}<input value={search} onChange={event => setSearch(event.target.value)} /></label>
      <ul aria-label={copy("账户列表", "Account list")}>{rows.map(item => <li key={`${item.source}-${item.id}`}>
        <div className={styles.accountTitle}>
          {state.unlocked && item.name ? <strong>{item.name}</strong> : null}
          <span className={styles.badge}>{item.source === "manual" ? copy("手动", "Manual") : copy("自动记住", "Remembered")}</span>
          {item.url.startsWith("http:") && <span className={styles.insecure}>{copy("非加密连接", "Unencrypted connection")}</span>}
        </div>
        <span>{item.url} · ••••••</span>
        {state.unlocked && item.group ? <span>{copy("分组", "Group")}: {item.group}</span> : null}
        {state.unlocked && item.notes ? <span>{copy("备注", "Notes")}: {item.notes}</span> : null}
        <label className={styles.toggle}><input type="checkbox" checked={item.enabled} onChange={event => {
          void request(item.source === "remembered" ? { action: "remember-toggle", id: item.id, enabled: event.target.checked } : { action: "save", entry: { id: item.id, autoLogin: event.target.checked } });
        }} />{copy("允许自动登录", "Allow automatic sign-in")}</label>
        <div className={styles.actions}>
          {state.unlocked && <button type="button" onClick={() => { void request({ action: "fill", id: item.id }); }}>{copy("填入当前浏览器", "Fill current browser")}</button>}
          {item.source === "manual" ? <>
            <button type="button" onClick={() => { setDraft({ ...item, password: "" }); setManagerOpen(true); }}>{copy("编辑", "Edit")}</button>
            <button type="button" onClick={() => { if (window.confirm(copy("删除此凭据？", "Delete this credential?"))) void request({ action: "remove", id: item.id }); }}>{copy("删除", "Delete")}</button>
          </> : <>
            {state.unlocked && <button type="button" onClick={() => { void request({ action: "remember-promote", id: item.id }); }}>{copy("转入手动库以编辑", "Move to manual vault to edit")}</button>}
            <button type="button" onClick={() => { void request({ action: "remember-remove", id: item.id }); }}>{copy("删除已记住账户", "Delete remembered account")}</button>
          </>}
        </div>
      </li>)}</ul>
      {!rows.length && <p>{search ? copy("没有匹配的账户。", "No matching accounts.") : copy("还没有可见账户。可登录支持的网站自动保存，或解锁后手动添加。", "No accounts are visible yet. Sign in to a supported website to save one, or unlock the vault to add one manually.")}</p>}
    </fieldset>

    <details data-settings-id="data.credentialVault" open={managerOpen} onToggle={event => setManagerOpen(event.currentTarget.open)}>
      <summary>{copy("凭据库（本地加密）", "Credential vault (locally encrypted)")}</summary>
      <p>{copy("主密码至少 12 位，解锁持续 10 分钟。密码始终遮盖，编辑时留空保留原密码。备份包含手动及自动记住的账户，使用主密码加密；导入后自动登录默认关闭。", "Use a master password of at least 12 characters; unlock lasts 10 minutes. Passwords stay masked; leave the password empty when editing to keep it. Backups include manual and remembered accounts, encrypted with the master password. Imported accounts have automatic sign-in disabled.")}</p>
      <fieldset disabled={busy || !state.available}>
        <label>{copy("主密码（导入时填写备份密码）", "Master password (backup password for import)")}<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label>
        {!state.unlocked ? <button type="button" disabled={password.length < 12} onClick={() => { void request({ action: state.initialized ? "unlock" : "initialize", password }); }}>{state.initialized ? copy("解锁", "Unlock") : copy("创建凭据库", "Create vault")}</button> : <>
          <div className={styles.actions}>
            <button type="button" onClick={() => { setDraft(empty); void request({ action: "lock" }); }}>{copy("锁定", "Lock")}</button>
            <button type="button" disabled={password.length < 12} onClick={() => { void request({ action: "export", password }); }}>{copy("验证并导出加密备份", "Verify and export encrypted backup")}</button>
            <button type="button" disabled={password.length < 12} onClick={() => { void request({ action: "import", password }); }}>{copy("导入加密备份", "Import encrypted backup")}</button>
          </div>
          <label className={styles.toggle}><input type="checkbox" checked={state.autofill} onChange={event => { void request({ action: "configure", enabled: event.target.checked }); }} />{copy("自动填写唯一匹配的登录页（默认关闭）", "Automatically fill a uniquely matched login page (off by default)")}</label>
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
      </fieldset>
    </details>

    <details data-settings-id="data.credentialWhitelist">
      <summary>{copy("HTTP 站点白名单", "HTTP site allowlist")}</summary>
      <p>{copy("HTTP 连接不会加密传输密码。仅为信任的站点添加完整 origin（http://主机:端口），不支持通配符，最多 50 项。移除后停止该站点的凭据填写和自动保存。", "HTTP sends passwords without transport encryption. Add only a trusted site's exact origin (http://host:port), without wildcards, up to 50 sites. Removing a site stops credential filling and automatic saving for it.")}</p>
      <fieldset disabled={busy || !state.available}>
        <label>{copy("允许保存凭据的 HTTP origin", "HTTP origin allowed for credentials")}<input type="url" placeholder="http://intranet.example:8080" value={httpOrigin} onChange={event => setHttpOrigin(event.target.value)} /></label>
        <button type="button" disabled={!httpOrigin.trim() || (state.httpOrigins?.length ?? 0) >= 50} onClick={() => { void request({ action: "http-allow", url: httpOrigin.trim() }).then(ok => { if (ok) setHttpOrigin(""); }); }}>{copy("允许此 HTTP 站点保存和填写账户", "Allow credential saving and filling for this HTTP site")}</button>
        <ul>{state.httpOrigins?.map(origin => <li key={origin}><span>{origin} <span className={styles.insecure}>{copy("非加密连接", "Unencrypted connection")}</span></span><button type="button" onClick={() => { void request({ action: "http-remove", url: origin }); }}>{copy("移除 HTTP 站点", "Remove HTTP site")}</button></li>)}</ul>
      </fieldset>
    </details>

    <details data-settings-id="data.credentialSso">
      <summary>{copy("SSO 登录成功规则", "SSO sign-in completion rules")}</summary>
      <p>{copy("将认证站点与业务回跳地址关联，密码只绑定认证站点。默认检查退出按钮或用户菜单；也可指定业务页面标记或由你确认的会话 Cookie 名称。Cookie 必须在本次登录中发生变化，其值不会显示。HTTP 地址须先加入白名单。", "Associate an authentication site with its business return address; credentials remain bound to the authentication site. By default, check sign-out or user-menu markers. You may select a page marker or a session cookie name you recognize. The cookie must change during this sign-in; its value is never displayed. Allowlist HTTP sites first.")}</p>
      <fieldset disabled={busy || !state.available}>
        <ul>{state.ssoRules?.map(item => <li key={item.id}>
          <span>{item.authOrigin} → {item.returnUrl}</span>
          <span>{item.evidence === "cookie" ? `Cookie: ${item.cookieName}` : item.evidence === "meta" ? 'meta piora-auth="verified"' : copy("退出按钮或用户菜单", "Sign-out or user menu")}</span>
          <div className={styles.actions}><button type="button" onClick={() => setRule(item)}>{copy("编辑 SSO 规则", "Edit SSO rule")}</button><button type="button" onClick={() => { void request({ action: "sso-remove", id: item.id }); }}>{copy("删除 SSO 规则", "Delete SSO rule")}</button></div>
        </li>)}</ul>
        <label>{copy("认证站点 origin", "Authentication site origin")}<input type="url" value={rule.authOrigin ?? ""} onChange={event => setRule(previous => ({ ...previous, authOrigin: event.target.value }))} placeholder="https://login.example" /></label>
        <label>{copy("业务回跳 URL 前缀", "Business return URL prefix")}<input type="url" value={rule.returnUrl ?? ""} onChange={event => setRule(previous => ({ ...previous, returnUrl: event.target.value }))} placeholder="https://app.example/home" /></label>
        <label>{copy("登录成功依据", "Sign-in evidence")}<select aria-label={copy("登录成功依据", "Sign-in evidence")} value={rule.evidence ?? "dom"} onChange={event => setRule(previous => ({ ...previous, evidence: event.target.value as SsoRule["evidence"] }))}>
          <option value="dom">{copy("退出按钮或用户菜单", "Sign-out or user menu")}</option>
          <option value="meta">{copy("页面 meta 标记 piora-auth=verified", "Page meta marker piora-auth=verified")}</option>
          <option value="cookie">{copy("我指定的会话 Cookie 变化", "Change to my chosen session cookie")}</option>
        </select></label>
        {rule.evidence === "cookie" && <label>{copy("确认用于认证的 Cookie 名称", "Confirmed authentication cookie name")}<input value={rule.cookieName ?? ""} onChange={event => setRule(previous => ({ ...previous, cookieName: event.target.value }))} autoComplete="off" /></label>}
        <div className={styles.actions}>
          <button type="button" disabled={!rule.authOrigin?.trim() || !rule.returnUrl?.trim() || (rule.evidence === "cookie" && !rule.cookieName?.trim())} onClick={() => { void request({ action: "sso-save", rule }).then(ok => { if (ok) setRule(emptyRule); }); }}>{copy("保存 SSO 规则", "Save SSO rule")}</button>
          <button type="button" onClick={() => setRule(emptyRule)}>{copy("清空 SSO 编辑", "Clear SSO editor")}</button>
        </div>
      </fieldset>
    </details>
    {error && <p role="alert">{copy("操作未完成。请检查密码、站点白名单、SSO 规则、备份及当前登录页；不符合填写规则的页面请手动登录。", "Operation not completed. Check the password, site allowlist, SSO rule, backup and current login page. Sign in manually on unsupported pages.")}</p>}
  </section>;
}
