import { DatabaseSync } from "node:sqlite";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToWindow } from "node:timers/promises";
import type { ImportedVisit, ImportSource } from "./contracts.js";
import { browserDataRoot } from "./import-sources.js";
import { historyUrl } from "./library.js";

export async function profileHistory(profile: ImportSource): Promise<{ rows: ImportedVisit[]; skipped: number }> {
  if (profile.browser === "piora" || !/^(Default|Profile \d+)$/u.test(profile.directory))
    throw new Error("请选择一个本机浏览器个人资料。");
  const root = browserDataRoot(profile.browser);
  if (!root) throw new Error("找不到所选个人资料。");
  const file = join(root, profile.directory, "History");
  if (!(await lstat(file).catch(() => null))?.isFile()) throw new Error("此个人资料没有可导入的浏览记录。");
  let db: DatabaseSync | undefined;
  const rows: ImportedVisit[] = [];
  let skipped = 0;
  try {
    db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF");
    // Convert Chromium's microseconds since 1601 inside SQLite, before conversion to a JS Number.
    const statement =
      db.prepare(`SELECT urls.url, urls.title, CAST(visits.visit_time / 1000 AS INTEGER) - 11644473600000 AS visited
      FROM visits JOIN urls ON urls.id=visits.url WHERE urls.hidden=0 ORDER BY visits.id`);
    for (const item of statement.iterate()) {
      const url = typeof item.url === "string" ? historyUrl(item.url) : null;
      const visited = Number(item.visited);
      if (url && Number.isSafeInteger(visited) && visited > 0 && visited <= 8640000000000000)
        rows.push({ url, title: String(item.title ?? "").slice(0, 1000), visited });
      else skipped++;
      if ((rows.length + skipped) % 512 === 0) await yieldToWindow();
    }
  } catch {
    throw new Error("暂时无法读取所选个人资料的浏览记录。请完全退出来源浏览器再试一次。");
  } finally {
    db?.close();
  }
  return { rows, skipped };
}
