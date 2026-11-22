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
  directory = await mkdtemp(path.join(tmpdir(), "piora-side-chat-browser-"));
  await writeFile(
    path.join(directory, "ts.cjs"),
    `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`,
  );
  await writeFile(
    path.join(directory, "css.cjs"),
    `module.exports=function(s){const prefix=require('node:path').basename(this.resourcePath).replace(/\\W/g,'_');const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+'_'+m[1]]));const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(_,n)=>'.'+names[n]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.append(style);export default '+JSON.stringify(names)}`,
  );

  const stubs = path.join(directory, "stubs.tsx");
  await writeFile(
    stubs,
    "export const FileExplorer=()=>null;export const FileViewer=()=>null;export const TabBar=()=>null;export const ReviewPanel=()=>null;export const CommandPanel=()=>null;export const BrowserPanel=()=>null;export const SafeHarmonyPanel=()=>null;export const AutomationPanel=()=>null;export const SSHPanel=()=>null;export const DesignToHarmonyPanel=()=>null;export default ()=>()=>null;",
  );

  await writeFile(
    path.join(directory, "entry.tsx"),
    `
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/hooks/useI18n";
import { ChatWindow } from "@/components/ChatWindow";
import { RightPanel, type RightPanelTab } from "@/components/workspace/RightPanel";
import { useSideChatController } from "@/components/side-chat/useSideChatController";
import { SideChatSwitcherPopover } from "@/components/side-chat/SideChatSwitcherPopover";
import { SideChatCloseConfirmDialog } from "@/components/side-chat/SideChatCloseConfirmDialog";
import { parseSideChatTabId, type SideChatTabId } from "@/components/side-chat/side-chat-events";

const noop = () => {};
const SESSIONS = {
  "parent-a": {
    id: "parent-a",
    path: "F:/fixture/parent-a.jsonl",
    cwd: "F:/fixture",
    name: "Parent A",
    created: "2026-11-22T00:00:00Z",
    modified: "2026-11-22T00:00:00Z",
    messageCount: 2,
    firstMessage: "Started parent A",
  },
  "parent-b": {
    id: "parent-b",
    path: "F:/fixture/parent-b.jsonl",
    cwd: "F:/fixture",
    name: "Parent B",
    created: "2026-11-22T00:00:00Z",
    modified: "2026-11-22T00:00:00Z",
    messageCount: 2,
    firstMessage: "Started parent B",
  },
};

function App() {
  const initParent = new URLSearchParams(window.location.search).get("initialParent") ?? "parent-a";
  const delayParentRestore = new URLSearchParams(window.location.search).get("delayParent") === "1";
  const [session, setSession] = useState(delayParentRestore ? null : SESSIONS[initParent] ?? SESSIONS["parent-a"]);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("home");
  const [restoredSideChatTab, setRestoredSideChatTab] = useState<SideChatTabId | null>(null);
  const [tabRestored, setTabRestored] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("piora-right-panel-tab");
    const parsed = stored ? parseSideChatTabId(stored) : null;
    if (stored === "files" || stored === "review" || stored === "commands" || stored === "browser") {
      setRightPanelTab(stored);
      setRestoredSideChatTab(null);
    } else {
      setRightPanelTab("home");
      setRestoredSideChatTab(parsed?.kind === "live" ? (stored as SideChatTabId) : null);
    }
    setTabRestored(true);
  }, []);

  useEffect(() => {
    if (restoredSideChatTab && rightPanelTab !== "home") {
      setRestoredSideChatTab(null);
    }
  }, [restoredSideChatTab, rightPanelTab]);

  useEffect(() => {
    if (!tabRestored) return;
    if (rightPanelTab === "home" && restoredSideChatTab !== null) return;
    if (parseSideChatTabId(rightPanelTab)?.kind === "loading") return;
    window.localStorage.setItem("piora-right-panel-tab", rightPanelTab);
  }, [restoredSideChatTab, rightPanelTab, tabRestored]);

  const handleRestoredHandled = useCallback(() => {
    setRestoredSideChatTab(null);
  }, []);

  const sideChat = useSideChatController({
    enabled: true,
    parentSession: session,
    parentSnapshot: null,
    parentRunning: false,
    rightPanelOpen,
    rightPanelTab,
    setRightPanelOpen,
    setRightPanelTab,
    restoredSideChatTab,
    onRestoredSideChatTabHandled: handleRestoredHandled,
    onPromotedSession: noop,
    onJumpToParent: noop,
  });

  window.fixtureApi = {
    switchParent: (id) => setSession(id ? SESSIONS[id] ?? null : null),
    openOrCreate: (req) => sideChat.openOrCreateSideChat(req),
    selectSideChat: (id) => sideChat.selectSideChat(id),
    getSideChatState: () => ({
      parentId: session?.id ?? null,
      rightPanelTab,
      rightPanelOpen,
      openIds: sideChat.openIds,
      items: sideChat.items,
    }),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <header style={{ display: "flex", gap: 8, padding: 8, borderBottom: "1px solid #333" }}>
          <button type="button" onClick={() => setSession(SESSIONS["parent-a"])}>Switch Parent A</button>
          <button type="button" onClick={() => setSession(SESSIONS["parent-b"])}>Switch Parent B</button>
          <button type="button" ref={anchorRef} onClick={() => setSwitcherOpen((open) => !open)}>Side Chat Switcher</button>
          <button type="button" onClick={() => void sideChat.openOrCreateSideChat({ storage: "temporary", forceNew: true })}>New Temp Side Chat</button>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 0 }}>
          <div style={{ minHeight: 0, overflow: "hidden" }}>
            <ChatWindow
              visible
              session={session}
              newSessionCwd="F:/fixture"
              sideChatEnabled
              onOpenSideChat={sideChat.openOrCreateSideChat}
            />
          </div>
          <div style={{ minHeight: 0, overflow: "hidden", display: rightPanelOpen ? "flex" : "none", flexDirection: "column" }}>
            <RightPanel
              sideChat={sideChat.panelProps}
              activeTab={rightPanelTab}
              onActiveTabChange={setRightPanelTab}
              cwd="F:/fixture"
              refreshKey={0}
              active={rightPanelOpen}
              maximized={false}
              onMaximizedChange={noop}
              onClosePanel={() => setRightPanelOpen(false)}
              fileTabs={[]}
              activeFileTabId={null}
              canReopenClosedFileTab={false}
              onSelectFileTab={noop}
              onCloseFileTab={noop}
              onCloseOtherFileTabs={noop}
              onCloseFileTabsToRight={noop}
              onMoveFileTab={noop}
              onReopenClosedFileTab={noop}
              onOpenFile={noop}
              onDirtyChange={noop}
              onRefresh={noop}
              onMention={noop}
              onMentions={noop}
              onMentionLines={noop}
              selectedAutomationId={null}
              sessionId={session?.id ?? null}
              capabilities={null}
            />
          </div>
        </div>
        <SideChatSwitcherPopover
          open={switcherOpen}
          anchorRef={anchorRef}
          canCreate={sideChat.canCreate}
          items={sideChat.items}
          activeSideChatId={sideChat.activeSideChatId}
          unreadIds={sideChat.unreadIds}
          onClose={() => setSwitcherOpen(false)}
          onSelect={sideChat.selectSideChat}
          onCreate={(storage) => { void sideChat.openOrCreateSideChat({ storage, forceNew: true }); }}
          onUnarchive={(id) => { void sideChat.setArchivedSideChat(id, false); }}
        />
        <SideChatCloseConfirmDialog
          open={Boolean(sideChat.pendingCloseConfirm)}
          onCancel={sideChat.cancelCloseConfirm}
          onConfirm={sideChat.confirmCloseTemporary}
        />
      </div>
  );
}

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
`,
  );

  const alias = Object.fromEntries(
    [
      "../FileExplorer",
      "../FileViewer",
      "../TabBar",
      "./ReviewPanel",
      "./CommandPanel",
      "./BrowserPanel",
      "./HarmonyPanel",
      "../AutomationPanel",
      "./SSHPanel",
      "./design-to-harmony/DesignToHarmonyPanel",
      "next/dynamic",
    ].map((name) => [name + "$", stubs]),
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
      alias: { ...alias, "@": repo },
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

async function setupHarnessPage(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));

  const longTail = "TAIL-MARKER-250";
  const longMessage = `${"A".repeat(250 - longTail.length)}${longTail}`;
  assert.equal(longMessage.length, 250);

  let sideCounter = 0;
  const sideChatsByParent = new Map([
    ["parent-a", options.initialParentASideChats ?? []],
    ["parent-b", options.initialParentBSideChats ?? []],
  ]);

  const queueCommandId = "cmd_11111111-1111-1111-1111-111111111111";
  const queueRecordsByParent = new Map([
    [
      "parent-a",
      options.withQueuedItem
        ? [
            {
              commandId: queueCommandId,
              idempotencyKey: "queue-idem-1",
              targetSessionId: "parent-a",
              acceptedAt: 1_000,
              status: "queued",
              revision: 1,
              queuePaused: false,
              preview: longMessage.slice(0, 180),
            },
          ]
        : [],
    ],
    ["parent-b", []],
  ]);
  const fullDraftsByCommandId = new Map([
    [queueCommandId, { value: longMessage, images: [], files: [] }],
  ]);

  const state = {
    longMessage,
    sideChatsByParent,
    queueActionLog: [],
    sideCreateStatus: 201,
    sideDeleteStatus: 200,
    sideDeleteLog: [],
    agentSubmitStatus: 200,
    agentSubmitLog: [],
    holdCreate: false,
    heldCreates: [],
    createWaiters: [],
    holdGetByParent: new Set(),
    heldGets: [],
    getWaiters: [],
    runningSideIds: new Set(options.runningSideIds ?? []),
    nextHeldCreate: () =>
      state.heldCreates.length
        ? Promise.resolve(state.heldCreates.shift())
        : new Promise((resolve) => state.createWaiters.push(resolve)),
    nextHeldGet: () =>
      state.heldGets.length
        ? Promise.resolve(state.heldGets.shift())
        : new Promise((resolve) => state.getWaiters.push(resolve)),
  };

  await page.addInitScript(
    ({ locale, initialStorage }) => {
      localStorage.setItem("pi-locale", locale);
      for (const [k, v] of Object.entries(initialStorage ?? {})) {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      }
    },
    { locale: options.locale ?? "en", initialStorage: options.initialStorage ?? {} },
  );

  await page.route("https://side-chat.test/**", async (route) => {
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

    const sideChatsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/side-chats$/);
    if (sideChatsMatch) {
      const parentId = decodeURIComponent(sideChatsMatch[1]);
      if (method === "GET") {
        if (state.holdGetByParent.has(parentId)) {
          const item = { route, parentId };
          if (state.getWaiters.length) state.getWaiters.shift()(item);
          else state.heldGets.push(item);
          return;
        }
        return route.fulfill({
          json: {
            enabled: true,
            parentArchived: false,
            sideChats: state.sideChatsByParent.get(parentId) ?? [],
          },
        });
      }
      if (method === "POST") {
        const body = req.postDataJSON() ?? {};
        const completeCreate = async () => {
          if (state.sideCreateStatus !== 201 && state.sideCreateStatus !== 200) {
            return route.fulfill({
              status: state.sideCreateStatus,
              json: { error: `Simulated create ${state.sideCreateStatus}` },
            });
          }
          sideCounter += 1;
          const summary = {
            id: `side-${parentId}-${sideCounter}`,
            parentSessionId: parentId,
            storage: body.storage === "temporary" ? "temporary" : "attached",
            title: `Side ${sideCounter}`,
            isDefaultTitle: true,
            preview: "",
            createdAt: "2026-11-22T01:00:00Z",
            modifiedAt: "2026-11-22T01:00:00Z",
            messageCount: 0,
            running: false,
            archived: false,
            expired: false,
            cwd: "F:/fixture",
          };
          const list = state.sideChatsByParent.get(parentId) ?? [];
          state.sideChatsByParent.set(parentId, [summary, ...list]);
          return route.fulfill({ status: 201, json: { sideChat: summary } });
        };
        if (state.holdCreate) {
          const item = { route, parentId, finish: completeCreate };
          if (state.createWaiters.length) state.createWaiters.shift()(item);
          else state.heldCreates.push(item);
          return;
        }
        return completeCreate();
      }
    }

    const sideChatItemMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/side-chats\/([^/]+)$/);
    if (sideChatItemMatch) {
      const parentId = decodeURIComponent(sideChatItemMatch[1]);
      const sideId = decodeURIComponent(sideChatItemMatch[2]);
      if (method === "DELETE") {
        state.sideDeleteLog.push({ parentId, sideId, status: state.sideDeleteStatus });
        if (state.sideDeleteStatus !== 200) {
          return route.fulfill({
            status: state.sideDeleteStatus,
            json: { error: `Simulated delete ${state.sideDeleteStatus}` },
          });
        }
        const list = state.sideChatsByParent.get(parentId) ?? [];
        state.sideChatsByParent.set(parentId, list.filter((s) => s.id !== sideId));
        return route.fulfill({ json: { ok: true } });
      }
      if (method === "PATCH") {
        return route.fulfill({ json: { sideChat: (state.sideChatsByParent.get(parentId) ?? []).find((s) => s.id === sideId) } });
      }
    }

    const submissionsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/submissions$/);
    if (submissionsMatch) {
      const sid = decodeURIComponent(submissionsMatch[1]);
      const cmdId = url.searchParams.get("commandId");
      if (cmdId) {
        const draft = fullDraftsByCommandId.get(cmdId);
        if (!draft) return route.fulfill({ status: 404, json: { error: "Missing draft" } });
        return route.fulfill({ json: draft });
      }
      return route.fulfill({
        json: {
          items: queueRecordsByParent.get(sid) ?? [],
          nextOffset: null,
        },
      });
    }

    const stateMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/state$/);
    if (stateMatch) {
      const sid = decodeURIComponent(stateMatch[1]);
      if (state.runningSideIds.has(sid)) {
        return route.fulfill({
          json: {
            running: true,
            state: {
              runtime: "running",
              isStreaming: true,
              isPromptRunning: true,
              isCompacting: false,
              isBashRunning: false,
            },
          },
        });
      }
      return route.fulfill({ json: { running: false } });
    }

    const permsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/permissions$/);
    if (permsMatch || pathname === "/api/tool-permissions") {
      return route.fulfill({ json: { mode: "ask", legacy: false } });
    }

    const reviewsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/tool-reviews$/);
    if (reviewsMatch) {
      return route.fulfill({ json: { reviews: [] } });
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sid = decodeURIComponent(sessionMatch[1]);
      return route.fulfill({
        json: {
          info: {
            id: sid,
            path: `F:/fixture/${sid}.jsonl`,
            cwd: "F:/fixture",
            created: "2026-11-22T00:00:00Z",
            modified: "2026-11-22T00:00:00Z",
            messageCount: 2,
            firstMessage: "Started",
          },
          context: {
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "Started" }],
                timestamp: 1,
              },
            ],
            entryIds: ["u1"],
            leafId: null,
            modelChanges: [],
          },
        },
      });
    }

    const eventsMatch = pathname.match(/^\/api\/agent\/([^/]+)\/events$/);
    if (eventsMatch) {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'retry: 60000\ndata: {"type":"connected"}\n\n',
      });
    }

    const workflowMatch = pathname.match(/^\/api\/agent\/([^/]+)\/workflow$/);
    if (workflowMatch) {
      const sid = decodeURIComponent(workflowMatch[1]);
      return route.fulfill({
        json: { sessionId: sid, mode: "agent", turnBudget: 10 },
      });
    }

    const subagentsMatch = pathname.match(/^\/api\/agent\/([^/]+)\/subagents$/);
    if (subagentsMatch) {
      return route.fulfill({ json: { total: 0, records: [] } });
    }

    if (/^\/api\/agent\/[^/]+\/changes$/.test(pathname)) {
      // The real changes endpoint returns null when this session has no recorded file changes.
      return route.fulfill({ contentType: "application/json", body: "null" });
    }

    const agentMatch = pathname.match(/^\/api\/agent\/([^/]+)$/);
    if (agentMatch) {
      const sid = decodeURIComponent(agentMatch[1]);
      if (method === "GET") {
        if (state.runningSideIds.has(sid)) {
          return route.fulfill({
            json: {
              running: true,
              runtimeProfile: "normal",
              state: {
                runtime: "running",
                isStreaming: true,
                isPromptRunning: true,
                isCompacting: false,
                isBashRunning: false,
              },
            },
          });
        }
        return route.fulfill({ json: { running: false, runtimeProfile: "normal" } });
      }
      if (method === "POST") {
        const body = req.postDataJSON() ?? {};
        if (body.type === "queued_input_action") {
          const list = queueRecordsByParent.get(sid) ?? [];
          const idx = list.findIndex((item) => item.commandId === body.commandId);
          if (idx < 0) return route.fulfill({ status: 404, json: { error: "Not found" } });
          const current = list[idx];
          state.queueActionLog.push({
            sid,
            commandId: body.commandId,
            action: body.action,
            expectedRevision: body.expectedRevision,
          });
          let next = { ...current, revision: current.revision + 1 };
          if (body.action === "pause") next.queuePaused = true;
          else if (body.action === "resume") next.queuePaused = false;
          else if (body.action === "cancel") next.status = "cancelled";
          list[idx] = next;
          return route.fulfill({ json: { success: true, data: next } });
        }
        if (body.type === "submit_input") {
          state.agentSubmitLog.push({ sid, body, status: state.agentSubmitStatus });
          if (state.agentSubmitStatus !== 200) {
            return route.fulfill({
              status: state.agentSubmitStatus,
              json: { error: `Simulated submit ${state.agentSubmitStatus}` },
            });
          }
          state.runningSideIds.add(sid);
          return route.fulfill({
            json: {
              success: true,
              data: { accepted: true, commandId: "cmd_22222222-2222-2222-2222-222222222222", sessionId: sid, status: "queued" },
            },
          });
        }
        return route.fulfill({ json: { success: true, data: {} } });
      }
    }

    if (pathname === "/api/settings/laboratory") {
      return route.fulfill({ json: { planGoalEnabled: false } });
    }
    if (pathname === "/api/settings/side-chat") {
      return route.fulfill({ json: { enabled: true } });
    }
    if (pathname === "/api/system-prompt") {
      return route.fulfill({ json: { selectorVisible: false, templates: [] } });
    }
    if (pathname === "/api/models") {
      return route.fulfill({
        json: {
          models: {},
          modelList: [],
          defaultModel: null,
          thinkingLevels: {},
          thinkingLevelMaps: {},
          thinkingLevelPins: {},
        },
      });
    }
    if (pathname === "/api/agent/running") {
      return route.fulfill({ json: { runningSessionIds: [], runningSessions: [] } });
    }
    if (pathname === "/api/prompts") {
      return route.fulfill({ json: { prompts: [] } });
    }

    if (pathname === "/" || pathname.startsWith("/?")) {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}</style><div id="root"></div><script src="/bundle.js"></script>`,
      });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto(`https://side-chat.test/${options.query ?? ""}`);
  if (errors.length) throw new Error(errors.join("\n"));
  await page.waitForFunction(() => Boolean(window.fixtureApi));
  return { page, state, errors };
}

