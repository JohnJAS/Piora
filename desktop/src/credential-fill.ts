// Trusted application code only. Probe/fill return booleans; capture is consumed by
// the desktop main process and is never exposed as an agent tool result.
export function credentialFillScript(url: string, username: string, password: string, probe = false, submit = false, capture = false, allowedHttpOrigins: string[] = []): string {
  return `(() => {
    const target = ${JSON.stringify(url)};
    const documents = [];
    const visit = win => {
      try {
        if (win.location.origin !== window.location.origin) return;
        documents.push(win.document);
        for (let i = 0; i < win.frames.length; i++) visit(win.frames[i]);
      } catch { /* Cross-origin frames are not credential targets. */ }
    };
    visit(window);
    const allowedHttpOrigins = ${JSON.stringify(allowedHttpOrigins)};
    const doc = documents.find(doc => (doc.location.protocol === 'https:' || (doc.location.protocol === 'http:' && allowedHttpOrigins.includes(doc.location.origin))) && doc.location.origin + doc.location.pathname === target);
    if (!doc) return false;
    const win = doc.defaultView;
    const visible = e => !e.disabled && !e.readOnly && e.getClientRects().length && win.getComputedStyle(e).visibility === 'visible';
    const passwords = [...doc.querySelectorAll('input[type="password"]')].filter(visible);
    if (passwords.length > 1) return false;
    const secret = passwords[0];
    const inputs = [...doc.querySelectorAll('input')].filter(e => visible(e) && ['text', 'email'].includes(e.type));
    const preferred = inputs.filter(e => /^(username|email)$/i.test(e.autocomplete) || /^(user(?:name)?|email|login|account)(?:[-_]?name)?$/i.test(e.name || e.id));
    const users = preferred.length ? preferred : inputs;
    if (users.length > 1 || (!secret && users.length !== 1)) return false;
    const user = users[0];
    if (secret && !user && [...doc.querySelectorAll('input')].some(e => ['text', 'email'].includes(e.type) && !visible(e) && (!e.value || (!${JSON.stringify(probe)} && e.value !== ${JSON.stringify(username)})))) return false;
    const anchor = secret || user;
    const form = anchor.form;
    const scope = form || anchor.closest('[role="dialog"], [data-login-form]') || doc.body;
    const safeForm = () => !form || (new URL(form.action || doc.location.href).origin === doc.location.origin && form.method.toLowerCase() === 'post');
    if (!safeForm() || (user && user.form !== form)) return false;
    const danger = /^(?:register|sign[ -]?up|create.account|reset.password|change.password|pay(?:ment)?|checkout)(?:\\s|$)|^(?:注册|创建账户|修改密码|重置密码|支付|付款)/i;
    if ([...scope.querySelectorAll('input')].some(e => visible(e) && (/^(new-password|one-time-code)$/i.test(e.autocomplete) || /^cc-/i.test(e.autocomplete) || /(?:captcha|otp|verification.?code)/i.test(e.name + ' ' + e.id)))) return false;
    if ([...scope.querySelectorAll('h1,h2,h3,legend')].some(e => visible(e) && danger.test(e.innerText.trim()))) return false;
    const buttons = [...scope.querySelectorAll('button, input[type="submit"], [role="button"]')].filter(visible);
    const label = e => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim();
    const login = /^(?:log[ -]?in|sign[ -]?in|continue|next)(?:\\s|$)|^(?:登录|登入|继续|下一步)/i;
    const actions = buttons.filter(e => login.test(label(e)));
    if (!actions.length || (buttons.length === 1 && danger.test(label(buttons[0])))) return false;
    const submitters = form ? buttons.filter(e => e.type === 'submit') : actions;
    if (${JSON.stringify(submit)} && (actions.length !== 1 || (form && submitters.length > 1))) return false;
    if (${JSON.stringify(capture)}) return secret && user ? { url: target, username: user.value, password: secret.value } : false;
    if (${JSON.stringify(probe)}) return true;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    const fields = [];
    if (user) { setter.call(user, ${JSON.stringify(username)}); fields.push(user); }
    if (secret) { setter.call(secret, ${JSON.stringify(password)}); fields.push(secret); }
    for (const field of fields) { field.dispatchEvent(new win.Event('input', { bubbles: true })); field.dispatchEvent(new win.Event('change', { bubbles: true })); }
    if (${JSON.stringify(submit)}) {
      if (!safeForm() || !actions[0].isConnected) return false;
      // Click supports frameworks whose login handler is attached to a button,
      // including ordinary form submitters and controls outside a form.
      actions[0].click();
    }
    return true;
  })()`;
}
