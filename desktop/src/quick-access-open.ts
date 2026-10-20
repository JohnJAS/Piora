import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { QuickAccessError, type QuickAccessEnvironment, type QuickAccessStore } from "./quick-access-store.js";

export function hostsEditorCommand(systemRoot: string, elevated: boolean) {
  const editor = path.win32.join(systemRoot, "System32", "notepad.exe");
  const hosts = path.win32.join(systemRoot, "System32", "drivers", "etc", "hosts");
  if (!elevated) return { executable: editor, args: [hosts] };
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  // Only the main-process-owned Windows hosts path can enter this command.
  const script = `try { Start-Process -FilePath ${literal(editor)} -ArgumentList ${literal(`"${hosts}"`)} -Verb RunAs -WindowStyle Normal -ErrorAction Stop; exit 0 } catch { $e = $_.Exception; while ($e) { if ($e.NativeErrorCode -eq 1223) { exit 1223 }; $e = $e.InnerException }; exit 1 }`;
  return { executable: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")] };
}

export async function launchHostsEditor(systemRoot: string, elevated: boolean, processes: Pick<typeof import("node:child_process"), "execFile" | "spawn"> = { execFile, spawn }): Promise<"opened" | "cancelled"> {
  const command = hostsEditorCommand(systemRoot, elevated);
  if (elevated) return new Promise((resolve, reject) => {
    processes.execFile(command.executable, command.args, { windowsHide: true, timeout: 180_000 }, error => {
      if (!error) resolve("opened");
      else if (error.code === 1223) resolve("cancelled");
      else reject(new QuickAccessError("openFailed"));
    });
  });
  return new Promise((resolve, reject) => {
    const child = processes.spawn(command.executable, command.args, { windowsHide: false, detached: true, stdio: "ignore" });
    child.once("error", () => reject(new QuickAccessError("openFailed")));
    child.once("spawn", () => { child.unref(); resolve("opened"); });
  });
}

export interface QuickAccessOpenDependencies {
  openPath: (target: string) => Promise<string>;
  reveal: (target: string) => void;
  copy: (target: string) => void | Promise<void>;
  hostsEditor: (elevated: boolean) => Promise<"opened" | "cancelled">;
}

export async function openQuickAccess(store: QuickAccessStore, environment: QuickAccessEnvironment, dependencies: QuickAccessOpenDependencies, id: unknown, action: unknown = "open"): Promise<{ status: "opened" | "cancelled" }> {
  if (!["open", "reveal", "copy", "edit-admin"].includes(String(action))) throw new QuickAccessError("invalidInput");
  // Copy remains useful for a missing target; the other actions verify its current type.
  const item = action === "copy" ? (await store.list()).items.find(entry => entry.id === id) : await store.get(id);
  if (!item) throw new QuickAccessError("notFound");
  const hosts = environment.platform === "win32" && item.preset === "hosts";
  if (action === "edit-admin" && !hosts) throw new QuickAccessError("invalidInput");
  try {
    if (action === "copy") await dependencies.copy(item.path);
    else if (action === "reveal" && item.kind === "file") dependencies.reveal(item.path);
    else if (hosts && (action === "open" || action === "edit-admin")) return { status: await dependencies.hostsEditor(action === "edit-admin") };
    else if (await dependencies.openPath(item.path)) throw new QuickAccessError("openFailed");
    return { status: "opened" };
  } catch (cause) {
    if (cause instanceof QuickAccessError) throw cause;
    throw new QuickAccessError("openFailed");
  }
}
