import { randomBytes } from "node:crypto";
import { access, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, parse, relative, resolve } from "node:path";

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
      await cp(currentDirectory, stagingDirectory, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
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
