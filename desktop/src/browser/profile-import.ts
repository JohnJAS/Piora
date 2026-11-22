import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { open } from "node:fs/promises";
import { dialog, safeStorage, type BrowserWindow, type Cookie, type Session } from "electron";
import type { CredentialVault } from "../credential-vault.js";
import { readPioraCookieSnapshot, sessionCookieDetails } from "../browser-cookie-store.js";
import type { ImportKind, ImportPreview, ImportResult, ImportSelection, ImportedVisit } from "./contracts.js";

import { passwordCsv, type PasswordRow } from "./password-csv.js";
import { selectedImportSource } from "./import-sources.js";
import { profileHistory } from "./profile-history.js";
import type { BrowserLibrary } from "./library.js";

type Batch =
  | { kind: "history"; rows: ImportedVisit[]; source: string; skipped: number }
  | { kind: "passwords"; rows: PasswordRow[] }
  | { kind: "cookies"; rows: Cookie[]; skipped: number };
const cookieKey = (cookie: Cookie) => JSON.stringify([cookie.domain, cookie.path, cookie.name]);
function cookieSite(cookie: Cookie) {
  const details = sessionCookieDetails(cookie);
  if (!details) return "";
  const url = new URL(details.url);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "";
  return url.origin;
}

export class BrowserProfileImport {
  private readonly pending = new Map<string, { batch: Batch; timer: NodeJS.Timeout }>();
  constructor(
    private readonly parent: BrowserWindow,
    private readonly session: Session,
    private readonly vault: () => CredentialVault,
    private readonly writeSites: <T>(operation: () => Promise<T>) => Promise<T>,
    private readonly library: BrowserLibrary,
    private readonly historyChanged: () => void,
  ) {}
  cancel(token: string) {
    const entry = this.pending.get(token);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(token);
    }
  }
  close() {
    for (const token of this.pending.keys()) this.cancel(token);
  }
  async choose(selection: ImportKind | ImportSelection, owner = this.parent): Promise<ImportPreview | null> {
    const kind = typeof selection === "string" ? selection : selection?.kind;
    const source =
      typeof selection === "object" && selection ? await selectedImportSource(selection.sourceId) : undefined;
    if (kind === "history") {
      if (!source) throw new Error("请选择来源个人资料");
      const { rows, skipped } = await profileHistory(source);
      const { duplicates } = this.library.importVisits(rows, source.id, true);
      const sites = [...new Set(rows.map((row) => new URL(row.url).origin))];
      return this.stage(
        { kind, rows, skipped, source: source.id },
        source.name,
        rows.length,
        duplicates,
        skipped,
        sites,
      );
    }
    if (kind === "cookies" && source && source.browser !== "piora") throw new Error("请选择 Piora 会话备份来源。");
    if (kind !== "cookies" && kind !== "passwords") throw new Error("Invalid import type");
    if (kind === "passwords" && !this.vault().status().unlocked)
      throw new Error("请先在密码管理器中创建或解锁凭据库");
    const result = await dialog.showOpenDialog(owner, {
      properties: ["openFile"],
      ...(source?.name
        ? {
            title:
              "选择文件 · " +
              (source.browser === "chrome" ? "Google Chrome" : "Microsoft Edge") +
              " · " +
              source.name +
              " — 选择此个人资料导出的密码 CSV",
          }
        : {}),
      filters: [
        kind === "passwords"
          ? { name: "Chrome / Edge password CSV", extensions: ["csv"] }
          : { name: "Piora browser-session-cookies.enc", extensions: ["enc"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0],
      filename = basename(path);
    if (kind === "cookies" && filename.toLowerCase() !== "browser-session-cookies.enc")
      throw new Error("请选择 Piora 的 browser-session-cookies.enc 会话备份");
    const file = await open(path, "r");
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error("Import file exceeds 4 MiB");
      bytes = await file.readFile();
      if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("Import file exceeds 4 MiB");
    } finally {
      await file.close();
    }
    let batch: Batch, valid: number, duplicates: number, skipped: number, sites: string[];
    try {
      if (kind === "passwords") {
        const rows = passwordCsv(bytes.toString("utf8"));
        const stats = this.vault().importPasswordRows(rows, false, true);
        valid = stats.added + stats.duplicates;
        duplicates = stats.duplicates;
        skipped = stats.invalid;
        sites = stats.sites;
        batch = { kind, rows };
      } else {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("系统加密不可用");
        const saved = readPioraCookieSnapshot(JSON.parse(safeStorage.decryptString(bytes)));
        if (!saved || saved.length > 10000) throw new Error("Invalid Piora cookie backup");
        const rows: Cookie[] = [];
        for (const item of saved as Array<Cookie & { partitionKey?: unknown }>) {
          if (
            item &&
            item.session === true &&
            typeof item.domain === "string" &&
            typeof item.path === "string" &&
            typeof item.name === "string" &&
            typeof item.value === "string" &&
            !item.partitionKey &&
            cookieSite(item)
          )
            rows.push(item);
        }
        const existing = new Set((await this.session.cookies.get({})).map(cookieKey));
        duplicates = rows.filter((row) => existing.has(cookieKey(row))).length;
        valid = rows.length;
        skipped = saved.length - rows.length;
        sites = [...new Set(rows.map(cookieSite))];
        batch = { kind, rows, skipped };
      }
    } catch {
      throw new Error("无法读取所选文件，请检查格式、来源和当前系统账户");
    } finally {
      bytes.fill(0);
    }
    return this.stage(batch, filename, valid, duplicates, skipped, sites);
  }
  private stage(
    batch: Batch,
    filename: string,
    valid: number,
    duplicates: number,
    skipped: number,
    sites: string[],
  ): ImportPreview {
    const token = randomUUID();
    const timer = setTimeout(() => this.cancel(token), 5 * 60000);
    timer.unref();
    this.pending.set(token, { batch, timer });
    return { token, filename, kind: batch.kind, valid, duplicates, skipped, sites };
  }
  async apply(token: string, replace: boolean, sites: string[]): Promise<ImportResult> {
    const pending = this.pending.get(token);
    if (!pending || !Array.isArray(sites) || !sites.length) throw new Error("导入预览已过期或未选择站点");
    this.cancel(token);
    const selected = new Set(sites);
    const batch = pending.batch;
    if (batch.kind === "history") {
      const rows = batch.rows.filter((row) => selected.has(new URL(row.url).origin));
      const { added } = this.library.importVisits(rows, batch.source);
      this.historyChanged();
      return { added, skipped: batch.skipped + batch.rows.length - added, failed: 0 };
    }
    if (batch.kind === "passwords") {
      const rows = batch.rows.filter((row) => {
        try {
          return selected.has(new URL(row.url).origin);
        } catch {
          return false;
        }
      });
      const result = this.vault().importPasswordRows(rows, replace, false);
      return {
        added: result.added,
        skipped: batch.rows.length - result.added - result.invalid,
        failed: result.invalid,
      };
    }
    return this.writeSites(async () => {
      const existing = new Set((await this.session.cookies.get({})).map(cookieKey));
      let added = 0,
        skipped = batch.skipped,
        failed = 0;
      for (const row of batch.rows) {
        const key = cookieKey(row);
        if (!selected.has(cookieSite(row)) || (!replace && existing.has(key))) {
          skipped++;
          continue;
        }
        try {
          await this.session.cookies.set(sessionCookieDetails(row)!);
          existing.add(key);
          added++;
        } catch {
          failed++;
        }
      }
      return { added, skipped, failed };
    });
  }
}
