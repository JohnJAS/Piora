import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cp, lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isExtensionVersion, type CordisOperation } from "./cordis-extension-contract.js";

const slotId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export interface DataSlot { id: string; schema: number }
export interface InstalledSlot { id: string; version: string; data: DataSlot }
export interface ProfileState {
  format: 1;
  active: InstalledSlot | null;
  previous: InstalledSlot | null;
  retained: DataSlot | null;
  autoStart: boolean;
  pending: string | null;
  operation: CordisOperation | null;
}

function isDataSlot(value: unknown): value is DataSlot {
  const data = value as Partial<DataSlot> | null;
  return Boolean(data && slotId(data.id) && Number.isSafeInteger(data.schema) && (data.schema ?? 0) > 0);
}

function isInstalledSlot(value: unknown): value is InstalledSlot {
  const slot = value as Partial<InstalledSlot> | null;
  return Boolean(slot && slotId(slot.id) && typeof slot.version === "string"
    && isExtensionVersion(slot.version) && isDataSlot(slot.data));
}

function readState(root: string): ProfileState {
  const initial: ProfileState = {
    format: 1, active: null, previous: null, retained: null, autoStart: false, pending: null, operation: null,
  };
  let state: ProfileState;
  try { state = JSON.parse(readFileSync(join(root, "state.json"), "utf8")) as ProfileState; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initial;
    throw error;
  }
  if (!state || state.format !== 1 || !(state.active === null || isInstalledSlot(state.active))
    || !(state.previous === null || isInstalledSlot(state.previous))
    || !(state.retained === null || isDataSlot(state.retained))
    || !(state.pending === null || slotId(state.pending))
    || typeof state.autoStart !== "boolean"
    || state.pending && [state.active?.id, state.active?.data.id, state.previous?.id, state.previous?.data.id, state.retained?.id].includes(state.pending)) {
    throw new Error("Invalid desktop extension state. The installed files and saved data were preserved.");
  }
  return state;
}

export class CordisProfileStore {
  state: ProfileState;
  constructor(readonly root: string) { this.state = readState(root); }

  files(id: string): string {
    if (!slotId(id)) throw new Error("Invalid extension version slot");
    return join(this.root, "versions", id);
  }

  data(id: string): string {
    if (!slotId(id)) throw new Error("Invalid extension data slot");
    return join(this.root, "data", id);
  }

  write(update: Partial<ProfileState>): void {
    const next = { ...this.state, ...update };
    mkdirSync(this.root, { recursive: true });
    const path = join(this.root, "state.json");
    const temporary = path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify(next), { flag: "wx", flush: true });
      renameSync(temporary, path);
    } finally { rmSync(temporary, { force: true }); }
    this.state = next;
  }

  async recover(): Promise<void> {
    if (!this.state.pending) return;
    await this.removeCandidate(this.state.pending);
    this.write({ pending: null, operation: { outcome: "interrupted" } });
  }

  async prepareParents(): Promise<void> {
    await Promise.all([mkdir(join(this.root, "versions"), { recursive: true }), mkdir(join(this.root, "data"), { recursive: true })]);
  }

  async prepareData(id: string, previous?: DataSlot): Promise<void> {
    const destination = this.data(id);
    if (!previous) { await mkdir(destination); return; }
    // The running host is stopped first. The previous data remains available
    // through its original slot until the candidate and its migration are healthy.
    await cp(this.data(previous.id), destination, {
      recursive: true, errorOnExist: true, force: false,
      async filter(source) {
        const info = await lstat(source);
        if (!info.isFile() && !info.isDirectory()) throw new Error("Unsupported file in extension data");
        return true;
      },
    });
  }

  async removeCandidate(id: string): Promise<void> {
    await Promise.all([
      rm(this.files(id), { recursive: true, force: true }),
      rm(this.data(id), { recursive: true, force: true }),
    ]);
  }

  async removeFiles(id: string): Promise<void> {
    await rm(this.files(id), { recursive: true, force: true });
  }
}
