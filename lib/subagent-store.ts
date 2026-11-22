import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file.ts";
import { getRuntimeAgentDataDirectory } from "./runtime-home.ts";
import { hasSubagentProjection, isSubagentId, type SubagentRecord } from "./subagent-types.ts";

function valid(id: string): string { if (!isSubagentId(id)) throw new TypeError("Invalid subagent/session id"); return id; }
function root(): string { return join(getRuntimeAgentDataDirectory(), "piora", "subagent-runs"); }
function directory(parent: string): string { return join(root(), valid(parent)); }

const host = globalThis as typeof globalThis & { __pioraSubagentPresence?: { root: string; version: string; parents?: Set<string> } };

const changeLimit = 256;
type Changes = { root: string; epoch: string; cursor: number; parents: Map<string, number> };
const refreshHost = globalThis as typeof globalThis & { __pioraSubagentRefresh?: Changes };

function changeState(): Changes {
  const directory = root();
  if (refreshHost.__pioraSubagentRefresh?.root !== directory) {
    refreshHost.__pioraSubagentRefresh = { root: directory, epoch: randomUUID(), cursor: 0, parents: new Map() };
  }
  return refreshHost.__pioraSubagentRefresh;
}

export function readSubagentChanges(epoch: string | null, after: number) {
  const state = changeState();
  const reset = epoch !== state.epoch || after > state.cursor || after < state.cursor - changeLimit;
  return {
    subagentRefreshEpoch: state.epoch, subagentRefreshCursor: state.cursor,
    subagentChanges: reset ? [] : [...state.parents].filter(([, cursor]) => cursor > after).map(([id]) => id),
    subagentRefreshReset: reset,
  };
}

function presenceState() {
  const directory = root();
  if (host.__pioraSubagentPresence?.root !== directory) host.__pioraSubagentPresence = { root: directory, version: randomUUID() };
  return host.__pioraSubagentPresence;
}

export function getSubagentPresenceVersion(): string { return presenceState().version; }

export function forgetEmptySubagentParent(parent: string): void {
  const state = presenceState();
  if (state.parents?.delete(parent)) state.version = randomUUID();
}

export function listSubagentParents(ids: Iterable<string>): string[] {
  const state = presenceState();
  if (!state.parents) {
    let parents: string[];
    try {
      parents = readdirSync(state.root, { withFileTypes: true }).filter(entry => entry.isDirectory() && isSubagentId(entry.name)).map(entry => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parents = [];
    }
    state.parents = new Set(parents);
  }
  const { parents } = state;
  return [...ids].filter(id => parents.has(id));
}

export function saveSubagent(record: SubagentRecord): void {
  const dir = directory(record.parentSessionId);
  const file = join(dir, `${valid(record.agentId)}.json`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const state = presenceState();
  const knownParent = state.parents?.has(record.parentSessionId) ?? existsSync(file);
  writePrivateFileAtomicSync(file, JSON.stringify(record));
  const changes = changeState();
  changes.parents.delete(record.parentSessionId);
  changes.parents.set(record.parentSessionId, ++changes.cursor);
  if (changes.parents.size > changeLimit) changes.parents.delete(changes.parents.keys().next().value!);
  if (!knownParent) {
    state.version = randomUUID();
    state.parents?.add(record.parentSessionId);
  }
}
export function listSubagentRecords(parent: string): SubagentRecord[] {
  const dir = directory(parent);
  let files: string[];
  try {
    if (!lstatSync(dir).isDirectory()) return [];
    files = readdirSync(dir).filter(file => file.endsWith(".json"));
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const records: SubagentRecord[] = [];
  for (const name of files) {
    const file = join(dir, name);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const record = JSON.parse(readFileSync(file, "utf8")) as SubagentRecord;
      if (record?.version === 1 && hasSubagentProjection(record) && record.parentSessionId === parent && name === `${record.agentId}.json`
        && typeof record.prompt === "string" && (record.childSessionFile === undefined || typeof record.childSessionFile === "string")
        && (record.resultEntryId === undefined || typeof record.resultEntryId === "string")
        && (record.resultFullLength === undefined || (Number.isSafeInteger(record.resultFullLength) && record.resultFullLength >= 0))) records.push(record);
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return records.sort((left, right) => left.startedAt - right.startedAt);
}
