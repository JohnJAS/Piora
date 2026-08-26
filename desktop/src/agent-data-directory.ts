import { createHash, randomBytes } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import { access, cp, lstat, mkdir, readlink, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, parse, relative, resolve } from "node:path";

export type AgentDataDirectoryErrorCode =
  | "invalid-path"
  | "same-path"
  | "overlapping-path"
  | "target-not-empty"
  | "migration-failed";

export class AgentDataDirectoryError extends Error {
  constructor(readonly code: AgentDataDirectoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentDataDirectoryError";
  }
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isPathWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ""
    && pathFromParent !== ".."
    && !pathFromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !parse(pathFromParent).root;
}

export function validateAgentDataDirectory(
  requestedDirectory: string,
  currentDirectory: string,
  homeDirectory: string,
): string {
  const trimmed = requestedDirectory.trim();
  if (!trimmed) throw new AgentDataDirectoryError("invalid-path", "The Pi data directory is required.");

  const target = resolve(trimmed);
  const targetComparable = comparablePath(target);
  const currentComparable = comparablePath(currentDirectory);
  if (targetComparable === comparablePath(parse(target).root) || targetComparable === comparablePath(homeDirectory)) {
    throw new AgentDataDirectoryError("invalid-path", "Choose a dedicated folder instead of a drive root or home directory.");
  }
  if (targetComparable === currentComparable) {
    throw new AgentDataDirectoryError("same-path", "The selected directory is already in use.");
  }
  if (isPathWithin(currentComparable, targetComparable) || isPathWithin(targetComparable, currentComparable)) {
    throw new AgentDataDirectoryError("overlapping-path", "The old and new Pi data directories cannot contain one another.");
  }
  return target;
}

async function directoryIsEmpty(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

type AgentDataManifestEntry =
  | { path: string; type: "directory" }
  | { path: string; type: "file"; size: number; sha256: string }
  | { path: string; type: "symlink"; target: string };

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}

export async function createAgentDataDirectoryManifest(
  rootDirectory: string,
): Promise<AgentDataManifestEntry[]> {
  const entries: AgentDataManifestEntry[] = [];

  async function visit(relativePath: string): Promise<void> {
    const absolutePath = relativePath ? join(rootDirectory, relativePath) : rootDirectory;
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      entries.push({ path: relativePath, type: "symlink", target: await readlink(absolutePath) });
      return;
    }
    if (stats.isFile()) {
      const sha256 = await hashFile(absolutePath);
      const statsAfterHash = await lstat(absolutePath);
      if (
        !statsAfterHash.isFile()
        || statsAfterHash.size !== stats.size
        || statsAfterHash.mtimeMs !== stats.mtimeMs
        || statsAfterHash.ctimeMs !== stats.ctimeMs
      ) {
        throw new Error(`Pi data changed while hashing: ${relativePath}`);
      }
      entries.push({
        path: relativePath,
        type: "file",
        size: stats.size,
        sha256,
      });
      return;
    }
    if (!stats.isDirectory()) {
      throw new Error(`Unsupported entry in the Pi data directory: ${relativePath || "."}`);
    }
    if (relativePath) entries.push({ path: relativePath, type: "directory" });
    const children = await readdir(absolutePath, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      await visit(relativePath ? join(relativePath, child.name) : child.name);
    }
  }

  await visit("");
  return entries;
}

function assertMatchingManifests(
  expected: AgentDataManifestEntry[],
  actual: AgentDataManifestEntry[],
  label: string,
): void {
  if (expected.length !== actual.length) {
    throw new Error(`${label} contains ${actual.length} entries; expected ${expected.length}.`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedEntry = expected[index];
    const actualEntry = actual[index];
    if (JSON.stringify(expectedEntry) !== JSON.stringify(actualEntry)) {
      throw new Error(
        `${label} differs at ${expectedEntry?.path || actualEntry?.path || `entry ${index}`}.`,
      );
    }
  }
}

export async function prepareAgentDataDirectoryChange(options: {
  currentDirectory: string;
  targetDirectory: string;
  migrate: boolean;
}): Promise<void> {
  const { currentDirectory, targetDirectory, migrate } = options;
  try {
    if (!migrate) {
      await mkdir(targetDirectory, { recursive: true });
      await access(targetDirectory, fsConstants.R_OK | fsConstants.W_OK);
      return;
    }

    if (!await directoryIsEmpty(targetDirectory)) {
      throw new AgentDataDirectoryError(
        "target-not-empty",
        "Choose an empty folder when migrating existing Pi data.",
      );
    }

    const stagingDirectory = `${targetDirectory}.piora-migration-${randomBytes(6).toString("hex")}`;
    try {
      await mkdir(dirname(targetDirectory), { recursive: true });
      const sourceManifestBeforeCopy = await createAgentDataDirectoryManifest(currentDirectory);
      await cp(currentDirectory, stagingDirectory, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
      const [sourceManifestAfterCopy, stagedManifest] = await Promise.all([
        createAgentDataDirectoryManifest(currentDirectory),
        createAgentDataDirectoryManifest(stagingDirectory),
      ]);
      assertMatchingManifests(
        sourceManifestBeforeCopy,
        sourceManifestAfterCopy,
        "The source Pi data directory changed during migration",
      );
      assertMatchingManifests(
        sourceManifestBeforeCopy,
        stagedManifest,
        "The verified migration copy",
      );
      // The chosen target may already exist as an empty folder. Removing that
      // empty shell lets rename publish the fully-copied tree atomically.
      await rm(targetDirectory, { recursive: true, force: true });
      await rename(stagingDirectory, targetDirectory);
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof AgentDataDirectoryError) throw error;
    throw new AgentDataDirectoryError(
      "migration-failed",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
