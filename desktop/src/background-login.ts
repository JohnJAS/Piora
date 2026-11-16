import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import type { Browser } from "playwright-core";
import { executePrivateLogin } from "./browser-login-executor.js";
import { getCredentialVault } from "./credential-vault-ipc.js";

const active = new Map<string, AbortController>();
export function cancelBackgroundLogin(id: string) { active.get(id)?.abort(); }

/** The endpoint is read from our own profile, never accepted from a website/tool argument. */
export async function recoverBackgroundLogin(agentDirectory: string, requestId: string, targetId: string, options: { graceMs?: number; timeoutMs?: number } = {}) {
  if (!/^[a-f0-9]+$/i.test(targetId)) throw new Error("Invalid browser target");
  const controller = new AbortController(); active.set(requestId, controller);
  const timeout = setTimeout(() => controller.abort(), 65_000);
  let browser: Browser | undefined;
  try {
    const [port, path] = (await readFile(join(agentDirectory, "piora", "browser-profile", "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
    if (!port || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !path || !/^\/devtools\/browser\/[a-f0-9-]+$/i.test(path)) throw new Error("Invalid browser endpoint");
    const requireRuntime = createRequire(app.isPackaged ? join(process.resourcesPath, "web", "package.json") : __filename);
    const { chromium } = requireRuntime("playwright-core") as typeof import("playwright-core");
    browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${path}`, { timeout: 5000 });
    for (const context of browser.contexts()) for (const page of context.pages()) {
      const cdp = await context.newCDPSession(page);
      const info = await cdp.send("Target.getTargetInfo"); await cdp.detach();
      if (info.targetInfo.targetId !== targetId) continue;
      try {
        const result = await executePrivateLogin({
          execute: code => page.evaluate(source => globalThis.eval(source), code),
          // The owning server quarantines the page before dispatching this request.
          protect: () => {},
        }, getCredentialVault(), controller.signal, options);
        return { status: result.status, url: page.url() };
      } finally {
        // Never leave a document which may contain a credential available for later reads.
        await page.close().catch(() => {});
      }
    }
    throw new Error("Browser target unavailable");
  } finally {
    clearTimeout(timeout); active.delete(requestId);
    // For a CDP connection close disconnects this client; it does not own the browser process.
    await browser?.close().catch(() => {});
  }
}
