import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPackage } from "@electron/asar";
import { verifyWindowsUpdateArtifacts } from "../scripts/verify-windows-update-artifacts.mjs";

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "piora-update-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installerName = "Piora-0.4.12-win-x64-setup.exe";
  const installerPath = join(root, installerName);
  await writeFile(installerPath, "", "utf8");
  await truncate(installerPath, 11 * 1024 * 1024);
  const installer = await readFile(installerPath);
  const sha512 = createHash("sha512").update(installer).digest("base64");
  await writeFile(`${installerPath}.blockmap`, "blockmap".repeat(20), "utf8");
  await mkdir(join(root, "win-unpacked", "resources"), { recursive: true });
  const asarSource = join(root, "asar-source");
  await mkdir(join(asarSource, "node_modules", "electron-updater", "out"), { recursive: true });
  await mkdir(join(asarSource, "node_modules", "builder-util-runtime", "out"), { recursive: true });
  await writeFile(join(asarSource, "node_modules", "electron-updater", "out", "main.js"), "module.exports = {};\n", "utf8");
  await writeFile(join(asarSource, "node_modules", "builder-util-runtime", "out", "index.js"), "module.exports = {};\n", "utf8");
  await createPackage(asarSource, join(root, "win-unpacked", "resources", "app.asar"));
  await writeFile(
    join(root, "win-unpacked", "resources", "app-update.yml"),
    "provider: github\nowner: kexijiang\nrepo: Piora\n",
    "utf8",
  );
  await writeFile(
    join(root, "latest.yml"),
    [
      "version: 0.4.12",
      "files:",
      `  - url: ${installerName}`,
      `    sha512: ${sha512}`,
      `    size: ${11 * 1024 * 1024}`,
      "releaseDate: '2026-08-26T00:00:00.000Z'",
      "",
    ].join("\n"),
    "utf8",
  );
  return { root, installerName };
}

test("Windows update artifacts bind the installer to GitHub metadata", async (t) => {
  const fixture = await createFixture(t);
  const result = await verifyWindowsUpdateArtifacts(fixture.root, "v0.4.12");
  assert.equal(result.version, "0.4.12");
  assert.equal(result.installerName, fixture.installerName);
  assert.equal(result.metadataName, "latest.yml");
});

test("Windows update verification rejects a substituted installer", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.root, fixture.installerName), "substituted", "utf8");
  await assert.rejects(
    verifyWindowsUpdateArtifacts(fixture.root, "0.4.12"),
    /unexpectedly small|SHA-512 does not match/,
  );
});
