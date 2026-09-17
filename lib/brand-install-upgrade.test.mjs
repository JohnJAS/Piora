import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createPackage } from "@electron/asar";
import { dump } from "js-yaml";
import { installerVersion, verifyInstalledBrand, validateInstallerRegistration, EXPECTED_INSTALLER_GUID } from "../scripts/verify-brand-install-upgrade.mjs";

test("upgrade registration must remain under the shared AppId with the expected version and path", () => {
  assert.match(EXPECTED_INSTALLER_GUID, /^[0-9a-f-]{36}$/i);
  const record = { installLocation: resolve("fixture/installed"), version: "1.2.3", displayName: "XiaoYiHarness" };
  assert.equal(validateInstallerRegistration([record], record.installLocation, record.version, record.displayName).length, 1);
  assert.throws(() => validateInstallerRegistration([], record.installLocation, record.version, record.displayName), /missing/);
  for (const patch of [{ version: "1.2.2" }, { displayName: "Piora" }, { installLocation: resolve("other") }]) {
    assert.throws(() => validateInstallerRegistration([{ ...record, ...patch }], record.installLocation, record.version, record.displayName), /changed identity/);
  }
});

test("upgrade fixtures accept only branded canonical installers", () => {
  assert.equal(installerVersion("XiaoYiHarness-1.2.3-beta.4-win-x64-setup.exe"), "1.2.3-beta.4");
  for (const name of ["Piora-1.2.3-win-x64-setup.exe", "XiaoYiHarness-1.2.3-win-x64-portable.exe", "setup.exe"]) {
    assert.throws(() => installerVersion(name));
  }
});

test("installed payload verification checks actual updater file and ASAR package identity", async t => {
  const root = await mkdtemp(resolve(tmpdir(), "piora-installed-brand-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = resolve(root, "resources");
  const source = resolve(root, "fixture-app");
  await mkdir(resources);
  await mkdir(source);
  await writeFile(resolve(source, "package.json"), JSON.stringify({ productName: "XiaoYiHarness", version: "1.2.3-beta.4" }));
  await createPackage(source, resolve(resources, "app.asar"));
  await writeFile(resolve(resources, "brand.json"), JSON.stringify({ id: "xiaoyi-harness", displayName: "XiaoYiHarness", artifactPrefix: "XiaoYiHarness" }));
  const config = { provider: "github", owner: "kexijiang", repo: "Piora", channel: "xiaoyi-beta", updaterCacheDirName: "xiaoyi-harness-updater" };
  const file = resolve(resources, "app-update-xiaoyi.yml");
  await writeFile(file, dump(config));
  assert.equal((await verifyInstalledBrand(root, "1.2.3-beta.4")).version, "1.2.3-beta.4");
  for (const patch of [{ channel: "beta" }, { updaterCacheDirName: "@pioradesktop-updater" }, { repo: "other" }]) {
    await writeFile(file, dump({ ...config, ...patch }));
    await assert.rejects(verifyInstalledBrand(root, "1.2.3-beta.4"), /not isolated/);
  }
  await writeFile(file, dump(config));
  await assert.rejects(verifyInstalledBrand(root, "1.2.3-beta.5"), /version mismatch/);
});
