import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file.ts";
import type { SubagentRecord } from "./subagent-types.ts";

function valid(id: string): string { if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw new TypeError("Invalid subagent/session id"); return id; }
function directory(parent: string): string { return join(getAgentDir(), "piora", "subagent-runs", valid(parent)); }
export function saveSubagent(record: SubagentRecord): void {
  const dir = directory(record.parentSessionId); mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(join(dir, `${valid(record.agentId)}.json`), JSON.stringify(record));
}
export function listSubagentRecords(parent: string): SubagentRecord[] {
  const dir = directory(parent);
  let files: string[];
  try { files = readdirSync(dir).filter(file => file.endsWith(".json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return files.map(file => JSON.parse(readFileSync(join(dir, file), "utf8")) as SubagentRecord)
    .filter(record => record.version === 1 && record.parentSessionId === parent)
    .sort((a, b) => a.startedAt - b.startedAt);
}
