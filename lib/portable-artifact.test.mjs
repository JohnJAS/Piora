import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findPortableArtifact,
  normalizePortableVersion,
  verifyPortableArtifact,
} from "../scripts/verify-portable-artifact.mjs";

test("portable artifact versions are strict and normalized", () => {
  assert.equal(normalizePortableVersion("v0.2.0"), "0.2.0");
  assert.equal(normalizePortableVersion("0.2.0"), "0.2.0");
  assert.throws(() => normalizePortableVersion("0.2"), /must match/);
});

test("portable artifact selection requires exactly the versioned Windows wrapper", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-portable-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const expected = join(root, "Piora-0.2.0-win-x64-portable.exe");
  await writeFile(expected, "fixture");
  assert.equal(await findPortableArtifact(root, "v0.2.0"), expected);
  await writeFile(join(root, "Piora-0.1.0-win-x64-portable.exe"), "fixture");
  await assert.rejects(() => findPortableArtifact(root, "0.2.0"), /Expected only/);
});

test("portable artifact verification rejects small and malformed executables", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-portable-pe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "Piora-0.2.0-win-x64-portable.exe");
  await writeFile(path, "not an executable");
  await assert.rejects(() => verifyPortableArtifact(path, "0.2.0"), /unexpectedly small/);

  const handle = await open(path, "w");
  try {
    await handle.truncate(50 * 1024 * 1024);
  } finally {
    await handle.close();
  }
  await assert.rejects(() => verifyPortableArtifact(path, "0.2.0"), /DOS\/PE header/);
});
