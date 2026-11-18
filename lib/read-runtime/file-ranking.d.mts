import type { FileIndexEntry } from "../file-fuzzy";

export function buildEntriesFromFiles(files: string[]): FileIndexEntry[];
export function filterFileEntries(entries: FileIndexEntry[], query: string, limit?: number, check?: () => void): FileIndexEntry[];
