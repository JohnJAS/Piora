import { createReadStream, type Stats } from "node:fs";
import { createHash, type Hash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { fileRevision, sameFile } from "./jsonl-file-index";

export type SessionCatalogEntry = Omit<SessionInfo, "allMessagesText">;

interface CatalogCheckpoint {
  prefix: string;
  snapshot: Stats;
  activity: number;
  firstMessage: string;
}

const checkpoints = new WeakMap<SessionCatalogEntry, CatalogCheckpoint>();

async function hashPrefix(file: string, end: number, hash: Hash): Promise<void> {
  if (!end) return;
  for await (const chunk of createReadStream(file, { start: 0, end: end - 1 })) hash.update(chunk);
}

export async function readSessionCatalogEntry(file: string, modified: Date, snapshot?: Stats, previous?: SessionCatalogEntry): Promise<SessionCatalogEntry | null> {
  const state = snapshot ?? await stat(file);
  const checkpoint = previous && checkpoints.get(previous);
  let hash = createHash("sha256");
  let offset = 0;
  if (checkpoint && state.size > checkpoint.snapshot.size && sameFile(state, checkpoint.snapshot)) {
    await hashPrefix(file, checkpoint.snapshot.size, hash);
    if (hash.copy().digest("hex") === checkpoint.prefix) offset = checkpoint.snapshot.size;
    else hash = createHash("sha256");
  }
  if (state.size === 0) return null;
  const raw = createReadStream(file, { start: offset, end: state.size - 1 });
  const encoding = new TextDecoder();
  let lastByte: number | undefined;
  async function* decoded() {
    for await (const chunk of raw) {
      const bytes = chunk as Buffer;
      hash.update(bytes);
      lastByte = bytes.at(-1);
      yield encoding.decode(bytes, { stream: true });
    }
    yield encoding.decode();
  }
  const textStream = Readable.from(decoded());
  const lines = createInterface({ input: textStream, crlfDelay: Infinity });
  let header: Record<string, unknown> | undefined = offset && previous
    ? { id: previous.id, timestamp: previous.created.getTime(), cwd: previous.cwd, parentSession: previous.parentSessionPath } : undefined;
  let messageCount = offset && previous ? previous.messageCount : 0;
  let lastActivity = offset ? checkpoint!.activity : 0;
  let firstMessage = offset ? checkpoint!.firstMessage : "";
  let name = offset ? previous?.name : undefined;
  try {
    for await (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || typeof entry !== "object") continue;
      if (!header) {
        if (entry.type !== "session" || typeof entry.id !== "string") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
      if (entry.type !== "message") continue;
      messageCount++;
      const message = entry.message;
      if (!message || !("content" in message) || (message.role !== "user" && message.role !== "assistant")) continue;
      const time = typeof message.timestamp === "number" ? message.timestamp : new Date(entry.timestamp).getTime();
      if (Number.isFinite(time)) lastActivity = Math.max(lastActivity, time);
      if (!firstMessage && message.role === "user") {
        firstMessage = typeof message.content === "string" ? message.content
          : Array.isArray(message.content) ? message.content.filter((block: { type?: string } | null) => block?.type === "text")
            .map((block: { text: string }) => block.text).join(" ") : "";
      }
    }
    if (!header) return null;
    const created = new Date(header.timestamp as string);
    const result = {
      path: file, id: header.id as string, cwd: typeof header.cwd === "string" ? header.cwd : "", name,
      parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
      created, modified: lastActivity > 0 ? new Date(lastActivity) : Number.isFinite(created.getTime()) ? created : modified,
      messageCount, firstMessage: firstMessage || "(no messages)",
    };
    if (lastByte === 10 && fileRevision(await stat(file)) === fileRevision(state)) {
      checkpoints.set(result, { prefix: hash.digest("hex"), snapshot: state, activity: lastActivity, firstMessage });
    }
    return result;
  } finally { lines.close(); textStream.destroy(); raw.destroy(); }
}

/** Revalidate file identity on every scan; unchanged files need no JSON parsing. */
export class SessionCatalogIndex {
  private entries = new Map<string, { signature: string; value: SessionCatalogEntry; bytes: number }>();
  private bytes = 0;
  constructor(private read = readSessionCatalogEntry, private maxBytes = 32 * 1024 * 1024) {}
  private remove(file: string) {
    this.bytes -= this.entries.get(file)?.bytes ?? 0;
    this.entries.delete(file);
  }
  async list(root: string): Promise<SessionCatalogEntry[]> {
    const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const directory of directories) {
      if (!directory.isDirectory() && !directory.isSymbolicLink()) continue;
      const folder = join(root, directory.name);
      const names = await readdir(folder).catch(() => []);
      for (const name of names) if (name.endsWith(".jsonl")) files.push(join(folder, name));
    }
    const present = new Set(files);
    for (const file of this.entries.keys()) if (!present.has(file)) this.remove(file);
    // Keep reads in file order; apply SDK discovery ordering once stats exist.
    const results: Array<SessionCatalogEntry | null> = new Array(files.length).fill(null);
    const modifiedOnDisk = new Map<string, number>();
    let cursor = 0;
    // Bound simultaneous stream buffers, JSON decoding and disk operations.
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (cursor < files.length) {
        const position = cursor++;
        const file = files[position];
        try {
          const state = await stat(file);
          modifiedOnDisk.set(file, state.mtimeMs);
          const version = fileRevision(state);
          const cached = this.entries.get(file);
          if (cached?.signature === version) { results[position] = cached.value; continue; }
          this.remove(file);
          const value = await this.read(file, state.mtime, state, cached?.value);
          if (!value) continue;
          results[position] = value;
          // A concurrently appended/rewritten file must be read again next time.
          if (fileRevision(await stat(file)) !== version) continue;
          const bytes = 2 * JSON.stringify(value).length;
          this.remove(file);
          // Every scan visits every file. Evicting older entries here would
          // churn the entire cache once the catalog exceeds its budget.
          if (this.bytes + bytes > this.maxBytes) continue;
          this.entries.set(file, { signature: version, value, bytes }); this.bytes += bytes;
        } catch { this.remove(file); }
      }
    }));
    return results.filter((value): value is SessionCatalogEntry => value !== null)
      // Pi 1.0 discovers recent files first, then keeps that order when
      // transcript activity ties. Reader completion order must not leak in.
      .sort((left, right) => right.modified.getTime() - left.modified.getTime()
        || (modifiedOnDisk.get(right.path) ?? 0) - (modifiedOnDisk.get(left.path) ?? 0)
        || basename(right.path).localeCompare(basename(left.path)));
  }
}
