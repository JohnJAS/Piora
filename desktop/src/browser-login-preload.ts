/// <reference lib="dom" />
import { ipcRenderer } from "electron";

// The isolated main-frame preload observes accessible same-origin documents.
// Credentials only cross the private Electron IPC boundary, never page storage.
if (process.isMainFrame) {
  const attached = new WeakSet<Document>();
  const notified = new WeakMap<Document, string>();
  const captured = new WeakMap<Element, { at: number; stage: string }>();
  const humanAction = new WeakMap<Document, number>();
  const loginWords = /^(?:log[ -]?in|sign[ -]?in|continue|next)(?:\s|$)|^(?:登录|登入|继续|下一步)/i;
  const danger = /^(?:register|sign[ -]?up|create.account|reset.password|change.password|pay(?:ment)?|checkout)(?:\s|$)|^(?:注册|创建账户|修改密码|重置密码|支付|付款)/i;
  function inspect(doc: Document, action?: Element) {
    const win = doc.defaultView;
    if (!win || doc.location.protocol !== "https:" || doc.location.origin !== location.origin) return null;
    const visible = (el: Element) => {
      const input = el as HTMLInputElement;
      return !input.disabled && !input.readOnly && el.getClientRects().length > 0 && win.getComputedStyle(el).visibility === "visible";
    };
    const passwords = [...doc.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(visible);
    if (passwords.length > 1) return null;
    const password = passwords[0];
    const inputs = [...doc.querySelectorAll<HTMLInputElement>('input')].filter(el => visible(el) && ["text", "email"].includes(el.type));
    const preferred = inputs.filter(el => /^(username|email)$/i.test(el.autocomplete) || /^(user(?:name)?|email|login|account)(?:[-_]?name)?$/i.test(el.name || el.id));
    const users = preferred.length ? preferred : inputs;
    if (users.length > 1 || (!password && users.length !== 1)) return null;
    const user = users[0];
    const anchor = password || user;
    if (!anchor) return null;
    const form = anchor.form;
    const scope = form || anchor.closest('[role="dialog"], [data-login-form]') || doc.body;
    if (!scope || (user && user.form !== form)) return null;
    if (form && (form.method.toLowerCase() !== "post" || new URL(form.action || doc.location.href).origin !== doc.location.origin)) return null;
    if ([...scope.querySelectorAll<HTMLInputElement>('input')].some(el => visible(el) && (/^(new-password|one-time-code)$/i.test(el.autocomplete) || /^cc-/i.test(el.autocomplete) || /(?:captcha|otp|verification.?code)/i.test(el.name + " " + el.id)))) return null;
    if ([...scope.querySelectorAll('h1,h2,h3,legend')].some(el => visible(el) && danger.test((el.textContent || "").trim()))) return null;
    const buttons = [...scope.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]')].filter(visible);
    const label = (el: HTMLElement) => (el.innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim();
    const actions = buttons.filter(el => loginWords.test(label(el)));
    if (!actions.length || (action && !actions.includes(action as HTMLElement))) return null;
    return { url: doc.location.origin + doc.location.pathname, user, password, scope, stage: password ? user ? "credentials" : "password" : "username" };
  }
  function capture(doc: Document, event: Event, action?: Element) {
    if (!event.isTrusted) return;
    if (event.type === "submit" && Date.now() - (humanAction.get(doc) || 0) > 2000) return;
    const match = inspect(doc, action);
    if (!match) return;
    const previous = captured.get(match.scope);
    if (previous?.stage === match.stage && Date.now() - previous.at < 250) return;
    const username = match.user?.value || "", password = match.password?.value || "";
    if (username.length > 500 || password.length > 4096) return;
    if (!match.password) {
      if (username) ipcRenderer.send("piora:login-username", { url: match.url, username });
    } else if (password && (username || !match.user)) {
      ipcRenderer.send("piora:remember-login-candidate", { url: match.url, username, password });
    } else return;
    captured.set(match.scope, { at: Date.now(), stage: match.stage });
  }
  function scan(doc: Document) {
    try {
      if (doc.location.origin !== location.origin) return;
      const match = inspect(doc);
      const signature = match ? `${match.url}:${match.stage}` : "";
      if (match && notified.get(doc) !== signature) ipcRenderer.send("piora:login-form-ready", { url: match.url, stage: match.stage });
      notified.set(doc, signature);
      for (const frame of doc.querySelectorAll<HTMLIFrameElement>('iframe, frame')) {
        try { if (frame.contentDocument) attach(frame.contentDocument); } catch { /* Cross-origin frames remain isolated. */ }
      }
    } catch { /* A document may navigate while being observed. */ }
  }
  function attach(doc: Document) {
    if (attached.has(doc) || doc.location.origin !== location.origin) return;
    attached.add(doc);
    doc.addEventListener("submit", event => capture(doc, event, (event as SubmitEvent).submitter || undefined), true);
    doc.addEventListener("click", event => {
      if (event.isTrusted) humanAction.set(doc, Date.now());
      const target = event.target as Element | null;
      const action = target?.closest?.('button, input[type="submit"], [role="button"]');
      if (action) capture(doc, event, action);
    }, true);
    doc.addEventListener("keydown", event => {
      if (event.isTrusted) humanAction.set(doc, Date.now());
      if (event.key === "Enter" && (event.target as Element | null)?.tagName === "INPUT") capture(doc, event);
    }, true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => scan(doc), 100); };
    new MutationObserver(schedule).observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "style", "class", "hidden", "disabled", "autocomplete"] });
    doc.addEventListener("DOMContentLoaded", () => scan(doc));
    doc.addEventListener("load", () => scan(doc), true);
    scan(doc);
  }
  attach(document);
}
