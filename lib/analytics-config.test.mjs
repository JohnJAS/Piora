import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { readAnalyticsConfig } from "../desktop/src/analytics-store.mts";

test("Windows analytics configuration accepts HTTP and HTTPS while rejecting invalid origins", {
  skip: process.platform !== "win32" ? "Windows configuration path" : false,
}, () => {
  const root = mkdtempSync(join(tmpdir(), "piora-analytics-config-"));
  const previous = process.env.LOCALAPPDATA;
  const directory = join(root, "Piora", "telemetry");
  mkdirSync(directory, { recursive: true });
  process.env.LOCALAPPDATA = root;
  const read = (backend_url, enabled = true) => {
    writeFileSync(join(directory, "config.json"), JSON.stringify({ backend_url, enabled, enrollment_key: "synthetic-enrollment" }));
    return readAnalyticsConfig();
  };
  try {
    for (const url of ["http://127.0.0.1:4319", "http://192.168.1.10:4319", "http://analytics.internal:4319", "https://analytics.example.com"]) {
      assert.deepEqual(read(url), { backend_url: url, enabled: true, enrollment_key: "synthetic-enrollment" });
    }
    assert.equal(read("http://analytics.internal/")?.backend_url, "http://analytics.internal");
    assert.equal(read("http://analytics.internal", false), undefined);
    for (const url of ["ftp://analytics.internal", "file:///tmp/data", "not a URL", "http://user:password@analytics.internal", "http://analytics.internal/path", "http://analytics.internal?secret=test", "http://analytics.internal#fragment"]) {
      assert.equal(read(url), undefined, url);
    }
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    assert.match(relative(resolve(tmpdir()), resolve(root)), /^piora-analytics-config-[\w-]+$/);
    rmSync(root, { recursive: true, force: true });
  }
});
