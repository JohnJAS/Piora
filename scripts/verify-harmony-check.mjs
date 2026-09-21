import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";

const fixture = resolve("lib/design-to-harmony/fixtures/harmony-flex");
const root = await mkdtemp(join(tmpdir(), "piora-harmony-real-"));
const project = join(root, "harmony-flex");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent-data");
const jiti = createJiti(import.meta.url);
const { closeHarmonyCheckRuntimes, runHarmonyCheck } = await jiti.import("../lib/harmony/check-runtime.ts");
const studioPath = process.env.DEVECO_CLI_STUDIO_PATH;
if (!studioPath) throw new Error("Set DEVECO_CLI_STUDIO_PATH to a DevEco Studio installation");
const baseConfig = {
  arktsEnabled: true, lintEnabled: true, checkAfterAgentEdits: true, maxAgentIterations: 3,
  timeoutMs: 45_000, studioPath, products: {},
};

try {
  await cp(fixture, project, { recursive: true });
  // Real projects do not always have a Code Linter config yet. Verify Piora's
  // temporary recommended config is created and removed without touching the
  // project after the check.
  await rm(join(project, "code-linter.json5"), { force: true });
  const lint = await runHarmonyCheck({ projectRoot: project, checks: ["lint"], config: baseConfig });
  if (lint.status === "incomplete") console.error("real lint incomplete:", lint.checks[0]?.message ?? "unknown error");
  assert.equal(lint.status, "issues");
  assert.ok(lint.diagnostics.some((item) => item.source === "lint" && item.rule === "@performance/avoid-overusing-custom-component-check"));
  assert.equal((await readdir(project)).some((name) => name.startsWith(".piora-code-linter-")), false);
  console.log(`real lint: ${lint.status}, ${lint.summary.total} diagnostic(s), ${lint.durationMs}ms`);

  const broken = join(project, "entry", "src", "main", "ets", "pages", "Broken.ets");
  await writeFile(broken, `@Entry\n@Component\nstruct Broken {\n  build() {\n    const count: number = 'not-a-number';\n    Text(count)\n  }\n}\n`);
  const arkts = await runHarmonyCheck({ projectRoot: project, checks: ["arkts"], files: [broken], config: baseConfig });
  console.log(`real arkts result: ${arkts.status}, ${arkts.summary.total} diagnostic(s), ${arkts.durationMs}ms`, arkts.diagnostics.map((item) => ({ severity: item.severity, code: item.code, message: item.message })), arkts.checks[0].message ?? "");
  assert.equal(arkts.status, "issues");
  assert.ok(arkts.diagnostics.some((item) => item.source === "arkts" && item.severity === "error"));
  console.log(`real arkts: ${arkts.status}, ${arkts.summary.total} diagnostic(s), ${arkts.durationMs}ms`);

  await writeFile(broken, `@Entry\n@Component\nstruct Repaired {\n  build() {\n    Text('valid ArkTS')\n  }\n}\n`);
  const repaired = await runHarmonyCheck({ projectRoot: project, checks: ["arkts"], files: [broken], config: baseConfig });
  assert.equal(repaired.status, "passed");
  assert.equal(repaired.summary.total, 0);
  console.log(`real repaired recheck: ${repaired.status}, ${repaired.durationMs}ms`);

  const timeout = await runHarmonyCheck({ projectRoot: project, checks: ["lint"], config: { ...baseConfig, timeoutMs: 20 } });
  assert.equal(timeout.status, "incomplete");
  assert.match(timeout.checks[0].message ?? "", /exceeded/i);
  console.log(`real timeout: ${timeout.status}, ${timeout.durationMs}ms`);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await runHarmonyCheck({ projectRoot: project, checks: ["lint"], signal: controller.signal, config: baseConfig });
  assert.equal(cancelled.status, "cancelled");
  console.log(`real cancellation: ${cancelled.status}, ${cancelled.durationMs}ms`);
} finally {
  await closeHarmonyCheckRuntimes();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
}
