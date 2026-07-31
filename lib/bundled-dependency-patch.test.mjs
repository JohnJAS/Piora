import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { patchBundledBraceExpansion } from "../scripts/patch-bundled-dependencies.mjs";

async function writePackage(path, version, marker) {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "package.json"),
    `${JSON.stringify({ name: "brace-expansion", version }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(path, marker), `${version}\n`, "utf8");
}

async function withFixture(targetVersion, callback) {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-bundled-patch-"));
  try {
    await writePackage(join(root, "node_modules", "brace-expansion"), "5.0.9", "patched.js");
    await writePackage(
      join(
        root,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "node_modules",
        "brace-expansion",
      ),
      targetVersion,
      "bundled.js",
    );
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("replaces the known bundled vulnerable copy and is idempotent", async () => {
  await withFixture("5.0.7", async (root) => {
    const result = await patchBundledBraceExpansion(root);
    assert.deepEqual(result, { patched: true, from: "5.0.7", to: "5.0.9" });

    const target = join(
      root,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "brace-expansion",
    );
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    assert.equal(manifest.version, "5.0.9");
    assert.equal(await readFile(join(target, "patched.js"), "utf8"), "5.0.9\n");
    await assert.rejects(readFile(join(target, "bundled.js"), "utf8"), { code: "ENOENT" });

    assert.deepEqual(await patchBundledBraceExpansion(root), {
      patched: false,
      reason: "already-patched",
      version: "5.0.9",
    });
  });
});

test("fails closed for an unexpected bundled version", async () => {
  await withFixture("6.0.0", async (root) => {
    await assert.rejects(
      patchBundledBraceExpansion(root),
      /Refusing to replace unexpected bundled package brace-expansion@6\.0\.0/,
    );
  });
});
