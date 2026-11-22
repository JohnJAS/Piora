import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { getRuntimeAgentDataDirectory } from "../runtime-home";
import type { SideChatSettings } from "./types";

/** Resolve the private configuration path for Side Chat Laboratory settings. */
export function getSideChatSettingsPath(): string {
  return join(getRuntimeAgentDataDirectory(), "piora", "side-chat.json");
}

/** Strictly parse Side Chat settings without implicit coercion or unknown keys. */
export function parseSideChatSettings(value: unknown): SideChatSettings {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || typeof (value as SideChatSettings).enabled !== "boolean"
  ) {
    throw new TypeError("Side chat settings require only a boolean enabled field.");
  }
  return { enabled: (value as SideChatSettings).enabled };
}

/** Read current Side Chat settings; fails closed when persisted JSON is corrupt. */
export function readSideChatSettings(): SideChatSettings {
  let raw: string;
  try {
    raw = readFileSync(getSideChatSettingsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { enabled: false };
    }
    throw error;
  }
  try {
    return parseSideChatSettings(JSON.parse(raw));
  } catch {
    throw new Error("Side chat settings are invalid; restore them before continuing.");
  }
}

/** Atomically validate and persist Side Chat Laboratory settings. */
export function writeSideChatSettings(value: unknown): SideChatSettings {
  const settings = parseSideChatSettings(value);
  const path = getSideChatSettingsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, JSON.stringify(settings));
  return settings;
}
