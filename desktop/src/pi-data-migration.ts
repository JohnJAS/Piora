import { cpSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

interface DirectoryInventory {
  entries: number;
  files: number;
  bytes: number;
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path !== ""
    && path !== ".."
    && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !isAbsolute(path);
}

function inventory(directory: string): DirectoryInventory {
  const result: DirectoryInventory = { entries: 0, files: 0, bytes: 0 };
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    result.entries += 1;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = inventory(path);
      result.entries += nested.entries;
      result.files += nested.files;
      result.bytes += nested.bytes;
    } else {
      result.files += 1;
      result.bytes += lstatSync(path).size;
    }
  }
  return result;
}

export function directoryHasData(directory: string): boolean {
  try {
    return existsSync(directory) && readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}

/**
 * Copies the complete legacy Pi agent directory into an empty destination and
 * verifies the resulting entry/file counts and byte total. The source is
 * deliberately retained so a user can roll back after the first launch.
 */
export function migratePiDataDirectory(source: string, destination: string): DirectoryInventory {
  const sourceDirectory = resolve(source);
  const destinationDirectory = resolve(destination);
  if (samePath(sourceDirectory, destinationDirectory)) return inventory(sourceDirectory);
  if (isWithin(sourceDirectory, destinationDirectory) || isWithin(destinationDirectory, sourceDirectory)) {
    throw new Error("The old and new Pi data directories cannot contain one another");
  }
  if (!directoryHasData(sourceDirectory)) return { entries: 0, files: 0, bytes: 0 };
  if (directoryHasData(destinationDirectory)) {
    throw new Error("The destination directory must be empty before migration");
  }

  const expected = inventory(sourceDirectory);
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    cpSync(join(sourceDirectory, entry.name), join(destinationDirectory, entry.name), {
      recursive: entry.isDirectory(),
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
  }
  const actual = inventory(destinationDirectory);
  if (actual.entries !== expected.entries || actual.files !== expected.files || actual.bytes !== expected.bytes) {
    throw new Error("The migrated Pi data did not pass verification");
  }
  return actual;
}
