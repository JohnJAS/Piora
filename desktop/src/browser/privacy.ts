import { randomUUID } from "node:crypto";
import type { Session } from "electron";
import type { BrowserContacts } from "./contacts.js";
import type { BrowserLibrary } from "./library.js";
import type { BrowserPermissions } from "../browser-permissions.js";
import { clearCategories, type ClearCategory, type ClearOptions, type ClearPreview } from "./contracts.js";

const hours = { hour: 1, day: 24, week: 168, month: 672, all: 0 };
export class BrowserPrivacy {
  private previewed: { options: ClearOptions; preview: ClearPreview } | undefined;
  constructor(
    private readonly library: BrowserLibrary,
    private readonly contacts: BrowserContacts,
    private readonly session: Session,
    private readonly permissions: () => BrowserPermissions,
    private readonly clearSites: () => Promise<void>,
  ) {}
  private async countOrClear(category: ClearCategory, since: number, until: number, clear: boolean) {
    switch (category) {
      case "history":
      case "downloads":
        return this.library.range(category, since, until, clear);
      case "contacts":
        return this.contacts.range(since, until, clear);
      case "permissions":
        return this.permissions().range(since, until, clear);
      case "cache":
        if (!clear) return this.session.getCacheSize();
        await this.session.clearCache();
        return 0;
      case "sites":
        if (!clear) return new Set((await this.session.cookies.get({})).map((cookie) => cookie.domain)).size;
        await this.clearSites();
        return 0;
    }
  }
  async preview(input: ClearOptions): Promise<ClearPreview> {
    if (
      !input ||
      !Object.hasOwn(hours, input.range) ||
      !Array.isArray(input.categories) ||
      !input.categories.length ||
      input.categories.some((key) => !clearCategories.includes(key))
    )
      throw new Error("Invalid data range");
    const categories = [...new Set(input.categories)];
    if (input.range !== "all" && (categories.includes("sites") || categories.includes("cache")))
      throw new Error("Cookie、站点数据和缓存仅支持全部时间");
    const until = Date.now(),
      since = input.range === "all" ? 0 : until - hours[input.range] * 3600000;
    const counts: ClearPreview["counts"] = {};
    for (const key of categories) counts[key] = await this.countOrClear(key, since, until, false);
    const preview = { token: randomUUID(), since, until, counts };
    this.previewed = { options: { categories, range: input.range }, preview };
    return preview;
  }
  async apply(token: string) {
    const entry = this.previewed;
    if (!entry || entry.preview.token !== token || Date.now() - entry.preview.until > 300000)
      throw new Error("清理预览已失效");
    this.previewed = undefined;
    const done: ClearCategory[] = [],
      failed: ClearCategory[] = [];
    for (const category of entry.options.categories) {
      try {
        await this.countOrClear(category, entry.preview.since, entry.preview.until, true);
        done.push(category);
      } catch {
        failed.push(category);
      }
    }
    return { done, failed };
  }
}
