import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "./logger.js";

interface DesktopState {
  serverPort?: number;
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65_535;
}

function statePath(userDataDirectory: string): string {
  return join(userDataDirectory, "desktop-state.json");
}

export function readPreferredServerPort(
  userDataDirectory: string,
  logger: Logger,
): number | undefined {
  try {
    const state = JSON.parse(readFileSync(statePath(userDataDirectory), "utf8")) as DesktopState;
    return isValidPort(state.serverPort) ? state.serverPort : undefined;
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as NodeJS.ErrnoException).code)
      : undefined;
    if (code !== "ENOENT") logger.warn("Unable to read desktop state", error);
    return undefined;
  }
}

export function writePreferredServerPort(
  userDataDirectory: string,
  port: number,
  logger: Logger,
): void {
  if (!isValidPort(port)) return;

  try {
    writeFileSync(
      statePath(userDataDirectory),
      `${JSON.stringify({ serverPort: port } satisfies DesktopState, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    logger.warn("Unable to persist the desktop server port", error);
  }
}
