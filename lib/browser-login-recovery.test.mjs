import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { chromium } from "playwright-core";
const jiti = createJiti(import.meta.url);
const { recoverBrowserLogin, LoginAttemptGate } = await jiti.import("../desktop/src/browser-login-recovery.ts");
const { executePrivateLogin } = await jiti.import("../desktop/src/browser-login-executor.ts");
const { BROWSER_LOGIN_STATE_SCRIPT, browserLoginCompleted } = await jiti.import("../desktop/src/browser-login.ts");
const login = { ready: true, loginVisible: true, loginStage: "credentials", authenticated: false, url: "https://accounts.example.com/login" };
const home = { ...login, loginVisible: false, authenticated: true, url: "https://accounts.example.com/home" };
function clockHost(observe, submit = async () => false) {
  let time = 1000;
  return { now: () => time, pause: async () => { time += 250; }, observe: async () => observe(time - 1000), submit };
}

test("delayed SSO completes silently without submitting credentials", async () => {
  let submissions = 0;
  const host = clockHost(elapsed => elapsed < 30_000 ? { ...login, loginStage: undefined } : home, async () => { submissions++; return true; });
  assert.equal(await recoverBrowserLogin(host), "ready");
  assert.equal(submissions, 0);
});

test("stable login forms submit within seconds without the old 45 second delay", async () => {
  let submittedAt = Infinity;
  const host = clockHost(() => submittedAt < Infinity ? home : login, async () => { submittedAt = host.now() - 1000; return true; });
  assert.equal(await recoverBrowserLogin(host), "ready");
  assert.equal(submittedAt, 1500);
});

test("blank and failed pages are not treated as successful authentication", async () => {
  const reasons = [];
  const blank = clockHost(() => ({ ...home, authenticated: false }));
  blank.onReason = reason => reasons.push(reason);
  assert.equal(await recoverBrowserLogin(blank, undefined, { timeoutMs: 2000 }), "needs-user");
  assert.equal(reasons.at(-1), "unverified");
  const failed = clockHost(() => ({ ...home, failed: true }));
  failed.onReason = reason => reasons.push(reason);
  assert.equal(await recoverBrowserLogin(failed), "needs-user");
  assert.equal(reasons.at(-1), "failed");
  assert.equal(browserLoginCompleted(login, { ...home, failed: true }), false);
  assert.equal(browserLoginCompleted({ ...login, url: home.url }, { ...home, authenticated: false }), false, "a disappearing form on the same page needs a signed-in marker");
});

test("username then password may each submit once but rejected password never repeats", async () => {
  const stages = [];
  const host = clockHost(() => ({ ...login, loginStage: stages.length ? "password" : "username" }), async (_url, stage) => { stages.push(stage); return true; });
  assert.equal(await recoverBrowserLogin(host, undefined, { graceMs: 0, timeoutMs: 2000 }), "needs-user");
  assert.deepEqual(stages, ["username", "password"]);
});

test("expired sessions submit once and verify the resulting page", async () => {
  let submissions = 0;
  const host = clockHost(() => submissions ? home : login, async () => { submissions++; return true; });
  assert.equal(await recoverBrowserLogin(host, undefined, { graceMs: 1000, timeoutMs: 5000 }), "ready");
  assert.equal(submissions, 1);
});

test("wrong passwords never loop and MFA hands off without submitting", async () => {
  let submissions = 0;
  const host = clockHost(() => login, async () => { submissions++; return true; });
  assert.equal(await recoverBrowserLogin(host, undefined, { graceMs: 0, timeoutMs: 3000 }), "needs-user");
  assert.equal(submissions, 1);
  const challenge = clockHost(() => ({ ...login, challenge: true }), async () => { throw new Error("must not submit"); });
  assert.equal(await recoverBrowserLogin(challenge), "needs-user");
});

test("cancellation interrupts an unresolved observation and discards late completion", async () => {
  const controller = new AbortController(); let finish;
  const pending = recoverBrowserLogin({ observe: () => new Promise(resolve => { finish = resolve; }), submit: async () => { throw new Error("must not submit"); } }, controller.signal);
  controller.abort();
  await assert.rejects(pending, /aborted/);
  finish(home);
});

test("per-origin cooldown prevents simultaneous account submissions", () => {
  const gate = new LoginAttemptGate();
  assert.equal(gate.claim(login.url, 1000), true);
  assert.equal(gate.claim(login.url + "?next=other", 1001), false);
  assert.equal(gate.claim("https://other.example.com/login", 1001), true);
  assert.equal(gate.claim(login.url, 302000), true);
  gate.complete(login.url);
  assert.equal(gate.claim(login.url, 302001), true, "confirmed successful login releases the failure cooldown");
});

