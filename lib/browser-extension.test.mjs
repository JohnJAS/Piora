import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const extension = readFileSync(new URL("../extensions/piora-browser.ts", import.meta.url), "utf8");
const rpc = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const staging = readFileSync(new URL("../scripts/stage-standalone.mjs", import.meta.url), "utf8");

test("loads the built-in browser with a visible panel and persistent Piora profile", () => {
  assert.match(rpc, /piora-browser\.ts/);
  assert.match(extension, /name: "browser"/);
  assert.match(extension, /launchPersistentContext/);
  assert.match(extension, /browser-profile/);
  assert.match(extension, /storageState/);
  assert.match(extension, /getBrowserViewScreenshot/);
  assert.match(extension, /sessions: new Map\(\)/);
  assert.match(extension, /sign-ins completed in Piora persist across restarts/);
  assert.doesNotMatch(extension, /private headless browser/);
});

test("packages the extension and Playwright runtime for desktop builds", () => {
  assert.match(staging, /extensions\/piora-browser\.ts/);
  assert.match(staging, /node_modules", "playwright-core/);
});
