import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = resolve(import.meta.dirname, "..");

test("400 parents derive subagent activity from running snapshots and a fresh scope invalidates details", { timeout: 180_000 }, async context => {
  const folder = await mkdtemp(join(tmpdir(), "piora-subagent-catalog-"));
  let browser, server;
  try {
    const entry = join(folder, "entry.tsx"), loader = join(folder, "loader.cjs"), cssLoader = join(folder, "css.cjs");
    await writeFile(loader, `const ts = require(${JSON.stringify(require.resolve("typescript"))});
      module.exports = source => ts.transpileModule(source, { compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
      }}).outputText;`);
    await writeFile(cssLoader, 'module.exports = () => "export default {}";');
    await writeFile(entry, `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { useSessionCatalog } from "@/components/sidebar/useSessionCatalog";
      import { useSubagentQuery } from "@/hooks/useSubagents";
      import { SubagentInspector } from "@/components/SubagentInspector";
      import { I18nProvider } from "@/hooks/useI18n";
      const muted = new Set();
      function Catalog() {
        const [open, setOpen] = React.useState(false);
        const catalog = useSessionCatalog({ selectedSessionId: null, mutedProjectRoots: muted });
        const detail = useSubagentQuery(open ? "parent-000" : undefined, open ? "agentId=child" : undefined);
        return <main>
          <output id="parents">{catalog.allSessions.length}</output>
          <output id="active">{[...catalog.subagentCounts.keys()].join(",")}</output>
          <button onClick={() => setOpen(!open)}>Toggle child</button>
          <button onClick={detail.refresh}>Refresh child</button>
          <output id="detail">{detail.data?.records[0]?.description}</output>
        </main>;
      }
      createRoot(document.getElementById("root")).render(location.pathname === "/markdown"
        ? <I18nProvider><SubagentInspector selection={{ parentSessionId: "markdown-parent", agentId: "markdown-child" }}
            onClose={() => {}} modal={false} /></I18nProvider>
        : <Catalog />);
    `);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry,
      output: { path: folder, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
      plugins: [new webpack.IgnorePlugin({ resourceRegExp: /^mermaid$/ })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.css$/, use: cssLoader }] },
    });
    await new Promise((done, reject) => compiler.run((error, stats) => compiler.close(() =>
      error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : done())));
    const bundle = await readFile(join(folder, "bundle.js"));
    const parents = Array.from({ length: 400 }, (_, index) => ({
      id: "parent-" + String(index).padStart(3, "0"), path: "fixture", cwd: "fixture", firstMessage: "", modified: "", created: "",
    }));
    let epoch = "original", active = false, polls = 0, streams = 0, calls = 0, historyLookups = 0;
    let hold = false, releaseOld;
    let fullResultReads = 0;
    const completeResult = [
      "Subagent report", "",
      "| Check | Status |", "| --- | --- |", "| Markdown preview | Ready |", "",
      "```ts", "const result = true;", "```", "",
      "Additional findings from this task. ".repeat(260), "", "FULL_RESULT_END",
    ].join("\n");
    const suffix = "\n[Truncated; see child transcript.]";
    const resultRecord = {
      agentId: "markdown-child", parentSessionId: "markdown-parent", parentToolCallId: "fixture", agentType: "Explore",
      description: "Markdown result", background: true, status: "completed", attempt: 1, revision: 2,
      startedAt: 1000, attemptStartedAt: 1000, endedAt: 2000, totalTokens: 50, totalToolUseCount: 1,
      result: completeResult.slice(0, 8000 - suffix.length) + suffix,
    };
    server = createServer(async (request, response) => {
      const url = new URL(request.url, "http://localhost");
      const json = value => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
      if (url.pathname === "/bundle.js") { response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); response.end(bundle); }
      else if (url.pathname.endsWith(".js")) {
        const chunk = await readFile(join(folder, basename(url.pathname))).catch(() => null);
        response.writeHead(chunk ? 200 : 404, { "Content-Type": "text/javascript; charset=utf-8" });
        response.end(chunk);
      }
      else if (url.pathname.endsWith("/events")) { streams++; response.end(); }
      else if (url.pathname === "/api/agent/running") {
        polls++;
        json({ runningSessions: active ? [{ id: "parent-000", runtime: "running", runningSubagentCount: 1 }] : [], subagentRefreshEpoch: epoch,
          subagentRefreshCursor: active ? 1 : 0, subagentRefreshReset: url.searchParams.get("subagentsEpoch") !== epoch });
      } else if (url.pathname === "/api/sessions" && url.searchParams.get("view") === "sidebar") {
        json({ sessions: parents, nextOffset: null, subagentParentIds: ["parent-000"] });
      } else if (url.pathname === "/api/sessions" && url.searchParams.get("view") === "subagents") {
        historyLookups++;
        json({ subagentParentIds: ["parent-000"] });
      } else if (url.pathname === "/api/agent/parent-000/subagents") {
        calls++;
        const data = { records: [{ agentId: "child", description: epoch, attempt: epoch === "original" ? 3 : 1, revision: 1 }] };
        if (hold && epoch === "original") releaseOld = () => json(data);
        else json(data);
      } else if (url.pathname === "/api/agent/markdown-parent/subagents") {
        const expanded = url.searchParams.get("fullResult") === "true";
        if (expanded) fullResultReads++;
        json({ records: [resultRecord], fullResult: expanded ? completeResult : undefined });
      } else {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
      }
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => document.querySelector("#parents")?.textContent === "400");
    await waitFor(() => polls > 0);
    assert.equal(await page.locator("#active").textContent(), "");
    assert.equal(calls, 0, "no per-parent or transcript requests while groups are collapsed");
    active = true;
    await page.waitForFunction(() => document.querySelector("#active")?.textContent === "parent-000");
    assert.equal(calls, 0);
    active = false;
    await page.waitForFunction(() => document.querySelector("#active")?.textContent === "");
    assert.equal(historyLookups, 0, "terminal subagent history is never fetched to populate the sidebar");
    await page.getByRole("button", { name: "Toggle child" }).click();
    await page.waitForFunction(() => document.querySelector("#detail").textContent === "original");
    hold = true;
    await page.getByRole("button", { name: "Refresh child" }).click();
    await waitFor(() => releaseOld);
    epoch = "new-root";
    await page.waitForFunction(() => document.querySelector("#detail").textContent === "new-root");
    releaseOld();
    await page.getByRole("button", { name: "Toggle child" }).click();
    await page.getByRole("button", { name: "Toggle child" }).click();
    await page.waitForFunction(() => document.querySelector("#detail").textContent === "new-root");
    assert.equal(streams, 0);

    await context.test("the inspector renders the chat Markdown preview and fetches the full result on expansion", async () => {
      await page.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
      await page.goto(new URL("/markdown", page.url()).href);
      await page.getByText("只读记录", { exact: true }).waitFor();
      const result = page.locator("[data-subagent-result]");
      const toggle = result.locator("button[aria-controls]");
      const tail = result.getByText("FULL_RESULT_END", { exact: true });
      await result.locator(".markdown-table-wrap table").getByRole("cell", { name: "Ready", exact: true }).waitFor();
      await result.locator(".markdown-code-block pre").filter({ hasText: "const result = true;" }).waitFor();
      await result.locator(".markdown-code-header button").waitFor();
      assert.equal(await tail.count(), 0);
      assert.equal(fullResultReads, 0);
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      const controlledId = await toggle.getAttribute("aria-controls");
      assert.ok(controlledId);
      assert.equal(await result.evaluate((node, id) => node.contains(document.getElementById(id)), controlledId), true);
      assert.equal(await toggle.textContent(), "展开完整结果");
      await toggle.click();
      await tail.waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await toggle.textContent(), "收起完整结果");
      assert.equal(fullResultReads, 1);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await tail.count(), 0);
    });
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise(done => server.close(done));
    assert.equal(dirname(folder), resolve(tmpdir()));
    await rm(folder, { recursive: true, force: true });
  }
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise(done => setTimeout(done, 50));
  }
  assert.fail("Browser fixture did not reach the expected request count");
}
