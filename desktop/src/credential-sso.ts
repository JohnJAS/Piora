import type { BrowserLoginState } from "./browser-login.js";

export interface SsoRule {
  id: string;
  authOrigin: string;
  returnUrl: string;
  evidence: "dom" | "meta" | "cookie";
  cookieName?: string;
}

export function normalizeSsoRule(value: Partial<SsoRule>): SsoRule {
  if (typeof value.authOrigin !== "string" || value.authOrigin.length > 2048 || typeof value.returnUrl !== "string" || value.returnUrl.length > 2048) throw new Error("Invalid SSO URL");
  const auth = new URL(value.authOrigin ?? ""), destination = new URL(value.returnUrl ?? "");
  for (const url of [auth, destination]) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hostname.includes("*")) throw new Error("Invalid SSO site");
  }
  if (auth.pathname !== "/" || auth.search || auth.hash || !["dom", "meta", "cookie"].includes(value.evidence ?? "")) throw new Error("Invalid SSO rule");
  const cookieName = value.cookieName?.trim();
  if (value.evidence === "cookie" && (!cookieName || !/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]{1,128}$/.test(cookieName))) throw new Error("Invalid cookie name");
  return { id: value.id ?? "", authOrigin: auth.origin, returnUrl: destination.origin + destination.pathname,
    evidence: value.evidence!, ...(value.evidence === "cookie" ? { cookieName: cookieName! } : {}) };
}

/** Segment-aware prefix, never a hostname suffix or a raw string prefix. */
export function matchesLoginReturn(expected: string, actual: string): boolean {
  try {
    const prefix = new URL(expected), page = new URL(actual);
    const path = prefix.pathname.replace(/\/+$/, "");
    return prefix.origin === page.origin && (!path || page.pathname === path || page.pathname.startsWith(path + "/"));
  } catch { return false; }
}

export interface LoginEvidence { returnUrl?: string; rule?: SsoRule }
export function loginEvidence(authUrl: string, entryUrl: string | undefined, rules: SsoRule[]): LoginEvidence {
  const authOrigin = new URL(authUrl).origin;
  let expected: string | undefined;
  try { const entry = new URL(entryUrl ?? ""); if (["http:", "https:"].includes(entry.protocol) && entry.origin !== authOrigin) expected = entry.origin + entry.pathname; } catch { /* Direct authentication-page visit. */ }
  const matches = rules.filter(rule => rule.authOrigin === authOrigin && (!expected || matchesLoginReturn(rule.returnUrl, expected)));
  if (matches.length === 1) return { returnUrl: matches[0]!.returnUrl, rule: { ...matches[0]! } };
  return expected ? { returnUrl: expected } : {};
}

export function loginEvidenceAccepted(authUrl: string, context: LoginEvidence, state: BrowserLoginState, cookieChanged = false): boolean {
  if (!state.ready || state.loginVisible || state.challenge || state.failed) return false;
  const authOrigin = new URL(authUrl).origin;
  // A configured or observed business return is mandatory for that flow.
  if (context.returnUrl) {
    if (!matchesLoginReturn(context.returnUrl, state.url)) return false;
    if (context.rule?.evidence === "meta") return state.declaredAuthenticated === true;
    if (context.rule?.evidence === "cookie") return cookieChanged;
    return state.authenticated;
  }
  return new URL(state.url).origin === authOrigin && state.authenticated;
}
