import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContact, ContactFields } from "./contracts.js";

interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
  getSelectedStorageBackend?(): string;
}
export class BrowserContacts {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}
  list(): BrowserContact[] {
    if (!existsSync(this.file)) return [];
    this.available();
    const contacts: unknown = JSON.parse(this.cipher.decryptString(readFileSync(this.file)));
    if (!Array.isArray(contacts)) throw new Error("Invalid contact database");
    return contacts;
  }
  private available() {
    if (!this.cipher.isEncryptionAvailable() || this.cipher.getSelectedStorageBackend?.() === "basic_text")
      throw new Error("Secure storage unavailable");
  }
  private write(entries: BrowserContact[]) {
    this.available();
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + ".tmp", this.cipher.encryptString(JSON.stringify(entries)), { mode: 0o600 });
    renameSync(this.file + ".tmp", this.file);
  }
  save(input: ContactFields & { id?: string }) {
    const rows = this.list();
    const clean = (value: unknown) => {
      if (typeof value !== "string" || value.length > 1000) throw new Error("Invalid contact");
      return value.trim();
    };
    const name = clean(input.name);
    if (!name || (input.id && !rows.some((row) => row.id === input.id)))
      throw new Error("Contact name or ID is invalid");
    const entry = {
      id: input.id || randomUUID(),
      name,
      address: clean(input.address),
      email: clean(input.email),
      phone: clean(input.phone),
      updated: Date.now(),
    };
    this.write([...rows.filter((row) => row.id !== entry.id), entry]);
  }
  remove(id: string) {
    this.write(this.list().filter((row) => row.id !== id));
  }
  range(since: number, until: number, clear: boolean) {
    const rows = this.list();
    const keep = rows.filter((row) => row.updated < since || row.updated > until);
    if (clear && keep.length !== rows.length) this.write(keep);
    return rows.length - keep.length;
  }
}
