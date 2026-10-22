import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { createWebRuntimeArchive } from "../scripts/archive-web-runtime.mjs";
import { collectRuntimeDependencyAssets } from "../scripts/stage-standalone.mjs";
const require = createRequire(import.meta.url);

async function probe(executable, entry, root) {
  return new Promise((done, reject) => {
    const child = spawn(executable, [entry], { cwd: root, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_PATH: "" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Image decoding timed out: ${stderr}`)); }, 15000);
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(`Image probe failed (${executable}, ${entry}, exit=${code}, signal=${signal}): ${stderr || "no diagnostic output"}`));
      } else {
        try {
          assert.doesNotMatch(stderr, /GLib(?:-GObject)?-(?:CRITICAL|WARNING)/);
          done(JSON.parse(stdout.trim()));
        } catch (error) { reject(error); }
      }
    });
  });
}

test("packaged sharp decodes images under Electron using its complete native dependency sidecar", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-image-package-"));
  t.after(async () => { assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}piora-image-package-`)); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const source = join(root, "source");
  const archive = join(root, "runtime.asar");
  await mkdir(source, { recursive: true });
  const assets = await collectRuntimeDependencyAssets([resolve("node_modules/sharp")], process.cwd(), source);
  assert.ok(assets.some((asset) => asset.name.includes("@img/sharp-" + process.platform)));
  for (const asset of assets) await cp(asset.source, asset.destination, {
    recursive: true,
    // Match production staging: npm command shims are not runtime assets and
    // can otherwise retain links back to the original installation on Linux.
    filter: path => !path.split(/[\\/]/).includes(".bin"),
  });
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
      console.log(JSON.stringify({width:metadata.width,height:metadata.height,format:metadata.format,pixels:[...pixels]}));
    })().catch(error => { console.error(error); process.exitCode=1; });
  `);
  const expected = { width: 3, height: 2, format: "png", pixels: Array.from({ length: 6 }, () => [18, 52, 86, 255]).flat() };
  // Compare ordinary Node and Electron before archiving, then remove the
  // source tree so the packaged check cannot resolve back to it.
  assert.deepEqual(await probe(process.execPath, join(source, "probe.cjs"), root), expected);
  assert.deepEqual(await probe(require("electron"), join(source, "probe.cjs"), root), expected);
  await createWebRuntimeArchive(source, archive);
  assert.ok(resolve(source).startsWith(`${resolve(root)}${sep}`));
  await rm(source, { recursive: true, force: true });
  assert.deepEqual(await probe(require("electron"), join(archive, "probe.cjs"), root), expected);
});
