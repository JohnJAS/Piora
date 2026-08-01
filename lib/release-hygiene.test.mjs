import assert from "node:assert/strict";
import test from "node:test";

import {
  SECRET_RULES,
  buildPrivatePathRules,
  getSensitivePathReason,
  scanText,
} from "../scripts/verify-release-hygiene.mjs";

test("detects high-confidence credentials without returning their value", () => {
  const syntheticToken = "gh" + "o_" + "a".repeat(24);
  const findings = scanText(`safe line\ntoken=${syntheticToken}`, SECRET_RULES);

  assert.deepEqual(findings, [{ rule: "github-token", line: 2 }]);
  assert.equal(JSON.stringify(findings).includes(syntheticToken), false);
});

test("detects the active checkout and home without hard-coding private paths", () => {
  const rules = buildPrivatePathRules({ cwd: process.cwd(), home: "Z:/synthetic-home" });
  assert.equal(scanText(`checkout=${process.cwd()}`, rules).length > 0, true);
  assert.equal(scanText("checkout=<development-checkout>", rules).length, 0);
});

test("rejects publish-sensitive paths while allowing templates and source fixtures", () => {
  assert.equal(getSensitivePathReason(".env.local"), "environment-file");
  assert.equal(getSensitivePathReason("private/session.jsonl"), "credential-or-session-file");
  assert.equal(getSensitivePathReason(".pi/agent/auth.json"), "credential-file");
  assert.equal(getSensitivePathReason("desktop/release/app.exe"), "generated-release-data");
  assert.equal(getSensitivePathReason(".env.example"), null);
  assert.equal(getSensitivePathReason("lib/session-reader.test.mjs"), null);
});
