import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./web-auth.ts");
}

function authorization(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function withEnvironment(overrides, callback) {
  const previous = new Map(Object.keys(overrides).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("enables password authentication only for a non-empty configured password", async () => {
  const { isWebPasswordEnabled } = await loadSubject();
  withEnvironment({ PI_WEB_PASSWORD: undefined }, () => {
    assert.equal(isWebPasswordEnabled(), false);
  });
  assert.equal(isWebPasswordEnabled(""), false);
  assert.equal(isWebPasswordEnabled("secret"), true);
});

test("validates the desktop token only when its authentication boundary is enabled", async () => {
  const { isDesktopTokenEnabled, isValidDesktopToken } = await loadSubject();
  withEnvironment({ PI_DESKTOP_TOKEN: undefined }, () => {
    assert.equal(isDesktopTokenEnabled(), false);
    assert.equal(isValidDesktopToken("desktop-secret"), false);
  });
  assert.equal(isDesktopTokenEnabled(""), false);
  assert.equal(isDesktopTokenEnabled("desktop-secret"), true);
  assert.equal(isValidDesktopToken("desktop-secret", "desktop-secret"), true);
  assert.equal(isValidDesktopToken("wrong", "desktop-secret"), false);
  assert.equal(isValidDesktopToken(null, "desktop-secret"), false);
  assert.equal(isValidDesktopToken("desktop-secret", ""), false);
});

test("uses the configured desktop token when no explicit token is injected", async () => {
  const { isDesktopTokenEnabled, isValidDesktopToken } = await loadSubject();
  withEnvironment({ PI_DESKTOP_TOKEN: "environment-secret" }, () => {
    assert.equal(isDesktopTokenEnabled(), true);
    assert.equal(isValidDesktopToken("environment-secret"), true);
    assert.equal(isValidDesktopToken("wrong"), false);
  });
});

test("accepts only the fixed pi username and configured password", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  assert.equal(isValidBasicAuthorization(authorization("pi", "secret"), "secret"), true);
  assert.equal(isValidBasicAuthorization(authorization("admin", "secret"), "secret"), false);
  assert.equal(isValidBasicAuthorization(authorization("pi", "wrong"), "secret"), false);
});

test("supports UTF-8 passwords and colons in the password", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  const password = "口令:with:colons";
  assert.equal(isValidBasicAuthorization(authorization("pi", password), password), true);
});

test("rejects missing, malformed, and non-canonical authorization values", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  const valid = authorization("pi", "secret");

  assert.equal(isValidBasicAuthorization(null, "secret"), false);
  assert.equal(isValidBasicAuthorization("Bearer token", "secret"), false);
  assert.equal(isValidBasicAuthorization("Basic !!!", "secret"), false);
  assert.equal(isValidBasicAuthorization(`${valid}!`, "secret"), false);
  assert.equal(isValidBasicAuthorization(
    `Basic ${Buffer.from("missing-separator", "utf8").toString("base64")}`,
    "secret",
  ), false);
});

test("does not authenticate when password protection is disabled", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  assert.equal(isValidBasicAuthorization(authorization("pi", ""), ""), false);
  withEnvironment({ PI_WEB_PASSWORD: undefined }, () => {
    assert.equal(isValidBasicAuthorization(authorization("pi", "secret")), false);
  });
});
