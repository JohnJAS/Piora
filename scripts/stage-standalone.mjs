#!/usr/bin/env node

import { cp, lstat, readdir, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextDirectory = join(projectRoot, ".next");
const standaloneDirectory = join(nextDirectory, "standalone");

const assets = [
  {
    name: "public assets",
    source: join(projectRoot, "public"),
    destination: join(standaloneDirectory, "public"),
    required: true,
    rejectSymlinks: true,
  },
  {
    name: "Next.js static assets",
    source: join(nextDirectory, "static"),
    destination: join(standaloneDirectory, ".next", "static"),
    required: true,
    rejectSymlinks: false,
  },
];

async function getPathType(path) {
  try {
    const entry = await stat(path);
    if (entry.isDirectory()) return "directory";
    if (entry.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

function assertInside(parent, child) {
  const childRelativePath = relative(parent, child);
  if (
    childRelativePath === "" ||
    childRelativePath === ".." ||
    childRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(childRelativePath)
  ) {
    throw new Error(`Refusing to stage outside ${parent}: ${child}`);
  }
}

export async function findSymbolicLinks(root) {
  const rootEntry = await lstat(root).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (!rootEntry) return [];
  if (rootEntry.isSymbolicLink()) return [resolve(root)];
  if (!rootEntry.isDirectory()) return [];

  const links = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      links.push(entryPath);
    } else if (entry.isDirectory()) {
      links.push(...await findSymbolicLinks(entryPath));
    }
  }
  return links;
}

async function main() {
  if ((await getPathType(standaloneDirectory)) !== "directory") {
    throw new Error(
      `Standalone output not found at ${standaloneDirectory}. Run a Next.js build first.`,
    );
  }

  const serverEntry = join(standaloneDirectory, "server.js");
  if ((await getPathType(serverEntry)) !== "file") {
    throw new Error(`Standalone server entry not found at ${serverEntry}.`);
  }

  const stagedAssets = [];
  for (const asset of assets) {
    assertInside(standaloneDirectory, asset.destination);
    const sourceType = await getPathType(asset.source);
    if (sourceType === "missing" && !asset.required) {
      stagedAssets.push({ ...asset, sourceType });
      continue;
    }
    if (sourceType !== "directory") {
      throw new Error(`Expected ${asset.name} directory at ${asset.source}.`);
    }
    if (asset.rejectSymlinks) {
      const symbolicLinks = await findSymbolicLinks(asset.source);
      if (symbolicLinks.length > 0) {
        throw new Error(
          `Refusing to stage ${asset.name} containing symbolic links:\n${symbolicLinks.join("\n")}`,
        );
      }
    }
    stagedAssets.push({ ...asset, sourceType });
  }

  for (const asset of stagedAssets) {
    await rm(asset.destination, { recursive: true, force: true });
    if (asset.sourceType === "missing") {
      console.log(`Skipped ${asset.name}; source directory does not exist.`);
      continue;
    }
    await cp(asset.source, asset.destination, {
      recursive: true,
      force: true,
      dereference: true,
    });
    console.log(`Staged ${asset.name} at ${asset.destination}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
