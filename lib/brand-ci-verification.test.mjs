import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { prepareBrandCiVersion } from "../scripts/prepare-brand-ci-version.mjs";
import { verifyReleaseMetadata } from "../scripts/verify-release-metadata.mjs";

test("CI fixture versions stay consistent across manifests, lockfile and release notes", async t => {
  for (const sequence of ["1", "2"]) {
    const root = await mkdtemp(resolve(tmpdir(), "piora-ci-version-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(resolve(root, "desktop"));
    for (const name of ["package.json", "desktop/package.json"]) await writeFile(resolve(root, name), JSON.stringify({ version: "1.2.3", private: true }));
    await writeFile(resolve(root, "package-lock.json"), JSON.stringify({ version: "1.2.3", packages: { "": { version: "1.2.3" }, desktop: { version: "1.2.3" } } }));
    await writeFile(resolve(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
    const version = await prepareBrandCiVersion(root, sequence);
    await verifyReleaseMetadata({ projectRoot: root, tagName: `v${version}`, prerelease: true });
    assert.match(await readFile(resolve(root, "CHANGELOG.md"), "utf8"), /禁止发布/);
    await assert.rejects(prepareBrandCiVersion(root, "3"), /sequence must be/);
  }
});

test("installation verification workflow builds both consecutive versions without release privileges", async () => {
  const text = await readFile(resolve(import.meta.dirname, "../.github/workflows/brand-verification.yml"), "utf8");
  const workflow = load(text);
  assert.equal(workflow.permissions.contents, "read");
  assert.doesNotMatch(text, /contents: write|gh release|git push|--publish always|--publish onTag/);
  const build = workflow.jobs["windows-packages"];
  assert.deepEqual(build.strategy.matrix.include.map(row => [row.brand, row.sequence]), [["piora", "1"], ["xiaoyi-harness", "1"], ["xiaoyi-harness", "2"]]);
  assert.equal(workflow.jobs["install-upgrade"].needs, "windows-packages");
  assert.ok(workflow.jobs["install-upgrade"].steps.some(step => step.run?.includes("verify-brand-install-upgrade.mjs")));
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});