test("unsupported forms do not consume the credential retry budget", async () => {
  const url = "https://eligibility.example.com/login";
  let eligible = false, submissions = 0, scriptCalls = 0;
  const page = { protect() {}, execute: async code => {
    if (code === BROWSER_LOGIN_STATE_SCRIPT) return submissions ? { ...home, url: "https://eligibility.example.com/home" } : { ...login, url };
    scriptCalls++;
    if (!eligible) return false;
    if (scriptCalls === 3) submissions++;
    return true;
  } };
  const vault = { automaticCredential: () => ({ url, username: "local-user", password: "local-secret" }) };
  const options = { graceMs: 0, timeoutMs: 4000 };
  assert.deepEqual(await executePrivateLogin(page, vault, new AbortController().signal, options), { status: "needs-user", protectedEntry: false, reason: "unsupported-form" });
  eligible = true;
  assert.deepEqual(await executePrivateLogin(page, vault, new AbortController().signal, options), { status: "ready", protectedEntry: true });
  assert.equal(submissions, 1);
});

test("fixed probe recognizes real failure alerts and username login steps", { timeout: 15000 }, async t => {
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("https://probe.example.com/**", route => route.fulfill({ contentType: "text/html", body: '<h1>Sign in</h1><input autocomplete="username"><button>Next</button>' }));
  await page.goto("https://probe.example.com/login");
  assert.equal((await page.evaluate(BROWSER_LOGIN_STATE_SCRIPT)).loginStage, "username");
  await page.setContent('<input autocomplete="username"><input type="password"><button>Sign in</button><a>验证码登录</a>');
  assert.equal((await page.evaluate(BROWSER_LOGIN_STATE_SCRIPT)).challenge, false, "an alternative verification link is not an active challenge");
  await page.setContent('<div role="alert">Invalid password</div>');
  assert.equal((await page.evaluate(BROWSER_LOGIN_STATE_SCRIPT)).failed, true);
  await page.setContent('<title>403 Forbidden</title><h1>Access denied</h1>');
  assert.equal((await page.evaluate(BROWSER_LOGIN_STATE_SCRIPT)).failed, true);
});

test("private executor submits a real form and returns no credential values", { timeout: 15000 }, async t => {
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("https://accounts.example.com/**", route => route.fulfill({ contentType: "text/html", body: '<form method="post"><input name="username"><input type="password"><button>Sign in</button></form><script>window.submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submits++;history.replaceState(null,"","/home");document.body.innerHTML="<button>Sign out</button>"}</script>' }));
  await page.goto(login.url);
  let protectedPage = false;
  const result = await executePrivateLogin({ execute: code => page.evaluate(code), protect: () => { protectedPage = true; } },
    { automaticCredential: () => ({ url: login.url, username: "fixture-user-621", password: "fixture-secret-621" }) }, new AbortController().signal, { graceMs: 0, timeoutMs: 5000 });
  assert.deepEqual(result, { status: "ready", protectedEntry: true });
  assert.equal(protectedPage, true);
  assert.equal(await page.evaluate(() => window.submits), 1);
  assert.doesNotMatch(JSON.stringify(result), /fixture-user|fixture-secret/);
});

test("private executor follows a same-origin username then password flow without broad credential lookup", { timeout: 15000 }, async t => {
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const start = "https://multistep.example.com/login";
  await page.route("https://multistep.example.com/**", route => route.fulfill({ contentType: "text/html", body: `<h1>Sign in</h1><input autocomplete="username"><button>Next</button><script>
    window.steps = [];
    document.querySelector('button').onclick = () => {
      window.steps.push(document.querySelector('input').value === 'saved-user' ? 'username' : 'wrong-user');
      history.pushState(null, '', '/password');
      document.body.innerHTML = '<input type="password"><button>Sign in</button>';
      document.querySelector('button').onclick = () => {
        window.steps.push(document.querySelector('input').value === 'saved-password' ? 'password' : 'wrong-password');
        history.pushState(null, '', '/home'); document.body.innerHTML = '<button>Sign out</button>';
      };
    };
    </script>` }));
  await page.goto(start);
  const lookups = [];
  const result = await executePrivateLogin({ execute: code => page.evaluate(code), protect() {} }, {
    automaticCredential: url => { lookups.push(url); return url === start ? { url, username: "saved-user", password: "saved-password" } : null; },
  }, new AbortController().signal, { graceMs: 0, timeoutMs: 5000 });
  assert.deepEqual(result, { status: "ready", protectedEntry: true });
  assert.deepEqual(lookups, [start, start, start, start], "both steps revalidate after probing only the original saved login, not its new path");
  assert.deepEqual(await page.evaluate(() => window.steps), ["username", "password"]);
});

