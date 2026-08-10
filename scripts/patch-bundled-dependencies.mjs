#!/usr/bin/env node

import { cp, lstat, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

async function patchBundledPackage({
  root,
  sourceRoot,
  packageName,
  patchedVersion,
  acceptedBundledVersions,
}) {
  const modulesRoot = join(root, "node_modules");
  const sourceModulesRoot = join(sourceRoot, "node_modules");
  const source = join(sourceModulesRoot, packageName);
  const targetParent = join(
    modulesRoot,
    "@earendil-works",
    "pi-coding-agent",
    "node_modules",
  );
  const target = join(targetParent, packageName);

  assertInside(sourceModulesRoot, source, "Patch source");
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
  if (sourcePackage.name !== packageName || sourcePackage.version !== patchedVersion) {
    throw new Error(
      `Expected locked ${packageName} ${patchedVersion}, found ${sourcePackage.name}@${sourcePackage.version}`,
    );
  }
  if (
    targetPackage.name !== packageName
    || !acceptedBundledVersions.has(targetPackage.version)
  ) {
    throw new Error(
      `Refusing to replace unexpected bundled package ${targetPackage.name}@${targetPackage.version}`,
    );
  }

  const [sourceModulesRealPath, targetModulesRealPath, sourceRealPath, targetParentRealPath] = await Promise.all([
    realpath(sourceModulesRoot),
    realpath(modulesRoot),
    realpath(source),
    realpath(targetParent),
  ]);
  assertInside(sourceModulesRealPath, sourceRealPath, "Resolved patch source");
  assertInside(targetModulesRealPath, targetParentRealPath, "Resolved patch target parent");

  if (targetPackage.version === patchedVersion) {
    return { patched: false, reason: "already-patched", version: patchedVersion };
  }

  const temporaryDirectory = await mkdtemp(
    join(targetParentRealPath, `.${packageName}-patch-`),
  );
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
  if (installedPackage.name !== packageName || installedPackage.version !== patchedVersion) {
    throw new Error(`Bundled dependency patch verification failed at ${target}`);
  }
  return {
    patched: true,
    from: targetPackage.version,
    to: installedPackage.version,
  };
}

export async function patchBundledBraceExpansion(root = projectRoot, sourceRoot = root) {
  return patchBundledPackage({
    root,
    sourceRoot,
    packageName: "brace-expansion",
    patchedVersion: "5.0.9",
    acceptedBundledVersions: new Set(["5.0.7", "5.0.9"]),
  });
}

export async function patchBundledUndici(root = projectRoot, sourceRoot = root) {
  return patchBundledPackage({
    root,
    sourceRoot,
    packageName: "undici",
    patchedVersion: "8.9.0",
    acceptedBundledVersions: new Set(["8.5.0", "8.9.0"]),
  });
}

async function main() {
  const patches = await Promise.all([
    patchBundledBraceExpansion().then((result) => ({ package: "brace-expansion", ...result })),
    patchBundledUndici().then((result) => ({ package: "undici", ...result })),
  ]);
  console.log(JSON.stringify({ bundledDependencyPatches: patches }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
