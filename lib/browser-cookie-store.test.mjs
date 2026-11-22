import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";
const { BrowserCookieStore, readPioraCookieSnapshot, sessionCookieDetails } = await createJiti(import.meta.url).import("../desktop/src/browser-cookie-store.ts");
const cookie = { name: "login", value: "fixture-session", domain: "example.test", path: "/", hostOnly: true, session: true, httpOnly: true, secure: true, sameSite: "lax" };
test("session cookie restore preserves security flags and never extends dated cookies", () => {
  const restored = sessionCookieDetails(cookie);
  assert.equal(restored.httpOnly, true);
  assert.equal(restored.secure, true);
  assert.equal(restored.sameSite, "lax");
  assert.equal(restored.domain, undefined);
  assert.equal(restored.expirationDate, undefined);
  assert.equal(sessionCookieDetails({ ...cookie, session: false, expirationDate: 123 }), null);
  assert.equal(sessionCookieDetails({ ...cookie, partitionKey: { topLevelSite: "https://synthetic.example" } }), null);
  assert.equal(sessionCookieDetails({ ...cookie, path: "other" }), null);
});
test("encrypted restart snapshot restores missing login cookies, preserves fresh cookies and logout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-cookie-test-"));
  const file = path.join(root, "session.enc");
  const key = randomBytes(32), iv = randomBytes(16);
  const cipher = {
    isEncryptionAvailable: () => true,
    encryptString(value) { const c = createCipheriv("aes-256-cbc", key, iv); return Buffer.concat([c.update(value, "utf8"), c.final()]); },
    decryptString(value) { const c = createDecipheriv("aes-256-cbc", key, iv); return Buffer.concat([c.update(value), c.final()]).toString(); },
  };
  let current = [cookie]; const restored = [];
  const store = new BrowserCookieStore(file, { get: async () => current, set: async (details) => { restored.push(details); } }, cipher);
  try {
    await writeFile(file, cipher.encryptString(JSON.stringify([cookie])));
    current = []; await store.restore();
    assert.equal(restored[0].value, cookie.value);
    assert.equal(readPioraCookieSnapshot([cookie]), null, "only automatic restore accepts a legacy unmarked backup");
    current = [cookie]; restored.length = 0;
    await store.save();
    const bytes = await readFile(file);
    assert.equal(bytes.includes(Buffer.from(cookie.value)), false);
    const envelope = JSON.parse(cipher.decryptString(bytes));
    assert.deepEqual(readPioraCookieSnapshot(envelope), [cookie]);
    assert.equal(readPioraCookieSnapshot({ ...envelope, partition: "different-profile" }), null);
    await store.restore(); assert.equal(restored.length, 0, "never overwrite a refreshed token");
    current = []; await store.restore(); assert.equal(restored[0].value, cookie.value);
    await store.save(); restored.length = 0; await store.restore(); assert.equal(restored.length, 0, "logout must persist an empty snapshot");
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("piora-cookie-test-"));
    await rm(root, { recursive: true, force: true });
  }
});
