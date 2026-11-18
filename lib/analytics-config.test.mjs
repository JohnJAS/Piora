import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { readAnalyticsConfig, initializeAnalyticsConfig } from "../desktop/src/analytics-store.mts";

test("Windows analytics configuration accepts HTTP and HTTPS while rejecting invalid origins", {
  skip: process.platform !== "win32" ? "Windows configuration path" : false,
}, () => {
  const root = mkdtempSync(join(tmpdir(), "piora-analytics-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const directory = join(root, "piora", "telemetry");
  mkdirSync(directory, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = root;
  const read = (backend_url, enabled = true, proxy_mode) => {
    writeFileSync(join(directory, "config.json"), JSON.stringify({ backend_url, enabled, enrollment_key: "synthetic-enrollment", proxy_mode }));
    return readAnalyticsConfig();
  };
  try {
    const warnings = [];
    initializeAnalyticsConfig(code => warnings.push(code));
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "config.json"), "utf8")), { enabled: false, backend_url: "", enrollment_key: "" });
    assert.equal(readAnalyticsConfig(), undefined);
    assert.deepEqual(readdirSync(directory), ["config.json"]);
    const original = readFileSync(join(directory, "config.json"), "utf8");
    initializeAnalyticsConfig(code => warnings.push(code));
    assert.equal(readFileSync(join(directory, "config.json"), "utf8"), original);
    assert.equal(read("http://analytics.internal", true, "inherit").proxy_mode, "inherit");
    assert.equal(read("http://analytics.internal", true, "direct").proxy_mode, "direct");
    assert.equal(read("http://analytics.internal", true, "unknown"), undefined);
    for (const url of ["http://127.0.0.1:4319", "http://192.168.1.10:4319", "http://analytics.internal:4319", "https://analytics.example.com"]) {
      assert.deepEqual(read(url), { backend_url: url, enabled: true, enrollment_key: "synthetic-enrollment" });
    }
    const enterprise = readFileSync(join(directory, "config.json"), "utf8");
    initializeAnalyticsConfig(code => warnings.push(code));
    assert.equal(readFileSync(join(directory, "config.json"), "utf8"), enterprise);
    assert.equal(read("http://analytics.internal/")?.backend_url, "http://analytics.internal");
    assert.equal(read("http://analytics.internal", false), undefined);
    for (const url of ["ftp://analytics.internal", "file:///tmp/data", "not a URL", "http://user:password@analytics.internal", "http://analytics.internal/path", "http://analytics.internal?secret=test", "http://analytics.internal#fragment"]) {
      assert.equal(read(url), undefined, url);
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    assert.match(relative(resolve(tmpdir()), resolve(root)), /^piora-analytics-config-[\w-]+$/);
    rmSync(root, { recursive: true, force: true });
  }
});
