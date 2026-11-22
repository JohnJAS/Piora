import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Session, WebContents } from "electron";

const labels: Record<string, string> = {
  "media:audio": "麦克风", "media:video": "摄像头", geolocation: "位置", "geolocation-approximate": "大致位置",
  notifications: "通知", "clipboard-read": "读取剪贴板", "clipboard-sanitized-write": "写入剪贴板",
  fullscreen: "全屏", pointerLock: "锁定鼠标指针", "screen-wake-lock": "保持屏幕唤醒",
  "persistent-storage": "持久保存网站数据", "local-fonts": "本机字体", "idle-detection": "检测设备空闲状态",
  sensors: "设备传感器", "local-network": "本地网络", "local-network-access": "本地网络", "loopback-network": "本机网络服务",
};
type Decisions = Record<string, boolean>;
type Page = { url: string; documentId: string; visible: boolean };
type Details = { isMainFrame: boolean; requestingUrl?: string; securityOrigin?: string; embeddingOrigin?: string; mediaType?: string; mediaTypes?: string[] };
export interface BrowserPermissionHost {
  page(contents: WebContents): Page | null;
  prompt(origin: string, permissions: string[]): Promise<{ decision: boolean | null; remember: boolean }>;
  warn(error: unknown): void;
}

function originOf(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? "");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.origin : null;
  } catch { return null; }
}

function permissionKeys(permission: string, details: Details, request: boolean): string[] {
  if (permission !== "media") return Object.hasOwn(labels, permission) ? [permission] : [];
  const types = request ? details.mediaTypes : [details.mediaType];
  // An unspecified media request must not turn microphone permission into camera permission.
  if (!types?.length || types.some(type => type !== "audio" && type !== "video")) return [];
  return [...new Set(types.map(type => `media:${type}`))].sort();
}

/** Exact-origin permissions. Hardware selection and display capture retain their separate Electron flows. */
export class BrowserPermissions {
  private readonly saved = new Map<string, Decisions>();
  private readonly temporary = new Map<string, Decisions>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private readonly decidedAt = new Map<string, number>();

