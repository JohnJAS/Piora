import { readdir, readFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ImportSource, ImportBrowser } from "./contracts.js";

type ExternalBrowser = Exclude<ImportBrowser, "piora">;

export function browserDataRoot(browser: ExternalBrowser): string | undefined {
  const chrome = browser === "chrome";
  if (process.platform === "win32") {
    const root = process.env.LOCALAPPDATA;
    return root ? join(root, chrome ? "Google" : "Microsoft", chrome ? "Chrome" : "Edge", "User Data") : undefined;
  }
  if (process.platform === "darwin")
    return join(
      homedir(),
      "Library",
      "Application Support",
      ...(chrome ? ["Google", "Chrome"] : ["Microsoft Edge"]),
    );
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    chrome ? "google-chrome" : "microsoft-edge",
  );
}

const field = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 180) : "");
interface DisplayInfo {
  name?: string;
  gaia_name?: string;
  gaia_given_name?: string;
  user_name?: string;
  is_using_default_name?: boolean;
}

export async function browserProfiles(
  browser: ExternalBrowser,
  root = browserDataRoot(browser),
): Promise<ImportSource[]> {
  const fallback = [{ id: browser, browser, name: "", directory: "", account: "" }];
  if (!root) return fallback;
  let folders: string[];
  try {
    folders = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^(Default|Profile \d+)$/u.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return fallback;
  }
  let cache: Record<string, DisplayInfo> = {},
    lastUsed = "";
  try {
    const file = join(root, "Local State");
    if ((await lstat(file)).isFile()) {
      const { profile } = JSON.parse(await readFile(file, "utf8"));
      cache = profile?.info_cache ?? {};
      lastUsed = field(profile?.last_used);
    }
  } catch {
    /* Folder names identify profiles even when their display metadata is unavailable. */
  }
  folders.sort(
    (a, b) => Number(b === lastUsed) - Number(a === lastUsed) || a.localeCompare(b, "en", { numeric: true }),
  );
  if (!folders.length) return fallback;
  return folders.map((directory) => {
    const info = cache[directory] ?? {};
    const account = field(info.user_name);
    const accountName = field(info.gaia_given_name) || field(info.gaia_name) || account;
    const name = (info.is_using_default_name && accountName) || field(info.name) || accountName || directory;
    return { id: browser + "/" + directory, browser, name, account, directory };
  });
}

export function profileSettingsArguments(source: ImportSource) {
  if (source.browser === "piora" || !/^(Default|Profile \d+)$/u.test(source.directory))
    throw new Error("请先选择浏览器个人资料。");
  return [
    "--profile-directory=" + source.directory,
    source.browser === "chrome" ? "chrome://password-manager/settings" : "edge://settings/passwords",
  ];
}

export async function openImportSource(id: string) {
  const source = await selectedImportSource(id);
  const args = profileSettingsArguments(source);
  if (process.platform !== "win32") throw new Error("请在所选个人资料中打开浏览器的密码管理器。");
  const chrome = source.browser === "chrome";
  const suffix = chrome
    ? ["Google", "Chrome", "Application", "chrome.exe"]
    : ["Microsoft", "Edge", "Application", "msedge.exe"];
  const roots = new Set([
    process.env.LOCALAPPDATA,
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ]);
  for (const root of roots) {
    if (!root) continue;
    const executable = join(root, ...suffix);
    if (!(await lstat(executable).catch(() => null))?.isFile()) continue;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, { shell: false, detached: true, stdio: "ignore" });
      child.once("error", () => reject(new Error("无法打开来源浏览器。")));
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    return;
  }
  throw new Error("找不到来源浏览器，请手动打开所选个人资料的密码管理器。");
}

export async function importSources(): Promise<ImportSource[]> {
  const [chrome, edge] = await Promise.all([browserProfiles("chrome"), browserProfiles("edge")]);
  return [...chrome, ...edge, { id: "piora", browser: "piora", name: "", directory: "", account: "" }];
}

export async function selectedImportSource(id: string) {
  const browser = id.split("/")[0];
  if (browser === "piora" && id === "piora")
    return { id, browser: "piora" as const, name: "", directory: "", account: "" };
  if (browser !== "chrome" && browser !== "edge") throw new Error("未知的浏览器来源");
  const match = (await browserProfiles(browser)).find((source) => source.id === id);
  if (!match) throw new Error("此浏览器个人资料已更改，请重新打开导入窗口。");
  return match;
}
