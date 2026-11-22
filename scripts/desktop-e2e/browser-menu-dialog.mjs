import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  const script = fileURLToPath(new URL("./browser-menu-dialog.ps1", import.meta.url));
  await run(
    "pwsh.exe",
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