  constructor(private readonly file: string, private readonly host: BrowserPermissionHost) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if ((data?.version !== 1 && data?.version !== 2) || !data.origins || typeof data.origins !== "object") return;
      if (data.version === 2 && data.times && typeof data.times === "object") {
        for (const [id, at] of Object.entries(data.times)) if (typeof at === "number" && Number.isFinite(at)) this.decidedAt.set(id, at);
      }
      for (const [origin, values] of Object.entries(data.origins).slice(0, 500)) {
        if (originOf(origin) !== origin || !values || typeof values !== "object") continue;
        const valid = Object.fromEntries(Object.entries(values).filter(([key, value]) => Object.hasOwn(labels, key) && typeof value === "boolean"));
        if (Object.keys(valid).length) this.saved.set(origin, valid);
      }
    } catch { /* First run or invalid file: ask on the next eligible request. */ }
  }

  install(session: Session): void {
    session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
      if (!contents) return false;
      const target = this.target(contents, details, requestingOrigin);
      const keys = permissionKeys(permission, details, false);
      return Boolean(target && keys.length && keys.every(key => this.decision(target.origin, target.page.documentId, key) === true));
    });
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      void this.request(contents, permission, details).then(callback, () => callback(false));
    });
  }

  reset(url: string): void {
    const origin = originOf(url);
    if (!origin) return;
    this.revision++;
    this.saved.delete(origin);
    for (const id of this.decidedAt.keys()) if (id.startsWith(origin + "\n")) this.decidedAt.delete(id);
    for (const key of this.temporary.keys()) if (key.startsWith(`${origin}\n`)) this.temporary.delete(key);
    this.persist();
  }

  private target(contents: WebContents, details: Details, requestingOrigin?: string): { origin: string; page: Page } | null {
    const page = this.host.page(contents);
    if (!page || !details.isMainFrame) return null;
    const origin = originOf(page.url);
    if (!origin || !details.requestingUrl || originOf(details.requestingUrl) !== origin) return null;
    for (const reported of [requestingOrigin, details.securityOrigin, details.embeddingOrigin]) {
      if (reported !== undefined && originOf(reported) !== origin) return null;
    }
    return { origin, page: { ...page } };
  }

  private decision(origin: string, documentId: string, key: string): boolean | undefined {
    return this.temporary.get(`${origin}\n${documentId}`)?.[key] ?? this.saved.get(origin)?.[key];
  }

  private async request(contents: WebContents, permission: string, details: Details): Promise<boolean> {
    const target = this.target(contents, details);
    const keys = permissionKeys(permission, details, true);
    if (!target || !keys.length) return false;
    const { origin, page } = target;
    const revision = this.revision;
    const current = (visible: boolean) => {
      const latest = this.target(contents, details);
      return revision === this.revision && latest?.origin === origin && latest.page.documentId === page.documentId && (!visible || latest.page.visible);
    };
    const decisions = () => keys.map(key => this.decision(origin, page.documentId, key));
    if (decisions().some(value => value === false)) return false;
    if (decisions().every(value => value === true)) return true;
    if (!page.visible) return false;
    const id = `${origin}\n${page.documentId}\n${keys.join(",")}`;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const result = this.queue.then(async () => {
      if (!current(true) || decisions().some(value => value === false)) return false;
      const missing = keys.filter(key => this.decision(origin, page.documentId, key) === undefined);
      if (!missing.length) return true;
      const answer = await this.host.prompt(origin, missing.map(key => labels[key]!));
      if (!current(true) || answer.decision === null) return false;
      const store = answer.remember ? this.saved : this.temporary;
      const storeKey = answer.remember ? origin : `${origin}\n${page.documentId}`;
      const values = { ...store.get(storeKey) };
      for (const key of missing) {
        values[key] = answer.decision;
        this.decidedAt.set(storeKey + "\n" + key, Date.now());
      }
      store.set(storeKey, values);
      // Bound per-document memory without expanding a permission to another page.
      if (this.temporary.size > 500) {
        const oldest = this.temporary.keys().next().value!;
        for (const key of Object.keys(this.temporary.get(oldest)!)) this.decidedAt.delete(oldest + "\n" + key);
        this.temporary.delete(oldest);
      }
      if (answer.remember) this.persist();
      return answer.decision;
    });
    this.queue = result.catch(() => {});
    this.pending.set(id, result);
    try { return await result; }
    finally { this.pending.delete(id); }
  }

  range(since: number, until: number, clear: boolean): number {
    const removals: Array<{ store: Map<string, Decisions>; scope: string; permission: string }> = [];
    for (const store of [this.saved, this.temporary]) {
      for (const [scope, values] of store) for (const permission of Object.keys(values)) {
        const at = this.decidedAt.get(scope + "\n" + permission);
        if (at === undefined ? since === 0 : at >= since && at <= until) removals.push({ store, scope, permission });
      }
    }
    if (!clear) return removals.length;
    this.revision++;
    const undo: Array<() => void> = [];
    for (const { store, scope, permission } of removals) {
      const values = store.get(scope)!;
      const old = values[permission]!, id = scope + "\n" + permission, at = this.decidedAt.get(id);
      undo.push(() => { values[permission] = old; store.set(scope, values); if (at !== undefined) this.decidedAt.set(id, at); });
      delete values[permission]; this.decidedAt.delete(id);
      if (!Object.keys(values).length) store.delete(scope);
    }
    try { if (removals.some(item => item.store === this.saved)) this.persist(true); }
    catch (error) { for (const restore of undo) restore(); throw error; }
    return removals.length;
  }

  private persist(throwOnFailure = false): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const times = Object.fromEntries([...this.decidedAt].filter(([key]) => key.split("\n").length === 2));
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 2, origins: Object.fromEntries(this.saved), times }), { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    } catch (error) { this.host.warn(error); if (throwOnFailure) throw error; }
  }
}
