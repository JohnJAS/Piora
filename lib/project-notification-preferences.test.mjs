import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("project notification preferences normalize paths and survive storage", async () => {
  const subject = await jiti.import("./project-notification-preferences.ts");
  const roots = new Set([subject.normalizeNotificationProjectRoot("Q:\\ProjectOne\\")]);
  const restored = subject.parseMutedProjectRoots(subject.serializeMutedProjectRoots(roots));
  assert.equal(subject.isProjectNotificationMuted(restored, "q:/projectone"), true);
  assert.equal(subject.isProjectNotificationMuted(restored, "Q:/Another"), false);
  assert.deepEqual([...subject.parseMutedProjectRoots('{"version":2,"muted":["Q:/ProjectOne"]}')], []);
});

test("muted projects suppress completion dots and expose a reversible project menu action", async () => {
  const { filterMutedSessionIds } = await jiti.import("./project-notification-preferences.ts");
  const muted = new Set(["q:/projectone"]);
  const sessions = [
    { id: "muted", cwd: "Q:/ProjectOne/worktree", projectRoot: "Q:/ProjectOne" },
    { id: "visible", cwd: "Q:/Other", projectRoot: "Q:/Other" },
  ];
  assert.deepEqual(filterMutedSessionIds(["muted", "visible", "unknown"], sessions, muted), ["visible", "unknown"]);
  const menu = readFileSync(new URL("../components/sidebar/ProjectList.tsx", import.meta.url), "utf8");
  assert.match(menu, /role="menuitemcheckbox"/);
  assert.match(menu, /sidebar\.disableProjectNotifications/);
  assert.match(menu, /sidebar\.enableProjectNotifications/);
});
