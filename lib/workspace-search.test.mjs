import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeWorkspaceSearchQuery, parseGitIgnore, searchWorkspace, WORKSPACE_SEARCH_LIMIT } from "./workspace-search.ts";

test("normalizes and bounds workspace search queries", () => {
  assert.equal(normalizeWorkspaceSearchQuery("  hello  "), "hello");
  assert.equal(normalizeWorkspaceSearchQuery("x".repeat(400)).length, 256);
  assert.equal(normalizeWorkspaceSearchQuery(null), "");
});

test("parses common gitignore rules and negations for the Node fallback", () => {
  const rules = parseGitIgnore("node_modules/\n*.log\n!important.log\n");
  assert.equal(rules.length, 3);
  assert.equal(rules[0].directoryOnly, true);
  assert.equal(rules[2].negated, true);
});

test("searches filenames and content in a real temporary workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-search-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "special-file.ts"), "first\nneedle value\n", "utf8");
    await writeFile(join(root, "README.md"), "nothing here\n", "utf8");
    const files = await searchWorkspace(root, "special", "files");
    assert.equal(files.results[0]?.path, "src/special-file.ts");
    const content = await searchWorkspace(root, "needle", "content");
    assert.equal(content.results[0]?.path, "src/special-file.ts");
    assert.equal(content.results[0]?.line, 2);
    assert.ok(content.results.length <= WORKSPACE_SEARCH_LIMIT);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
