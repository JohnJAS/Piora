import { execFile } from "node:child_process";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { QuickAccessError } from "./quick-access-store.js";

/** Electron's Windows picker dereferences .lnk files, losing their arguments. */
export function quickAccessFilePickerCommand(systemRoot: string, handle: Buffer, title: string) {
  const windowHandle = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const script = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition 'public sealed class PioraQuickAccessPickerOwner : System.Windows.Forms.IWin32Window { public System.IntPtr Handle { get; private set; } public PioraQuickAccessPickerOwner(long value) { Handle = new System.IntPtr(value); } }'
$owner = [PioraQuickAccessPickerOwner]::new([long]${windowHandle})
$picker = [System.Windows.Forms.OpenFileDialog]::new()
try {
  $picker.Title = ${literal(title)}
  $picker.DereferenceLinks = $false
  $picker.CheckFileExists = $true
  $picker.Multiselect = $false
  if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    ConvertTo-Json -InputObject $picker.FileName -Compress
  } else { 'null' }
} finally { $picker.Dispose() }`;
  return {
    executable: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
  };
}

export async function pickQuickAccessFile(owner: BrowserWindow, systemRoot: string, title: string, execute: typeof execFile = execFile): Promise<string | null> {
  const command = quickAccessFilePickerCommand(systemRoot, owner.getNativeWindowHandle(), title);
  const controller = new AbortController();
  const closed = () => controller.abort();
  owner.once("closed", closed);
  try {
    const output = await new Promise<string>((resolve, reject) => execute(command.executable, command.args, {
      windowsHide: true, encoding: "utf8", maxBuffer: 128 * 1024, signal: controller.signal,
    }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    const value: unknown = JSON.parse(output.replace(/^\uFEFF/, "").trim());
    if (value !== null && (typeof value !== "string" || !value || !path.win32.isAbsolute(value))) throw new Error("Invalid picker response");
    return value as string | null;
  } catch {
    if (controller.signal.aborted) return null;
    throw new QuickAccessError("pickerFailed");
  } finally { owner.removeListener("closed", closed); }
}
