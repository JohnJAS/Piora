import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { VaultEntry, VaultSnapshot } from "./credential-vault-types.js";
import { credentialUrl, storedCredentialUrl, credentialHttpOrigin } from "./credential-policy.js";
import { normalizeSsoRule, type SsoRule } from "./credential-sso.js";
export { credentialUrl } from "./credential-policy.js";
interface Cipher { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; getSelectedStorageBackend?: () => string }
interface Remembered { version: 1; enabled: boolean; entries: VaultEntry[]; blocked: string[]; httpOrigins?: string[]; policyBlocked?: string[]; ssoRules?: SsoRule[]; audit?: VaultSnapshot["audit"] }
interface Data { version: 1; salt: string; verifier: string; autofill: boolean; entries: VaultEntry[]; audit: VaultSnapshot["audit"] }
const error = () => new Error("凭据库操作失败，请检查主密码、系统加密与备份格式。");
function passwordKey(password: string, salt: Buffer) { if (typeof password !== "string" || password.length < 12 || password.length > 512) throw error(); return scryptSync(password, salt, 32); }
function entry(value: Partial<VaultEntry>, previous?: VaultEntry): VaultEntry {
  const field = (key: keyof VaultEntry, max: number) => { const text = value[key] ?? previous?.[key] ?? ""; if (typeof text !== "string" || text.length > max) throw error(); return text; };
  if (value.autoLogin !== undefined && typeof value.autoLogin !== "boolean") throw error();
  const name = field("name", 200), username = field("username", 500), password = field("password", 4096) || previous?.password || "";
  if (!name.trim() || !username || !password) throw error();
  const url = storedCredentialUrl(field("url", 2048));
  return { id: previous?.id ?? randomUUID(), name, url, username, password, notes: field("notes", 2000), group: field("group", 100), autoLogin: value.autoLogin ?? previous?.autoLogin ?? false, insecure: url.startsWith("http:") };
}
export class CredentialVault {
  private data: Data | undefined;
  private expires = 0;
  constructor(private readonly file: string, private readonly cipher: Cipher) {}
  available() { return this.cipher.isEncryptionAvailable() && this.cipher.getSelectedStorageBackend?.() !== "basic_text"; }
  private requireData() { if (!this.available() || !this.data || Date.now() > this.expires) { this.lock(); throw error(); } return this.data; }
  private persist(data = this.requireData()) { const bytes = this.cipher.encryptString(JSON.stringify(data)); mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(`${this.file}.tmp`, bytes, { mode: 0o600 }); renameSync(`${this.file}.tmp`, this.file); this.data = data; }
  private verify(password: string) { const data = this.requireData(); if (!timingSafeEqual(passwordKey(password, Buffer.from(data.salt, "base64")), Buffer.from(data.verifier, "base64"))) throw error(); }
  status(): VaultSnapshot {
    if (Date.now() > this.expires) this.lock();
    const remembered = this.readRemembered();
    return { httpOrigins: remembered.httpOrigins ?? [], ssoRules: remembered.ssoRules ?? [], remembered: this.rememberedStatus(), available: this.available(), initialized: existsSync(this.file), unlocked: Boolean(this.data), autofill: this.data?.autofill ?? false, entries: this.data?.entries.map(({ password: _password, ...metadata }) => { void _password; return { ...metadata, insecure: metadata.url.startsWith("http:") }; }) ?? [], audit: this.data ? [...this.data.audit, ...(remembered.audit ?? [])].sort((a, b) => b.at - a.at).slice(0, 100) : [] };
  }
  initialize(password: string) {
    if (existsSync(this.file) || !this.available()) throw error();
    const salt = randomBytes(16); const data: Data = { version: 1, salt: salt.toString("base64"), verifier: passwordKey(password, salt).toString("base64"), autofill: false, entries: [], audit: [] }; this.persist(data); this.expires = Date.now() + 10 * 60_000;
  }
  unlock(password: string) {
    this.lock();
    if (!this.available()) throw error();
    const bytes = readFileSync(this.file); if (bytes.length > 4 * 1024 * 1024) throw error();
    const data = JSON.parse(this.cipher.decryptString(bytes)) as Data;
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 500 || typeof data.autofill !== "boolean" || !Array.isArray(data.audit) || data.audit.length > 100 || Buffer.from(data.salt, "base64").length !== 16 || Buffer.from(data.verifier, "base64").length !== 32) throw error();
    const ids = new Set<string>();
    for (const item of data.entries) { if (typeof item.id !== "string" || ids.has(item.id)) throw error(); entry(item, item); ids.add(item.id); }
    for (const item of data.audit) if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.origin !== "string" || !Number.isFinite(item.at)) throw error();
    this.data = data; this.expires = Date.now() + 10 * 60_000;
    try { this.verify(password); } catch { this.lock(); throw error(); }
  }
  lock() { this.data = undefined; this.expires = 0; }
  save(value: Partial<VaultEntry>) { const data = this.requireData(); const previous = data.entries.find(item => item.id === value.id); if (value.id && !previous) throw error(); if (!previous && data.entries.length >= 500) throw error(); const next = entry(value, previous); if (!this.allowedUrl(next.url)) throw error(); this.persist({ ...data, entries: [...data.entries.filter(item => item.id !== next.id), next] }); }
  remove(id: string) { const data = this.requireData(); this.persist({ ...data, entries: data.entries.filter(item => item.id !== id) }); }
  configure(enabled: boolean) { this.persist({ ...this.requireData(), autofill: enabled }); }
  allowedOrigins(): string[] { return this.readRemembered().httpOrigins ?? []; }
  allowedUrl(url: string): boolean { try { credentialUrl(url, this.allowedOrigins()); return true; } catch { return false; } }
  allowHttpOrigin(value: string): void {
    const origin = credentialHttpOrigin(value), data = this.readRemembered();
    const origins = [...new Set([...(data.httpOrigins ?? []), origin])];
    if (origins.length > 50) throw error();
    const restored = (data.policyBlocked ?? []).filter(url => new URL(url).origin === origin);
    this.writeRemembered({ ...data, httpOrigins: origins, blocked: data.blocked.filter(url => !restored.includes(url)), policyBlocked: (data.policyBlocked ?? []).filter(url => !restored.includes(url)) });
  }
  removeHttpOrigin(value: string): void {
    const origin = credentialHttpOrigin(value), data = this.readRemembered();
    const newlyBlocked = data.entries.filter(item => new URL(item.url).origin === origin && !data.blocked.includes(item.url)).map(item => item.url);
    this.writeRemembered({ ...data, httpOrigins: (data.httpOrigins ?? []).filter(item => item !== origin), blocked: [...new Set([...data.blocked, ...newlyBlocked])].slice(-500), policyBlocked: [...new Set([...(data.policyBlocked ?? []), ...newlyBlocked])].slice(-500) });
  }
  ssoRules(): SsoRule[] { return (this.readRemembered().ssoRules ?? []).filter(rule => this.allowedUrl(rule.authOrigin) && this.allowedUrl(rule.returnUrl)); }
  saveSsoRule(value: Partial<SsoRule>): void {
    const normalized = normalizeSsoRule(value), data = this.readRemembered();
    const rule = { ...normalized, id: normalized.id || randomUUID() };
    if (typeof rule.id !== "string" || rule.id.length > 100) throw error();
    if (!this.allowedUrl(rule.authOrigin) || !this.allowedUrl(rule.returnUrl)) throw error();
    const rules = [...(data.ssoRules ?? []).filter(item => item.id !== rule.id), rule];
    if (rules.length > 50) throw error();
    this.writeRemembered({ ...data, ssoRules: rules });
  }
  removeSsoRule(id: string): void { const data = this.readRemembered(); this.writeRemembered({ ...data, ssoRules: (data.ssoRules ?? []).filter(rule => rule.id !== id) }); }
  candidates(url: string, automatic: boolean) { try { const data = this.requireData(); if (automatic && !data.autofill) return []; const target = credentialUrl(url, this.allowedOrigins()); return data.entries.filter(item => item.url === target).map(item => ({ id: item.id, name: item.name })); } catch { return []; } }
  credential(id: string, url: string) { const data = this.requireData(); const target = credentialUrl(url, this.allowedOrigins()); const found = [...data.entries, ...this.readRemembered().entries].find(item => item.id === id && item.url === target); if (!found) throw error(); return found; }
  record(id: string, url: string) { const data = this.requireData(); const found = this.credential(id, url); this.persist({ ...data, audit: [{ id, name: found.name, origin: new URL(url).origin, at: Date.now() }, ...data.audit].slice(0, 100) }); }
  private readRemembered(): Remembered {
    const empty: Remembered = { version: 1, enabled: true, entries: [], blocked: [] };
    if (!this.available()) return { ...empty, enabled: false };
    const file = `${this.file}.browser`;
    if (!existsSync(file)) return empty;
    try {
      const bytes = readFileSync(file);
      if (bytes.length > 4 * 1024 * 1024) throw error();
      const value = JSON.parse(this.cipher.decryptString(bytes)) as Remembered;
      if (value.version !== 1 || typeof value.enabled !== "boolean" || !Array.isArray(value.entries) || value.entries.length > 500 || !Array.isArray(value.blocked) || value.blocked.length > 500 || value.blocked.some(item => typeof item !== "string")) throw error();
      for (const item of value.entries) entry(item, item);
      if (value.httpOrigins !== undefined && (!Array.isArray(value.httpOrigins) || value.httpOrigins.length > 50 || value.httpOrigins.some(origin => credentialHttpOrigin(origin) !== origin))) throw error();
      if (value.policyBlocked !== undefined && (!Array.isArray(value.policyBlocked) || value.policyBlocked.length > 500 || value.policyBlocked.some(url => storedCredentialUrl(url) !== url))) throw error();
      if (value.ssoRules !== undefined) { if (!Array.isArray(value.ssoRules) || value.ssoRules.length > 50) throw error(); for (const rule of value.ssoRules) normalizeSsoRule(rule); }
      if (value.audit !== undefined && (!Array.isArray(value.audit) || value.audit.length > 100 || value.audit.some(item => typeof item.id !== "string" || typeof item.name !== "string" || typeof item.origin !== "string" || !Number.isFinite(item.at)))) throw error();
      return value;
    } catch { return { ...empty, enabled: false }; }
  }
  private writeRemembered(data: Remembered) {
    if (!this.available()) throw error();
    const file = `${this.file}.browser`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, this.cipher.encryptString(JSON.stringify(data)), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  rememberedStatus() {
    const data = this.readRemembered();
    const unlocked = Boolean(this.data && Date.now() <= this.expires);
    return { enabled: data.enabled, entries: data.entries.map(item => ({ id: item.id, url: item.url, enabled: item.autoLogin !== false, insecure: item.url.startsWith("http:"), ...(unlocked ? { name: item.name, username: item.username, group: item.group, notes: item.notes } : {}) })) };
  }
  configureRemembered(enabled: boolean) { this.writeRemembered({ ...this.readRemembered(), enabled }); }
  removeRemembered(id: string) {
    const data = this.readRemembered(), item = data.entries.find(row => row.id === id);
    if (!item) return;
    this.writeRemembered({ ...data, entries: data.entries.filter(row => row.id !== id), blocked: [...new Set([...data.blocked, item.url])].slice(-500), policyBlocked: (data.policyBlocked ?? []).filter(url => url !== item.url) });
  }
  toggleRemembered(id: string, enabled: boolean) {
    const data = this.readRemembered();
    this.writeRemembered({ ...data, entries: data.entries.map(item => item.id === id ? { ...item, autoLogin: enabled } : item) });
  }
  promoteRemembered(id: string): void {
    const data = this.requireData(), remembered = this.readRemembered();
    const found = remembered.entries.find(item => item.id === id);
    if (!found || data.entries.length >= 500 || data.entries.some(item => item.id === id) || !this.allowedUrl(found.url)) throw error();
    // Persist the destination first. A failed second write may leave two visible copies, never lose a password.
    this.persist({ ...data, entries: [...data.entries, entry(found, found)] });
    this.removeRemembered(id);
  }
  recordAutomatic(id: string, url: string): void {
    const target = credentialUrl(url, this.allowedOrigins()), remembered = this.readRemembered();
    const found = this.automaticCredential(target);
    if (!found || found.id !== id) return;
    this.writeRemembered({ ...remembered, audit: [{ id, name: found.name, origin: new URL(target).origin, at: Date.now() }, ...(remembered.audit ?? [])].slice(0, 100) });
  }
  rememberLogin(value: { url: string; username: string; password: string }) {
    const data = this.readRemembered();
    const url = credentialUrl(value.url, data.httpOrigins ?? []);
    if (!data.enabled || data.blocked.includes(url)) return;
    const previous = data.entries.find(item => item.url === url && item.username === value.username);
    if (previous?.autoLogin === false || (!previous && data.entries.length >= 500)) return;
    const next = entry({ ...value, url, name: new URL(url).hostname, autoLogin: true }, previous);
    this.writeRemembered({ ...data, entries: [...data.entries.filter(item => item.id !== next.id), next] });
  }
  /** Browser accounts are remembered by default; legacy manual entries keep their explicit permission. */
  automaticCredential(url: string): VaultEntry | undefined {
    try {
      if (!this.available()) return undefined;
      const remembered = this.readRemembered();
      if (!remembered.enabled) return undefined;
      let entries: VaultEntry[] = [];
      if (existsSync(this.file)) {
        const bytes = readFileSync(this.file);
        if (bytes.length > 4 * 1024 * 1024) return undefined;
        const data = JSON.parse(this.cipher.decryptString(bytes)) as Data;
        if (data.version !== 1 || !Array.isArray(data.entries)) return undefined;
        entries = data.entries;
      }
      const target = credentialUrl(url, remembered.httpOrigins ?? []);
      const manual = entries.filter(item => item.url === target);
      const matches = manual.length ? manual : remembered.entries.filter(item => item.url === target);
      if (matches.length !== 1 || matches[0]?.autoLogin !== true) return undefined;
      return entry(matches[0], matches[0]);
    } catch { return undefined; }
  }
  export(password: string): Buffer {
    this.verify(password); const data = this.requireData(); const salt = randomBytes(16), iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", passwordKey(password, salt), iv);
    const keys = new Set(data.entries.map(item => JSON.stringify([item.url, item.username])));
    const entries = [...data.entries, ...this.readRemembered().entries.filter(item => !keys.has(JSON.stringify([item.url, item.username])))];
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 1, entries }), "utf8"), cipher.final()]);
    return Buffer.from(JSON.stringify({ version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") }));
  }
  import(bytes: Buffer, password: string) {
    const data = this.requireData(); if (bytes.length > 4 * 1024 * 1024) throw error();
    const envelope = JSON.parse(bytes.toString("utf8")); if (envelope.version !== 1) throw error();
    const salt = Buffer.from(envelope.salt, "base64"), iv = Buffer.from(envelope.iv, "base64"), tag = Buffer.from(envelope.tag, "base64");
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw error();
    const decipher = createDecipheriv("aes-256-gcm", passwordKey(password, salt), iv); decipher.setAuthTag(tag);
    const imported = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
    if (imported.version !== 1 || !Array.isArray(imported.entries) || imported.entries.length + data.entries.length > 500) throw error();
    const entries = imported.entries.map((item: Partial<VaultEntry>) => entry({ ...item, autoLogin: false }));
    this.persist({ ...data, entries: [...data.entries, ...entries] });
  }
}