test("fixed probe reports the visible same-origin login frame, not a hidden or foreign frame", { timeout: 15000 }, async t => {
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("https://frames.example.com/**", route => route.fulfill({ contentType: "text/html", body: route.request().url().endsWith("/shell")
    ? '<iframe hidden src="/hidden"></iframe><iframe src="/password"></iframe>'
    : '<input autocomplete="username"><input type="password"><button>Sign in</button>' }));
  await page.goto("https://frames.example.com/shell");
  const state = await page.evaluate(BROWSER_LOGIN_STATE_SCRIPT);
  assert.equal(state.url, "https://frames.example.com/password");
  assert.equal(state.loginStage, "credentials");
  assert.equal(state.loginVisible, true);
});

test("revoking HTTP policy during the form probe prevents filling and does not record an audit", async () => {
  const url = "http://intranet:8080/login";
  let allowed = true, scriptCalls = 0, protectedPage = false, audits = 0;
  const page = {
    protect: () => { protectedPage = true; },
    execute: async code => {
      if (code === BROWSER_LOGIN_STATE_SCRIPT) return { ...login, url };
      scriptCalls++;
      allowed = false;
      return true;
    },
  };
  const result = await executePrivateLogin(page, {
    automaticCredential: () => ({ id: "http-account", url, username: "private-user", password: "private-secret" }),
    allowedUrl: () => allowed,
    allowedOrigins: () => allowed ? ["http://intranet:8080"] : [],
    recordAutomatic: () => { audits++; },
  }, new AbortController().signal, { graceMs: 0, timeoutMs: 3000 });
  assert.deepEqual(result, { status: "needs-user", protectedEntry: false, reason: "unsupported-form" });
  assert.equal(scriptCalls, 1);
  assert.equal(protectedPage, false);
  assert.equal(audits, 0);
});

test("disabling a saved account after the username step prevents password submission", async () => {
  const url = "https://revoke-staged.example/login";
  let disabled = false, scripts = 0, audits = 0;
  const result = await executePrivateLogin({
    protect() {},
    execute: async code => {
      if (code === BROWSER_LOGIN_STATE_SCRIPT) return { ...login, url: disabled ? "https://revoke-staged.example/password" : url, loginStage: disabled ? "password" : "username" };
      if (++scripts === 2) disabled = true;
      return true;
    },
  }, {
    automaticCredential: target => !disabled && target === url ? { id: "account", url, username: "user", password: "secret" } : undefined,
    recordAutomatic: () => { audits++; },
  }, new AbortController().signal, { graceMs: 0, timeoutMs: 3000 });
  assert.deepEqual(result, { status: "needs-user", protectedEntry: true, reason: "no-account" });
  assert.equal(scripts, 2, "only the username probe and fill ran");
  assert.equal(audits, 1);
});

test("disabling an account while the form probe is pending prevents credential entry", async () => {
  const url = "https://revoke-probe.example/login";
  let enabled = true, scripts = 0, protectedPage = false;
  const result = await executePrivateLogin({
    protect: () => { protectedPage = true; },
    execute: async code => {
      if (code === BROWSER_LOGIN_STATE_SCRIPT) return { ...login, url };
      scripts++; enabled = false; return true;
    },
  }, { automaticCredential: () => enabled ? { id: "revoked", url, username: "user", password: "secret" } : undefined }, new AbortController().signal, { graceMs: 0, timeoutMs: 3000 });
  assert.deepEqual(result, { status: "needs-user", protectedEntry: false, reason: "no-account" });
  assert.equal(scripts, 1);
  assert.equal(protectedPage, false);
});

test("an explicit SSO meta rule verifies its return page even when it retains an auth route", { timeout: 10000 }, async () => {
  for (const [name, configured, returnPath, expected] of [
    ["matched", true, "/auth", "ready"],
    ["unconfigured", false, "/auth", "needs-user"],
    ["wrong-path", true, "/oauth", "needs-user"],
  ]) {
    const authOrigin = `https://${name}.sso.example`, url = authOrigin + "/login";
    let scripts = 0;
    const result = await executePrivateLogin({
      protect() {},
      execute: async code => code === BROWSER_LOGIN_STATE_SCRIPT
        ? scripts < 2 ? { ...login, url } : { ...home, authenticated: false, declaredAuthenticated: true, url: "https://business.example" + returnPath }
        : (++scripts, true),
    }, {
      automaticCredential: () => ({ id: name, url, username: "user", password: "secret" }),
      ssoRules: () => configured ? [{ id: name, authOrigin, returnUrl: "https://business.example/auth", evidence: "meta" }] : [],
    }, new AbortController().signal, { graceMs: 0, timeoutMs: 1800 });
    assert.equal(result.status, expected, name);
  }
});
