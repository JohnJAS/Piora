import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { HarmonyError, runCommand } = await jiti.import("./harmony/index.ts");

test("runs an absolute executable with exact argv and captures bounded output", async () => {
  const hostile = `hello & echo pwned; $() \`whoami\` "quoted"`;
  const result = await runCommand({
    executable: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", hostile],
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    operation: "test",
  });
  assert.deepEqual(JSON.parse(result.stdout.toString("utf8")), [hostile]);
  assert.equal(result.exitCode, 0);
});

test("enforces timeout, abort, output limits, and absolute executable paths", async () => {
  await assert.rejects(() => runCommand({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 20,
    operation: "timeout_test",
  }), (error) => error instanceof HarmonyError && error.code === "COMMAND_TIMEOUT");

  await assert.rejects(() => runCommand({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(1024))"],
    maxOutputBytes: 32,
    operation: "limit_test",
  }), (error) => error instanceof HarmonyError && error.code === "COMMAND_OUTPUT_LIMIT");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => runCommand({
    executable: process.execPath,
    args: ["-e", "process.exit()"],
    signal: controller.signal,
  }), (error) => error instanceof HarmonyError && error.code === "COMMAND_ABORTED");

  await assert.rejects(() => runCommand({ executable: "hdc.exe", args: [] }),
    (error) => error instanceof HarmonyError && error.code === "HDC_INVALID");
});
