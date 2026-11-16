import { browserLoginCompleted, type BrowserLoginStage, type BrowserLoginState } from "./browser-login.js";

export type LoginRecoveryResult = "ready" | "needs-user";
export type LoginRecoveryReason = "challenge" | "no-account" | "unsupported-form" | "failed" | "timeout" | "cooldown" | "unverified" | "unavailable";
export type LoginSubmission = boolean | { accepted: boolean; reason?: LoginRecoveryReason };
export interface LoginRecoveryHost {
  observe(): Promise<BrowserLoginState | null>;
  /** Executes only an explicitly enabled, uniquely matched account. Never returns credentials. */
  submit(url: string, stage?: BrowserLoginStage): Promise<LoginSubmission>;
  onReason?(reason: LoginRecoveryReason): void;
  now?: () => number;
  pause?: () => Promise<void>;
}

/** A bounded recovery attempt. No business action is ever replayed. */
export async function recoverBrowserLogin(host: LoginRecoveryHost, signal?: AbortSignal,
  options: { graceMs?: number; timeoutMs?: number } = {}): Promise<LoginRecoveryResult> {
  const now = host.now ?? Date.now;
  const started = now(), deadline = started + (options.timeoutMs ?? 60_000);
  let before: BrowserLoginState | null = null, stableSince = 0, stableUrl = "";
  let formSince = 0, formKey = "", lastState: BrowserLoginState | null = null;
  const submittedStages = new Set<BrowserLoginStage>();
  const needsUser = (reason: LoginRecoveryReason): LoginRecoveryResult => { host.onReason?.(reason); return "needs-user"; };
  const check = () => { if (signal?.aborted) throw new Error("Browser action aborted"); };
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void = () => {};
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Login observation timed out")), 1500);
      abort = () => reject(new Error("Browser action aborted"));
      signal?.addEventListener("abort", abort, { once: true });
    });
    try { return await Promise.race([operation(), limit]); }
    finally { clearTimeout(timer!); signal?.removeEventListener("abort", abort); }
  };
  while (now() < deadline) {
    check();
    const state = await bounded(host.observe).catch(() => null);
    check();
    if (state && !before) before = state;
    if (state) lastState = state;
    if (state?.challenge) return needsUser("challenge");
    if (state?.failed) return needsUser("failed");
    if (state?.ready && browserLoginCompleted(before, state)) {
      const location = new URL(state.url); const key = location.origin + location.pathname;
      if (stableUrl !== key) { stableUrl = key; stableSince = now(); }
      if (now() - stableSince >= 1000) return "ready";
    } else { stableUrl = ""; stableSince = 0; }
    const stage = state?.loginStage;
    if (state?.ready && state.loginVisible && stage) {
      const location = new URL(state.url), key = location.origin + location.pathname + ":" + stage;
      if (formKey !== key) { formKey = key; formSince = now(); }
      // A stable real form can proceed promptly; form-less SSO redirects keep waiting.
      if (!submittedStages.has(stage) && now() - formSince >= (options.graceMs ?? 1500)) {
        // Only the password step may follow a username step. Never repeat rejected credentials.
        if (submittedStages.size && !(submittedStages.size === 1 && submittedStages.has("username") && stage === "password")) return needsUser("failed");
        submittedStages.add(stage);
        const result = await host.submit(state.url, stage);
        check();
        const accepted = typeof result === "boolean" ? result : result.accepted;
        if (!accepted) return needsUser(typeof result === "object" ? result.reason ?? "unsupported-form" : "unsupported-form");
      }
    } else { formKey = ""; formSince = 0; }
    await (host.pause?.() ?? new Promise<void>(resolve => setTimeout(resolve, 250)));
  }
  return needsUser(lastState?.ready && !lastState.loginVisible ? "unverified" : "timeout");
}

/** Shared by all tabs of one browser backend. Failed credentials are not hammered. */
export class LoginAttemptGate {
  private readonly attempts = new Map<string, number>();
  claim(url: string, now = Date.now()): boolean {
    const key = new URL(url).origin;
    if ((this.attempts.get(key) ?? 0) > now) return false;
    this.attempts.set(key, now + 5 * 60_000);
    if (this.attempts.size > 200) for (const [item, expires] of this.attempts) if (expires <= now) this.attempts.delete(item);
    return true;
  }
  complete(url: string) { this.attempts.delete(new URL(url).origin); }
}
