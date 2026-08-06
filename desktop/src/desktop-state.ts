import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "./logger.js";

interface DesktopState {
  serverPort?: number;
  companionWindowPosition?: CompanionWindowPosition;
}

export interface CompanionWindowPosition {
  x: number;
  y: number;
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65_535;
}

function statePath(userDataDirectory: string): string {
  return join(userDataDirectory, "desktop-state.json");
}

function readDesktopState(userDataDirectory: string, logger: Logger): DesktopState {
  try {
    const value = JSON.parse(readFileSync(statePath(userDataDirectory), "utf8")) as unknown;
    return value && typeof value === "object" ? value as DesktopState : {};
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as NodeJS.ErrnoException).code)
      : undefined;
    if (code !== "ENOENT") logger.warn("Unable to read desktop state", error);
    return {};
  }
}

function writeDesktopState(
  userDataDirectory: string,
  patch: Partial<DesktopState>,
  logger: Logger,
): void {
  try {
    const state = { ...readDesktopState(userDataDirectory, logger), ...patch };
    writeFileSync(
      statePath(userDataDirectory),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    logger.warn("Unable to persist desktop state", error);
  }
}

export function readPreferredServerPort(
  userDataDirectory: string,
  logger: Logger,
): number | undefined {
  const state = readDesktopState(userDataDirectory, logger);
  return isValidPort(state.serverPort) ? state.serverPort : undefined;
}

export function writePreferredServerPort(
  userDataDirectory: string,
  port: number,
  logger: Logger,
): void {
  if (!isValidPort(port)) return;
  writeDesktopState(userDataDirectory, { serverPort: port }, logger);
}

function isValidPosition(value: unknown): value is CompanionWindowPosition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isInteger(candidate.x)
    && Number.isInteger(candidate.y)
    && Math.abs(Number(candidate.x)) <= 100_000
    && Math.abs(Number(candidate.y)) <= 100_000;
}

export function readCompanionWindowPosition(
  userDataDirectory: string,
  logger: Logger,
): CompanionWindowPosition | undefined {
  const state = readDesktopState(userDataDirectory, logger);
  return isValidPosition(state.companionWindowPosition)
    ? state.companionWindowPosition
    : undefined;
}

export function writeCompanionWindowPosition(
  userDataDirectory: string,
  position: CompanionWindowPosition,
  logger: Logger,
): void {
  if (!isValidPosition(position)) return;
  writeDesktopState(userDataDirectory, { companionWindowPosition: position }, logger);
}
