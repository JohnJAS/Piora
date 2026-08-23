import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const runtime = await jiti.import("./runtime-evidence.ts");

test("runtime verification accepts direct successful checks and rejects masked or compound shell commands", () => {
  assert.equal(runtime.runtimeVerificationLabel("npm test"), "test suite");
  assert.equal(runtime.runtimeVerificationLabel("npm run typecheck"), "typecheck");
  assert.equal(runtime.runtimeVerificationLabel("npm test && git diff --check"), "test suite");
  for (const command of ["npm test || true", "npm test; exit 0", "npm test\necho ok", "npm test | tee out.log", "npm test &"]) {
    assert.equal(runtime.runtimeVerificationLabel(command), undefined, command);
  }
});
