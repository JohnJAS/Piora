import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QuickAccessEntry, QuickAccessItem, QuickAccessKind, QuickAccessPreset, QuickAccessSnapshot } from "./quick-access-types.js";

export class QuickAccessError extends Error {
  constructor(code: string) { super(`quickAccess.error.${code}`); }
}

export interface QuickAccessEnvironment {
  platform: string;
  systemRoot: string;
  folders: Record<"downloads" | "desktop" | "documents", string>;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validText = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

/** One serialized writer owns the on-disk bookmark list, independent of agent sessions. */
export class QuickAccessStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  private readonly paths: typeof path;
  readonly presets: QuickAccessSnapshot["presets"];

  constructor(private readonly directory: string, private readonly environment: QuickAccessEnvironment) {
    this.file = path.join(directory, "quick-access.json");
    this.paths = environment.platform === "win32" ? path.win32 : path.posix;
    this.presets = [
      ...(["downloads", "desktop", "documents"] as const).map(id => ({ id, path: environment.folders[id], kind: "folder" as const })),
      ...(environment.platform === "win32" ? [{ id: "hosts" as const, path: this.paths.join(environment.systemRoot, "System32", "drivers", "etc", "hosts"), kind: "file" as const }] : []),
    ];
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  private normalize(value: unknown): string {
    if (!validText(value, 32767) || !this.paths.isAbsolute(value.trim()) || /^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^\\\\[?.]\\/.test(value)) throw new QuickAccessError("invalidPath");
    return this.paths.normalize(value.trim());
  }

  private key(value: string): string {
    const normalized = this.paths.normalize(value).replace(/[\\/]+$/, "");
    return this.environment.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  private makePreset(id: QuickAccessPreset): QuickAccessItem {
    const preset = this.presets.find(item => item.id === id);
    if (!preset) throw new QuickAccessError("invalidPreset");
    return { id: randomUUID(), name: id === "hosts" ? "hosts" : "", path: preset.path, kind: preset.kind, pinned: true, preset: id };
  }

  private async read(): Promise<QuickAccessItem[]> {
    let text: string;
    try { text = await readFile(this.file, "utf8"); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw new QuickAccessError("storage");
      const initial = this.presets.map(item => this.makePreset(item.id));
      await this.write(initial);
      return initial;
    }
    try {
      const data: unknown = JSON.parse(text);
      if (!record(data) || data.version !== 1 || !Array.isArray(data.items) || data.items.length > 500) throw new Error();
      const ids = new Set<string>(), paths = new Set<string>();
      return data.items.map((item: unknown) => {
        if (!record(item) || !validText(item.id, 100) || typeof item.name !== "string" || item.name.length > 120 || /[\u0000-\u001f\u007f]/.test(item.name) || typeof item.pinned !== "boolean" || !["file", "folder"].includes(String(item.kind))) throw new Error();
        const target = this.normalize(item.path);
        if (ids.has(item.id) || paths.has(this.key(target))) throw new Error();
        ids.add(item.id); paths.add(this.key(target));
        const preset = this.presets.find(entry => entry.id === item.preset && this.key(entry.path) === this.key(target) && entry.kind === item.kind);
        return { id: item.id, name: item.name, path: target, kind: item.kind as QuickAccessKind, pinned: item.pinned, ...(preset ? { preset: preset.id } : {}) };
      });
    } catch { throw new QuickAccessError("storage"); }
  }

  private async write(items: QuickAccessItem[]): Promise<void> {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporary, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
    } catch { throw new QuickAccessError("storage"); }
    finally { await unlink(temporary).catch(() => {}); }
  }

  private async kind(target: string): Promise<QuickAccessKind> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // A disconnected drive must not hold the bookmark writer or UI indefinitely.
      const info = await Promise.race([stat(target), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new QuickAccessError("unavailable")), 2000);
      })]);
      if (info.isDirectory()) return "folder";
      if (info.isFile()) return "file";
      throw new QuickAccessError("invalidPath");
    } catch (cause) {
      if (cause instanceof QuickAccessError) throw cause;
      throw new QuickAccessError((cause as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable");
    } finally { if (timer) clearTimeout(timer); }
  }

  private async snapshot(items: QuickAccessItem[]): Promise<QuickAccessSnapshot> {
    const entries = await Promise.all(items.map(async (item): Promise<QuickAccessEntry> => {
      try { return { ...item, availability: await this.kind(item.path) === item.kind ? "available" : "unavailable" }; }
      catch (cause) { return { ...item, availability: cause instanceof QuickAccessError && cause.message.endsWith(".missing") ? "missing" : "unavailable" }; }
    }));
    return { items: entries.sort((a, b) => Number(b.pinned) - Number(a.pinned)), presets: this.presets };
  }

  list(): Promise<QuickAccessSnapshot> { return this.serialized(async () => this.snapshot(await this.read())); }

  get(id: unknown): Promise<QuickAccessItem> {
    return this.serialized(async () => {
      if (!validText(id, 100)) throw new QuickAccessError("notFound");
      const item = (await this.read()).find(entry => entry.id === id);
      if (!item) throw new QuickAccessError("notFound");
      if (await this.kind(item.path) !== item.kind) throw new QuickAccessError("unavailable");
      return item;
    });
  }

  mutate(input: unknown): Promise<QuickAccessSnapshot> {
    return this.serialized(async () => {
      if (!record(input)) throw new QuickAccessError("invalidInput");
      let items = await this.read();
      const name = (value: unknown) => {
        if (!validText(value, 120)) throw new QuickAccessError("invalidName");
        return value.trim();
      };
      const unique = (target: string, except?: string) => {
        if (items.some(item => item.id !== except && this.key(item.path) === this.key(target))) throw new QuickAccessError("duplicate");
      };
      switch (input.type) {
        case "add": {
          if (items.length >= 500) throw new QuickAccessError("limit");
          const target = this.normalize(input.path);
          unique(target);
          const kind = await this.kind(target);
          const preset = this.presets.find(entry => entry.kind === kind && this.key(entry.path) === this.key(target));
          const defaultName = preset ? preset.id === "hosts" ? "hosts" : "" : this.paths.basename(target) || target;
          items.push({ id: randomUUID(), name: input.name === undefined ? defaultName : name(input.name), path: target, kind, pinned: false, ...(preset ? { preset: preset.id } : {}) });
          break;
        }
        case "preset": {
          if (items.length >= 500) throw new QuickAccessError("limit");
          const item = this.makePreset(input.preset as QuickAccessPreset);
          unique(item.path); items.push(item); break;
        }
        case "update": {
          const item = items.find(entry => entry.id === input.id);
          if (!item) throw new QuickAccessError("notFound");
          if (input.name !== undefined) item.name = name(input.name);
          if (input.pinned !== undefined) {
            if (typeof input.pinned !== "boolean") throw new QuickAccessError("invalidInput");
            item.pinned = input.pinned;
          }
          if (input.path !== undefined) {
            const target = this.normalize(input.path);
            unique(target, item.id);
            item.kind = await this.kind(target);
            item.path = target;
            if (!this.presets.some(preset => preset.id === item.preset && this.key(preset.path) === this.key(target))) delete item.preset;
          }
          break;
        }
        case "remove": {
          if (!items.some(item => item.id === input.id)) throw new QuickAccessError("notFound");
          items = items.filter(item => item.id !== input.id); break;
        }
        case "reorder": {
          if (!Array.isArray(input.ids) || input.ids.length !== items.length || new Set(input.ids).size !== items.length) throw new QuickAccessError("invalidInput");
          const byId = new Map(items.map(item => [item.id, item]));
          items = input.ids.map((id: unknown) => {
            const item = typeof id === "string" ? byId.get(id) : undefined;
            if (!item) throw new QuickAccessError("invalidInput");
            return item;
          });
          break;
        }
        default: throw new QuickAccessError("invalidInput");
      }
      await this.write(items);
      return this.snapshot(items);
    });
  }
}
