import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserQuery, Transfer, TransferState, Visit } from "./contracts.js";

export function historyUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || raw.length > 8192)
      return null;
    const sensitive =
      /^(?:access_token|id_token|refresh_token|code|code_verifier|token|password|client_secret|samlresponse|session_state|ticket)$/i;
    const fragment = url.hash.slice(1).split("?", 2).at(-1) ?? "";
    if ([...url.searchParams.keys(), ...new URLSearchParams(fragment).keys()].some((key) => sensitive.test(key)))
      return null;
    if (/(?:^|\/)(?:oauth2?|sso|saml|auth)(?:\/[^/]+)*\/(?:callback|return|redirect)\/?$/i.test(url.pathname))
      return null;
    return url.href;
  } catch {
    return null;
  }
}

type SavedTransfer = Omit<Transfer, "live" | "resumable" | "missing">;
function queryValues(q: BrowserQuery) {
  return {
    text: typeof q.text === "string" ? q.text.trim().slice(0, 512) : "",
    before: Number.isSafeInteger(q.before) ? q.before! : Number.MAX_SAFE_INTEGER,
    since: Number.isFinite(q.since) ? q.since! : 0,
    until: Number.isFinite(q.until) ? q.until! : Number.MAX_SAFE_INTEGER,
    limit: Number.isSafeInteger(q.limit) ? Math.min(100, Math.max(1, q.limit!)) : 50,
  };
}

/** One store per browser partition. Live Electron DownloadItems never enter SQLite. */
export class BrowserLibrary {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error("Unsupported browser library version");
    }
    this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, title TEXT NOT NULL, visited INTEGER NOT NULL, source TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS visit_url ON visits(url);
      CREATE INDEX IF NOT EXISTS visit_title ON visits(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS visit_time ON visits(visited DESC);
      CREATE TABLE IF NOT EXISTS transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, path TEXT NOT NULL, url TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER, received INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS transfer_time ON transfers(started);
      CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
    this.db.prepare("UPDATE transfers SET state='interrupted', ended=? WHERE ended IS NULL").run(Date.now());
  }

  visit(raw: string, title: string, source: string, at = Date.now()): number | null {
    const url = historyUrl(raw);
    if (!url) return null;
    return Number(
      this.db
        .prepare("INSERT INTO visits(url,title,visited,source) VALUES(?,?,?,?)")
        .run(url, title.slice(0, 1000), at, source).lastInsertRowid,
    );
  }
  title(id: number, value: string) {
    this.db.prepare("UPDATE visits SET title=? WHERE id=?").run(value.slice(0, 1000), id);
  }
  history(query: BrowserQuery): Visit[] {
    const { text, before, since, until, limit } = queryValues(query);
    const filter =
      "id < ? AND visited BETWEEN ? AND ? AND (instr(lower(url),lower(?)) OR instr(lower(title),lower(?)))";
    const sql = query.suggestions
      ? `WITH ranked AS (SELECT max(id) AS id, count(*) AS frequency FROM visits WHERE ${filter} GROUP BY url) SELECT visits.* FROM ranked JOIN visits USING(id) ORDER BY visited / 86400000 DESC, frequency DESC, id DESC LIMIT ?`
      : `SELECT * FROM visits WHERE ${filter} ORDER BY id DESC LIMIT ?`;
    return this.db.prepare(sql).all(before, since, until, text, text, limit) as unknown as Visit[];
  }
  deleteVisit(id: number) {
    this.db.prepare("DELETE FROM visits WHERE id=?").run(id);
  }

  startDownload(filename: string, rawUrl: string, started = Date.now()): number {
    const url = historyUrl(rawUrl);
    return Number(
      this.db
        .prepare("INSERT INTO transfers(filename,path,url,started,state) VALUES(?,'',?,?,'progressing')")
        .run(filename, url || "", started).lastInsertRowid,
    );
  }
  updateDownload(
    id: number,
    path: string,
    received: number,
    total: number,
    state: TransferState,
    ended: number | null,
  ) {
    this.db
      .prepare("UPDATE transfers SET path=?, received=?, total=?, state=?, ended=? WHERE id=?")
      .run(path, received, total, state, ended, id);
  }
  downloads(query: BrowserQuery): SavedTransfer[] {
    const { text, before, since, until, limit } = queryValues(query);
    return this.db
      .prepare(
        "SELECT * FROM transfers WHERE id < ? AND started BETWEEN ? AND ? AND (instr(lower(filename),lower(?)) OR instr(lower(url),lower(?))) ORDER BY id DESC LIMIT ?",
      )
      .all(before, since, until, text, text, limit) as unknown as SavedTransfer[];
  }
  transfer(id: number): SavedTransfer | undefined {
    return this.db.prepare("SELECT * FROM transfers WHERE id=?").get(id) as unknown as SavedTransfer | undefined;
  }
  deleteTransfer(id: number) {
    this.db.prepare("DELETE FROM transfers WHERE id=? AND ended IS NOT NULL").run(id);
  }
  describe(row: SavedTransfer, live: boolean, resumable: boolean): Transfer {
    return { ...row, live, resumable, missing: row.state === "completed" && (!row.path || !existsSync(row.path)) };
  }
  range(kind: "history" | "downloads", since: number, until: number, clear = false): number {
    const target =
      kind === "history"
        ? "visits WHERE visited BETWEEN ? AND ?"
        : "transfers WHERE started BETWEEN ? AND ? AND ended <= ?";
    const bounds = kind === "history" ? [since, until] : [since, until, until];
    if (clear) return Number(this.db.prepare("DELETE FROM " + target).run(...bounds).changes);
    return Number(this.db.prepare("SELECT count(*) AS count FROM " + target).get(...bounds)?.count ?? 0);
  }
  deviceDefault(value?: boolean) {
    if (value !== undefined)
      this.db
        .prepare("INSERT OR REPLACE INTO preferences(key,value) VALUES('deviceDefault',?)")
        .run(String(value));
    return this.db.prepare("SELECT value FROM preferences WHERE key='deviceDefault'").get()?.value === "true";
  }
  close() {
    this.db.close();
  }
}
