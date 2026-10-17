import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { withHdcLocalPath, HDC_LOCAL_PATH_LIMIT } = jiti("./harmony/runtime/hdc-local-path.ts");
const { HarmonyRequestError } = jiti("./harmony/request-error.ts");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "piora-hdc-path-test-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const directory = join(root, "a".repeat(90), "b".repeat(90), "c".repeat(50));
  await mkdir(directory, { recursive: true });
  const file = join(directory, "input.hap");
  return { root, directory, file };
}
test("long install uses verified private copy without adding replace, and keeps source bytes", async t => {
  const { root, file } = await fixture(t);
  const bytes = Buffer.from("signed immutable HAP bytes");
  await writeFile(file, bytes);
  let protectedDirectory;
  await withHdcLocalPath({ args: ["-t", "test", "install", file], platform: "win32", temporaryRoot: root,
    protect: async directory => { protectedDirectory = directory; assert.deepEqual(await readdir(directory), []); },
    execute: async args => {
      assert.deepEqual(args.slice(0, -1), ["-t", "test", "install"]);
      assert.equal(dirname(args.at(-1)), protectedDirectory);
      assert.ok(args.at(-1).length <= HDC_LOCAL_PATH_LIMIT);
      assert.deepEqual(await readFile(args.at(-1)), bytes);
      assert.notEqual((await stat(args.at(-1))).ino, (await stat(file)).ino, "staging must copy, never hard-link the source");
    },
  });
  assert.deepEqual(await readFile(file), bytes);
  await assert.rejects(stat(protectedDirectory), { code: "ENOENT" });
});
test("sandbox send and receive retain every remote argument and copy back exclusively", async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, "payload");
  const common = { platform: "win32", temporaryRoot: root, protect: async () => {} };
  await withHdcLocalPath({ ...common, args: ["-t", "test", "file", "send", "-b", "app.test", file, "files/远端.db"],
    execute: async args => { assert.deepEqual(args.slice(0, -2), ["-t", "test", "file", "send", "-b", "app.test"]); assert.equal(args.at(-1), "files/远端.db"); assert.equal(await readFile(args.at(-2), "utf8"), "payload"); },
  });
  const destination = join(dirname(file), "received.db");
  await withHdcLocalPath({ ...common, args: ["-t", "test", "file", "recv", "-b", "app.test", "files/db.sqlite", destination],
    execute: async args => { assert.deepEqual(args.slice(0, -1), ["-t", "test", "file", "recv", "-b", "app.test", "files/db.sqlite"]); await writeFile(args.at(-1), "database snapshot"); },
  });
  assert.equal(await readFile(destination, "utf8"), "database snapshot");
  let dispatched = false;
  await assert.rejects(withHdcLocalPath({ ...common, args: ["-t", "test", "file", "recv", "remote", destination], execute: async () => { dispatched = true; } }), /already exists/);
  assert.equal(dispatched, false);
  assert.equal(await readFile(destination, "utf8"), "database snapshot");
});
test("cancelled receive never publishes partial data and cleans private staging", async t => {
  const { root, file } = await fixture(t);
  const controller = new AbortController();
  let directory;
  await assert.rejects(withHdcLocalPath({ args: ["-t", "test", "file", "recv", "remote", file], platform: "win32", temporaryRoot: root,
    signal: controller.signal, protect: async value => { directory = value; },
    execute: async args => { await writeFile(args.at(-1), "partial"); controller.abort(); },
  }), error => error.code === "COMMAND_ABORTED");
  await assert.rejects(stat(file), { code: "ENOENT" });
  await assert.rejects(stat(directory), { code: "ENOENT" });
});
test("ACL failure prevents dispatch; deep TEMP uses a bounded existing ancestor", async t => {
  const { root, directory, file } = await fixture(t);
  await writeFile(file, "hap");
  let privateDirectory;
  let dispatched = false;
  await assert.rejects(withHdcLocalPath({ args: ["-t", "test", "install", "-r", file], platform: "win32", temporaryRoot: directory,
    protect: async path => { privateDirectory = path; throw new Error("ACL denied"); }, execute: async () => { dispatched = true; },
  }), error => error.details?.reason === "local-file-staging-unavailable" && error.details.dispatchState === "not-sent");
  assert.equal(dispatched, false);
  assert.ok(privateDirectory.startsWith(root));
  assert.ok(join(privateDirectory, "input.hap").length <= HDC_LOCAL_PATH_LIMIT);
  await assert.rejects(stat(privateDirectory), { code: "ENOENT" });
});
test("short paths and unrelated commands bypass staging", async () => {
  for (const args of [["-t", "test", "install", "C:\\short.hap"], ["-t", "test", "shell", "x".repeat(400)]]) {
    let dispatched;
    await withHdcLocalPath({ args, platform: "win32", protect: async () => { assert.fail("must not stage"); }, execute: async value => { dispatched = value; } });
    assert.equal(dispatched, args);
  }
});
test("real Windows ACL protects long-path staging before any file bytes are written", { skip: process.platform !== "win32" }, async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, "real ACL fixture");
  await withHdcLocalPath({ args: ["-t", "test", "install", file], temporaryRoot: root,
    execute: async args => assert.equal(await readFile(args.at(-1), "utf8"), "real ACL fixture"),
  });
});
test("fixed local transfer reasons have useful Chinese messages without local paths", () => {
  for (const reason of ["local-file-unavailable", "local-file-staging-unavailable", "local-file-staging-cleanup-failed", "local-file-changed", "local-file-destination-exists"]) {
    const error = new HarmonyRequestError({ code: "COMMAND_FAILED", message: "generic", details: { reason } }, 502);
    assert.notEqual(error.messageFor(true), "generic");
    assert.match(error.messageFor(true), /文件|目录|目标/);
  }
});
