import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(".") },
});

const {
  CapabilityBundleError,
  assertSafeCapabilityArchivePath,
  exportCapabilityBundle,
  importCapabilityBundle,
  validateCapabilityBundleManifest,
} = await jiti.import("./capability-bundles.ts");
const capabilityBundleRoute = await jiti.import("../app/api/capability-bundles/route.ts");

function validManifest(overrides = {}) {
  return {
    format: "piora-capability-bundle",
    version: 1,
    id: "fixture-bundle",
    name: "Fixture capabilities",
    createdAt: "2026-08-30T00:00:00.000Z",
    createdBy: { app: "Piora", version: "0.4.29", platform: "win32" },
    security: { secretsIncluded: false },
    plugins: [{
      id: "portable-plugin",
      scope: "global",
      label: "Portable plugin",
      portablePath: "payload/plugins/portable-plugin",
    }],
    skills: [],
    extensionStates: [{
      target: "plugin",
      pluginId: "portable-plugin",
      relativePath: "extensions/index.ts",
      enabled: true,
    }],
    skillStates: [],
    warnings: [],
    ...overrides,
  };
}

test("capability bundle manifest accepts a portable, secret-free bundle", () => {
  const manifest = validateCapabilityBundleManifest(validManifest());
  assert.equal(manifest.format, "piora-capability-bundle");
  assert.equal(manifest.plugins[0].portablePath, "payload/plugins/portable-plugin");
  assert.equal(manifest.extensionStates[0].target, "plugin");
});

test("capability bundle import route rejects cross-site writes before reading the archive", async () => {
  const response = await capabilityBundleRoute.POST(new Request(
    `http://localhost:30141/api/capability-bundles?cwd=${encodeURIComponent(process.cwd())}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/vnd.piora.capability-bundle+zip",
        origin: "https://attacker.example",
        host: "localhost:30141",
        "sec-fetch-site": "cross-site",
      },
      body: new Uint8Array([1, 2, 3]),
    },
  ));
  assert.equal(response.status, 403);
});

test("capability bundle paths reject traversal, absolute paths, and Windows separators", () => {
  for (const unsafe of ["../auth.json", "/etc/passwd", "C:/Users/test/.env", "payload\\..\\auth.json"]) {
    assert.throws(
      () => assertSafeCapabilityArchivePath(unsafe),
      (error) => error instanceof CapabilityBundleError && error.status === 422,
    );
  }
  assert.equal(assertSafeCapabilityArchivePath("payload/plugins/example/index.ts"), "payload/plugins/example/index.ts");
});

test("capability bundle manifest rejects secret-bearing declarations and dangling state references", () => {
  assert.throws(
    () => validateCapabilityBundleManifest(validManifest({ security: { secretsIncluded: true } })),
    /secret-exclusion policy/,
  );
  assert.throws(
    () => validateCapabilityBundleManifest(validManifest({
      extensionStates: [{
        target: "plugin",
        pluginId: "missing-plugin",
        relativePath: "index.ts",
        enabled: true,
      }],
    })),
    /unknown plugin/,
  );
});

test("capability bundle manifest requires exactly one remote source or portable payload", () => {
  assert.throws(
    () => validateCapabilityBundleManifest(validManifest({
      plugins: [{
        id: "bad-plugin",
        scope: "global",
        label: "Bad plugin",
        source: "npm:example",
        portablePath: "payload/plugins/example",
      }],
      extensionStates: [],
    })),
    /exactly one valid source/,
  );
  assert.throws(
    () => validateCapabilityBundleManifest(validManifest({
      plugins: [{
        id: "unsafe-source",
        scope: "global",
        label: "Unsafe source",
        source: "../../outside-project",
      }],
      extensionStates: [],
    })),
    /remote source is unsafe/,
  );
  assert.throws(
    () => validateCapabilityBundleManifest(validManifest({
      plugins: [{
        id: "credential-source",
        scope: "global",
        label: "Credential source",
        source: "https://token@example.com/plugin.git",
      }],
      extensionStates: [],
    })),
    /remote source is unsafe/,
  );
});

test("capability bundle export embeds custom project extensions and skills without environment files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-capability-export-"));
  const agentDir = path.join(root, "agent");
  const homeDir = path.join(root, "home");
  const cwd = path.join(root, "project");
  const targetCwd = path.join(root, "target-project");
  const extensionDir = path.join(cwd, ".pi", "extensions", "fixture-extension");
  const skillDir = path.join(cwd, ".pi", "skills", "fixture-skill");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(targetCwd, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "index.ts"), "export default function fixture() {}\n");
  fs.writeFileSync(path.join(extensionDir, ".env"), "SECRET=must-not-export\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: fixture-skill\ndescription: fixture\n---\n# Fixture\n");

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousHome = process.env.HOME;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.HOME = homeDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const { bytes, manifest } = await exportCapabilityBundle(cwd);
  const custom = manifest.plugins.find((plugin) => plugin.id === "custom-project");
  assert.ok(custom?.portablePath);
  assert.ok(manifest.warnings.some((warning) => warning.endsWith(".env")));
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  assert.ok(names.some((name) => name.endsWith("/index.ts")));
  assert.ok(names.some((name) => name.endsWith("/SKILL.md")));
  assert.equal(names.some((name) => name.endsWith("/.env")), false);

  const imported = await importCapabilityBundle(bytes, targetCwd);
  assert.equal(imported.success, true);
  assert.equal(imported.summary.pluginsInstalled, 1);
  assert.ok(imported.summary.extensionStatesApplied >= 1);
  const targetSettings = JSON.parse(fs.readFileSync(path.join(targetCwd, ".pi", "settings.json"), "utf8"));
  assert.equal(targetSettings.packages.length, 1);
  assert.match(typeof targetSettings.packages[0] === "string" ? targetSettings.packages[0] : targetSettings.packages[0].source, /imported-capabilities/);
});
