import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatGitRepository } = await jiti.import("./project-info.ts");

test("formats HTTPS and SSH Git remotes like Codex project menus", () => {
  assert.equal(formatGitRepository("https://github.com/kexijiang/pi-gui.git"), "kexijiang/pi-gui");
  assert.equal(formatGitRepository("git@github.com:kexijiang/pi-gui.git"), "kexijiang/pi-gui");
  assert.equal(formatGitRepository(null), undefined);
});