test("R1: queue-to-side-chat transfers full 250-char text and preserves/resumes queued item on 503", { timeout: 90000 }, async () => {
  const { page, state, errors } = await setupHarnessPage({ withQueuedItem: true });
  try {
    const openSideBtn = page.getByRole("button", { name: "Open in side chat" });
    await openSideBtn.waitFor();

    // 503 create failure: pause -> restore -> POST (503) -> resume, NEVER cancel
    state.sideCreateStatus = 503;
    await openSideBtn.click();
    await page.locator("section p[role='alert']").waitFor();

    assert.deepEqual(
      state.queueActionLog.map((entry) => entry.action),
      ["pause", "resume"],
      "503 failure must resume the paused queue item and never cancel it",
    );
    assert.equal(state.agentSubmitLog.length, 0);
    await openSideBtn.waitFor();

    // Now succeed: pause -> restore -> POST (201) -> submit_input (200, full 250 chars) -> cancel
    state.sideCreateStatus = 201;
    state.queueActionLog.length = 0;
    const sideSubmit = page.waitForResponse(response => response.request().method() === "POST"
      && /^\/api\/agent\/[^/]+$/.test(new URL(response.url()).pathname)
      && response.request().postDataJSON()?.type === "submit_input");
    const queueCancel = page.waitForResponse(response => response.request().method() === "POST"
      && /^\/api\/agent\/[^/]+$/.test(new URL(response.url()).pathname)
      && response.request().postDataJSON()?.action === "cancel");
    await openSideBtn.click();

    await sideSubmit;
    await queueCancel;
    const newSideTab = page.locator('[role="tab"][aria-controls="workspace-sidechat:side-parent-a-1"]');
    await newSideTab.waitFor();
    assert.equal(await newSideTab.getAttribute("aria-controls"), "workspace-sidechat:side-parent-a-1");
    assert.equal(await newSideTab.getAttribute("aria-selected"), "true");
    assert.equal(state.agentSubmitLog.length, 1);
    assert.equal(state.agentSubmitLog[0].body.type, "submit_input");
    assert.equal(state.agentSubmitLog[0].body.message, state.longMessage);
    assert.equal(state.agentSubmitLog[0].body.message.length, 250);
    assert.match(state.agentSubmitLog[0].body.idempotencyKey, /^side-transfer:cmd_/);
    assert.deepEqual(
      state.queueActionLog.map((entry) => entry.action),
      ["pause", "cancel"],
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("R4: /side keeps composer draft across 503 create or 503 submit failures and clears only after success", { timeout: 90000 }, async () => {
  const { page, state, errors } = await setupHarnessPage();
  try {
    const textarea = page.locator("div[data-chat-surface] textarea").first();
    await textarea.waitFor();
    await textarea.fill("/side keep-this-question");

    // Case 1: POST /side-chats fails with 503
    state.sideCreateStatus = 503;
    await textarea.press("Enter");
    await page.locator('[role="alert"]').first().waitFor();
    assert.equal(await textarea.inputValue(), "/side keep-this-question");

    // Case 2: POST /side-chats succeeds (201), but durable submit_input fails with 503
    state.sideCreateStatus = 201;
    state.agentSubmitStatus = 503;
    const cleanup = page.waitForResponse(response => response.request().method() === "DELETE" && /\/side-chats\//.test(new URL(response.url()).pathname));
    await textarea.press("Enter");
    await cleanup;
    await page.getByRole("alert").filter({ hasText: "Simulated submit 503" }).first().waitFor();
    assert.equal(await textarea.inputValue(), "/side keep-this-question");
    assert.equal(state.sideDeleteLog.length, 1, "orphan empty side chat should be cleaned up on submit 503");

    // Case 3: Both succeed -> draft clears and side chat tab opens
    state.agentSubmitStatus = 200;
    await textarea.press("Enter");
    await page.waitForFunction(() => document.querySelector("div[data-chat-surface] textarea")?.value === "");
    assert.equal(state.agentSubmitLog.at(-1)?.body.message, "keep-this-question");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("R2: closing a running temporary side chat with messageCount 0 requires confirmation and DELETE 503 retains item", { timeout: 90000 }, async () => {
  const tempSummary = {
    id: "side-temp-running",
    parentSessionId: "parent-a",
    storage: "temporary",
    title: "Temp Run",
    isDefaultTitle: false,
    preview: "",
    createdAt: "2026-11-22T01:00:00Z",
    modifiedAt: "2026-11-22T01:00:00Z",
    messageCount: 0,
    running: false,
    archived: false,
    expired: false,
    cwd: "F:/fixture",
  };
  const { page, state, errors } = await setupHarnessPage({
    initialParentASideChats: [tempSummary],
    runningSideIds: ["side-temp-running"],
    initialStorage: {
      "piora-side-chat-open-tabs:parent-a": JSON.stringify(["side-temp-running"]),
      "piora-side-chat-skip-temp-close-confirm": null,
    },
  });
  try {
    const tempTab = page.getByRole("tab", { name: "Temp Run" });
    await tempTab.waitFor();
    await tempTab.click();
    // Wait until LiveSideChatSessionView observes running state via GET /api/agent/side-temp-running
    await page.getByText("Side chat running").waitFor();

    await page.getByRole("button", { name: "Close tab", exact: true }).click();
    const confirmDialog = page.getByRole("dialog");
    await confirmDialog.waitFor();
    assert.equal(state.sideDeleteLog.length, 0, "must confirm before issuing DELETE");

    // 503 delete failure preserves tab & shows error alert
    state.sideDeleteStatus = 503;
    await confirmDialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator('[role="alert"]').first().waitFor();
    assert.equal(await page.getByRole("tab", { name: "Temp Run" }).count(), 1);
    assert.equal(state.sideDeleteLog.length, 1);

    // Retry with 200 succeeds and removes tab
    state.sideDeleteStatus = 200;
    await page.getByRole("button", { name: "Close tab", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="tab"]'));
    assert.equal(state.sideDeleteLog.length, 2);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("R3 & R8 & A01: switching parent isolates side chats immediately, late create respects Files tab, and keyboard navigates static+side tabs", { timeout: 90000 }, async () => {
  const alpha = {
    id: "side-a1",
    parentSessionId: "parent-a",
    storage: "attached",
    title: "Alpha Side Chat",
    isDefaultTitle: false,
    preview: "Alpha preview",
    createdAt: "2026-11-22T01:00:00Z",
    modifiedAt: "2026-11-22T01:00:00Z",
    messageCount: 1,
    running: false,
    archived: false,
    expired: false,
    cwd: "F:/fixture",
  };
  const { page, state, errors } = await setupHarnessPage({
    initialParentASideChats: [alpha],
    initialStorage: {
      "piora-side-chat-open-tabs:parent-a": JSON.stringify(["side-a1"]),
      "piora-right-panel-tab": "review",
    },
  });
  try {
    const reviewTab = page.getByRole("tab", { name: "Review", exact: true });
    const alphaTab = page.getByRole("tab", { name: "Alpha Side Chat" });
    await reviewTab.waitFor();
    await alphaTab.waitFor();

    // A01: Unified keyboard navigation across static ("review") and dynamic ("Alpha Side Chat") tabs
    await reviewTab.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await alphaTab.getAttribute("aria-selected"), "true");
    assert.equal(await alphaTab.evaluate((el) => document.activeElement === el), true);

    await page.keyboard.press("ArrowLeft");
    assert.equal(await reviewTab.getAttribute("aria-selected"), "true");
    assert.equal(await reviewTab.evaluate((el) => document.activeElement === el), true);

    await page.keyboard.press("End");
    assert.equal(await alphaTab.getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    assert.equal(await reviewTab.getAttribute("aria-selected"), "true");

    // R8: Start creating side chat while holding POST, switch to Files, release POST -> Files remains active
    state.holdCreate = true;
    await page.getByRole("button", { name: "New Temp Side Chat" }).click();
    const heldCreate = await state.nextHeldCreate();
    await page.getByRole("button", { name: "Open tool", exact: true }).click();
    await page.getByRole("menuitem", { name: /Files/ }).click();
    const filesTab = page.getByRole("tab", { name: "Files", exact: true });
    assert.equal(await filesTab.getAttribute("aria-selected"), "true");

    state.holdCreate = false;
    await heldCreate.finish();
    await page.getByRole("tab", { name: "Side chat", exact: true }).waitFor();
    assert.equal(await filesTab.getAttribute("aria-selected"), "true", "late create response must not steal focus from Files");

    // R3: Switch A -> B with delayed B GET; pre-loaded stale stored tab in B also reconciles cleanly
    await page.evaluate(() => {
      localStorage.setItem("piora-side-chat-open-tabs:parent-b", JSON.stringify(["stale-b-id"]));
    });
    state.holdGetByParent.add("parent-b");
    await page.getByRole("button", { name: "Switch Parent B" }).click();
    const heldB = await state.nextHeldGet();

    // While B's GET is still pending, A's items must be completely absent and unselectable
    await page.getByRole("button", { name: "Side Chat Switcher" }).click();
    assert.equal(await page.getByRole("dialog", { name: "Side chats", exact: true }).getByText("Alpha Side Chat").count(), 0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.fixtureApi.selectSideChat("side-a1"));
    assert.equal(await page.evaluate(() => window.fixtureApi.getSideChatState().openIds.includes("side-a1")), false);

    state.holdGetByParent.delete("parent-b");
    await heldB.route.fulfill({ json: { enabled: true, parentArchived: false, sideChats: [] } });
    await page.waitForFunction(() => window.fixtureApi.getSideChatState().openIds.length === 0);
    assert.equal(await filesTab.getAttribute("aria-selected"), "true");

    // Verify stale sidechat tab resets to home when B resolves empty
    await page.getByRole("button", { name: "Switch Parent A" }).click();
    await alphaTab.click();
    assert.equal(await page.evaluate(() => window.fixtureApi.getSideChatState().rightPanelTab), "sidechat:side-a1");

    await page.evaluate(() => {
      window.localStorage.setItem("piora-side-chat-open-tabs:parent-b", JSON.stringify(["stale-b-id"]));
    });
    state.holdGetByParent.add("parent-b");
    await page.getByRole("button", { name: "Switch Parent B" }).click();
    const heldBAgain = await state.nextHeldGet();
    state.holdGetByParent.delete("parent-b");
    await heldBAgain.route.fulfill({ json: { enabled: true, parentArchived: false, sideChats: [] } });
    await page.waitForFunction(() => window.fixtureApi.getSideChatState().rightPanelTab === "home");
    assert.equal(await page.evaluate(() => window.fixtureApi.getSideChatState().openIds.length), 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("S05: reload restores valid active sidechat:<id> tab and falls back to home when missing or archived", { timeout: 90000 }, async () => {
  const s1 = {
    id: "side-persist-1",
    parentSessionId: "parent-a",
    storage: "attached",
    title: "Restored Chat",
    isDefaultTitle: false,
    preview: "",
    createdAt: "2026-11-22T01:00:00Z",
    modifiedAt: "2026-11-22T01:00:00Z",
    messageCount: 1,
    running: false,
    archived: false,
    expired: false,
    cwd: "F:/fixture",
  };

  // Valid restoration (even when parent session arrives asynchronously after mount)
  const valid = await setupHarnessPage({
    query: "?delayParent=1",
    initialParentASideChats: [s1],
    initialStorage: {
      "piora-right-panel-tab": "sidechat:side-persist-1",
      "piora-right-panel-open": "true",
    },
  });
  try {
    await valid.page.evaluate(() => window.fixtureApi.switchParent("parent-a"));
    const restoredTab = valid.page.getByRole("tab", { name: "Restored Chat" });
    await restoredTab.waitFor();
    assert.equal(await restoredTab.getAttribute("aria-selected"), "true");
    assert.deepEqual(valid.errors, []);
  } finally {
    await valid.page.close();
  }

  // Invalid / non-owned / expired fallback to "home"
  const invalid = await setupHarnessPage({
    query: "?delayParent=1",
    initialParentASideChats: [s1],
    initialStorage: {
      "piora-right-panel-tab": "sidechat:deleted-side-id",
      "piora-right-panel-open": "true",
    },
  });
  try {
    await invalid.page.evaluate(() => window.fixtureApi.switchParent("parent-a"));
    await invalid.page.waitForFunction(() => localStorage.getItem("piora-right-panel-tab") === "home");
    assert.equal(await invalid.page.evaluate(() => window.fixtureApi.getSideChatState().rightPanelTab), "home");
    assert.deepEqual(invalid.errors, []);
  } finally {
    await invalid.page.close();
  }
});
