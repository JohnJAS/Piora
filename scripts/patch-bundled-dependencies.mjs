#!/usr/bin/env node

import { cp, lstat, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchedVersion = "5.0.9";
const acceptedBundledVersions = new Set(["5.0.7", patchedVersion]);

function assertInside(parent, child, label) {
  const childRelativePath = relative(parent, child);
  if (
    !childRelativePath
    || childRelativePath === ".."
    || childRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(childRelativePath)
  ) {
    throw new Error(`${label} escapes the expected directory: ${child}`);
  }
}

async function readPackage(path) {
  return JSON.parse(await readFile(join(path, "package.json"), "utf8"));
}

export async function patchBundledBraceExpansion(root = projectRoot) {
  const modulesRoot = join(root, "node_modules");
  const source = join(modulesRoot, "brace-expansion");
  const targetParent = join(
    modulesRoot,
    "@earendil-works",
    "pi-coding-agent",
    "node_modules",
  );
  const target = join(targetParent, "brace-expansion");

  assertInside(modulesRoot, source, "Patch source");
  assertInside(modulesRoot, target, "Patch target");

  const [sourceEntry, targetEntry] = await Promise.all([
    lstat(source),
    lstat(target).catch((error) => error?.code === "ENOENT" ? undefined : Promise.reject(error)),
  ]);
  if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
    throw new Error(`Expected a real directory at ${source}`);
  }
  if (!targetEntry) {
    return { patched: false, reason: "bundled-copy-absent" };
  }
  if (!targetEntry.isDirectory() || targetEntry.isSymbolicLink()) {
    throw new Error(`Refusing to replace a non-directory or symlink at ${target}`);
  }

  const [sourcePackage, targetPackage] = await Promise.all([
    readPackage(source),
    readPackage(target),
  ]);
  if (sourcePackage.name !== "brace-expansion" || sourcePackage.version !== patchedVersion) {
    throw new Error(
      `Expected locked brace-expansion ${patchedVersion}, found ${sourcePackage.name}@${sourcePackage.version}`,
    );
  }
  if (
    targetPackage.name !== "brace-expansion"
    || !acceptedBundledVersions.has(targetPackage.version)
  ) {
    throw new Error(
      `Refusing to replace unexpected bundled package ${targetPackage.name}@${targetPackage.version}`,
    );
  }

  const [modulesRealPath, sourceRealPath, targetParentRealPath] = await Promise.all([
    realpath(modulesRoot),
    realpath(source),
    realpath(targetParent),
  ]);
  assertInside(modulesRealPath, sourceRealPath, "Resolved patch source");
  assertInside(modulesRealPath, targetParentRealPath, "Resolved patch target parent");

  if (targetPackage.version === patchedVersion) {
    return { patched: false, reason: "already-patched", version: patchedVersion };
  }

  const temporaryDirectory = await mkdtemp(join(targetParent, ".brace-expansion-patch-"));
  assertInside(targetParentRealPath, temporaryDirectory, "Patch temporary directory");
  try {
    await cp(source, temporaryDirectory, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    await rm(target, { recursive: true, force: false });
    await rename(temporaryDirectory, target);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  const installedPackage = await readPackage(target);
  if (installedPackage.name !== "brace-expansion" || installedPackage.version !== patchedVersion) {
    throw new Error(`Bundled dependency patch verification failed at ${target}`);
  }
  return {
    patched: true,
    from: targetPackage.version,
    to: installedPackage.version,
  };
}

async function main() {
  const result = await patchBundledBraceExpansion();
  console.log(JSON.stringify({ bundledDependencyPatch: "brace-expansion", ...result }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
