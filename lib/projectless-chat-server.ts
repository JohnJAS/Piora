import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function getProjectlessChatWorkspace(): string {
  const cwd = resolve(join(getAgentDir(), "piora", "projectless-chat-workspace"));
  mkdirSync(cwd, { recursive: true });
  return cwd;
}
