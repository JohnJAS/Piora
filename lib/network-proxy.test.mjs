import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const subject = await jiti.import("./network-proxy.ts");

test("normalizes manual proxy settings and always bypasses local Piora traffic", () => {
  const settings = subject.parseNetworkProxySettings({
    mode: "manual",
    proxyUrl: "http://proxy.example.test:7890/",
    bypass: "*.company.test",
  });
  assert.equal(settings.proxyUrl, "http://proxy.example.test:7890");
  assert.deepEqual(settings.bypass.split(","), ["*.company.test", "localhost", "127.0.0.1", "::1"]);
  assert.throws(() => subject.parseNetworkProxySettings({ mode: "manual", proxyUrl: "socks5://localhost:1080", bypass: "" }), /HTTP and HTTPS/);
  assert.throws(() => subject.parseNetworkProxySettings({ mode: "manual", proxyUrl: "", bypass: "" }), /Enter a proxy address/);
});
test("persists private network proxy settings in the desktop data directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-network-proxy-"));
  const previous = process.env.PIORA_DESKTOP_DATA_DIR;
  process.env.PIORA_DESKTOP_DATA_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.PIORA_DESKTOP_DATA_DIR;
    else process.env.PIORA_DESKTOP_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(root, { recursive: true });
  subject.writeNetworkProxySettings({ mode: "manual", proxyUrl: "https://proxy.example.test:8443", bypass: "internal.test" });
  assert.equal(subject.readNetworkProxySettings().mode, "manual");
  const stored = JSON.parse(await readFile(join(root, "network-proxy.json"), "utf8"));
  assert.equal(stored.schema, 1);
  assert.equal(stored.proxyUrl, "https://proxy.example.test:8443");
});

test("network proxy API applies settings and tests the speech-pack host", async () => {
  const route = await readFile(new URL("../app/api/network-proxy/route.ts", import.meta.url), "utf8");
  assert.match(route, /applyNetworkProxySettings/);
  assert.match(route, /api\.github\.com\/meta/);
  assert.match(route, /isApiRequestAllowed/);
  assert.match(route, /parseJsonWithinLimit/);
});
