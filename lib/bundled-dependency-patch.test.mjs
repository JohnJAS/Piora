import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  patchBundledBraceExpansion,
  patchBundledUndici,
  patchElectronBuilderWorkspaceCollector,
} from "../scripts/patch-bundled-dependencies.mjs";

async function writePackage(path, name, version, marker) {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "package.json"),
    `${JSON.stringify({ name, version }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(path, marker), `${version}\n`, "utf8");
}

async function withFixture(targetVersion, callback) {
  const root = await mkdtemp(join(tmpdir(), "piora-bundled-patch-"));
  try {
    await writePackage(join(root, "node_modules", "brace-expansion"), "brace-expansion", "5.0.9", "patched.js");
    await writePackage(
      join(
        root,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "node_modules",
        "brace-expansion",
      ),
      "brace-expansion",
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

test("replaces Pi's bundled undici with the reviewed secure version", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-bundled-undici-patch-"));
  try {
    await writePackage(join(root, "node_modules", "undici"), "undici", "8.9.0", "secure.js");
    const target = join(
      root,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "undici",
    );
    await writePackage(target, "undici", "8.5.0", "bundled.js");

    assert.deepEqual(await patchBundledUndici(root), {
      patched: true,
      from: "8.5.0",
      to: "8.9.0",
    });
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    assert.equal(manifest.version, "8.9.0");
    assert.equal(await readFile(join(target, "secure.js"), "utf8"), "8.9.0\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("electron-builder traverses workspace dependencies before accepting npm's root tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-electron-builder-patch-"));
  try {
    const packageRoot = join(root, "node_modules", "app-builder-lib");
    await mkdir(join(packageRoot, "out", "util"), { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({ name: "app-builder-lib", version: "26.15.3" })}\n`,
      "utf8",
    );
    const collectorPath = join(packageRoot, "out", "util", "appFileCopier.js");
    await writeFile(
      collectorPath,
      "const pmApproaches = [await packager.getPackageManager(), node_module_collector_1.PM.TRAVERSAL];\n",
      "utf8",
    );

    assert.deepEqual(await patchElectronBuilderWorkspaceCollector(root), {
      patched: true,
      version: "26.15.3",
    });
    assert.match(
      await readFile(collectorPath, "utf8"),
      /\[node_module_collector_1\.PM\.TRAVERSAL, await packager\.getPackageManager\(\)\]/,
    );
    assert.deepEqual(await patchElectronBuilderWorkspaceCollector(root), {
      patched: false,
      reason: "already-patched",
      version: "26.15.3",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
