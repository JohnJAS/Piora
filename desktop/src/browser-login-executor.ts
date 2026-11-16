import { BROWSER_LOGIN_STATE_SCRIPT, readBrowserLoginState } from "./browser-login.js";
import { recoverBrowserLogin, LoginAttemptGate, type LoginRecoveryReason } from "./browser-login-recovery.js";
import { credentialFillScript } from "./credential-fill.js";
import type { CredentialVault } from "./credential-vault.js";

export interface PrivateLoginPage {
  execute(code: string): Promise<unknown>;
  protect(): void;
}
const attempts = new LoginAttemptGate();
/** Credentials stay within the trusted executor and never become a tool result. */
export async function executePrivateLogin(page: PrivateLoginPage, vault: CredentialVault, signal: AbortSignal,
  options: { graceMs?: number; timeoutMs?: number } = {}) {
  let protectedEntry = false;
  let status: "ready" | "needs-user";
  let reason: LoginRecoveryReason | undefined;
  let claimedUrl: string | undefined;
  let stagedCredential: { username: string; password: string; origin: string } | undefined;
  let confirmedAuthentication = false;
  try { status = await recoverBrowserLogin({
    observe: async () => {
      const state = readBrowserLoginState(await page.execute(BROWSER_LOGIN_STATE_SCRIPT));
      confirmedAuthentication = Boolean(state?.authenticated && !state.loginVisible && !state.failed && !state.challenge);
      return state;
    },
    onReason: value => { reason = value; },
    submit: async (url, stage) => {
      const origin = new URL(url).origin;
      const credential = stagedCredential && stage === "password" && stagedCredential.origin === origin
        ? stagedCredential : vault.automaticCredential(url);
      if (!credential) return { accepted: false, reason: "no-account" };
      if (signal.aborted) return false;
      const eligible = await page.execute(credentialFillScript(new URL(url).origin + new URL(url).pathname, "", "", true, true));
      if (eligible !== true || signal.aborted) return { accepted: false, reason: "unsupported-form" };
      if (!claimedUrl) {
        if (!attempts.claim(url)) return { accepted: false, reason: "cooldown" };
        claimedUrl = url;
      } else if (new URL(claimedUrl).origin !== origin) return { accepted: false, reason: "unsupported-form" };
      page.protect(); protectedEntry = true;
      if (stage === "username") stagedCredential = { username: credential.username, password: credential.password, origin };
      const accepted = await page.execute(credentialFillScript(new URL(url).origin + new URL(url).pathname, credential.username, credential.password, false, true)) === true;
      return { accepted, ...(!accepted ? { reason: "unsupported-form" as const } : {}) };
    },
  }, signal, options); } catch { if (signal.aborted) throw new Error("Browser action aborted"); status = "needs-user"; reason = "unavailable"; }
  finally { stagedCredential = undefined; }
  if (status === "ready" && confirmedAuthentication && claimedUrl) attempts.complete(claimedUrl);
  return { status, protectedEntry, ...(reason ? { reason } : {}) };
}
