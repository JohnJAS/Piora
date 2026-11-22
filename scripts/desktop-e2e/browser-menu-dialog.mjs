import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

const run = promisify(execFile);
export async function fixtureBrowserPid(browser) {
  const cdp = await browser.newBrowserCDPSession();
  let browserPid;
  try {
    browserPid = (await cdp.send("SystemInfo.getProcessInfo")).processInfo.find(
      (info) => info.type === "browser",
    )?.id;
  } finally {
    await cdp.detach();
  }
  if (!Number.isSafeInteger(browserPid) || !browserPid) throw new Error("Isolated Electron PID unavailable");
  return browserPid;
}
export async function menuDialog(browserPid, operation, directory, file) {
  let script = fileURLToPath(new URL("./browser-menu-dialog.ps1", import.meta.url));
  const hasPwsh = (process.env.PATH ?? "").split(delimiter).some(part => existsSync(join(part, "pwsh.exe")));
  const shell = hasPwsh ? "pwsh.exe" : "powershell.exe";
  if (!hasPwsh) {
    // Windows PowerShell 5 reads BOM-less UTF-8 as an ANSI code page. Keep the
    // localized selectors intact without changing the source or the OS setup.
    const legacyScript = join(directory, "browser-menu-dialog-legacy.ps1");
    await writeFile(legacyScript, `\uFEFF${await readFile(script, "utf8")}`, "utf8");
    await copyFile(fileURLToPath(new URL("./windows-print-frame.cs", import.meta.url)), join(directory, "windows-print-frame.cs"));
    script = legacyScript;
  }
  await run(
    shell,
    [
      "-NoLogo",
      "-NoProfile",
      "-STA",
      "-File",
      script,
      "-BrowserProcess",
      String(browserPid),
      "-Operation",
      operation,
      "-FixtureDirectory",
      directory,
      ...(file ? ["-FixtureFile", file] : []),
    ],
    { windowsHide: true, timeout: 48000 },
  );
}
