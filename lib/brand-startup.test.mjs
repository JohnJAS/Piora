import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(resolve(import.meta.dirname, "../desktop/src/startup-scene.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function startup(displayName = "XiaoYiHarness") {
  const exports = {};
  const nativeRequire = createRequire(import.meta.url);
  runInNewContext(compiled, { exports, process, Buffer, require: id => id === "./branding.js"
    ? { APP_DISPLAY_NAME: displayName, APP_BRAND: { id: "xiaoyi-harness", startup: { video: null, poster: null } } }
    : nativeRequire(id) });
  return exports;
}

test("custom static startup has its own identity and wraps long names without old cinematic branding", () => {
  const html = startup("XiaoYi & Harness").createStartupDocument({ chinese: true, version: "1.2.3", updated: false, icon: "data:image/png;base64,AA==" });
  assert.match(html, /XiaoYi &amp; Harness/);
  assert.match(html, /data:image\/png;base64,AA==/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(html, /<video|POLARIS EXPEDITION|π \/ PIORA|Starting Piora/);
});

test("first-use static intro hides the skip button without changing the default intro", () => {
  const scene = startup();
  assert.equal(scene.XIAOYI_FIRST_STARTUP_MS, 5000);
  assert.match(scene.createStartupDocument({ chinese: true, version: "1.0.0", updated: false, allowSkip: false }), /#skip-intro\{display:none\}/);
  assert.doesNotMatch(scene.createStartupDocument({ chinese: true, version: "1.0.0", updated: false }), /#skip-intro\{display:none\}/);
});

test("custom startup ignores stale Piora media even if files remain on disk", async t => {
  const root = await mkdtemp(resolve(tmpdir(), "piora-custom-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, "polaris-rover.mp4"), "stale default film");
  await writeFile(resolve(root, "polaris-rover.jpg"), "stale default poster");
  await writeFile(resolve(root, "icon.png"), "custom icon");
  const media = startup().loadStartupMedia(root);
  assert.equal(media.video, undefined);
  assert.equal(media.poster, undefined);
  assert.equal(media.icon, `data:image/png;base64,${Buffer.from("custom icon").toString("base64")}`);
});
