import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const root = path.resolve(import.meta.dirname, "../..");

test("the file panel settles a stopped run whose change snapshot is still running", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-run-changes-"));
  let browser;
  try {
    await writeFile(path.join(directory, "ts.cjs"), `
      const ts = require(${JSON.stringify(require.resolve("typescript"))});
      module.exports = source => ts.transpileModule(source, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText;
    `);
    await writeFile(path.join(directory, "css.cjs"), 'module.exports = () => "export default {};";');
    await writeFile(path.join(directory, "entry.tsx"), `
      import { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { I18nProvider } from "@/hooks/useI18n";
      import { RunChangesPane } from "@/components/workspace/RunChangesPane";
      function Fixture() {
        const [running, setRunning] = useState(true);
        const [mode, setMode] = useState("run");
        return <I18nProvider>
          <button type="button" onClick={() => setRunning(false)}>Stop fixture</button>
          <RunChangesPane active sessionId="fixture" sessionRunning={running} refreshKey={0}
            fileNavMode={mode} onFileNavModeChange={setMode} onOpenReview={() => {}}
            onOpenRunFile={() => {}}>Explorer fixture</RunChangesPane>
        </I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    `);
    const compiler = webpack({
      mode: "development", target: "web", devtool: false,
      entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules")], alias: { "@": root } },
      module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "ts.cjs") },
        { test: /\.css$/, use: path.join(directory, "css.cjs") },
      ] },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    })));
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
    let requests = 0;
    let settled = false;
    await page.route("http://run-changes.test/**", async route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/agent/fixture/changes") {
        requests += 1;
        return route.fulfill({ json: {
          sessionId: "fixture", runId: "run", cwd: "C:/fixture", startedAt: 1, partial: false,
          status: settled ? "aborted" : "running",
          files: settled ? [{ path: "C:/fixture/changed.txt", kind: "modified" }] : [],
        } });
      }
      if (pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(pathname))) });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>' });
    });
    await page.goto("http://run-changes.test/");
    const running = page.getByText("本轮正在运行", { exact: true });
    await running.waitFor();

    const staleRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/agent/fixture/changes");
    await page.getByRole("button", { name: "Stop fixture" }).click();
    assert.equal((await (await staleRead).json()).status, "running", "the first read after Stop still sees an unfinished change snapshot");
    assert.equal(await running.isVisible(), true);
    settled = true;

    await page.getByText("本轮已停止", { exact: true }).waitFor({ timeout: 6000 });
    await page.getByRole("button", { name: /changed\.txt/ }).waitFor();
    assert.equal(await running.isVisible(), false);
    const readsAfterSettling = requests;
    await page.waitForTimeout(1250);
    assert.equal(requests, readsAfterSettling, "settled idle runs do not keep polling");
  } finally {
    await browser?.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
