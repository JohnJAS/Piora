import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = resolve(import.meta.dirname, "..");

test("400 parents use bounded presence batches and a fresh scope invalidates details", { timeout: 120_000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), "piora-subagent-catalog-"));
  let browser, server;
  try {
    const entry = join(folder, "entry.tsx"), loader = join(folder, "loader.cjs");
    await writeFile(loader, `const ts = require(${JSON.stringify(require.resolve("typescript"))});
      module.exports = source => ts.transpileModule(source, { compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
      }}).outputText;`);
    await writeFile(entry, `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { useSessionCatalog } from "@/components/sidebar/useSessionCatalog";
      import { useSubagentQuery } from "@/hooks/useSubagents";
      const muted = new Set();
      function Catalog() {
        const [open, setOpen] = React.useState(false);
        const catalog = useSessionCatalog({ selectedSessionId: null, mutedProjectRoots: muted });
        const detail = useSubagentQuery(open ? "parent-000" : undefined, open ? "agentId=child" : undefined);
        return <main>
          <output id="parents">{catalog.allSessions.length}</output>
          <output id="presence">{[...catalog.subagentParentIds].join(",")}</output>
          <button onClick={() => setOpen(!open)}>Toggle child</button>
          <button onClick={detail.refresh}>Refresh child</button>
          <output id="detail">{detail.data?.records[0]?.description}</output>
        </main>;
      }
      createRoot(document.getElementById("root")).render(<Catalog />);
    `);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry,
      output: { path: folder, filename: "bundle.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    await new Promise((done, reject) => compiler.run((error, stats) => compiler.close(() =>
      error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : done())));
    const bundle = await readFile(join(folder, "bundle.js"));
    const parents = Array.from({ length: 400 }, (_, index) => ({
      id: "parent-" + String(index).padStart(3, "0"), path: "fixture", cwd: "fixture", firstMessage: "", modified: "", created: "",
    }));
    let epoch = "original", version = "empty", found = false, polls = 0, streams = 0, calls = 0;
    let hold = false, releaseOld;
    const batches = [];
    server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      const json = value => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
      if (url.pathname === "/bundle.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bundle); }
      else if (url.pathname.endsWith("/events")) { streams++; response.end(); }
      else if (url.pathname === "/api/agent/running") {
        polls++;
        json({ runningSessions: [], subagentPresenceVersion: version, subagentRefreshEpoch: epoch,
          subagentRefreshCursor: found ? 1 : 0, subagentRefreshReset: url.searchParams.get("subagentsEpoch") !== epoch });
      } else if (url.pathname === "/api/sessions" && url.searchParams.get("view") === "sidebar") {
        json({ sessions: parents, nextOffset: null, subagentParentIds: [] });
      } else if (url.pathname === "/api/sessions" && url.searchParams.get("view") === "subagents") {
        const ids = url.searchParams.getAll("sessionId");
        batches.push(ids.length);
        json({ subagentParentIds: found && ids.includes("parent-000") ? ["parent-000"] : [] });
      } else if (url.pathname === "/api/agent/parent-000/subagents") {
        calls++;
        const data = { records: [{ agentId: "child", description: epoch, attempt: epoch === "original" ? 3 : 1, revision: 1 }] };
        if (hold && epoch === "original") releaseOld = () => json(data);
        else json(data);
      } else {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
      }
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => document.querySelector("#parents")?.textContent === "400");
    await waitFor(() => batches.length === 4);
    assert.deepEqual(batches, [128, 128, 128, 16]);
    assert.equal(calls, 0, "no per-parent or transcript requests while groups are collapsed");
    found = true; version = "new-parent";
    await page.waitForFunction(() => document.querySelector("#presence")?.textContent === "parent-000");
    assert.deepEqual(batches.slice(4), [128, 128, 128, 16], "an idle-to-idle presence change is batched");
    assert.equal(calls, 0);
    const startPoll = polls;
    await waitFor(() => polls > startPoll);
    assert.equal(batches.length, 8, "unchanged status polls do not fetch the catalog again");
    await page.getByRole("button", { name: "Toggle child" }).click();
    await page.waitForFunction(() => document.querySelector("#detail").textContent === "original");
    hold = true;
    await page.getByRole("button", { name: "Refresh child" }).click();
    await waitFor(() => releaseOld);
    epoch = "new-root"; version = "new-root-presence";
    await page.waitForFunction(() => document.querySelector("#detail").textContent === "new-root");
    releaseOld();
    await page.getByRole("button", { name: "Toggle child" }).click();
    await page.getByRole("button", { name: "Toggle child" }).click();
    await page.waitForFunction(() => document.querySelector("#detail").textContent === "new-root");
    assert.equal(streams, 0);
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
