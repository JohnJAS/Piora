import assert from "node:assert/strict";
import test from "node:test";

const { buildStarters } = await import("./starters.ts");
const t = (key) => key;

test("derives project-specific starters in priority order", () => {
  const starters = buildStarters({ hasProject: true, hasUncommittedChanges: true, hasTests: true, hasReadme: true, hasPackageJson: true, hasOutdatedDependencies: true }, t);
  assert.deepEqual(starters.map((starter) => starter.id), ["review", "tests", "architecture", "dependencies", "bug"]);
});

test("omits signals that the current project does not have", () => {
  const starters = buildStarters({ hasProject: true, hasUncommittedChanges: false, hasTests: false, hasReadme: true, hasPackageJson: false, hasOutdatedDependencies: false }, t);
  assert.deepEqual(starters.map((starter) => starter.id), ["architecture", "bug"]);
});

test("provides a useful default for a new directory without a project", () => {
  const starters = buildStarters({ hasProject: false, hasUncommittedChanges: false, hasTests: false, hasReadme: false, hasPackageJson: false, hasOutdatedDependencies: false }, t);
  assert.deepEqual(starters.map((starter) => starter.id), ["explore", "bug"]);
});
