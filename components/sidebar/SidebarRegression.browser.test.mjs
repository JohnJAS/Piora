import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "../..");

let directory;
let browser;
let css;

test.before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "piora-sidebar-regression-"));
  await writeFile(
    path.join(directory, "ts.cjs"),
    `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`,
  );
  await writeFile(
    path.join(directory, "css.cjs"),
    `module.exports=function(s){const prefix=require('node:path').basename(this.resourcePath).replace(/\\W/g,'_');const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+'_'+m[1]]));const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(_,n)=>'.'+names[n]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.append(style);export default '+JSON.stringify(names)}`,
  );

  await writeFile(
    path.join(directory, "entry.tsx"),
    `
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/hooks/useI18n";
import { SessionSidebar, type SessionSidebarHandle } from "@/components/SessionSidebar";

function App() {
  const params = new URLSearchParams(window.location.search);
  const initialSessionId = params.get("initialSessionId");
  const sidebarRef = useRef<SessionSidebarHandle | null>(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [restoreDoneCount, setRestoreDoneCount] = useState(0);
  const [selections, setSelections] = useState<string[]>([]);

  window.sidebarFixture = {
    getSelectedIds: () => selections,
    getRestoreDoneCount: () => restoreDoneCount,
    findSession: (id: string) => sidebarRef.current?.findSession(id) ?? null,
  };

  return (
    <I18nProvider>
      <div style={{ width: 320, height: "100vh", display: "flex", flexDirection: "column" }}>
        <SessionSidebar
          ref={sidebarRef}
          selectedSession={selectedSession}
          selectedSessionId={selectedSession?.id ?? null}
          selectedCwd={selectedCwd}
          initialSessionId={initialSessionId}
          onOpenSubagent={() => {}}
          onCwdChange={(cwd) => setSelectedCwd(cwd)}
          onSelectSession={(session, isRestore) => {
            setSelectedSession(session);
            setSelections((prev) => [...prev, \`\${session.id}:\${isRestore ? "restore" : "click"}\`]);
          }}
          onInitialRestoreDone={() => setRestoreDoneCount((c) => c + 1)}
        />
      </div>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`,
  );

  const compiler = webpack({
    mode: "development",
    target: "web",
    devtool: false,
    entry: path.join(directory, "entry.tsx"),
    output: { path: directory, filename: "bundle.js" },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
      modules: ["node_modules", path.join(repo, "node_modules")],
      alias: { "@": repo },
    },
    module: {
      rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "ts.cjs") },
        { test: /\.css$/, use: path.join(directory, "css.cjs") },
      ],
    },
  });

  await new Promise((resolve, reject) =>
    compiler.run((error, stats) =>
      compiler.close(() =>
        error || stats.hasErrors()
          ? reject(error || new Error(stats.toString({ all: false, errors: true })))
          : resolve(),
      ),
    ),
  );

  css = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "");
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : "chromium",
    headless: true,
  });
});

