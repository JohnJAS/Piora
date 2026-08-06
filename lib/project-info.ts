import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 256 * 1024;

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function formatGitRepository(remoteUrl: string | null): string | undefined {
  if (!remoteUrl) return undefined;
  const trimmed = remoteUrl.trim().replace(/\.git$/i, "");
  const scpMatch = trimmed.match(/^[^@\s]+@[^:\s]+:(.+)$/);
  if (scpMatch?.[1]) return scpMatch[1].replace(/^\/+/, "");
  try {
    const url = new URL(trimmed);
    const repository = url.pathname.replace(/^\/+/, "");
    return repository || trimmed;
  } catch {
    return trimmed;
  }
}

export async function getProjectInfo(cwd: string): Promise<{
  repository?: string;
  branch?: string;
}> {
  const [remoteUrl, branch] = await Promise.all([
    git(cwd, ["config", "--get", "remote.origin.url"]),
    git(cwd, ["branch", "--show-current"]),
  ]);
  return {
    repository: formatGitRepository(remoteUrl),
    branch: branch ?? undefined,
  };
}
