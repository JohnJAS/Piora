import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

test("browser recovery snapshots only session cookies and serializes concurrent writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piora-browser-cookies-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const profile = join(directory, "piora", "browser-profile"); await mkdir(profile, { recursive: true });
    const { persistBrowserState } = await createJiti(import.meta.url).import("../extensions/piora-browser.ts");
    let reads = 0, active = 0, peak = 0;
    const context = {
      cookies: async () => {
        reads++; peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
        return [{ name: "session", value: String(reads), expires: -1 }, { name: "persistent", value: "profile-owned", expires: 9999999999 }];
      },
      storageState: () => { throw new Error("must not export site IndexedDB"); },
    };
    await Promise.all(Array.from({ length: 6 }, () => persistBrowserState(context)));
    assert.equal(peak, 1);
    assert.deepEqual(JSON.parse(await readFile(join(profile, "piora-storage-state.json"), "utf8")), { cookies: [{ name: "session", value: "6", expires: -1 }] });
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true });
  }
});

test("persistent browser restores session login and retains localStorage and IndexedDB", { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "piora-browser-profile-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  let context;
  try {
    const { getBrowserViewState, persistBrowserState } = await createJiti(import.meta.url).import("../extensions/piora-browser.ts");
    const open = async () => {
      await getBrowserViewState();
      context = await globalThis.__pioraBrowserRuntime.contextPromise;
      await context.route("https://piora-persistence.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Persistence</title>" }));
      const page = context.pages()[0]; await page.goto("https://piora-persistence.test/"); return page;
    };
    const page = await open();
    await context.addCookies([{ name: "login", value: "session-token", url: "https://piora-persistence.test", httpOnly: true, secure: true }]);
    await page.evaluate(async () => {
      localStorage.setItem("draft", "saved locally");
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("site-data", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("records");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result, transaction = database.transaction("records", "readwrite");
          transaction.objectStore("records").put("retained database", "value");
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    });
    await persistBrowserState(context); await context.close();
    const restored = await open();
    assert.equal((await context.cookies()).find(cookie => cookie.name === "login")?.value, "session-token");
    assert.equal(await restored.evaluate(() => localStorage.getItem("draft")), "saved locally");
    assert.equal(await restored.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("site-data", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction("records"), read = transaction.objectStore("records").get("value");
        read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
        transaction.oncomplete = () => database.close();
      };
    })), "retained database");
    assert.deepEqual(Object.keys(JSON.parse(await readFile(join(directory, "piora", "browser-profile", "piora-storage-state.json"), "utf8"))), ["cookies"]);
  } finally {
    await context?.close();
    await globalThis.__pioraBrowserRuntime?.persistChain;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true });
  }
});
