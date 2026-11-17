import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

export interface BrowserDownloadPreferences { directory: string; askEachTime: boolean; effectiveDirectory: string }
type Preferences = { directory: string; askEachTime: boolean; zoom: Record<string, number> };
export const MIN_BROWSER_ZOOM = -3;
export const MAX_BROWSER_ZOOM = 5;
export const clampBrowserZoom = (level: number) => Math.max(MIN_BROWSER_ZOOM, Math.min(MAX_BROWSER_ZOOM, level));
export function browserOrigin(url: string): string | null {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.origin : null; } catch { return null; }
}

export class BrowserPreferences {
  private value: Preferences = { directory: "", askEachTime: false, zoom: {} };
  constructor(private readonly file: string) {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Preferences>;
      if (typeof saved.directory === "string" && isAbsolute(saved.directory) && !/[\x00-\x1f]/.test(saved.directory)) this.value.directory = saved.directory;
      if (typeof saved.askEachTime === "boolean") this.value.askEachTime = saved.askEachTime;
      if (saved.zoom && typeof saved.zoom === "object") for (const [origin, level] of Object.entries(saved.zoom).slice(-1000)) {
        if (browserOrigin(origin) === origin && typeof level === "number" && Number.isFinite(level)) this.value.zoom[origin] = clampBrowserZoom(level);
      }
    } catch { /* A new or malformed profile uses browser defaults. */ }
  }
  downloads(defaultDirectory: string): BrowserDownloadPreferences {
    return { directory: this.value.directory, askEachTime: this.value.askEachTime, effectiveDirectory: this.value.directory || defaultDirectory };
  }
  updateDownloads(input: unknown, defaultDirectory: string, apply: (path: string) => void): BrowserDownloadPreferences {
    if (!input || typeof input !== "object") throw new Error("Invalid download preferences");
    const candidate = input as Partial<BrowserDownloadPreferences>;
    if (typeof candidate.directory !== "string" || typeof candidate.askEachTime !== "boolean") throw new Error("Invalid download preferences");
    const directory = candidate.directory.trim();
    if (directory && (!isAbsolute(directory) || /[\x00-\x1f]/.test(directory))) throw new Error("Download directory must be an absolute path");
    const effective = directory || defaultDirectory;
    mkdirSync(effective, { recursive: true });
    if (!statSync(effective).isDirectory()) throw new Error("Download location is not a directory");
    accessSync(effective, constants.W_OK);
    const next = { ...this.value, directory, askEachTime: candidate.askEachTime };
    apply(effective);
    try { this.save(next); }
    catch (error) { apply(this.value.directory || defaultDirectory); throw error; }
    return this.downloads(defaultDirectory);
  }
  zoomLevel(url: string): number { const origin = browserOrigin(url); return origin ? this.value.zoom[origin] ?? 0 : 0; }
  setZoomLevel(url: string, level: number): number {
    const origin = browserOrigin(url);
    if (!origin || !Number.isFinite(level)) return 0;
    const zoom = { ...this.value.zoom };
    delete zoom[origin];
    const normalized = clampBrowserZoom(level);
    if (normalized !== 0) zoom[origin] = normalized;
    this.save({ ...this.value, zoom: Object.fromEntries(Object.entries(zoom).slice(-1000)) });
    return normalized;
  }
  private save(value: Preferences): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); renameSync(temporary, this.file); this.value = value; }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  }
}

/** Keep server filenames inside the selected directory and avoid silent overwrites. */
export function browserDownloadPath(directory: string, requestedName: string, reserved: ReadonlySet<string> = new Set()): string {
  const filename = basename(requestedName.replaceAll("\\", "/")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  const safe = !filename || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ? `download-${filename || "file"}` : filename;
  const extension = extname(safe), stem = safe.slice(0, safe.length - extension.length);
  for (let index = 0; index < 10000; index++) {
    const path = join(directory, index ? `${stem} (${index})${extension}` : safe);
    if (!existsSync(path) && !reserved.has(path)) return path;
  }
  throw new Error("Too many downloads with the same filename");
}

export function browserFontPreferences(platform = process.platform) {
  return { defaultFontSize: 16, defaultMonospaceFontSize: 13, minimumFontSize: 0, defaultEncoding: "UTF-8",
    defaultFontFamily: { monospace: platform === "win32" ? "Consolas" : platform === "darwin" ? "Menlo" : "DejaVu Sans Mono" } };
}
