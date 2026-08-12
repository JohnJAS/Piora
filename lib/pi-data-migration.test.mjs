import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { directoryHasData, migratePiDataDirectory } = await jiti.import("../desktop/src/pi-data-migration.ts");

test("migrates existing Pi data into an empty directory and retains the source", (t) => {
  const root = mkdtempSync(join(tmpdir(), "piora-pi-migration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "old-agent");
  const destination = join(root, "new-agent");
  mkdirSync(join(source, "sessions"), { recursive: true });
  mkdirSync(destination);
  writeFileSync(join(source, "auth.json"), "credentials");
  writeFileSync(join(source, "sessions", "one.jsonl"), "session");

  const result = migratePiDataDirectory(source, destination);
  assert.equal(result.files, 2);
  assert.equal(readFileSync(join(destination, "auth.json"), "utf8"), "credentials");
  assert.equal(readFileSync(join(source, "sessions", "one.jsonl"), "utf8"), "session");
});

test("skips missing legacy data and refuses to merge into a populated target", (t) => {
  const root = mkdtempSync(join(tmpdir(), "piora-pi-compat-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const missing = join(root, "missing-agent");
  const destination = join(root, "new-agent");
  mkdirSync(destination);
  assert.equal(directoryHasData(missing), false);
  assert.deepEqual(migratePiDataDirectory(missing, destination), { entries: 0, files: 0, bytes: 0 });

  const source = join(root, "old-agent");
  mkdirSync(source);
  writeFileSync(join(source, "settings.json"), "{}");
  writeFileSync(join(destination, "do-not-overwrite.txt"), "user data");
  assert.throws(() => migratePiDataDirectory(source, destination), /must be empty/);
});
