import assert from "node:assert/strict";
import test from "node:test";

const { inspectToolRuntime } = await import("./tool-runtime.ts");

test("reports managed and system tool sources with versions", () => {
  const result = inspectToolRuntime({
    agentDir: "C:/Users/test/.pi/agent",
    platform: "win32",
    files: new Set(["C:\\Users\\test\\.pi\\agent\\bin\\fd.exe"]),
    run: (command) => command.endsWith("\\fd.exe")
      ? { status: 0, stdout: "fd 10.2.0\n", stderr: "" }
      : command === "rg"
        ? { status: 0, stdout: "ripgrep 15.1.0\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "" },
  });

  assert.deepEqual(result.map(({ id, status, version, source, path }) => ({ id, status, version, source, path })), [
    { id: "fd", status: "available", version: "10.2.0", source: "managed", path: "C:\\Users\\test\\.pi\\agent\\bin\\fd.exe" },
    { id: "rg", status: "available", version: "15.1.0", source: "system", path: "rg" },
  ]);
});

test("reports missing tools and the offline state", () => {
  const result = inspectToolRuntime({
    agentDir: "C:/Users/test/.pi/agent",
    platform: "win32",
    env: { PI_OFFLINE: "1" },
    files: new Set(),
    run: () => ({ status: 1, stdout: "", stderr: "not found" }),
  });

  assert.equal(result.every((tool) => tool.status === "missing"), true);
  assert.equal(result.every((tool) => tool.offline === true), true);
});
