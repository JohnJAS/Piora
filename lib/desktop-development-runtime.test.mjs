import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("../desktop/src/development-runtime.ts");
}

test("accepts only an authenticated fixed loopback development origin", async () => {
  const { resolveDesktopDevelopmentRuntime } = await loadSubject();
  const runtime = resolveDesktopDevelopmentRuntime({
    PI_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:30141/",
    PI_DESKTOP_TOKEN: "x".repeat(43),
  });
  assert.equal(runtime?.url.origin, "http://127.0.0.1:30141");
  assert.equal(runtime?.token.length, 43);
  assert.equal(resolveDesktopDevelopmentRuntime({}), null);

  for (const invalid of [
    "http://localhost:30141/",
    "http://0.0.0.0:30141/",
    "https://127.0.0.1:30141/",
    "http://127.0.0.1:30141/path",
    "http://user@127.0.0.1:30141/",
  ]) {
    assert.throws(() => resolveDesktopDevelopmentRuntime({
      PI_DESKTOP_DEV_SERVER_URL: invalid,
      PI_DESKTOP_TOKEN: "x".repeat(43),
    }));
  }
  assert.throws(() => resolveDesktopDevelopmentRuntime({
    PI_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:30141/",
    PI_DESKTOP_TOKEN: "short",
  }));
});

test("matches authenticated HTTP and HMR websocket requests by exact host and port", async () => {
  const { isDesktopApplicationTransportUrl } = await loadSubject();
  const application = new URL("http://127.0.0.1:30141/");
  assert.equal(isDesktopApplicationTransportUrl("http://127.0.0.1:30141/api/health", application), true);
  assert.equal(isDesktopApplicationTransportUrl("ws://127.0.0.1:30141/_next/webpack-hmr", application), true);
  assert.equal(isDesktopApplicationTransportUrl("http://127.0.0.1:30142/", application), false);
  assert.equal(isDesktopApplicationTransportUrl("http://localhost:30141/", application), false);
});
