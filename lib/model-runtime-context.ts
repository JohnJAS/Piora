import { stat } from "fs/promises";
import { resolve } from "path";
import {
  createAgentSessionServices,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { projectTrustReloadOptions } from "@/lib/project-trust";

export class ModelRequestCwdError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403,
    readonly code: "invalid_cwd" | "access_denied",
  ) {
    super(message);
    this.name = "ModelRequestCwdError";
  }
}

/**
 * Resolve and authorize the cwd used to enumerate models.
 *
 * Model discovery can import project extensions, so callers must use the same
 * allowed-root and project-trust path as `/api/models` instead of constructing
 * a bare ModelRuntime.
 */
export async function resolveModelRequestCwd(requestedCwd?: string | null): Promise<string> {
  const cwd = resolve(requestedCwd || process.cwd());

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    throw new ModelRequestCwdError(`Directory does not exist: ${cwd}`, 400, "invalid_cwd");
  }
  if (!cwdStat.isDirectory()) {
    throw new ModelRequestCwdError(`Not a directory: ${cwd}`, 400, "invalid_cwd");
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new ModelRequestCwdError("Access denied", 403, "access_denied");
  }
  return cwd;
}

/** Build Pi services without bypassing the repository trust gate. */
export function createTrustedModelServices(cwd: string) {
  const agentDir = getAgentDir();
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  return createAgentSessionServices({
    cwd,
    agentDir,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
}
