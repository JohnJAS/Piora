import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const packageUrl = import.meta.resolve("@earendil-works/pi-coding-agent");

test("search tool installation loads the real SDK after server bundling without network access", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-tool-runtime-bundle-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const source = await readFile(new URL("./tool-runtime.ts", import.meta.url), "utf8");
  await writeFile(path.join(root, "entry.js"), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const compiler = webpack({
    mode: "production", target: "node22", entry: path.join(root, "entry.js"),
    optimization: { minimize: false },
    output: { path: root, filename: "bundle.cjs", library: { type: "commonjs2" } },
    resolve: { modules: [path.resolve("node_modules"), "node_modules"] },
    externals: [/^node:/, { "@earendil-works/pi-coding-agent": `import ${packageUrl}` }],
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close((closeError) => {
      if (error || closeError) reject(error || closeError);
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  }));

  // The real SDK accepts an existing managed file without executing it or downloading.
  const agentDir = path.join(root, "agent");
  const binary = path.join(agentDir, "bin", process.platform === "win32" ? "fd.exe" : "fd");
  await mkdir(path.dirname(binary), { recursive: true });
  await writeFile(binary, "SDK resolver fixture");
  const bundleUrl = pathToFileURL(path.join(root, "bundle.cjs")).href;
  const script = `const loaded = await import(${JSON.stringify(bundleUrl)}); const api = await loaded.default; console.log(JSON.stringify(await api.installToolRuntime('fd')));`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, PI_OFFLINE: "1", PI_CODING_AGENT_DIR: agentDir }, timeout: 20_000,
  });
  assert.deepEqual(JSON.parse(stdout.trim()), { path: binary, status: "installed" });
});
