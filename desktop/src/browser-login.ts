/** Fixed, read-only probe. Never returns input values, storage, cookies or page text. */
export const BROWSER_LOGIN_STATE_SCRIPT = String.raw`(() => {
  const visible = el => {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const documents = [document];
  for (let index = 0; index < documents.length && index < 20; index++) {
    for (const frame of documents[index].querySelectorAll('iframe, frame')) {
      try {
        const child = frame.contentDocument;
        if (documents.length < 20 && visible(frame) && child && child.location.origin === location.origin && !documents.includes(child)) documents.push(child);
      } catch { /* Cross-origin frames keep their own credential boundary. */ }
    }
  }
  const all = selector => documents.flatMap(doc => [...doc.querySelectorAll(selector)].filter(visible));
  const label = el => (el.getAttribute('aria-label') || el.innerText || '').trim();
  const loginWords = /log[ -]?in|sign[ -]?in|登录|登入|扫码登录|scan.*(?:sign|log).*in/i;
  const controls = all('input:not([type="hidden"]), button, [role="button"], a, form, [role="dialog"]');
  const password = all('input[type="password"], input[autocomplete="one-time-code"]').length > 0;
  const form = controls.some(el => (el.tagName === 'FORM' || el.getAttribute('role') === 'dialog') && loginWords.test(label(el)) && [...el.querySelectorAll('input, canvas, img, svg')].some(visible));
  const authRoute = /(?:^|\/)(?:login|signin|sign-in|auth|oauth|sso|verify|2fa)(?:\/|$)/i.test(location.pathname);
  let loginVisible = password || form || (authRoute && controls.some(el => loginWords.test(label(el))));
  let loginStage, loginUrl;
  for (const doc of documents) {
    const inputs = [...doc.querySelectorAll('input')].filter(visible);
    const secrets = inputs.filter(el => el.type === 'password');
    const usernames = inputs.filter(el => ['text', 'email', 'tel'].includes(el.type) && !/one-time-code|new-password|^cc-/.test(el.autocomplete));
    const actions = [...doc.querySelectorAll('button, input[type="submit"], [role="button"]')].filter(visible);
    const hasLogin = actions.some(el => loginWords.test(label(el) || el.value || ''));
    const hasNext = actions.some(el => /^(?:next|continue|下一步|继续)$/i.test(label(el) || el.value || ''));
    const hasUsername = usernames.some(el => /^(username|email)$/i.test(el.autocomplete) || /^(user(?:name)?|email|login|account)(?:[-_]?name)?$/i.test(el.name || el.id)) || usernames.length === 1;
    const heading = [...doc.querySelectorAll('h1, h2, [role="heading"]')].filter(visible).some(el => loginWords.test(label(el)));
    const loginRoute = /(?:^|\/)(?:login|signin|sign-in|auth|oauth|sso)(?:\/|$)/i.test(doc.location.pathname);
    if (secrets.length === 1 && (hasLogin || (hasNext && (heading || loginRoute || secrets[0].autocomplete === 'current-password')))) loginStage = hasUsername ? 'credentials' : 'password';
    else if (secrets.length === 0 && hasUsername && (hasLogin || (hasNext && (heading || loginRoute)))) loginStage = 'username';
    if (loginStage) { loginUrl = doc.location.href; loginVisible = true; break; }
  }
  const logout = controls.some(el => /^(?:log[ -]?out|sign[ -]?out|退出登录|退出登入|注销)(?:\s|$)/i.test(label(el)) || /(?:^|\/)(?:logout|signout|sign-out)(?:\/|$|\?)/i.test(el.getAttribute('href') || ''));
  const userMenu = all('[data-testid="user-menu"], [data-testid="user-avatar"], [data-testid="account-menu"], [aria-label="User menu" i], [aria-label="Account menu" i], [aria-label="用户菜单"], [aria-label="个人头像"]').length > 0;
  const challenge = all('input[autocomplete="one-time-code"], input[name*="captcha" i], input[name="otp" i], iframe[src*="captcha"], [data-sitekey]').length > 0 || all('input').some(el => /验证码|动态口令|verification code|authenticator code/i.test(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')) || all('form, [role="dialog"]').some(el => /扫码登录|scan.*(?:sign|log).*in/i.test(label(el)) && [...el.querySelectorAll('canvas, img')].some(visible));
  const failureWords = /(?:incorrect|invalid|wrong).{0,30}(?:password|credentials|username)|(?:login|sign[ -]?in|authentication|access).{0,15}(?:failed|denied)|(?:密码|账号|用户名).{0,12}(?:错误|不正确|无效)|登录失败|认证失败|访问被拒绝/i;
  const failed = all('[role="alert"], [aria-live="assertive"], .error, .error-message, [data-testid="login-error"], h1, h2').some(el => failureWords.test(label(el))) || documents.some(doc => /^(?:error|access denied|forbidden|unauthorized|[45]\d\d)\b/i.test(doc.title) || /(?:^|\/)(?:error|access-denied|login-failed)(?:\/|$)/i.test(doc.location.pathname));
  return { challenge, failed, ready: document.readyState !== 'loading', loginVisible, loginStage, authenticated: logout || userMenu, url: loginUrl || location.href };
})()`;

export type BrowserLoginStage = "username" | "password" | "credentials";
export interface BrowserLoginState { challenge?: boolean; failed?: boolean; loginStage?: BrowserLoginStage; ready: boolean; loginVisible: boolean; authenticated: boolean; url: string }

export function readBrowserLoginState(value: unknown): BrowserLoginState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<BrowserLoginState>;
  if (typeof row.ready !== "boolean" || typeof row.loginVisible !== "boolean" || typeof row.authenticated !== "boolean" || typeof row.url !== "string") return null;
  try { if (!["http:", "https:"].includes(new URL(row.url).protocol)) return null; } catch { return null; }
  if (row.loginStage !== undefined && !["username", "password", "credentials"].includes(row.loginStage)) return null;
  return { ready: row.ready, loginVisible: row.loginVisible, authenticated: row.authenticated, url: row.url,
    ...(typeof row.challenge === "boolean" ? { challenge: row.challenge } : {}),
    ...(typeof row.failed === "boolean" ? { failed: row.failed } : {}),
    ...(row.loginStage ? { loginStage: row.loginStage } : {}) };
}

export const LOGIN_VERIFICATION_DELAY_MS = 1500;
export function loginPageStillVisible(state: BrowserLoginState): boolean {
  return state.loginVisible || /(?:^|\/)(?:login|signin|sign-in|auth|oauth|sso|verify|2fa)(?:\/|$)/i.test(new URL(state.url).pathname);
}

/** Resume to a fresh snapshot for verification; this does not attest authentication. */
export function browserLoginCompleted(before: BrowserLoginState | null, after: BrowserLoginState | null): boolean {
  if (!after?.ready || after.loginVisible || after.challenge || after.failed) return false;
  if (after.authenticated) return true;
  if (!before || !loginPageStillVisible(before) || loginPageStillVisible(after)) return false;
  const previous = new URL(before.url), current = new URL(after.url);
  return previous.origin + previous.pathname !== current.origin + current.pathname;
}
