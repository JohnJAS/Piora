import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { loadBranding, runtimeBranding } from "../scripts/branding-config.mjs";
import { prepareBranding } from "../scripts/prepare-branding.mjs";

const sourceRoot = resolve(import.meta.dirname, "..");
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "piora-brand-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ["branding", "desktop/build/piora-icon.svg", "desktop/build/startup", "desktop/build/portable-splash.bmp", "desktop/electron-builder.yml", "desktop/package.json"]) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await cp(resolve(sourceRoot, file), resolve(root, file), { recursive: true });
  }
  await mkdir(resolve(root, "app"));
  return root;
}
async function config(root, patch) {
  const file = resolve(root, "branding/xiaoyi-harness/branding.json");
  const original = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...original, ...patch }));
}
async function hashes(root) {
  const result = {};
  for (const file of ["app/favicon.ico", "public/icons/icon-192.png", "public/icons/icon-512.png", "public/offline.html", ".branding/resources/icon.ico", ".branding/resources/tray.png", "lib/generated/brand.ts", "desktop/src/generated/brand.ts", ".branding/runtime.json"]) {
    result[file] = createHash("sha256").update(await readFile(resolve(root, file))).digest("hex");
  }
  return result;
}

test("Piora -> XiaoYiHarness -> Piora restores resources without stale startup media", async t => {
  const root = await fixture(t);
  await prepareBranding(root, "piora");
  const before = await hashes(root);
  assert.deepEqual((await readdir(resolve(root, ".branding/resources/startup"))).sort(), ["icon.png", "polaris-rover.jpg", "polaris-rover.mp4"]);
  const custom = await prepareBranding(root, "xiaoyi-harness");
  assert.equal(custom.displayName, "XiaoYiHarness");
  assert.deepEqual(custom.startup, { video: null, poster: null });
  assert.deepEqual(await readdir(resolve(root, ".branding/resources/startup")), ["icon.png"]);
  await assert.rejects(readFile(resolve(root, ".branding/resources/portable-splash.bmp")), { code: "ENOENT" });
  const changed = await hashes(root);
  assert.notEqual(changed["app/favicon.ico"], before["app/favicon.ico"]);
  assert.match(await readFile(resolve(root, "public/offline.html"), "utf8"), /XiaoYiHarness/);
  await prepareBranding(root, "piora");
  assert.deepEqual(await hashes(root), before);
});

test("brand builder configs keep application identity but isolate artifacts, channels and caches", async t => {
  const root = await fixture(t);
  for (const id of ["piora", "xiaoyi-harness"]) {
    const runtime = await prepareBranding(root, id);
    for (const preview of [false, true]) {
      const built = JSON.parse(await readFile(resolve(root, `.branding/builder${preview ? "-preview" : ""}.json`), "utf8"));
      assert.equal(built.appId, "io.github.kexijiang.piora");
      assert.equal(built.executableName, "Piora");
      assert.equal(built.linux.executableName, "Piora");
      assert.equal(built.productName, runtime.displayName);
      assert.equal(built.publish.channel, runtime.updateChannels[preview ? "preview" : "stable"]);
      assert.equal(built.publish.owner, "kexijiang");
      assert.equal(built.publish.repo, "Piora");
      assert.equal(built.nsis.artifactName, runtime.artifactPrefix + "-${version}-win-x64-setup.${ext}");
      assert.equal(built.nsis.deleteAppDataOnUninstall, false);
      assert.equal(Boolean(built.portable.splashImage), id === "piora");
      assert.equal(built.extraResources.some(entry => entry.to === "app-update-xiaoyi.yml"), id !== "piora");
    }
    assert.deepEqual(runtime, runtimeBranding(await loadBranding(root, id)));
  }
  const defaultBrand = await loadBranding(root, "piora");
  const customBrand = await loadBranding(root, "xiaoyi-harness");
  assert.notEqual(defaultBrand.audienceFile, customBrand.audienceFile);
  assert.notEqual(defaultBrand.updaterCacheDirName, customBrand.updaterCacheDirName);
  const updateConfig = await readFile(resolve(root, ".branding/app-update-xiaoyi.yml"), "utf8");
  const { version } = JSON.parse(await readFile(resolve(root, "desktop/package.json"), "utf8"));
  assert.ok(updateConfig.includes(`channel: ${customBrand.updateChannels[version.includes("-beta.") ? "preview" : "stable"]}`));
  assert.match(updateConfig, /updaterCacheDirName: xiaoyi-harness-updater/);
});

test("invalid branding is rejected before replacing prepared outputs", async t => {
  const root = await fixture(t);
  await prepareBranding(root, "piora");
  const before = await hashes(root);
  await assert.rejects(prepareBranding(root, "unknown"), /Unknown PIORA_BRAND/);
  for (const patch of [
    { artifactPrefix: "Piora" },
    { updateChannels: { stable: "latest", preview: "beta" } },
    { displayName: "../invalid" },
    { displayName: " bad name " },
    { repository: "elsewhere" },
  ]) {
    await cp(resolve(sourceRoot, "branding/xiaoyi-harness/branding.json"), resolve(root, "branding/xiaoyi-harness/branding.json"));
    await config(root, patch);
    await assert.rejects(prepareBranding(root, "xiaoyi-harness"));
    assert.deepEqual(await hashes(root), before);
  }
});

test("custom brand cannot escape its asset directory or silently reuse default icon", async t => {
  const root = await fixture(t);
  await config(root, { icon: "../../desktop/build/piora-icon.svg" });
  await assert.rejects(loadBranding(root, "xiaoyi-harness"), /escapes the brand directory/);
  await config(root, { icon: undefined });
  await assert.rejects(loadBranding(root, "xiaoyi-harness"), /requires its own SVG/);
  await config(root, { icon: "icon.svg" });
  await writeFile(resolve(root, "branding/xiaoyi-harness/icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(loadBranding(root, "xiaoyi-harness"), /self-contained/);
});