test.after(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setupSidebarPage(options = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const heldFlagPatches = [];
  const patchWaiters = [];
  const state = {
    failPage2: Boolean(options.failPage2),
    holdFlagPatches: Boolean(options.holdFlagPatches),
    heldFlagPatches,
    patchLog: [],
    nextPatch: () =>
      heldFlagPatches.length
        ? Promise.resolve(heldFlagPatches.shift())
        : new Promise((resolve) => patchWaiters.push(resolve)),
  };

  await page.addInitScript((locale) => {
    localStorage.setItem("pi-locale", locale);
    localStorage.removeItem("piora:sidebar-collapsed-projects:v1");
  }, options.locale ?? "en");

  const page1Sessions = options.page1Sessions ?? [
    {
      id: "task-alpha",
      name: "Alpha Task",
      firstMessage: "Alpha Task",
      path: "F:/fixture/task-alpha.jsonl",
      cwd: "F:/fixture",
      projectRoot: "F:/fixture",
      created: "2026-11-22T01:00:00Z",
      modified: "2026-11-22T02:00:00Z",
      messageCount: 2,
    },
  ];
  const page2Sessions = options.page2Sessions ?? [
    {
      id: "task-page2-target",
      name: "Deep Link Page 2",
      firstMessage: "Deep Link Page 2",
      path: "F:/fixture/task-page2-target.jsonl",
      cwd: "F:/fixture",
      projectRoot: "F:/fixture",
      created: "2026-11-21T01:00:00Z",
      modified: "2026-11-21T02:00:00Z",
      messageCount: 3,
    },
  ];

  await page.route("https://sidebar-reg.test/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const method = req.method();

    if (pathname.endsWith(".js")) {
      return route.fulfill({
        contentType: "text/javascript",
        body: await readFile(path.join(directory, path.basename(pathname))),
      });
    }
    if (pathname.startsWith("/fonts/")) {
      return route.fulfill({ status: 404, body: "" });
    }

    if (pathname === "/api/sessions") {
      if (url.searchParams.get("view") === "subagents") {
        return route.fulfill({ json: { subagentParentIds: options.subagentParentIds ?? [] } });
      }
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (offset === 0) {
        return route.fulfill({
          json: {
            sessions: page1Sessions,
            runningSessionIds: [],
            subagentParentIds: options.subagentParentIds ?? [],
            version: "v1",
            nextOffset: options.paginated ? 1 : null,
          },
        });
      }
      if (state.failPage2) {
        return route.fulfill({ status: 503, json: { error: "Page 2 temporary 503" } });
      }
      return route.fulfill({
        json: {
          sessions: page2Sessions,
          runningSessionIds: [],
          subagentParentIds: [],
          version: "v1",
          nextOffset: null,
        },
      });
    }

    if (pathname === "/api/sessions/flags") {
      if (method === "GET") {
        return route.fulfill({ json: { flags: {} } });
      }
      if (method === "PATCH") {
        const body = req.postDataJSON() ?? {};
        state.patchLog.push(body);
        if (state.holdFlagPatches) {
          const item = { route, body };
          if (patchWaiters.length) patchWaiters.shift()(item);
          else heldFlagPatches.push(item);
          return;
        }
        return route.fulfill({ json: { flag: { archived: Boolean(body.archived) } } });
      }
    }

    const subagentsListMatch = pathname.match(/^\/api\/agent\/([^/]+)\/subagents$/);
    if (subagentsListMatch) {
      return route.fulfill({
        json: {
          total: 2,
          records: [
            {
              agentId: "agent-running-1",
              parentSessionId: decodeURIComponent(subagentsListMatch[1]),
              description: "Explore Auth",
              status: "running",
              startedAt: Date.now() - 5000,
              updatedAt: Date.now(),
              attempt: 1,
            },
            {
              agentId: "agent-done-2",
              parentSessionId: decodeURIComponent(subagentsListMatch[1]),
              description: "Verify Schema",
              status: "completed",
              startedAt: Date.now() - 15000,
              endedAt: Date.now() - 5000,
              updatedAt: Date.now() - 5000,
              attempt: 1,
            },
          ],
          nextOffset: null,
        },
      });
    }

    if (pathname === "/api/rooms") return route.fulfill({ json: { rooms: [] } });
    if (pathname === "/api/worktrees") return route.fulfill({ json: { isGitRepository: false, projectRoot: "F:/fixture", worktrees: [] } });
    if (pathname === "/api/home") return route.fulfill({ json: { home: "C:/Users/test" } });
    if (pathname === "/api/agent/running") return route.fulfill({ json: {
      runningSessionIds: options.subagentParentIds ?? [],
      runningSessions: (options.subagentParentIds ?? []).map(id => ({ id, runtime: "running", pendingApproval: false, lastPromptFailed: false, runningSubagentCount: 1 })),
    } });

    if (pathname === "/" || pathname.startsWith("/?")) {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}</style><div id="root"></div><script src="/bundle.js"></script>`,
      });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto(`https://sidebar-reg.test/${options.query ?? ""}`);
  return { page, state, errors };
}

test("R6: archive + immediate undo ignores late out-of-order archive response", { timeout: 90000 }, async () => {
  const { page, state, errors } = await setupSidebarPage({ holdFlagPatches: true });
  try {
    const taskRow = page.getByRole("treeitem", { name: "Alpha Task", exact: true });
    await taskRow.waitFor();

    // Right click to open context menu and archive
    await taskRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive task", exact: true }).click();

    const patchArchive = await state.nextPatch();
    assert.equal(patchArchive.body.archived, true);

    // Undo toast appears while PATCH #1 is still in flight
    const undoBtn = page.getByRole("button", { name: "Undo", exact: true });
    await undoBtn.waitFor();
    await undoBtn.click();

    const patchUndo = await state.nextPatch();
    assert.equal(patchUndo.body.archived, false);

    // Resolve Undo (#2) FIRST, then resolve Archive (#1) LATE
    await patchUndo.route.fulfill({ json: { flag: { archived: false } } });
    await taskRow.waitFor();

    await patchArchive.route.fulfill({ json: { flag: { archived: true } } });
    await page.waitForTimeout(100);

    assert.equal(await taskRow.count(), 1, "late archive response must not hide unarchived task");
    assert.equal(await taskRow.isVisible(), true);

    // Also verify out-of-order 503 failure on PATCH #1 after PATCH #2 succeeds keeps task visible
    await taskRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive task", exact: true }).click();
    const patchArchiveFail = await state.nextPatch();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const patchUndoOk = await state.nextPatch();
    await patchUndoOk.route.fulfill({ json: { flag: { archived: false } } });
    await patchArchiveFail.route.fulfill({ status: 503, json: { error: "Transient 503" } });
    await page.waitForTimeout(100);
    assert.equal(await taskRow.isVisible(), true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("R9: failed page 2 pagination preserves initialSessionId and selects deep-linked session after Retry", { timeout: 90000 }, async () => {
  const { page, state, errors } = await setupSidebarPage({
    paginated: true,
    failPage2: true,
    query: "?initialSessionId=task-page2-target",
  });
  try {
    const alert = page.getByRole("alert");
    await alert.waitFor();
    const retryBtn = alert.getByRole("button", { name: "Retry" });
    await retryBtn.waitFor();

    assert.equal(await page.evaluate(() => window.sidebarFixture.getRestoreDoneCount()), 0, "restore must stay pending after failed page 2");
    assert.deepEqual(await page.evaluate(() => window.sidebarFixture.getSelectedIds()), []);

    state.failPage2 = false;
    await retryBtn.click();

    await page.waitForFunction(() => window.sidebarFixture.getSelectedIds().includes("task-page2-target:restore"));
    assert.equal(await page.evaluate(() => window.sidebarFixture.findSession("task-page2-target")?.id), "task-page2-target");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("A02: running subagent row exposes localized running status in both English and Chinese", { timeout: 90000 }, async () => {
  for (const [locale, expected] of [
    ["en", /Running/],
    ["zh-CN", /运行中/],
  ]) {
    const { page, errors } = await setupSidebarPage({
      locale,
      subagentParentIds: ["task-alpha"],
    });
    try {
      const groupRow = page.locator('[data-subagent-group="task-alpha"]');
      await groupRow.waitFor();
      await groupRow.click();

      const runningSubagentRow = page.locator('[data-subagent-row="agent-running-1"]');
      await runningSubagentRow.waitFor();
      const accessibleText = await runningSubagentRow.evaluate((el) => el.textContent ?? "");
      assert.match(accessibleText, expected);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});
