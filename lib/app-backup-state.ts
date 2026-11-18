import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getRuntimeAgentDataDirectory } from "./runtime-home";

export function backupControlRoot(): string {
  return `${getRuntimeAgentDataDirectory()}.piora-transfer`;
}

export function backupJob(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("backup_job");
  return join(backupControlRoot(), id);
}

export async function newBackupJob(): Promise<string> {
  const id = randomUUID();
  await mkdir(backupJob(id), { recursive: true, mode: 0o700 });
  return id;
}

export function backupRestoreJournalPath(): string {
  return join(backupControlRoot(), "pending.json");
}

export function hasPendingApplicationRestore(): boolean {
  return existsSync(backupRestoreJournalPath());
}
