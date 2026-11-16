import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { chromium } from "playwright-core";
const jiti = createJiti(import.meta.url);
const { credentialFillScript } = await jiti.import("../desktop/src/credential-fill.ts");

test("credential fill checks the live form and origin, never submits or returns secret values", { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = "https://accounts.example.com/login";
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><form method="post"><input name="username" autocomplete="username"><input type="password" autocomplete="current-password"><button>Login</button></form><script>window.submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submits++}</script>' }));
  const fill = () => page.evaluate(credentialFillScript(url, "private-user", "private-password"));
  await page.goto(url);
  assert.equal(await page.evaluate(credentialFillScript(url, "", "", true)), true);
  assert.equal(await page.locator('input[type="password"]').inputValue(), "");
  assert.equal(await fill(), true);
  assert.equal(await page.locator('input[name="username"]').inputValue(), "private-user");
  assert.equal(await page.locator('input[type="password"]').inputValue(), "private-password");
  assert.equal(await page.evaluate(() => window.submits), 0);
  for (const change of [
    () => { document.querySelector("form").action = "https://evil.example/"; },
    () => { document.querySelector("form").method = "get"; },
    () => { document.querySelector('input[type="password"]').autocomplete = "new-password"; },
    () => { document.querySelector("form").insertAdjacentHTML("beforeend", '<input autocomplete="one-time-code">'); },
    () => { document.querySelector("button").textContent = "付款"; },
    () => { document.querySelector("form").insertAdjacentHTML("beforeend", '<input type="password">'); },
    () => { document.querySelector('input[name="username"]').style.display = "none"; },
  ]) {
    await page.goto(url); await page.evaluate(change);
    assert.equal(await fill(), false);
    assert.equal(await page.locator('input[type="password"]').first().inputValue(), "");
  }
  await page.goto("https://other.example.com/login");
  assert.equal(await fill(), false);
});


test("automatic submit rejects ambiguous buttons before filling and capture stays exact-site", { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = "https://capture.example.com/login";
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<form method="post"><input name="username"><input type="password"><button>Login</button><button>Register</button></form>' }));
  await page.goto(url);
  assert.equal(await page.evaluate(credentialFillScript(url, "user", "secret", false, true)), false);
  assert.equal(await page.locator('input[type=password]').inputValue(), "");
  await page.locator('input[name=username]').fill("saved-user");
  await page.locator('input[type=password]').fill("saved-secret");
  assert.deepEqual(await page.evaluate(credentialFillScript(url, "", "", false, false, true)), { url, username: "saved-user", password: "saved-secret" });
  assert.equal(await page.evaluate(credentialFillScript("https://other.example.com/login", "", "", false, false, true)), false);
});

test("fills JS controls, username/password stages and same-origin frames without URL keyword blocks", { timeout: 45000 }, async t => {
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/frame" ? '<input autocomplete="username"><input type="password"><button type="button" onclick="window.submitted=true">Login</button>'
      : path === "/container" ? '<iframe src="/frame"></iframe>'
      : path === "/foreign" ? '<iframe src="https://foreign.example/frame"></iframe>'
      : path === "/username" ? '<input autocomplete="username"><button type="button" onclick="window.submitted=true">Next</button>'
      : path === "/password" ? '<input type="password"><button type="button" onclick="window.submitted=true">Sign in</button>'
      : '<input name="search"><input autocomplete="username"><input type="password"><button type="button" onclick="window.submitted=true">Login</button>';
    return route.fulfill({ contentType: "text/html", body });
  });
  for (const path of ["/security/password/verify", "/username", "/password"]) {
    const url = "https://accounts.example.com" + path;
    await page.goto(url);
    assert.equal(await page.evaluate(credentialFillScript(url, "", "", true)), true);
    assert.equal(await page.evaluate(credentialFillScript(url, "saved-user", "saved-password", false, true)), true);
    assert.equal(await page.evaluate(() => window.submitted), true);
    if (path !== "/password") assert.equal(await page.locator('[autocomplete=username]').inputValue(), "saved-user");
    if (path !== "/username") assert.equal(await page.locator('[type=password]').inputValue(), "saved-password");
  }
  await page.goto("https://accounts.example.com/password");
  await page.evaluate(() => document.body.insertAdjacentHTML("afterbegin", '<input autocomplete="username" style="display:none" value="another-user">'));
  assert.equal(await page.evaluate(credentialFillScript("https://accounts.example.com/password", "saved-user", "saved-password", false, true)), false);
  assert.equal(await page.locator('[type=password]').inputValue(), "", "a retained username for another account cannot receive this password");
  await page.locator('[autocomplete=username]').evaluate(el => el.value = "saved-user");
  assert.equal(await page.evaluate(credentialFillScript("https://accounts.example.com/password", "saved-user", "saved-password", false, true)), true);
  await page.goto("https://accounts.example.com/container");
  assert.equal(await page.evaluate(credentialFillScript("https://accounts.example.com/frame", "saved-user", "saved-password", false, true)), true);
  assert.equal(await page.frameLocator("iframe").locator('[type=password]').inputValue(), "saved-password");
  await page.goto("https://accounts.example.com/foreign");
  assert.equal(await page.evaluate(credentialFillScript("https://foreign.example/frame", "saved-user", "saved-password", false, true)), false);
  await page.goto("https://accounts.example.com/security/password/verify");
  for (const autocomplete of ["new-password", "one-time-code", "cc-number"]) {
    await page.locator('[type=password]').evaluate((el, value) => el.autocomplete = value, autocomplete);
    assert.equal(await page.evaluate(credentialFillScript("https://accounts.example.com/security/password/verify", "saved-user", "saved-password", false, true)), false);
    assert.equal(await page.locator('[type=password]').inputValue(), "");
  }
});
