import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const {
  shouldRunRuntimeWarmup,
  runRuntimeWarmup,
  scheduleRuntimeWarmup,
  resetRuntimeWarmupForTest,
} = await jiti.import("./runtime-warmup.ts");

test("shouldRunRuntimeWarmup allows production by default and honors test/disable overrides", () => {
  assert.deepEqual(shouldRunRuntimeWarmup({ NODE_ENV: "production" }), { allowed: true });
  assert.deepEqual(shouldRunRuntimeWarmup({ NODE_ENV: "development" }), { allowed: false, reason: "non_production" });
  assert.deepEqual(
    shouldRunRuntimeWarmup({ NODE_ENV: "development", PIORA_ENABLE_DEV_RUNTIME_WARMUP: "1" }),
    { allowed: true },
  );
  assert.deepEqual(
    shouldRunRuntimeWarmup({ NODE_ENV: "production", PIORA_DISABLE_RUNTIME_WARMUP: "1" }),
    { allowed: false, reason: "disabled_by_env" },
  );
  assert.deepEqual(
    shouldRunRuntimeWarmup({ NODE_ENV: "production", NODE_TEST_CONTEXT: "child-v8" }),
    { allowed: false, reason: "test_env" },
  );
});

test("runRuntimeWarmup preloads first-party extensions without creating live sessions", async () => {
  resetRuntimeWarmupForTest();
  const prevSessions = globalThis.__piSessions;
  const prevServices = globalThis.__piServicesCache;
  try {
    const calls = [];
    const deps = {
      initTheme: () => calls.push("initTheme"),
      getAgentRuntimeProfile: () => "normal",
      getAgentDir: () => "C:/agent",
      enabledFirstPartyExtensionPaths: (profile) => {
        calls.push(["first-party", profile]);
        return ["ext-a.ts", "ext-b.ts"];
      },
      reloadResourceLoader: async (opts) => {
        calls.push(["reload", opts.cwd, opts.agentDir, opts.additionalExtensionPaths]);
      },
    };

    const result = await runRuntimeWarmup({
      env: { NODE_ENV: "production" },
      cwd: "C:/workspace",
      deps,
    });

    assert.equal(result.warmed, true);
    assert.equal(result.profile, "normal");
    assert.equal(result.extensionCount, 2);
    assert.deepEqual(calls, [
      "initTheme",
      ["first-party", "normal"],
      ["reload", "C:/workspace", "C:/agent", ["ext-a.ts", "ext-b.ts"]],
    ]);
    assert.equal(globalThis.__piSessions, prevSessions);
    assert.equal(globalThis.__piServicesCache, prevServices);

    // Repeat call without force returns cached warmup result and does not reload.
    const repeat = await runRuntimeWarmup({ env: { NODE_ENV: "production" }, cwd: "C:/workspace", deps });
    assert.equal(repeat.warmed, true);
    assert.equal(calls.length, 3);
  } finally {
    resetRuntimeWarmupForTest();
  }
});

test("SDK warmup only initializes bundled extensions and never installs configured packages", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-runtime-warmup-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const extensionsDir = join(root, "extensions");
  const marker = join(root, "loaded.txt");
  const previousEnv = { agentDir: process.env.PI_CODING_AGENT_DIR, runtimeRoot: process.env.PIORA_WEB_RUNTIME_ROOT };
  const previousProfile = globalThis.__pioraAgentRuntimeProfile;
  t.after(async () => {
    if (previousEnv.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousEnv.agentDir;
    if (previousEnv.runtimeRoot === undefined) delete process.env.PIORA_WEB_RUNTIME_ROOT;
    else process.env.PIORA_WEB_RUNTIME_ROOT = previousEnv.runtimeRoot;
    globalThis.__pioraAgentRuntimeProfile = previousProfile;
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all([agentDir, cwd, extensionsDir].map((directory) => mkdir(directory)));
  const extensionSource = (label) => `import { appendFileSync } from "node:fs";
export default function () { appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(label)}); }`;
  await writeFile(join(extensionsDir, "piora-harmony.ts"), extensionSource("bundled"));
  await writeFile(join(agentDir, "user-extension.ts"), extensionSource("user"));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    extensions: ["./user-extension.ts"], packages: ["npm:piora-warmup-test-missing-package"],
  }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PIORA_WEB_RUNTIME_ROOT = root;
  const install = t.mock.method(DefaultPackageManager.prototype, "installParsedSource", async () => {
    throw new Error("warmup must not install packages");
  });

  const result = await runRuntimeWarmup({ force: true, cwd });

  assert.equal(result.warmed, true, result.error);
  assert.equal(install.mock.callCount(), 0);
  assert.equal(await readFile(marker, "utf8"), "bundled");
});

test("scheduleRuntimeWarmup is idempotent and swallows loader errors gracefully", async () => {
  resetRuntimeWarmupForTest();
  try {
    const first = scheduleRuntimeWarmup({ env: { NODE_ENV: "production" }, delayMs: 60_000 });
    const second = scheduleRuntimeWarmup({ env: { NODE_ENV: "production" }, delayMs: 60_000 });
    assert.equal(first, true);
    assert.equal(second, false);

    const failed = await runRuntimeWarmup({
      force: true,
      deps: {
        initTheme() { throw new Error("boom"); },
        getAgentRuntimeProfile: () => "normal",
        getAgentDir: () => "C:/agent",
        enabledFirstPartyExtensionPaths: () => [],
        reloadResourceLoader: async () => {},
      },
    });
    assert.equal(failed.warmed, false);
    assert.equal(failed.error, "boom");
  } finally {
    resetRuntimeWarmupForTest();
  }
});
