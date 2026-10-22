// Run on the target OS: node scripts/diagnose-sharp-electron.mjs
// Baseline failures are evidence; every patched probe must pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWebRuntimeArchive } from "./archive-web-runtime.mjs";
import { collectRuntimeDependencyAssets } from "./stage-standalone.mjs";
import { patchSharpElectronLinux } from "./patch-sharp-electron-linux.mjs";

const require = createRequire(import.meta.url);
const electron = require("electron");
const root = await mkdtemp(join(tmpdir(), "piora-sharp-diagnostic-"));
const expected = { width: 3, height: 2, pixels: Array.from({ length: 6 }, () => [18, 52, 86, 255]).flat() };
try {
  console.log(JSON.stringify({ host: process.versions, platform: process.platform, arch: process.arch }));
  if (process.platform === "linux") {
    for (const [command, args] of [["ldd", ["--version"]], ["pkg-config", ["--modversion", "glib-2.0"]]]) {
      const result = spawnSync(command, args, { encoding: "utf8" });
      console.log(JSON.stringify({ command, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }));
    }
  }
  for (const patched of [false, true]) {
    const source = join(root, patched ? "patched" : "baseline");
    await mkdir(source);
    const assets = await collectRuntimeDependencyAssets([resolve("node_modules/sharp")], process.cwd(), source);
    for (const asset of assets) await cp(asset.source, asset.destination, {
      recursive: true, filter: path => !path.split(/[\\/]/).includes(".bin"),
    });
    // Restore upstream symbol names only in the isolated baseline fixture.
    await patchSharpElectronLinux(source, { restore: !patched });
    await writeFile(join(source, "probe.cjs"), `
      const sharp = require('sharp');
      console.error(JSON.stringify({runtime:process.versions,sharp:sharp.versions}));
      (async () => {
        const image = await sharp({create:{width:3,height:2,channels:4,background:'#123456'}}).png().toBuffer();
        const metadata = await sharp(image).metadata();
        const pixels = await sharp(image).ensureAlpha().raw().toBuffer();
        for (let iteration = 0; iteration < 20; iteration++) {
          const decoded = await sharp(image).ensureAlpha().raw().toBuffer();
          if (!decoded.equals(pixels)) throw new Error('Image pixels changed during repeated decoding');
        }
        console.log(JSON.stringify({width:metadata.width,height:metadata.height,pixels:[...pixels]}));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `);
    const run = (runtime, entry) => {
      const result = spawnSync(runtime, [entry], {
        cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_PATH: "" },
      });
      let valid = false;
      try { assert.deepEqual(JSON.parse(result.stdout), expected); valid = true; } catch { /* Report malformed/absent output below. */ }
      const passed = result.status === 0 && !result.error && valid && !/GLib(?:-GObject)?-(?:CRITICAL|WARNING)/.test(result.stderr);
      console.log(JSON.stringify({ patched, runtime, entry, passed, exit: result.status, signal: result.signal,
        error: result.error?.message, stdout: result.stdout, stderr: result.stderr }));
      if (patched && !passed) process.exitCode = 1;
    };
    run(process.execPath, join(source, "probe.cjs"));
    run(electron, join(source, "probe.cjs"));
    const archive = `${source}.asar`;
    await createWebRuntimeArchive(source, archive);
    await rm(source, { recursive: true, force: true });
    run(electron, join(archive, "probe.cjs"));
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
