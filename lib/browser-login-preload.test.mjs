import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { chromium } from "playwright-core";

test("default login capture follows user submission, ignores synthetic events and unsafe forms", { timeout: 30000 }, async t => {
  const source = (await readFile(new URL("../desktop/src/browser-login-preload.ts", import.meta.url), "utf8"))
    .replace('import { ipcRenderer } from "electron";', 'const ipcRenderer = { send: (channel, value) => { globalThis.messages.push({channel,value}); if (channel === "piora:remember-login-candidate") globalThis.captures.push(value); } }; globalThis.captures = []; globalThis.messages = [];')
    .replace("process.isMainFrame", "true");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : "chromium" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript({ content: code });
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<form method="post"><input name="username"><input type="password"><button>Sign in</button></form><script>document.querySelector("form").onsubmit=e=>e.preventDefault()</script>' }));
  const fill = async () => { await page.locator('[name=username]').fill("fixture-user"); await page.locator('[type=password]').fill("fixture-password"); };
  await page.goto("https://remember.example/login"); await fill();
  assert.equal(await page.evaluate(() => captures.length), 0, "typing alone never saves an account");
  await page.evaluate(() => document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true })));
  assert.equal(await page.evaluate(() => captures.length), 0);
  await page.getByRole("button", { name: "Sign in" }).click();
  assert.deepEqual(await page.evaluate(() => captures), [{ url: "https://remember.example/login", username: "fixture-user", password: "fixture-password" }]);
  for (const url of ["http://remember.example/login"]) {
    await page.goto(url); await fill(); await page.getByRole("button", { name: "Sign in" }).click();
    assert.equal(await page.evaluate(() => captures.length), 0);
  }
  await page.goto("https://remember.example/reset"); await fill();
  await page.locator('[type=password]').evaluate(el => el.autocomplete = "new-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  assert.equal(await page.evaluate(() => captures.length), 0, "reset forms are rejected by field purpose rather than URL words");
  await page.goto("https://remember.example/login"); await fill();
  await page.evaluate(() => document.querySelector("form").action = "https://other.example/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  assert.equal(await page.evaluate(() => captures.length), 0);
});

test("modern JS login, staged username capture and same-origin frames stay private", { timeout: 45000 }, async t => {
  const source = (await readFile(new URL("../desktop/src/browser-login-preload.ts", import.meta.url), "utf8"))
    .replace('import { ipcRenderer } from "electron";', 'const ipcRenderer = { send: (channel, value) => globalThis.messages.push({channel,value}) }; globalThis.messages = [];')
    .replace("process.isMainFrame", "window === window.top");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : "chromium" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript({ content: code });
  await page.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/frame" ? '<input autocomplete="username"><input type="password"><button type="button">Sign in</button>'
      : path === "/container" ? '<iframe src="/frame"></iframe>'
      : path === "/foreign" ? '<iframe src="https://foreign.example/frame"></iframe>'
      : path === "/staged" ? '<input autocomplete="username"><button type="button" onclick="document.querySelector(\'input\').remove();this.insertAdjacentHTML(\'beforebegin\',\'<input type=password>\');this.textContent=\'Sign in\'">Next</button>'
      : path === "/native" ? '<form method="post"><input autocomplete="username"><input type="password"><button>Sign in</button></form><script>document.querySelector("form").onsubmit=e=>e.preventDefault()</script>'
      : '<input name="search"><input autocomplete="username"><input type="password"><button type="button">Sign in</button>';
    return route.fulfill({ contentType: "text/html", body });
  });
  await page.goto("https://remember.example/security/password/verify");
  await page.locator('[autocomplete=username]').fill("js-user");
  await page.locator('[type=password]').fill("js-secret");
  await page.getByRole("button", { name: "Sign in" }).click();
  assert.deepEqual(await page.evaluate(() => messages.find(row => row.channel === "piora:remember-login-candidate").value), { url: "https://remember.example/security/password/verify", username: "js-user", password: "js-secret" });
  await page.waitForFunction(() => messages.some(row => row.channel === "piora:login-form-ready"));
  assert.equal(await page.evaluate(() => messages.filter(row => row.channel === "piora:login-form-ready").length), 1);
  await page.goto("https://remember.example/native");
  await page.evaluate(() => { document.querySelector('[autocomplete=username]').value = 'auto-user'; document.querySelector('[type=password]').value = 'auto-secret'; document.querySelector('form').requestSubmit(); });
  assert.equal(await page.evaluate(() => messages.some(row => row.channel === "piora:remember-login-candidate")), false, "programmatic requestSubmit is not a human login");
  await page.goto("https://remember.example/staged");
  await page.locator('[autocomplete=username]').fill("step-user");
  await page.getByRole("button", { name: "Next" }).click();
  assert.deepEqual(await page.evaluate(() => messages.find(row => row.channel === "piora:login-username").value), { url: "https://remember.example/staged", username: "step-user" });
  await page.waitForFunction(() => messages.some(row => row.channel === "piora:login-form-ready" && row.value.stage === "password"));
  await page.locator('[type=password]').fill("step-secret");
  await page.getByRole("button", { name: "Sign in" }).click();
  assert.deepEqual(await page.evaluate(() => messages.find(row => row.channel === "piora:remember-login-candidate").value), { url: "https://remember.example/staged", username: "", password: "step-secret" });
  await page.goto("https://remember.example/container");
  const frame = page.frameLocator("iframe");
  await frame.locator('[autocomplete=username]').fill("frame-user");
  await frame.locator('[type=password]').fill("frame-secret");
  await frame.getByRole("button", { name: "Sign in" }).click();
  assert.deepEqual(await page.evaluate(() => messages.find(row => row.channel === "piora:remember-login-candidate").value), { url: "https://remember.example/frame", username: "frame-user", password: "frame-secret" });
  await page.goto("https://remember.example/foreign");
  await page.frameLocator("iframe").locator('[autocomplete=username]').fill("foreign-user");
  await page.frameLocator("iframe").locator('[type=password]').fill("foreign-secret");
  await page.frameLocator("iframe").getByRole("button", { name: "Sign in" }).click();
  assert.equal(await page.evaluate(() => messages.length), 0, "cross-origin embedded identity providers require their own top-level login");
});
