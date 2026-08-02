import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./SessionHistoryDialog.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const exportRoute = readFileSync(new URL("../app/api/sessions/[id]/export/route.ts", import.meta.url), "utf8");

test("opens complete session history inside the current application window", () => {
  assert.match(appShell, /setHistoryDialogOpen\(true\)/);
  assert.match(appShell, /<SessionHistoryDialog/);
  assert.doesNotMatch(appShell, /window\.open\(/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /createPortal\(/);
});

test("isolates the interactive exported history while retaining download and reload controls", () => {
  assert.match(dialog, /embed=1&appearance=/);
  assert.match(dialog, /sandbox="allow-scripts allow-downloads"/);
  assert.doesNotMatch(dialog, /allow-same-origin/);
  assert.match(dialog, /href=\{downloadUrl\}/);
  assert.match(dialog, /setFrameVersion\(\(version\) => version \+ 1\)/);
  assert.match(exportRoute, /embed \? "frame-ancestors 'self'" : "frame-ancestors 'none'"/);
  assert.match(exportRoute, /pi-session-history:escape/);
});

test("reduces the conversation toolbar to progressive-disclosure actions", () => {
  assert.match(appShell, /className="conversation-toolbar-actions"/);
  assert.match(appShell, /conversationMenu\.title/);
  assert.match(appShell, /conversationMenu\.generateTitleDescription/);
  assert.match(appShell, /conversationMenu\.systemPromptDescription/);
  assert.doesNotMatch(appShell, /topbar-auto-name|topbar-system-button|topbar-stats-control/);
  assert.doesNotMatch(globalStyles, /topbar-auto-name|topbar-system-button|topbar-stats-control/);
});
