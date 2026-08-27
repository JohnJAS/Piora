import assert from "node:assert/strict";
import test from "node:test";
import { extractVersionNotes } from "../scripts/create-release-notes.mjs";

test("release notes contain only the requested CHANGELOG version plus download guidance", () => {
  const changelog = `# Changelog

## [Unreleased]

## [0.4.20] - 2026-08-27

### Fixed

- Shows update progress.

## [0.4.19] - 2026-08-27

- Older change.
`;
  const notes = extractVersionNotes(changelog, "v0.4.20");
  assert.match(notes, /Shows update progress/);
  assert.match(notes, /### Downloads/);
  assert.doesNotMatch(notes, /Older change/);
});

test("release-note generation fails closed for a missing or malformed version", () => {
  assert.throws(() => extractVersionNotes("# Changelog", "v0.4.20"), /does not contain release notes/);
  assert.throws(() => extractVersionNotes("# Changelog", "latest"), /Invalid release tag/);
});
