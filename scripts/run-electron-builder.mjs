import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadBranding, runtimeBranding } from "./branding-config.mjs";
import { verifyBrandBuilds } from "./brand-build-integrity.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const expected = runtimeBranding(await loadBranding(projectRoot));
const prepared = JSON.parse(await readFile(resolve(projectRoot, ".branding/runtime.json"), "utf8"));
if (JSON.stringify(expected) !== JSON.stringify(prepared)) throw new Error("Brand changed after compilation. Run the complete build with the intended PIORA_BRAND.");
await verifyBrandBuilds(projectRoot);
const args = process.argv.slice(2);
const preview = args.includes("--preview");
const require = createRequire(import.meta.url);
const cli = require.resolve("electron-builder/cli.js");
const result = spawnSync(process.execPath, [cli, "--config", resolve(projectRoot, ".branding", preview ? "builder-preview.json" : "builder.json"),
  ...args.filter(arg => arg !== "--preview"), "--publish", "never"], { cwd: resolve(projectRoot, "desktop"), stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
