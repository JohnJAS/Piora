import { BROWSER_LOGIN_STATE_SCRIPT, readBrowserLoginState } from "./browser-login.js";
import { recoverBrowserLogin, LoginAttemptGate, type LoginRecoveryReason } from "./browser-login-recovery.js";
import { credentialFillScript } from "./credential-fill.js";
import type { CredentialVault } from "./credential-vault.js";
import { loginEvidence, loginEvidenceAccepted } from "./credential-sso.js";

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
  let stagedCredential: { id: string; url: string; username: string; password: string; origin: string } | undefined;
  let confirmedAuthentication = false;
  try { status = await recoverBrowserLogin({
    observe: async () => {
      const state = readBrowserLoginState(await page.execute(BROWSER_LOGIN_STATE_SCRIPT));
      if (state && claimedUrl) {
        const evidence = loginEvidence(claimedUrl, undefined, vault.ssoRules?.() ?? []);
        // A meta declaration is meaningful only for the explicitly configured
        // return of the authentication origin that this attempt submitted to.
        if (evidence.rule?.evidence === "meta" && loginEvidenceAccepted(claimedUrl, evidence, state)) state.authenticated = true;
      }
      confirmedAuthentication = Boolean(state?.authenticated && !state.loginVisible && !state.failed && !state.challenge);
      return state;
    },
    onReason: value => { reason = value; },
    submit: async (url, stage) => {
      if (vault.allowedUrl?.(url) === false) return { accepted: false, reason: "unsupported-form" };
      const origin = new URL(url).origin;
      const staged = stagedCredential && stage === "password" && stagedCredential.origin === origin ? stagedCredential : undefined;
      // A second step may reuse only the original exact saved target, and must
      // re-read its current permission so disabling/deleting it takes effect.
      let credential = vault.automaticCredential(staged?.url ?? url);
      if (staged && credential?.id !== staged.id) return { accepted: false, reason: "no-account" };
      if (!credential) return { accepted: false, reason: "no-account" };
      if (signal.aborted) return false;
      const eligible = await page.execute(credentialFillScript(new URL(url).origin + new URL(url).pathname, "", "", true, true, false, vault.allowedOrigins?.() ?? []));
      if (eligible !== true || signal.aborted) return { accepted: false, reason: "unsupported-form" };
      // Revoking an origin while the probe is pending must prevent the fill.
      if (vault.allowedUrl?.(url) === false) return { accepted: false, reason: "unsupported-form" };
      const refreshed = vault.automaticCredential(staged?.url ?? url);
      if (!refreshed || refreshed.id !== credential.id || (staged && refreshed.username !== staged.username)) return { accepted: false, reason: "no-account" };
      credential = refreshed;
      if (!claimedUrl) {
        if (!attempts.claim(url)) return { accepted: false, reason: "cooldown" };
        claimedUrl = url;
      } else if (new URL(claimedUrl).origin !== origin) return { accepted: false, reason: "unsupported-form" };
      page.protect(); protectedEntry = true;
      if (stage === "username") stagedCredential = { id: credential.id, url: credential.url, username: credential.username, password: credential.password, origin };
      const accepted = await page.execute(credentialFillScript(new URL(url).origin + new URL(url).pathname, credential.username, credential.password, false, true, false, vault.allowedOrigins?.() ?? [])) === true;
      if (accepted && credential.id) {
        try { vault.recordAutomatic?.(credential.id, credential.url); } catch { /* Audit failure does not replay or undo an already submitted login. */ }
      }
      return { accepted, ...(!accepted ? { reason: "unsupported-form" as const } : {}) };
    },
  }, signal, options); } catch { if (signal.aborted) throw new Error("Browser action aborted"); status = "needs-user"; reason = "unavailable"; }
  finally { stagedCredential = undefined; }
  if (status === "ready" && confirmedAuthentication && claimedUrl) attempts.complete(claimedUrl);
  return { status, protectedEntry, ...(reason ? { reason } : {}) };
}
