"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AliIcon } from "./AliIcon";
import browserStyles from "./workspace/browser/BrowserTools.module.css";
import { useI18n } from "@/hooks/useI18n";
import type { VaultEntry, VaultRequest, VaultSnapshot } from "@/desktop/src/credential-vault-types";
import type { SsoRule } from "@/desktop/src/credential-sso";
import styles from "./CredentialVaultSettings.module.css";

const empty: Partial<VaultEntry> = { name: "", url: "", username: "", password: "", notes: "", group: "" };
const emptyRule: Partial<SsoRule> = { authOrigin: "", returnUrl: "", evidence: "dom", cookieName: "" };

export function CredentialVaultSettings({ browserPage = false, importPasswords }: { browserPage?: boolean; importPasswords?(): void } = {}) {
  const [tab, setTab] = useState<"passwords" | "settings">("passwords");
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
  return <section className={browserPage ? browserStyles.passwordPage : `${styles.card} ${styles.remembered}`} data-settings-id={browserPage ? "data.websiteAccounts" : undefined} aria-label={copy("网页登录账户", "Website accounts")}>
    {browserPage && <>
      <div role="tablist" aria-label={copy("密码管理器", "Password manager")} className={browserStyles.segments}>
        {(["passwords", "settings"] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab===key} onClick={() => setTab(key)}>{key === "passwords" ? copy("密码", "Passwords") : copy("设置", "Settings")}</button>)}
      </div>
      <label className={browserStyles.passwordSearch}><AliIcon name="search" size={16}/><input type="search" aria-label={copy("搜索密码", "Search passwords")} placeholder={copy("搜索密码", "Search passwords")} value={search} onChange={event => {setSearch(event.target.value); if (event.target.value) setTab("passwords");}} /></label>
    </>}
    {!browserPage && <h3>{copy("网页登录账户", "Website accounts")}</h3>}
    {!browserPage && <p>{copy("登录后默认加密保存账户并自动登录；解锁凭据库可管理详情与加密备份。", "Remembered sign-ins stay encrypted and sign in automatically. Unlock the vault for manual editing and backups.")}</p>}
    {!state.available && <p role="status">{copy("系统加密不可用，无法保存网页登录账户。", "System encryption is unavailable; website accounts cannot be saved.")}</p>}
    {browserPage && tab === "settings" && <div className={browserStyles.settingsRows}>
      <label className={browserStyles.option}><span>{copy("自动保存网页登录账户并自动登录", "Remember website accounts and sign in automatically")}<small>{copy("在支持的网站登录成功后，加密保存账户供下次使用。", "Save accounts locally after signing in to supported sites.")}</small></span>
        <input className={browserStyles.switch} aria-label={copy("自动保存网页登录账户并自动登录", "Remember website accounts and sign in automatically")} type="checkbox" checked={state.remembered?.enabled ?? true} disabled={busy || !state.available} onChange={e => void request({ action: "remember-configure", enabled: e.target.checked })} /></label>
      <label className={browserStyles.option}><span>{copy("自动填写密码", "Fill passwords automatically")}<small>{copy("凭据库解锁后，自动填写有唯一匹配账户的登录页。", "Fill a sign-in page with one matching account while the vault is unlocked.")}</small></span>
        <input className={browserStyles.switch} aria-label={copy("自动填写密码", "Fill passwords automatically")} type="checkbox" disabled={busy || !state.unlocked} checked={state.autofill} onChange={e => void request({ action:"configure", enabled:e.target.checked })}/></label>
      <div className={browserStyles.option}><span>{copy("导入密码", "Import passwords")}<small>{copy("选择从浏览器导出的 CSV 文件。", "Choose a CSV exported from your browser.")}</small></span>
        <button type="button" className={browserStyles.outlineButton} onClick={importPasswords}>{copy("选择文件", "Choose file")}</button></div>
      <div className={browserStyles.option}><span>{copy("加密备份与恢复", "Encrypted backups")}<small>{copy("使用主密码导出或恢复已有凭据。", "Export or restore saved accounts with your master password.")}</small></span>
        <button type="button" className={browserStyles.outlineButton} onClick={() => setManagerOpen(!managerOpen)}>{copy("管理备份", "Manage backups")}</button></div>
    </div>}
    {(!browserPage || tab === "passwords") && <fieldset disabled={busy || !state.available}>
      {!browserPage && <label className={styles.toggle}><input type="checkbox" checked={state.remembered?.enabled ?? true} onChange={event => { void request({ action: "remember-configure", enabled: event.target.checked }); }} />{copy("自动保存网页登录账户并自动登录", "Remember website accounts and sign in automatically")}</label>}
      {!browserPage && <label>{copy("搜索名称、站点或分组", "Search name, site or group")}<input value={search} onChange={event => setSearch(event.target.value)} /></label>}
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
            <button type="button" onClick={() => { setDraft({ ...item, password: "" }); setManagerOpen(true); if (browserPage) setTab("settings"); }}>{copy("编辑", "Edit")}</button>
            <button type="button" onClick={() => { if (window.confirm(copy("删除此凭据？", "Delete this credential?"))) void request({ action: "remove", id: item.id }); }}>{copy("删除", "Delete")}</button>
          </> : <>
            {state.unlocked && <button type="button" onClick={() => { void request({ action: "remember-promote", id: item.id }); }}>{copy("转入手动库以编辑", "Move to manual vault to edit")}</button>}
            <button type="button" onClick={() => { void request({ action: "remember-remove", id: item.id }); }}>{copy("删除已记住账户", "Delete remembered account")}</button>
          </>}
        </div>
      </li>)}</ul>
      {!rows.length && <p>{search ? copy("没有匹配的账户。", "No matching accounts.") : copy("还没有可见账户。可登录支持的网站自动保存，或解锁后手动添加。", "No accounts are visible yet. Sign in to a supported website to save one, or unlock the vault to add one manually.")}</p>}
      {browserPage && <button className={browserStyles.outlineButton} type="button" onClick={() => {setTab("settings"); setManagerOpen(true);}}>{state.unlocked ? copy("管理凭据库", "Manage vault") : copy("解锁或创建凭据库", "Open vault")}</button>}
    </fieldset>}

    {(!browserPage || tab === "settings") && <div className={browserPage ? browserStyles.advanced : undefined}>
    <details data-settings-id="data.credentialVault" open={managerOpen} onToggle={event => setManagerOpen(event.currentTarget.open)}>
      <summary>{copy("凭据库（本地加密）", "Credential vault (locally encrypted)")}</summary>
      <p>{copy("主密码至少 12 位，解锁持续 10 分钟；密码始终遮盖，导出备份同样使用主密码加密。", "Master password requires 12+ characters and unlocks for 10 minutes. Backups are encrypted with the same password.")}</p>
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
      <p>{copy("仅对明确信任的精确 HTTP origin（http://主机:端口）允许凭据保存与填写，最多 50 项。", "Allow saving and filling only on explicitly trusted exact HTTP origins (http://host:port), up to 50 entries.")}</p>
      <fieldset disabled={busy || !state.available}>
        <label>{copy("允许保存凭据的 HTTP origin", "HTTP origin allowed for credentials")}<input type="url" placeholder="http://intranet.example:8080" value={httpOrigin} onChange={event => setHttpOrigin(event.target.value)} /></label>
        <button type="button" disabled={!httpOrigin.trim() || (state.httpOrigins?.length ?? 0) >= 50} onClick={() => { void request({ action: "http-allow", url: httpOrigin.trim() }).then(ok => { if (ok) setHttpOrigin(""); }); }}>{copy("允许此 HTTP 站点保存和填写账户", "Allow credential saving and filling for this HTTP site")}</button>
        <ul>{state.httpOrigins?.map(origin => <li key={origin}><span>{origin} <span className={styles.insecure}>{copy("非加密连接", "Unencrypted connection")}</span></span><button type="button" onClick={() => { void request({ action: "http-remove", url: origin }); }}>{copy("移除 HTTP 站点", "Remove HTTP site")}</button></li>)}</ul>
      </fieldset>
    </details>

    <details data-settings-id="data.credentialSso">
      <summary>{copy("SSO 登录成功规则", "SSO sign-in completion rules")}</summary>
      <p>{copy("关联认证站点与回跳地址以判断登录完成，默认检查退出按钮或用户菜单。", "Associate authentication origins with return URLs to detect completed SSO sign-ins.")}</p>
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
    </div>}
    {error && <p role="alert">{copy("操作未完成。请检查密码、站点白名单、SSO 规则、备份及当前登录页；不符合填写规则的页面请手动登录。", "Operation not completed. Check the password, site allowlist, SSO rule, backup and current login page. Sign in manually on unsupported pages.")}</p>}
  </section>;
}
