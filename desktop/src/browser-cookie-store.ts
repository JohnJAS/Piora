import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Cookie, Cookies, CookiesSetDetails } from "electron";

interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function readPioraCookieSnapshot(value: unknown, legacyRestore = false): Cookie[] | null {
  if (Array.isArray(value)) return legacyRestore ? value : null;
  const envelope = value as { application?: string; version?: number; partition?: string; cookies?: unknown } | null;
  if (envelope?.application !== "Piora" || envelope.version !== 1 || envelope.partition !== "piora-browser"
    || !Array.isArray(envelope.cookies)) return null;
  return envelope.cookies;
}

export function sessionCookieDetails(cookie: Cookie): CookiesSetDetails | null {
  if (!cookie || cookie.session !== true || typeof cookie.domain !== "string" || !cookie.domain
    || typeof cookie.name !== "string" || typeof cookie.value !== "string") return null;
  if (("partitionKey" in cookie && cookie.partitionKey) || (cookie.path && (typeof cookie.path !== "string" || !cookie.path.startsWith("/")))) return null;
  const host = cookie.domain.replace(/^\./, "");
  if (!/^[a-z\d.:[\]-]+$/i.test(host)) return null;
  return {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`,
    name: cookie.name, value: cookie.value, path: cookie.path || "/",
    ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
    secure: cookie.secure === true, httpOnly: cookie.httpOnly === true, sameSite: cookie.sameSite,
  };
}

/** Chromium persists dated cookies itself, but discards session cookies at exit.
 * Restore those like a browser's "continue where you left off" mode. Keep the
 * snapshot encrypted by the OS and never change a server-issued expiry date. */
export class BrowserCookieStore {
  constructor(private readonly file: string, private readonly cookies: Pick<Cookies, "get" | "set">, private readonly cipher: Cipher) {}
  async restore(): Promise<void> {
    if (!this.cipher.isEncryptionAvailable()) return;
    let bytes: Buffer;
    try { bytes = await readFile(this.file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (bytes.length > 4 * 1024 * 1024) return;
    const saved = readPioraCookieSnapshot(JSON.parse(this.cipher.decryptString(bytes)), true);
    if (!saved) return;
    const existing = await this.cookies.get({});
    const identity = (cookie: Cookie) => JSON.stringify([cookie.domain, cookie.path, cookie.name]);
    const keys = new Set(existing.map(identity));
    for (const cookie of saved as Cookie[]) {
      if (!cookie || typeof cookie !== "object" || keys.has(identity(cookie))) continue;
      const details = sessionCookieDetails(cookie);
      if (details) await this.cookies.set(details).catch(() => undefined);
    }
  }
  async forget(): Promise<void> {
    await rm(this.file, { force: true });
  }
  async save(): Promise<void> {
    if (!this.cipher.isEncryptionAvailable()) return;
    const cookies = await this.cookies.get({ session: true });
    const bytes = this.cipher.encryptString(JSON.stringify({ application: "Piora", version: 1, partition: "piora-browser", cookies }));
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, bytes, { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
