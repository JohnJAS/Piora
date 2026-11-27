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

test("run file changes settle after Stop, open exact diffs, and reset per run", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-run-changes-"));
  let browser;
  try {
    await writeFile(path.join(directory, "ts.cjs"), `
      const ts = require(${JSON.stringify(require.resolve("typescript"))});
      module.exports = source => ts.transpileModule(source, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText;
    `);
    await writeFile(path.join(directory, "css.cjs"), `module.exports=function(source){
      const prefix=require("node:path").basename(this.resourcePath).replace(/\\W/g,"_");
      const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+"_"+m[1]]));
      const css=source.replace(/\\.([a-zA-Z][\\w-]*)/g,(_,name)=>"."+names[name]);
      return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.append(style);export default '+JSON.stringify(names);
    };`);
    const stubs = path.join(directory, "stubs.tsx");
    await writeFile(stubs, `
      export const FileExplorer=()=>null, FileViewer=()=>null, TabBar=()=>null, ReviewPanel=()=>null,
        CommandPanel=()=>null, BrowserPanel=()=>null, SafeHarmonyPanel=()=>null, AutomationPanel=()=>null,
        SSHPanel=()=>null, DesignToHarmonyPanel=()=>null, PlanSidePanelTab=()=>null, GoalSidePanelTab=()=>null,
        SideChatMenuEntries=()=>null, SideChatTabPanels=()=>null, SideChatTabStripItems=()=>null;
      export default ()=>()=>null;
    `);
    await writeFile(path.join(directory, "entry.tsx"), `
      import { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { I18nProvider } from "@/hooks/useI18n";
      import { RightPanel } from "@/components/workspace/RightPanel";
      import { RunChangesSummary } from "@/components/workspace/RunChangesSummary";
      import { useRunFileChanges } from "@/components/workspace/useRunFileChanges";
      const noop = () => {};
      function Fixture() {
        const [running, setRunning] = useState(true);
        const [mode, setMode] = useState("run");
        const [active, setActive] = useState(true);
        const [tab, setTab] = useState("files");
        const [sessionId, setSessionId] = useState("fixture");
        const { snapshot, reportStart } = useRunFileChanges(sessionId, true, running, 0);
        const expanded = active && tab === "files" && mode === "run";
        return <I18nProvider>
          <button type="button" onClick={() => setRunning(false)}>Stop fixture</button>
          <button type="button" onClick={() => { reportStart(sessionId, "run-next", 2); setRunning(true); }}>Next run</button>
          <button type="button" onClick={() => { reportStart(sessionId, "run-empty", 3); setRunning(false); }}>Empty run</button>
          <button type="button" onClick={() => setSessionId("other")}>Other chat</button>
          {snapshot && <RunChangesSummary key={snapshot.sessionId + ":" + snapshot.runId} snapshot={snapshot}
            expanded={expanded} onToggle={() => { setActive(!expanded); setMode("run"); setTab("files"); }} />}
          <div id="file-panel" style={{ height: 540, display: active ? "flex" : "none", flexDirection: "column" }}>
            <RightPanel activeTab={tab} onActiveTabChange={setTab} active={active} maximized={false} onMaximizedChange={noop}
              onClosePanel={() => setActive(false)} cwd={null} refreshKey={0} fileNavMode={mode}
              onFileNavModeChange={setMode} runFileChanges={snapshot} fileTabs={[]} activeFileTabId={null}
              canReopenClosedFileTab={false} onSelectFileTab={noop} onCloseFileTab={noop} onCloseOtherFileTabs={noop}
              onCloseFileTabsToRight={noop} onMoveFileTab={noop} onReopenClosedFileTab={noop}
              onOpenFile={() => setMode("tree")} onDirtyChange={noop} onRefresh={noop} onMention={noop}
              onMentions={noop} onMentionLines={noop} selectedAutomationId={null} sessionId={sessionId} capabilities={null} />
          </div>
        </I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    `);
    const compiler = webpack({
      mode: "development", target: "web", devtool: false,
      entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: ["node_modules", path.join(root, "node_modules")], alias: {
        "@": root,
        ...Object.fromEntries(["../FileExplorer", "../FileViewer", "../TabBar", "./ReviewPanel", "./CommandPanel",
          "./BrowserPanel", "./HarmonyPanel", "../AutomationPanel", "./SSHPanel", "./design-to-harmony/DesignToHarmonyPanel",
          "../workflow/PlanSidePanelTab", "../workflow/GoalSidePanelTab", "../side-chat/SideChatRightPanelSlots",
          "next/dynamic"].map(name => [name + "$", stubs])),
      } },
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
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    let requests = 0;
    const identity = { sessionId: "fixture", runId: "run", cwd: "C:/fixture", startedAt: 1, partial: false };
    const changedFile = { path: "C:/fixture/changed.txt", kind: "modified", additions: 2, deletions: 1, patchRevision: "edited" };
    const deletedFile = { path: "C:/fixture/gone.txt", kind: "deleted", additions: 0, deletions: 1, patchRevision: "deleted" };
    let snapshot = { ...identity, status: "running", files: [] };
    const requestedDiffs = [];
    await page.route("http://run-changes.test/**", async route => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (pathname === "/api/agent/fixture/changes") {
        if (searchParams.has("path")) {
          const file = searchParams.get("path");
          requestedDiffs.push([searchParams.get("runId"), file]);
          const patch = file === deletedFile.path
            ? "--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted from this run\n"
            : "--- a/changed.txt\n+++ b/changed.txt\n@@ -1 +1,2 @@\n-old line\n+new line\n+second line\n";
          return route.fulfill({ json: { patch } });
        }
        requests += 1;
        return route.fulfill({ json: snapshot });
      }
      if (pathname === "/api/agent/other/changes") return route.fulfill({ json: null });
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
    snapshot = { ...identity, status: "aborted", files: [changedFile, deletedFile] };

    await page.getByText("本轮已停止", { exact: true }).waitFor({ timeout: 6000 });
    const changed = page.getByRole("button", { name: /changed\.txt/ });
    const deleted = page.getByRole("button", { name: /gone\.txt/ });
    await changed.waitFor();
    assert.equal(await running.isVisible(), false);
    const readsAfterSettling = requests;
    await page.waitForTimeout(1250);
    assert.equal(requests, readsAfterSettling, "settled idle runs do not keep polling");

    const summary = page.locator("[data-run-changes-summary]");
    const summaryButton = summary.getByRole("button", { name: /已更改 2 个文件/ });
    const detail = page.getByRole("region", { name: "本轮文件差异" });
    assert.match(await summaryButton.textContent(), /\+2.*−2/);
    assert.equal(await summaryButton.getAttribute("aria-expanded"), "true");
    await detail.getByText("new line", { exact: true }).waitFor();
    assert.equal(await changed.getAttribute("aria-current"), "true");
    await summaryButton.click();
    await detail.waitFor({ state: "hidden" });
    assert.equal(await summaryButton.getAttribute("aria-expanded"), "false");
    await summaryButton.click();
    await detail.getByText("new line", { exact: true }).waitFor();
    await deleted.click();
    await detail.getByText("deleted from this run", { exact: true }).waitFor();
    assert.equal(await deleted.getAttribute("aria-current"), "true");
    assert.equal(await detail.getByRole("button", { name: "打开文件", exact: true }).count(), 0);
    assert.deepEqual(requestedDiffs.at(-1), ["run", deletedFile.path]);

    await page.setViewportSize({ width: 500, height: 740 });
    const rail = page.getByRole("button", { name: "本轮修改的文件" });
    await rail.click();
    await changed.click();
    await detail.getByText("new line", { exact: true }).waitFor();
    assert.equal(await rail.getAttribute("aria-expanded"), "false");
    await summary.getByRole("button", { name: "隐藏本轮变更摘要" }).click();
    await summary.waitFor({ state: "hidden" });
    assert.equal(await detail.isVisible(), true, "hiding the summary leaves the open review accessible");

    await page.setViewportSize({ width: 1000, height: 750 });
    await page.reload();
    await page.getByText("本轮已停止", { exact: true }).waitFor();
    assert.equal(await summary.count(), 0, "a reload preserves dismissal for the same run");
    await page.getByRole("button", { name: "Next run" }).click();
    await changed.waitFor({ state: "hidden" });
    assert.equal(await detail.count(), 0, "the previous run is hidden while its replacement is starting");
    snapshot = { ...identity, runId: "run-next", startedAt: 2, status: "running", files: [changedFile] };
    const nextSummary = summary.getByRole("button", { name: /已更改 1 个文件/ });
    await nextSummary.waitFor({ timeout: 7000 });
    await detail.getByText("new line", { exact: true }).waitFor();
    assert.deepEqual(requestedDiffs.at(-1), ["run-next", changedFile.path]);

    await page.getByRole("button", { name: "Empty run" }).click();
    await summary.waitFor({ state: "hidden" });
    snapshot = { ...identity, runId: "run-empty", startedAt: 3, status: "complete", files: [] };
    await page.getByText("本轮没有文件内容变化。", { exact: true }).first().waitFor();
    assert.equal(await summary.count(), 0);
    await page.getByRole("button", { name: "Other chat" }).click();
    await page.getByText("这个会话还没有本轮文件记录。", { exact: true }).first().waitFor();
    assert.equal(await summary.count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
