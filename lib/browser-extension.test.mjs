import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const extension = readFileSync(new URL("../extensions/piora-browser.ts", import.meta.url), "utf8");
const desktopBrowser = readFileSync(new URL("../desktop/src/browser-manager.ts", import.meta.url), "utf8");
const browserPanel = readFileSync(new URL("../components/workspace/BrowserPanel.tsx", import.meta.url), "utf8");
const desktopPreload = readFileSync(new URL("../desktop/src/preload.ts", import.meta.url), "utf8");
const staging = readFileSync(new URL("../scripts/stage-standalone.mjs", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const { FIRST_PARTY_EXTENSIONS } = await jiti.import("./first-party-extensions.ts");

test("loads the built-in browser with a visible panel and persistent Piora profile", () => {
  assert.equal(
    FIRST_PARTY_EXTENSIONS.some(({ id, fileName, profiles }) => (
      id === "piora:browser"
      && fileName === "piora-browser.ts"
      && profiles.includes("normal")
      && !profiles.includes("device-control")
    )),
    true,
  );
  assert.match(extension, /name: "browser"/);
  assert.match(extension, /launchPersistentContext/);
  assert.match(extension, /browser-profile/);
  assert.match(extension, /storageState/);
  assert.match(extension, /getBrowserViewScreenshot/);
  assert.match(extension, /page\.setViewportSize/);
  assert.match(extension, /case "mouse_move"/);
  assert.match(extension, /page\.mouse\.down/);
  assert.match(extension, /page\.mouse\.up/);
  assert.match(extension, /sessions: new Map\(\)/);
  assert.match(extension, /sign-ins completed in Piora persist across restarts/);
  assert.match(extension, /The `browser` tool is available in this session/);
  assert.equal(extension.includes('if (!/(?:https?://|www.'), false);
  assert.doesNotMatch(extension, /private headless browser/);
});

test("packages the extension and Playwright runtime for desktop builds", () => {
  assert.match(staging, /extensions\/piora-browser\.ts/);
  assert.match(staging, /node_modules", "playwright-core/);
});

test("embeds a live Chromium view inside the existing desktop browser panel", () => {
  assert.match(desktopBrowser, /new WebContentsView/);
  assert.match(desktopBrowser, /persist:piora-browser/);
  assert.match(desktopBrowser, /setDownloadPath\(app\.getPath\("downloads"\)\)/);
  assert.match(desktopBrowser, /BROWSER_VIEWPORT_CHANNEL/);
  assert.match(desktopPreload, /browser: Object\.freeze/);
  assert.match(browserPanel, /DesktopBrowserPanel/);
  assert.match(browserPanel, /ScreenshotBrowserPanel/);
  assert.match(browserPanel, /getBoundingClientRect/);
});

test("Chrome onboarding imports bookmarks without reading cookies or passwords", () => {
  assert.match(desktopBrowser, /join\(userData, profile, "Bookmarks"\)/);
  assert.doesNotMatch(desktopBrowser, /Cookies|Login Data|password_value/);
  assert.match(browserPanel, /browser\.importSafety/);
  assert.match(browserPanel, /BROWSER_ONBOARDING_KEY/);
});
