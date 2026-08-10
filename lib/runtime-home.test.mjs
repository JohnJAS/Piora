import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./runtime-home.ts");
  } catch {
    return import("./runtime-home.ts");
  }
}

const { getRuntimeHomeDirectory } = await loadSubject();

test("prefers an explicit Pi GUI home directory", () => {
  assert.equal(
    getRuntimeHomeDirectory({
      PIORA_HOME: "C:\\PiHome",
      USERPROFILE: "C:\\Users\\fallback",
    }),
    path.resolve("C:\\PiHome"),
  );
});

test("falls back to standard home environment variables", () => {
  const expected = path.resolve(process.platform === "win32" ? "C:\\Users\\pi" : "/home/pi");
  assert.equal(
    getRuntimeHomeDirectory({ USERPROFILE: "C:\\Users\\pi", HOME: "/home/pi" }),
    expected,
  );
});

test("rejects a missing runtime home directory", () => {
  assert.throws(
    () => getRuntimeHomeDirectory({}),
    /PIORA_HOME, USERPROFILE, or HOME/,
  );
});
