import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TaskHeader.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./TaskHeader.module.css", import.meta.url), "utf8");

test("renders the four task header slots from shared task status", () => {
  assert.match(source, /useTaskStatus\(/);
  assert.match(source, /STATUS_PRESENTATION\[presentationKey\]/);
  assert.match(source, /styles\.statusSlot/);
  assert.match(source, /styles\.environmentSlot/);
  assert.match(source, /styles\.changesSlot/);
  assert.match(source, /styles\.actions/);
});

test("does not label the current project as local", () => {
  assert.doesNotMatch(source, /t\("taskHeader\.local"\)/);
  assert.match(source, /worktreeBranch \? t\("taskHeader\.worktree"\) : null/);
});

test("polls git changes only while a running task is visible", () => {
  assert.match(source, /if \(!active\) return/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /3_000/);
});

test("shows tracked-only Git line totals in the conversation header", () => {
  assert.match(source, /getTrackedGitLineStats\(gitStatus\)/);
  assert.match(source, /\+\{trackedLineStats\.additions\}/);
  assert.match(source, /trackedLineStats\.deletions/);
});

test("keeps elapsed time anchored to the server run across task switches", () => {
  assert.match(source, /optimisticRunStarts = new Map<string, number>/);
  assert.match(source, /const authoritativeStart = taskStatus\.startedAt/);
  assert.match(source, /optimisticRunStarts\.get\(sessionId\)/);
  assert.match(source, /Date\.now\(\) - \(runStartedAtRef\.current/);
});

test("degrades slots in the required narrow-window order without overflow", () => {
  assert.match(css, /overflow:\s*visible/);
  assert.match(css, /@container \(max-width: 640px\)[\s\S]*?\.changesSlot[\s\S]*?display:\s*none/);
  assert.match(css, /@container \(max-width: 520px\)[\s\S]*?\.environmentDetail/);
  assert.match(css, /@container \(max-width: 400px\)[\s\S]*?\.duration/);
});
