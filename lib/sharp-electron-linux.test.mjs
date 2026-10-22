import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { patchSharpElectronLinux, sharpLinuxLoader } from "../scripts/patch-sharp-electron-linux.mjs";

test("sharp loader confines deep binding to Linux Electron and propagates native errors", () => {
  for (const [platform, electron] of [["linux", "44.9.0"], ["linux", undefined], ["win32", "44.9.0"]]) {
    const calls = [];
    const nativeModule = { exports: {} };
    const binding = { decoded: true };
    const require = Object.assign((name) => {
      calls.push(name);
      return name === "node:os" ? { constants: { dlopen: { RTLD_NOW: 2, RTLD_DEEPBIND: 8 } } } : binding;
    }, { resolve: name => `/fixture/${name}` });
    const process = { platform, versions: { electron }, dlopen: (target, file, flags) => {
      assert.equal(target, nativeModule);
      assert.match(file, /sharp-linux-x64-0\.35\.5\.node$/);
      assert.equal(flags, 10);
      target.exports = binding;
    } };
    runInNewContext(sharpLinuxLoader("linux-x64", "0.35.5"), { module: nativeModule, require, process });
    assert.equal(nativeModule.exports, binding);
    assert.deepEqual(calls, platform === "linux" && electron ? ["node:os"] : ["./lib/sharp-linux-x64-0.35.5.node"]);
    if (platform === "linux" && electron) {
      process.dlopen = () => { throw new Error("native failure"); };
      assert.throws(() => runInNewContext(sharpLinuxLoader("linux-x64", "0.35.5"), { module: nativeModule, require, process }), /native failure/);
    }
  }
});

test("sharp installation patch is exact, repeatable, and rejects dependency drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-sharp-patch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "node_modules/@img/sharp-linux-x64");
  await mkdir(directory, { recursive: true });
  const manifest = join(directory, "package.json");
  const loader = join(directory, "index.cjs");
  await writeFile(manifest, JSON.stringify({ name: "@img/sharp-linux-x64", version: "0.35.5" }));
  await writeFile(loader, sharpLinuxLoader("linux-x64", "0.35.5", false));
  assert.deepEqual(await patchSharpElectronLinux(root), { patched: ["@img/sharp-linux-x64"] });
  assert.equal(await readFile(loader, "utf8"), sharpLinuxLoader("linux-x64", "0.35.5"));
  assert.deepEqual(await patchSharpElectronLinux(root), { patched: [] });
  await writeFile(loader, "unexpected loader");
  await assert.rejects(patchSharpElectronLinux(root), /Unexpected sharp native loader/);
  await writeFile(manifest, JSON.stringify({ name: "@img/sharp-linux-x64", version: "0.36.0" }));
  await assert.rejects(patchSharpElectronLinux(root), /Review Electron GLib isolation/);
});
